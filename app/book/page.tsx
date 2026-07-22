"use client";
import { useEffect, useState } from "react";

type Slot = { start: string; end: string };

function groupByDay(slots: Slot[]): { day: string; slots: Slot[] }[] {
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const day = new Date(slot.start).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(slot);
  }
  return Array.from(groups.entries()).map(([day, slots]) => ({ day, slots }));
}

export default function BookPage() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [confirmed, setConfirmed] = useState<Slot | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/public/availability");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setLoadError(json.error || "Could not load availability.");
        return;
      }
      setSlots(await res.json());
    })();
  }, []);

  async function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setSubmitError("");
    const res = await fetch("/api/public/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: selected.start, end: selected.end, name, clinicName, email, phone }),
    });
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setSubmitError(json.error || "Could not complete the booking.");
      return;
    }
    setConfirmed(selected);
  }

  const pageStyle: React.CSSProperties = {
    maxWidth: 640,
    margin: "0 auto",
    padding: "40px 20px",
  };

  const visitorTimezone =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

  if (confirmed) {
    return (
      <div style={pageStyle}>
        <h1 style={{ color: "#5C1A2E" }}>You're booked!</h1>
        <p>
          Your meeting is confirmed for{" "}
          <strong>
            {new Date(confirmed.start).toLocaleString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {visitorTimezone && ` (${visitorTimezone})`}
          </strong>
          .
        </p>
        <p>We'll be in touch shortly with any additional details.</p>
      </div>
    );
  }

  if (selected) {
    return (
      <div style={pageStyle}>
        <h1 style={{ color: "#5C1A2E" }}>Confirm your booking</h1>
        <p>
          {new Date(selected.start).toLocaleString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
          {visitorTimezone && <span style={{ color: "#666" }}> ({visitorTimezone})</span>}
        </p>
        <form onSubmit={submitBooking} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
          <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required
            style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }} />
          <input placeholder="Clinic name" value={clinicName} onChange={(e) => setClinicName(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }} />
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }} />
          <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }} />
          {submitError && <p style={{ color: "#b00020" }}>{submitError}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setSelected(null)} style={{ padding: "10px 16px", borderRadius: 6, border: "1px solid #ccc", background: "#fff" }}>
              Back
            </button>
            <button type="submit" disabled={submitting} style={{ padding: "10px 16px", borderRadius: 6, border: "none", background: "#5C1A2E", color: "#fff" }}>
              {submitting ? "Booking…" : "Confirm booking"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <h1 style={{ color: "#5C1A2E" }}>Book a time with us</h1>
      {visitorTimezone && !loadError && (
        <p style={{ color: "#666", marginTop: -8, marginBottom: 20 }}>
          Times shown in your local time ({visitorTimezone})
        </p>
      )}
      {loadError && <p style={{ color: "#b00020" }}>{loadError}</p>}
      {!loadError && !slots && <p>Loading available times…</p>}
      {!loadError && slots && slots.length === 0 && <p>No open times right now — please check back soon.</p>}
      {slots &&
        groupByDay(slots).map(({ day, slots: daySlots }) => (
          <div key={day} style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 8 }}>{day}</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {daySlots.map((slot) => (
                <button key={slot.start} className="book-slot" onClick={() => setSelected(slot)}>
                  {new Date(slot.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
