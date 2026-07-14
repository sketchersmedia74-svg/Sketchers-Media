import { supabaseAdmin } from "@/lib/supabase";
import { getCalendarSettings, getFreeBusy, createCalendarEvent, CalendarSettings } from "@/lib/googleCalendar";
import { sendBookingConfirmationEmail } from "@/lib/email";

const DAYS_AHEAD = 14;
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type Slot = { start: string; end: string };

// Returns the timezone offset, in minutes, such that: local_ms = utc_ms + offsetMinutes.
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  return sign * (hours * 60 + minutes);
}

function partsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    weekday: get("weekday").toLowerCase().slice(0, 3),
  };
}

// Converts a local wall-clock time (dateStr "YYYY-MM-DD", "HH:mm") in the given
// IANA timezone into a UTC epoch-ms instant.
function localToUtcMs(dateStr: string, time: string, timeZone: string): number {
  const naiveUtcMs = new Date(`${dateStr}T${time}:00Z`).getTime();
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(naiveUtcMs), timeZone);
  return naiveUtcMs - offsetMinutes * 60000;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && aEnd > bStart;
}

export async function getOpenSlots(): Promise<Slot[]> {
  const settings = await getCalendarSettings();
  if (!settings || !settings.google_refresh_token) {
    throw new Error("Google Calendar is not connected yet.");
  }

  const now = new Date();
  const candidates: Slot[] = [];
  const stepMs = (settings.slot_duration_minutes + settings.buffer_minutes) * 60000;
  const durationMs = settings.slot_duration_minutes * 60000;

  for (let dayOffset = 0; dayOffset < DAYS_AHEAD; dayOffset++) {
    const refInstant = new Date(now.getTime() + dayOffset * 86400000);
    const { year, month, day, weekday } = partsInZone(refInstant, settings.timezone);
    const dateStr = `${year}-${month}-${day}`;
    const dayConfig = settings.working_hours[weekday];
    if (!dayConfig) continue;

    const dayStartMs = localToUtcMs(dateStr, dayConfig.start, settings.timezone);
    const dayEndMs = localToUtcMs(dateStr, dayConfig.end, settings.timezone);

    for (let cursor = dayStartMs; cursor + durationMs <= dayEndMs; cursor += stepMs) {
      if (cursor <= now.getTime()) continue;
      candidates.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + durationMs).toISOString() });
    }
  }

  if (candidates.length === 0) return [];

  const windowStart = candidates[0].start;
  const windowEnd = candidates[candidates.length - 1].end;
  const busy = await getFreeBusy(settings, windowStart, windowEnd);

  return candidates.filter((slot) => {
    const slotStartMs = new Date(slot.start).getTime();
    const slotEndMs = new Date(slot.end).getTime();
    return !busy.some((b) => overlaps(slotStartMs, slotEndMs, new Date(b.start).getTime(), new Date(b.end).getTime()));
  });
}

async function findOrCreateContact(
  db: ReturnType<typeof supabaseAdmin>,
  info: { name: string; email?: string; phone?: string }
) {
  if (info.email) {
    const { data: existing } = await db.from("contacts").select("*").ilike("email", info.email).maybeSingle();
    if (existing) return existing;
  }
  if (info.phone) {
    const { data: existing } = await db.from("contacts").select("*").ilike("phone", info.phone).maybeSingle();
    if (existing) return existing;
  }

  const trimmedName = info.name.trim();
  const spaceIdx = trimmedName.indexOf(" ");
  const first_name = (spaceIdx === -1 ? trimmedName : trimmedName.slice(0, spaceIdx)) || "Unknown";
  const last_name = spaceIdx === -1 ? null : trimmedName.slice(spaceIdx + 1);

  const { data: created, error } = await db
    .from("contacts")
    .insert({ first_name, last_name, email: info.email ?? null, phone: info.phone ?? null, source: "booking" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return created;
}

export type CreateBookingInput = {
  start: string;
  end: string;
  name: string;
  email?: string;
  phone?: string;
  contact_id?: string;
  source: "public_page" | "api";
};

export async function createBooking(input: CreateBookingInput) {
  const settings = await getCalendarSettings();
  if (!settings || !settings.google_refresh_token) {
    throw new Error("Google Calendar is not connected yet.");
  }

  const stillBusy = await getFreeBusy(settings, input.start, input.end);
  const requestedStart = new Date(input.start).getTime();
  const requestedEnd = new Date(input.end).getTime();
  const taken = stillBusy.some((b) =>
    overlaps(requestedStart, requestedEnd, new Date(b.start).getTime(), new Date(b.end).getTime())
  );
  if (taken) throw new Error("That time slot is no longer available. Please pick another.");

  const db = supabaseAdmin();

  const contact = input.contact_id
    ? (await db.from("contacts").select("*").eq("id", input.contact_id).single()).data
    : await findOrCreateContact(db, { name: input.name, email: input.email, phone: input.phone });
  if (!contact) throw new Error("Contact not found");

  const contactName = `${contact.first_name}${contact.last_name ? " " + contact.last_name : ""}`;

  const event = await createCalendarEvent(settings, {
    summary: `Meeting with ${contactName}`,
    description: `Booked via Sketchers Media CRM (${input.source === "api" ? "API" : "public booking page"}).`,
    start: input.start,
    end: input.end,
    attendeeEmail: contact.email ?? undefined,
  });

  const { data: openDeal } = await db
    .from("deals")
    .select("*")
    .eq("contact_id", contact.id)
    .not("stage", "in", "(Won,Lost)")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let deal = openDeal;
  if (!deal) {
    const { data: newDeal, error: dealError } = await db
      .from("deals")
      .insert({ title: `Booking: ${contactName}`, contact_id: contact.id, stage: "New" })
      .select()
      .single();
    if (dealError) throw new Error(dealError.message);
    deal = newDeal;
  }

  await db.from("notes").insert({
    contact_id: contact.id,
    text: `Booked a meeting for ${new Date(input.start).toLocaleString("en-US", { timeZone: settings.timezone })} via Google Calendar booking.`,
    created_by: "Booking system",
  });

  if (deal.stage === "New" || deal.stage === "Contacted") {
    await db.from("deals").update({ stage: "Proposal" }).eq("id", deal.id);
  }

  const { data: booking, error: bookingError } = await db
    .from("bookings")
    .insert({
      contact_id: contact.id,
      deal_id: deal.id,
      google_event_id: event.id,
      google_event_link: event.htmlLink,
      start_time: input.start,
      end_time: input.end,
      attendee_name: contactName,
      attendee_email: contact.email ?? null,
      attendee_phone: contact.phone ?? null,
      source: input.source,
    })
    .select()
    .single();
  if (bookingError) throw new Error(bookingError.message);

  if (process.env.MAKE_BOOKING_NOTIFY_WEBHOOK_URL) {
    fetch(process.env.MAKE_BOOKING_NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        booking_id: booking.id,
        contact_id: contact.id,
        deal_id: deal.id,
        attendee_name: contactName,
        attendee_email: contact.email ?? null,
        attendee_phone: contact.phone ?? null,
        start_time: input.start,
        end_time: input.end,
        source: input.source,
        calendar_event_link: event.htmlLink,
      }),
    }).catch(() => {});
  }

  await sendBookingConfirmationEmail({
    attendeeName: contactName,
    attendeeEmail: contact.email ?? null,
    startTime: input.start,
    endTime: input.end,
  });

  return { booking, contact, deal, calendar_event_link: event.htmlLink };
}

export type { CalendarSettings };
