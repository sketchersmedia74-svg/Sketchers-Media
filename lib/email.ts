export type BookingConfirmationDetails = {
  attendeeName: string;
  attendeeEmail: string | null;
  startTime: string;
  endTime: string;
};

// TODO: wire up an email provider (Resend/Zoho/SMTP) once one is set up, then
// actually send here. Kept as a no-op stub so the booking flow has a single
// call site to swap in real sending — never throws, so a missing provider
// doesn't fail the booking itself.
export async function sendBookingConfirmationEmail(details: BookingConfirmationDetails): Promise<void> {
  if (!details.attendeeEmail) return;
  console.log(`[email stub] Would send booking confirmation to ${details.attendeeEmail} for ${details.startTime}`);
}
