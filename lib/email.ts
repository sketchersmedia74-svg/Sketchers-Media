import nodemailer from "nodemailer";

export type BookingConfirmationDetails = {
  attendeeName: string;
  attendeeEmail: string | null;
  clinicName?: string;
  startTime: string;
  endTime: string;
  timezone?: string;
};

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit SSL; 587 uses STARTTLS instead
    auth: { user, pass },
  });
  return cachedTransporter;
}

function formatTime(iso: string, timezone?: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone || undefined,
  });
}

// Sends a real booking confirmation email via the Hostinger mailbox
// configured in SMTP_HOST/PORT/USER/PASS, to the client and (via bcc) the
// team address in TEAM_NOTIFICATION_EMAIL. Never throws — a misconfigured
// or down mail server shouldn't fail the booking itself, since the booking
// (contact/deal/calendar event) has already been created by this point.
export async function sendBookingConfirmationEmail(details: BookingConfirmationDetails): Promise<void> {
  if (!details.attendeeEmail) return;

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] SMTP not configured — would send booking confirmation to ${details.attendeeEmail}`);
    return;
  }

  const teamEmails = (process.env.TEAM_NOTIFICATION_EMAIL || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  const when = formatTime(details.startTime, details.timezone);
  const clinicSuffix = details.clinicName ? ` (${details.clinicName})` : "";
  const fromAddress = process.env.SMTP_USER!;

  try {
    await transporter.sendMail({
      from: `"Reset Dental Media" <${fromAddress}>`,
      to: details.attendeeEmail,
      bcc: teamEmails.length ? teamEmails : undefined,
      subject: "Your meeting with Reset Dental Media is confirmed",
      text: `Hi ${details.attendeeName}${clinicSuffix},\n\nYour meeting with Reset Dental Media is confirmed for ${when}.\n\nWe'll be in touch shortly with any additional details.\n\n— Reset Dental Media`,
      html: `
        <p>Hi ${details.attendeeName}${clinicSuffix},</p>
        <p>Your meeting with <strong>Reset Dental Media</strong> is confirmed for:</p>
        <p style="font-size:16px;"><strong>${when}</strong></p>
        <p>We'll be in touch shortly with any additional details.</p>
        <p>— Reset Dental Media</p>
      `,
    });
  } catch (err) {
    console.error("Failed to send booking confirmation email:", err);
  }
}
