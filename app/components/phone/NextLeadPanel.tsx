"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { isWithinCallingHours, localTimeLabel, resolveTimezone } from "@/lib/phone/usTime";
import CallButton from "./CallButton";
import { usePhone } from "./PhoneProvider";

// "Next lead": loads the next lead that is due, not Do Not Call, and inside calling
// hours right now. It only loads the lead; the caller still presses Call themselves.
export default function NextLeadPanel() {
  const { enabled, busy } = usePhone();
  const [lead, setLead] = useState<any>(null);
  const [localTime, setLocalTime] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);

  if (!enabled) return null;

  async function loadNext(skip: string[] = skipped) {
    setLoading(true);
    setMessage("");
    const nowIso = new Date().toISOString();
    // Due = scheduled call-back time has passed, OR never called and nothing scheduled.
    const { data, error } = await supabaseBrowser
      .from("contacts")
      .select("id, first_name, last_name, phone, state, timezone, do_not_call, next_call_at, call_count, companies(name)")
      .eq("do_not_call", false)
      .not("phone", "is", null)
      .or(`and(call_count.eq.0,next_call_at.is.null),next_call_at.lte.${nowIso}`)
      .order("next_call_at", { ascending: true, nullsFirst: false }) // call-backs first
      .order("created_at", { ascending: true })                      // then never-called
      .limit(300);
    setLoading(false);
    if (error) { setMessage(error.message); return; }

    const now = new Date();
    const next = (data || []).find((c: any) => {
      if (skip.includes(c.id)) return false;
      const tz = resolveTimezone(c);
      return !!tz && isWithinCallingHours(tz.timezone, now);
    });
    if (!next) {
      setLead(null);
      setMessage("No leads are due and inside calling hours right now.");
      return;
    }
    const tz = resolveTimezone(next)!;
    setLocalTime(localTimeLabel(tz.timezone, now));
    setLead(next);
  }

  function skip() {
    if (!lead) return;
    const s = [...skipped, lead.id];
    setSkipped(s);
    loadNext(s);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {!lead && (
        <button className="btn" onClick={() => loadNext()} disabled={loading || busy}>
          {loading ? "Finding…" : "Next lead"}
        </button>
      )}
      {message && <span style={{ marginLeft: 10, color: "var(--text-muted)" }}>{message}</span>}
      {lead && (
        <div className="next-lead-card">
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong>{lead.first_name} {lead.last_name}</strong>
            {lead.companies?.name && <> · {lead.companies.name}</>}
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {lead.phone} · their time: {localTime}
              {lead.next_call_at ? " · scheduled call-back" : " · never called"}
            </div>
          </div>
          <CallButton contact={lead} />
          <button className="btn secondary" onClick={skip} disabled={busy}>Skip</button>
          <button className="btn secondary" onClick={() => { setLead(null); setSkipped([]); }}>Close</button>
        </div>
      )}
    </div>
  );
}
