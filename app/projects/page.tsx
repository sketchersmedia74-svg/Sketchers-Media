"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Sidebar from "../components/Sidebar";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [companyCounts, setCompanyCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#5C1A2E");
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      await loadProjects();
    })();
  }, []);

  async function loadProjects() {
    setLoading(true);
    const { data } = await supabaseBrowser.from("projects").select("*").order("name", { ascending: true });
    setProjects(data || []);

    const { data: companies } = await supabaseBrowser.from("companies").select("project_id");
    const counts: Record<string, number> = {};
    (companies || []).forEach((c: any) => {
      if (c.project_id) counts[c.project_id] = (counts[c.project_id] || 0) + 1;
    });
    setCompanyCounts(counts);
    setLoading(false);
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!name.trim()) {
      setFormError("Project name is required.");
      return;
    }
    setSaving(true);
    const { error } = await supabaseBrowser.from("projects").insert({ name: name.trim(), color });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setName("");
    setColor("#5C1A2E");
    setShowForm(false);
    loadProjects();
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
      <div className="container">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2>Projects</h2>
          <button className="btn" onClick={() => setShowForm(true)}>New Project</button>
        </div>

        {showForm && (
          <div className="modal-overlay" onClick={() => setShowForm(false)}>
            <form className="login-card" onClick={(e) => e.stopPropagation()} onSubmit={createProject}>
              <h3 style={{ marginTop: 0 }}>New Project</h3>
              <label>Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dentists"
                required
              />
              <label>Color</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{ width: 60, height: 36, padding: 0, border: "none", borderRadius: 6, margin: "6px 0 14px" }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" type="submit" disabled={saving} style={{ flex: 1 }}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ flex: 1 }}
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </div>
              {formError && <p className="error">{formError}</p>}
            </form>
          </div>
        )}

        {loading ? <p>Loading…</p> : projects.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No projects yet. Create one to start tagging companies by niche.</p>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Color</th><th>Companies</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 14, height: 14, borderRadius: "50%", background: p.color, display: "inline-block", border: "1px solid var(--border)" }} />
                      {p.color}
                    </span>
                  </td>
                  <td>{companyCounts[p.id] || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>
    </div>
  );
}
