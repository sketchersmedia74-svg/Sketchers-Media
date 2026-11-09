"use client";
import { useState } from "react";
import { CallableContact, usePhone } from "./PhoneProvider";

// "Call" button for a lead. Hidden entirely until calling is switched on.
export default function CallButton({ contact, small }: { contact: CallableContact; small?: boolean }) {
  const { enabled, startCall, busy } = usePhone();
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  if (!enabled) return null;

  async function click(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError("");
    setStarting(true);
    const res = await startCall(contact);
    setStarting(false);
    if (!res.ok && res.error) setError(res.error);
  }

  const blocked = !contact.phone || !!contact.do_not_call;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        className="btn"
        onClick={click}
        disabled={starting || busy || blocked}
        title={contact.do_not_call ? "Do Not Call" : !contact.phone ? "No phone number" : "Call from your browser"}
        style={small ? { padding: "4px 10px", fontSize: 12 } : undefined}
      >
        {starting ? "Starting…" : contact.do_not_call ? "Do not call" : "Call"}
      </button>
      {error && <span className="error" style={{ margin: 0, maxWidth: 260 }}>{error}</span>}
    </span>
  );
}
