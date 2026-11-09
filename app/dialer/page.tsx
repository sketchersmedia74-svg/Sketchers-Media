"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Sidebar from "../components/Sidebar";
import { usePhone } from "../components/phone/PhoneProvider";
import { isWithinCallingHours, localTimeLabel, parseDialable } from "@/lib/phone/usTime";

const OUTCOME_LABELS: Record<string, string> = {
  no_answer: "No answer", voicemail: "Left voicemail", interested: "Interested",
  call_back: "Call back later", not_interested: "Not interested",
  wrong_number: "Wrong number", do_not_call: "Do not call",
};

const pretty = (e164: string) => {
  const d = e164.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
};

export default function DialerPage() {
  const router = useRouter();
  const { enabled, status, statusMessage, busy, startManualCall } = usePhone();
  const [number, setNumber] = useState("");
  const [match, setMatch] = useState<any>(null);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) router.push("/");
    })();
  }, [router]);

  const parsed = number.trim() ? parseDialable(number) : null;

  // Look up a matching contact as the number becomes a valid one.
  useEffect(() => {
    setMatch(null);
    if (!parsed || !parsed.ok) return;
    const tail = parsed.e164.slice(-10);
    let cancelled = false;
    supabaseBrowser
      .from("contacts")
      .select("id, first_name, last_name, do_not_call")
      .like("phone", `%${tail}`)
      .limit(1)
      .then(({ data }) => { if (!cancelled) setMatch(data?.[0] ?? null); });
    return () => { cancelled = true; };
  }, [parsed && parsed.ok ? parsed.e164 : ""]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRecent() {
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session) return;
    const { data } = await supabaseBrowser
      .from("call_logs")
      .select("id, to_number, started_at, duration_seconds, outcome, status, contact_id, contacts(first_name, last_name)")
      .eq("user_id", session.user.id)
      .eq("direction", "outbound")
      .order("started_at", { ascending: false })
      .limit(20);
    setRecent(data || []);
  }

  // Refresh after each call finishes (busy flips back to false once the outcome is saved).
  useEffect(() => { if (!busy) loadRecent(); }, [busy]);

  function press(d: string) { setError(""); setNumber((n) => n + d); }

  async function call() {
    setError("");
    setCalling(true);
    const res = await startManualCall(number);
    setCalling(false);
    if (!res.ok && res.error) setError(res.error);
  }

  const dnc = !!match?.do_not_call;
  const hoursNote =
    parsed && parsed.ok
      ? isWithinCallingHours(parsed.timezone)
        ? null
        : `It's ${localTimeLabel(parsed.timezone)} there. Calls are only allowed 8:00am to 9:00pm their time.`
      : null;
  const canCall = enabled && !busy && !calling && !!parsed && parsed.ok && !dnc;

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <div className="container">
          <h2>Dialer</h2>
          {!enabled ? (
            <p style={{ color: "var(--text-muted)" }}>Calling isn't switched on yet.</p>
          ) : (
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ width: 300 }}>
                <input
                  value={number}
                  onChange={(e) => { setNumber(e.target.value); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && canCall) call(); }}
                  placeholder="Type or paste a US/Canada number"
                  inputMode="tel"
                  autoFocus
                  aria-label="Phone number"
                  style={{ width: "100%", boxSizing: "border-box", padding: 12, fontSize: 20, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
                />
                <div style={{ minHeight: 64, marginTop: 8, fontSize: 13 }}>
                  {parsed && !parsed.ok && <span className="error" style={{ margin: 0 }}>{parsed.error}</span>}
                  {parsed && parsed.ok && (
                    <>
                      <div style={{ color: "var(--text-muted)" }}>
                        {pretty(parsed.e164)} · {parsed.country === "CA" ? "Canada" : "US"} · their time: {localTimeLabel(parsed.timezone)}
                      </div>
                      {match ? (
                        <div style={{ marginTop: 4 }}>
                          <strong>{match.first_name} {match.last_name}</strong> is in the CRM. The call will be attached to them.
                          {dnc && <div className="error" style={{ margin: "4px 0 0" }}>Marked Do Not Call. This call is blocked.</div>}
                        </div>
                      ) : (
                        <div style={{ marginTop: 4, color: "var(--text-muted)" }}>Not in the CRM. You can save them after the call.</div>
                      )}
                      {hoursNote && !dnc && <div className="error" style={{ margin: "4px 0 0" }}>{hoursNote} Admins can override.</div>}
                    </>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "12px 0" }}>
                  {["1","2","3","4","5","6","7","8","9"].map((d) => (
                    <button key={d} className="btn secondary" style={{ padding: "14px 0", fontSize: 18 }} onClick={() => press(d)}>{d}</button>
                  ))}
                  <button className="btn secondary" style={{ padding: "14px 0" }} onClick={() => setNumber("")} title="Clear">Clear</button>
                  <button className="btn secondary" style={{ padding: "14px 0", fontSize: 18 }} onClick={() => press("0")}>0</button>
                  <button className="btn secondary" style={{ padding: "14px 0" }} onClick={() => setNumber((n) => n.slice(0, -1))} title="Backspace">⌫</button>
                </div>

                <button className="btn call-answer" style={{ width: "100%", padding: 14, fontSize: 16 }} onClick={call} disabled={!canCall}>
                  {calling ? "Starting…" : "Call"}
                </button>
                {error && <p className="error">{error}</p>}
                {status === "error" && <p className="error">Phone isn't connected: {statusMessage || "connection error"}</p>}
                {busy && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Finish the current call (and save its outcome) first.</p>}
              </div>

              <div style={{ flex: 1, minWidth: 320 }}>
                <h3 style={{ marginTop: 0 }}>Recent calls</h3>
                {recent.length === 0 ? (
                  <p style={{ color: "var(--text-muted)" }}>No calls yet.</p>
                ) : (
                  recent.map((r) => (
                    <div className="card" key={r.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div>
                          <strong>{r.to_number ? pretty(r.to_number) : "Unknown number"}</strong>
                          {r.contacts && <> · {r.contacts.first_name} {r.contacts.last_name}</>}
                        </div>
                        <div className="meta" style={{ marginTop: 4, marginBottom: 0 }}>
                          {new Date(r.started_at).toLocaleString()}
                          {r.duration_seconds != null && ` · ${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s`}
                          {" · "}{r.outcome ? OUTCOME_LABELS[r.outcome] || r.outcome : r.status}
                        </div>
                      </div>
                      <button className="btn secondary" style={{ padding: "4px 10px", fontSize: 12 }}
                              onClick={() => { setNumber(r.to_number || ""); setError(""); }} disabled={!r.to_number}>
                        Redial
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
