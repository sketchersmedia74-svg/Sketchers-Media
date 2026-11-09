"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import type { ActiveCall, IncomingCall, PendingOutcome } from "./PhoneProvider";
import { STATE_TZ } from "@/lib/phone/usTime";

const pad = (n: number) => String(n).padStart(2, "0");
const mmss = (s: number) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

export function CallBar({
  active, onHangup, onMute, onDigit,
}: {
  active: ActiveCall;
  onHangup: () => void;
  onMute: () => void;
  onDigit: (d: string) => void;
}) {
  const [secs, setSecs] = useState(0);
  const [keypad, setKeypad] = useState(false);

  useEffect(() => {
    if (!active.connectedAt) { setSecs(0); return; }
    const tick = () => setSecs(Math.floor((Date.now() - (active.connectedAt as number)) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [active.connectedAt]);

  const label =
    active.phase === "connected" ? `Connected · ${mmss(secs)}`
    : active.phase === "ringing" ? "Ringing…" : "Dialing…";

  return (
    <div className="call-bar" role="region" aria-label="Active call">
      {keypad && (
        <div className="call-keypad">
          {["1","2","3","4","5","6","7","8","9","*","0","#"].map((d) => (
            <button key={d} className="btn secondary" onClick={() => onDigit(d)}>{d}</button>
          ))}
        </div>
      )}
      <div className="call-bar-row">
        <div className="call-bar-info">
          <strong>{active.name}</strong>
          <span>{active.direction === "inbound" ? "Incoming · " : ""}{active.number}</span>
        </div>
        <div className={`call-bar-state ${active.phase}`}>{label}</div>
        <div className="call-bar-actions">
          <button className="btn secondary" onClick={onMute} disabled={active.phase !== "connected"}>
            {active.muted ? "Unmute" : "Mute"}
          </button>
          <button className="btn secondary" onClick={() => setKeypad((k) => !k)} disabled={active.phase !== "connected"}>
            Keypad
          </button>
          <button className="btn call-hangup" onClick={onHangup}>Hang up</button>
        </div>
      </div>
    </div>
  );
}

export function IncomingCallBar({
  incoming, onAnswer, onDecline,
}: {
  incoming: IncomingCall;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="call-bar incoming" role="alertdialog" aria-label="Incoming call">
      <div className="call-bar-row">
        <div className="call-bar-info">
          <strong>Incoming call</strong>
          <span>
            {incoming.name}{incoming.contactId ? "" : ""} · {incoming.number || "Unknown number"}
            {incoming.contactId && (<> · <a href={`/contacts/${incoming.contactId}`} target="_blank" rel="noreferrer">Open lead</a></>)}
          </span>
        </div>
        <div className="call-bar-actions">
          <button className="btn call-answer" onClick={onAnswer}>Answer</button>
          <button className="btn call-hangup" onClick={onDecline}>Decline</button>
        </div>
      </div>
    </div>
  );
}

const OUTCOMES: Array<{ value: string; label: string }> = [
  { value: "no_answer", label: "No answer" },
  { value: "voicemail", label: "Left voicemail" },
  { value: "interested", label: "Interested" },
  { value: "call_back", label: "Call back later" },
  { value: "not_interested", label: "Not interested" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "do_not_call", label: "Do not call" },
];

// "Retry tomorrow" default for calls nobody picked up.
const RETRY_MS = 24 * 60 * 60 * 1000;

export function OutcomePanel({ pending, onDone }: { pending: PendingOutcome; onDone: () => void }) {
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // "Save as new contact" (for calls to numbers that aren't in the CRM yet)
  const [linkedContactId, setLinkedContactId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newState, setNewState] = useState("");
  const [creating, setCreating] = useState(false);
  const contactId = pending.contactId ?? linkedContactId;

  // Inbound rows are created by the webhook with no owner: claim it for this caller first.
  async function resolveLogId(): Promise<string | null> {
    let logId = pending.logId;
    if (!logId && pending.sessionId) {
      for (let i = 0; i < 4 && !logId; i++) {
        const { data } = await supabaseBrowser.rpc("claim_inbound_call", { p_session_id: pending.sessionId });
        logId = (data as string | null) ?? null;
        if (!logId) await new Promise((r) => setTimeout(r, 1500)); // webhook may still be writing
      }
    }
    return logId;
  }

  async function createContact() {
    setError("");
    if (!newFirst.trim()) { setError("First name is required."); return; }
    const st = newState.trim().toUpperCase();
    if (st && !STATE_TZ[st]) { setError("State must be a 2-letter US state code, like TX."); return; }
    setCreating(true);

    const logId = await resolveLogId();
    if (!logId) { setCreating(false); setError("Couldn't find this call's log yet. Wait a few seconds and try again."); return; }

    // Don't create a duplicate if someone added this number in the meantime.
    const tail = pending.number.replace(/\D/g, "").slice(-10);
    const { data: existing } = await supabaseBrowser
      .from("contacts").select("id, first_name, last_name").like("phone", `%${tail}`).limit(1);
    if (existing?.length) {
      setCreating(false);
      setError(`A contact with this number already exists (${existing[0].first_name} ${existing[0].last_name || ""}). Find them on the Contacts page.`);
      return;
    }

    const { data: c, error: e1 } = await supabaseBrowser
      .from("contacts")
      .insert({
        first_name: newFirst.trim(),
        last_name: newLast.trim() || null,
        phone: pending.number,
        source: "manual_dial",
        state: st || null,
        timezone: st ? STATE_TZ[st] : null,
        do_not_call: outcome === "do_not_call",
      })
      .select("id")
      .single();
    if (e1 || !c) { setCreating(false); setError(e1?.message || "Could not create the contact."); return; }

    const { error: e2 } = await supabaseBrowser.rpc("link_call_to_contact", { p_log_id: logId, p_contact_id: c.id });
    setCreating(false);
    if (e2) { setError(`Contact created, but linking the call failed: ${e2.message}`); setLinkedContactId(c.id); return; }
    setLinkedContactId(c.id);
    setShowNew(false);
  }

  async function save() {
    setError("");
    if (!outcome) { setError("Pick an outcome first."); return; }
    if (outcome === "call_back" && !callbackAt) { setError("Pick the call-back date and time."); return; }
    setSaving(true);

    const logId = await resolveLogId();

    if (logId) {
      const { error: e1 } = await supabaseBrowser
        .from("call_logs").update({ outcome, notes: notes.trim() || null }).eq("id", logId);
      if (e1) { setSaving(false); setError(e1.message); return; }
    } else if (pending.direction === "inbound") {
      setSaving(false);
      setError("Couldn't find this inbound call's log row yet. Wait a few seconds and press Save again.");
      return;
    }

    // Lead updates: call-back time, retry-tomorrow, do-not-call.
    if (contactId) {
      const patch: Record<string, unknown> = {};
      if (outcome === "call_back") patch.next_call_at = new Date(callbackAt).toISOString();
      else if (outcome === "no_answer" || outcome === "voicemail") patch.next_call_at = new Date(Date.now() + RETRY_MS).toISOString();
      else patch.next_call_at = null;
      if (outcome === "do_not_call") patch.do_not_call = true;
      const { error: e2 } = await supabaseBrowser.from("contacts").update(patch).eq("id", contactId);
      if (e2) { setSaving(false); setError(`Call saved, but the lead couldn't be updated: ${e2.message}`); return; }
    }

    setSaving(false);
    onDone();
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 1200 }}>
      <div className="call-outcome">
        <h3 style={{ marginTop: 0 }}>How did the call go?</h3>
        <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
          {pending.name} · {pending.number} · {pending.answered ? "Connected" : "Not answered"}
        </div>

        <div className="call-outcome-grid">
          {OUTCOMES.map((o) => (
            <label key={o.value} className={`call-outcome-opt ${outcome === o.value ? "selected" : ""}`}>
              <input type="radio" name="outcome" value={o.value} checked={outcome === o.value}
                     onChange={() => setOutcome(o.value)} />
              {o.label}
            </label>
          ))}
        </div>

        {outcome === "call_back" && (
          <label style={{ display: "block", marginTop: 12, fontWeight: 600 }}>
            Call back at (your time)
            <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)}
                   style={{ display: "block", marginTop: 4, padding: 8, borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
          </label>
        )}
        {outcome === "do_not_call" && (
          <p style={{ color: "#d33", fontSize: 13 }}>This lead will be marked Do Not Call and can't be dialed again.</p>
        )}

        <textarea
          placeholder="Notes about the call…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          style={{ width: "100%", marginTop: 12, padding: 10, borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
        />
        {!contactId && !showNew && (
          <button className="btn secondary" style={{ width: "100%", marginTop: 12 }} onClick={() => setShowNew(true)}>
            Save as new contact
          </button>
        )}
        {contactId && linkedContactId && (
          <p style={{ color: "#1a8f4c", fontSize: 13, marginBottom: 0 }}>
            Saved as a new contact and linked to this call. <a href={`/contacts/${linkedContactId}`} target="_blank" rel="noreferrer">Open</a>
          </p>
        )}
        {showNew && !contactId && (
          <div className="next-lead-card" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 12, marginBottom: 0 }}>
            <strong>New contact · {pending.number}</strong>
            <input placeholder="First name *" value={newFirst} onChange={(e) => setNewFirst(e.target.value)}
                   style={{ padding: 8, borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
            <input placeholder="Last name" value={newLast} onChange={(e) => setNewLast(e.target.value)}
                   style={{ padding: 8, borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
            <input placeholder="US state (optional, e.g. TX)" value={newState} maxLength={2} onChange={(e) => setNewState(e.target.value)}
                   style={{ padding: 8, borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)", textTransform: "uppercase" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={createContact} disabled={creating}>
                {creating ? "Saving…" : "Create contact"}
              </button>
              <button className="btn secondary" onClick={() => setShowNew(false)} disabled={creating}>Cancel</button>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn" style={{ width: "100%", marginTop: 12 }} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save outcome"}
        </button>
      </div>
    </div>
  );
}
