"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Sidebar from "../components/Sidebar";

export default function TeamPage() {
  const [members, setMembers] = useState<{ id: string; email: string; full_name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState<{ email: string; invited: boolean; temporary_password?: string; profile_warning?: string } | null>(null);
  const router = useRouter();

  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      await loadMembers();
      await loadNames();
    })();
  }, []);

  async function loadNames() {
    const res = await fetch("/api/team-names");
    if (res.ok) setNames(await res.json());
  }

  async function addName(e: React.FormEvent) {
    e.preventDefault();
    setNameError("");
    if (!newName.trim()) {
      setNameError("Name is required.");
      return;
    }
    setSavingName(true);
    const res = await fetch("/api/team-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const json = await res.json();
    setSavingName(false);
    if (!res.ok) {
      setNameError(json.error || "Failed to add name.");
      return;
    }
    setNewName("");
    loadNames();
  }

  async function removeName(id: string) {
    await fetch(`/api/team-names?id=${id}`, { method: "DELETE" });
    loadNames();
  }

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
      body: JSON.stringify({ email: email.trim(), full_name: fullName.trim() || undefined }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setFormError(json.error || "Failed to add team member.");
      return;
    }
    setResult(json);
    setEmail("");
    setFullName("");
    loadMembers();
  }

  if (accessDenied) {
    return (
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
        <div className="container">
          <h2>Team</h2>
          <p className="error">Access denied — this page is only available to admins.</p>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
      <div className="container">
        <h2>Team</h2>

        <form onSubmit={addMember} style={{ display: "flex", gap: 8, marginBottom: 16, maxWidth: 620 }}>
          <input
            placeholder="Full name (optional)"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
          />
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
            <thead><tr><th>Name</th><th>Email</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.full_name || "—"}</td>
                  <td>{m.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 style={{ marginTop: 36 }}>Names</h2>
        <p style={{ opacity: 0.75, maxWidth: 620, marginBottom: 16 }}>
          For when several people share one CRM login — add each person's name here so they can be picked
          as a deal Owner or credited on notes, without needing their own login account.
        </p>

        <form onSubmit={addName} style={{ display: "flex", gap: 8, marginBottom: 16, maxWidth: 420 }}>
          <input
            placeholder="Full name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
          />
          <button className="btn" type="submit" disabled={savingName}>
            {savingName ? "Adding…" : "Add Name"}
          </button>
        </form>
        {nameError && <p className="error">{nameError}</p>}

        <table>
          <thead><tr><th>Name</th><th></th></tr></thead>
          <tbody>
            {names.map((n) => (
              <tr key={n.id}>
                <td>{n.name}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "4px 10px", fontSize: 13 }}
                    onClick={() => removeName(n.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {names.length === 0 && (
              <tr><td colSpan={2} style={{ opacity: 0.6 }}>No names added yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
