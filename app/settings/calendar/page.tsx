"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

type DayConfig = { start: string; end: string };
type WorkingHours = Record<string, DayConfig | undefined>;

type Settings = {
  connected: boolean;
  connected_email?: string | null;
  calendar_id?: string;
  timezone?: string;
  slot_duration_minutes?: number;
  buffer_minutes?: number;
  working_hours?: WorkingHours;
  needs_reconnect?: boolean;
};

const DAY_LABELS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

function CalendarSettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accessDenied, setAccessDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [timezone, setTimezone] = useState("America/New_York");
  const [slotDuration, setSlotDuration] = useState(30);
  const [buffer, setBuffer] = useState(0);
  const [workingHours, setWorkingHours] = useState<WorkingHours>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabaseBrowser.auth.getSession();
      if (!session) {
        router.push("/");
        return;
      }
      await load();
    })();
  }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/calendar/settings");
    if (res.status === 403) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }
    if (res.ok) {
      const data: Settings = await res.json();
      setSettings(data);
      setTimezone(data.timezone || "America/New_York");
      setSlotDuration(data.slot_duration_minutes ?? 30);
      setBuffer(data.buffer_minutes ?? 0);
      setWorkingHours(data.working_hours || {});
    }
    setLoading(false);
  }

  function toggleDay(key: string, enabled: boolean) {
    setWorkingHours((prev) => {
      const next = { ...prev };
      if (enabled) next[key] = prev[key] || { start: "09:00", end: "17:00" };
      else delete next[key];
      return next;
    });
  }

  function updateDayTime(key: string, field: "start" | "end", value: string) {
    setWorkingHours((prev) => ({ ...prev, [key]: { ...(prev[key] || { start: "09:00", end: "17:00" }), [field]: value } }));
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMessage("");
    const res = await fetch("/api/calendar/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timezone,
        slot_duration_minutes: slotDuration,
        buffer_minutes: buffer,
        working_hours: workingHours,
      }),
    });
    setSaving(false);
    setSaveMessage(res.ok ? "Saved." : "Failed to save settings.");
    if (res.ok) load();
  }

  if (accessDenied) {
    return (
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          <div className="container">
            <h2>Calendar Settings</h2>
            <p className="error">Access denied — this page is only available to admins.</p>
          </div>
        </div>
      </div>
    );
  }

  const connected = searchParams.get("connected") === "1" || settings?.connected;
  const oauthError = searchParams.get("error");

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <div className="container">
          <h2>Calendar Settings</h2>

          {oauthError && <p className="error">Could not connect Google Calendar: {decodeURIComponent(oauthError)}</p>}

          {!loading && settings?.needs_reconnect && (
            <div
              className="card"
              style={{
                marginBottom: 20,
                maxWidth: 620,
                background: "#3a1f1f",
                border: "1px solid #b00020",
              }}
            >
              <p style={{ margin: "0 0 10px", fontWeight: 600 }}>
                ⚠️ Google Calendar needs to be reconnected
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 14, opacity: 0.9 }}>
                The connected Google account's access has expired or been revoked, so the public booking page
                can't check availability or create events right now. Reconnect below to restore it.
              </p>
              <a className="btn" href="/api/calendar/oauth/start">
                Reconnect Google Calendar
              </a>
            </div>
          )}

          {loading ? (
            <p>Loading…</p>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 20, maxWidth: 620 }}>
                {connected ? (
                  <>
                    <p style={{ margin: "0 0 10px" }}>
                      ✅ Connected as <strong>{settings?.connected_email}</strong>
                    </p>
                    <a className="btn" href="/api/calendar/oauth/start">
                      Reconnect Google Calendar
                    </a>
                    <p style={{ margin: "8px 0 0", fontSize: 13, opacity: 0.75 }}>
                      Use this if you changed permissions/scopes in Google Cloud Console and need to re-grant access.
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ margin: "0 0 10px" }}>Not connected yet. Connect the shared company Google account.</p>
                    <a className="btn" href="/api/calendar/oauth/start">
                      Connect Google Calendar
                    </a>
                  </>
                )}
              </div>

              <form onSubmit={saveSettings} style={{ maxWidth: 620 }} className="card">
                <h3 style={{ marginTop: 0 }}>Availability</h3>

                <label style={{ display: "block", marginBottom: 12 }}>
                  Timezone
                  <input
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="America/New_York"
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
                  />
                </label>

                <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                  <label style={{ flex: 1 }}>
                    Meeting duration (minutes)
                    <input
                      type="number"
                      min={5}
                      value={slotDuration}
                      onChange={(e) => setSlotDuration(parseInt(e.target.value, 10) || 0)}
                      style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    Buffer between meetings (minutes)
                    <input
                      type="number"
                      min={0}
                      value={buffer}
                      onChange={(e) => setBuffer(parseInt(e.target.value, 10) || 0)}
                      style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
                    />
                  </label>
                </div>

                <h4>Working hours</h4>
                {DAY_LABELS.map(({ key, label }) => {
                  const day = workingHours[key];
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <label style={{ width: 110, display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="checkbox" checked={!!day} onChange={(e) => toggleDay(key, e.target.checked)} />
                        {label}
                      </label>
                      {day && (
                        <>
                          <input
                            type="time"
                            value={day.start}
                            onChange={(e) => updateDayTime(key, "start", e.target.value)}
                            style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
                          />
                          <span>to</span>
                          <input
                            type="time"
                            value={day.end}
                            onChange={(e) => updateDayTime(key, "end", e.target.value)}
                            style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
                          />
                        </>
                      )}
                    </div>
                  );
                })}

                <button className="btn" type="submit" disabled={saving} style={{ marginTop: 12 }}>
                  {saving ? "Saving…" : "Save Settings"}
                </button>
                {saveMessage && <p style={{ marginTop: 8 }}>{saveMessage}</p>}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CalendarSettingsPage() {
  return (
    <Suspense fallback={<div className="container">Loading…</div>}>
      <CalendarSettingsContent />
    </Suspense>
  );
}
