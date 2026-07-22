import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabase";

export type CalendarSettings = {
  google_refresh_token: string | null;
  connected_email: string | null;
  calendar_id: string;
  timezone: string;
  slot_duration_minutes: number;
  buffer_minutes: number;
  working_hours: Record<string, { start: string; end: string } | undefined>;
  needs_reconnect?: boolean;
};

// Thrown when a Google Calendar API call fails because the stored refresh
// token has been revoked/expired (invalid_grant) — callers (the public
// booking routes) should catch this and show a generic "temporarily
// unavailable" message rather than leaking Google's raw OAuth error.
export class GoogleCalendarAuthError extends Error {}

function isInvalidGrantError(err: any): boolean {
  const code = err?.response?.data?.error;
  return code === "invalid_grant" || /invalid_grant/i.test(err?.message || "");
}

// Flags calendar_settings so the admin dashboard can show a "Reconnect
// Google Calendar" banner. Fire-and-forget: this is a best-effort UX signal,
// not something that should itself fail the caller's request.
async function flagNeedsReconnect() {
  try {
    await supabaseAdmin().from("calendar_settings").update({ needs_reconnect: true }).eq("id", 1);
  } catch (err) {
    console.error("Failed to flag calendar_settings.needs_reconnect:", err);
  }
}

// Reads the single-row shared calendar config. Only ever called from server
// routes via supabaseAdmin() — never expose this table to the browser client.
export async function getCalendarSettings(): Promise<CalendarSettings | null> {
  const db = supabaseAdmin();
  const { data } = await db.from("calendar_settings").select("*").eq("id", 1).maybeSingle();
  return data as CalendarSettings | null;
}

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

export function getAuthUrl(): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/userinfo.email"],
  });
}

// Exchanges an OAuth `code` for tokens and stores the refresh token + connected
// account email in calendar_settings (upsert, single row with id=1).
export async function completeOAuth(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke this app's access at https://myaccount.google.com/permissions and try connecting again (Google only issues a refresh token on first consent)."
    );
  }
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const { data: userInfo } = await oauth2.userinfo.get();

  const db = supabaseAdmin();
  await db.from("calendar_settings").upsert({
    id: 1,
    google_refresh_token: tokens.refresh_token,
    connected_email: userInfo.email ?? null,
    needs_reconnect: false,
    updated_at: new Date().toISOString(),
  });
}

async function authorizedClient(settings: CalendarSettings) {
  if (!settings.google_refresh_token) {
    throw new Error("Google Calendar is not connected yet.");
  }
  const client = oauthClient();
  client.setCredentials({ refresh_token: settings.google_refresh_token });
  return client;
}

// Returns busy [start, end) intervals (ISO strings) on the shared calendar
// between timeMin and timeMax (both ISO strings).
export async function getFreeBusy(
  settings: CalendarSettings,
  timeMin: string,
  timeMax: string
): Promise<{ start: string; end: string }[]> {
  const auth = await authorizedClient(settings);
  const calendar = google.calendar({ version: "v3", auth });
  try {
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: settings.calendar_id }],
      },
    });
    const busy = res.data.calendars?.[settings.calendar_id]?.busy ?? [];
    return busy.map((b) => ({ start: b.start!, end: b.end! }));
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await flagNeedsReconnect();
      throw new GoogleCalendarAuthError("Google Calendar authorization has expired and needs to be reconnected.");
    }
    throw err;
  }
}

export async function createCalendarEvent(
  settings: CalendarSettings,
  event: { summary: string; description?: string; start: string; end: string; attendeeEmail?: string }
): Promise<{ id: string; htmlLink: string | null }> {
  const auth = await authorizedClient(settings);
  const calendar = google.calendar({ version: "v3", auth });
  try {
    const res = await calendar.events.insert({
      calendarId: settings.calendar_id,
      requestBody: {
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.start, timeZone: settings.timezone },
        end: { dateTime: event.end, timeZone: settings.timezone },
        attendees: event.attendeeEmail ? [{ email: event.attendeeEmail }] : undefined,
      },
    });
    return { id: res.data.id!, htmlLink: res.data.htmlLink ?? null };
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await flagNeedsReconnect();
      throw new GoogleCalendarAuthError("Google Calendar authorization has expired and needs to be reconnected.");
    }
    throw err;
  }
}
