"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Topbar from "../components/Topbar";

export default function TeamPage() {
  const [members, setMembers] = useState<{ id: string; email: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState<{ email: string; invited: boolean; temporary_password?: string; profile_warning?: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      await loadMembers();
    })();
  }, []);

  async function loadMembers() {
    setLoading(true);
    const res = await fetch("/api/team-members");
    if (res.status === 403) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }
    if (res.ok) {
      setMembers(await res.json());
    }
    setLoading(false);
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!email.trim()) {
      setFormError("Email is required.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/team-members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setFormError(json.error || "Failed to add team member.");
      return;
    }
    setResult(json);
    setEmail("");
    loadMembers();
  }

  if (accessDenied) {
    return (
      <div>
        <Topbar />
        <div className="container">
          <h2>Team</h2>
          <p className="error">Access denied — this page is only available to admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Topbar />
      <div className="container">
        <h2>Team</h2>

        <form onSubmit={addMember} style={{ display: "flex", gap: 8, marginBottom: 16, maxWidth: 480 }}>
          <input
            type="email"
            placeholder="teammate@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
          />
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Adding…" : "Add Team Member"}
          </button>
        </form>
        {formError && <p className="error">{formError}</p>}

        {result && (
          <div className="card" style={{ marginBottom: 20 }}>
            {result.invited ? (
              <p style={{ margin: 0 }}>✅ Invite email sent to <strong>{result.email}</strong>.</p>
            ) : (
              <>
                <p style={{ margin: "0 0 8px" }}>
                  ✅ Account created for <strong>{result.email}</strong>. No invite email was sent (email
                  sending isn't configured) — share this temporary password with them now. It will not be
                  shown again.
                </p>
                <code style={{ background: "var(--primary-tint)", padding: "6px 10px", borderRadius: 6, display: "inline-block" }}>
                  {result.temporary_password}
                </code>
              </>
            )}
            {result.profile_warning && (
              <p className="error" style={{ marginTop: 8, marginBottom: 0 }}>
                ⚠️ Account created, but the internal profile record failed to save ({result.profile_warning}).
                It will be repaired automatically next time this page loads.
              </p>
            )}
          </div>
        )}

        {loading ? <p>Loading…</p> : (
          <table>
            <thead><tr><th>Email</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
