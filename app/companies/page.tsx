"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Topbar from "../components/Topbar";

const NEW_PROJECT_VALUE = "__new__";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [projectFilter, setProjectFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ name: "", website: "", industry: "", notes: "", project_id: "" });
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState("#5C1A2E");
  const [creatingProject, setCreatingProject] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      await loadCompanies();
      await loadProjects();
    })();
  }, []);

  async function loadCompanies() {
    setLoading(true);
    const { data } = await supabaseBrowser
      .from("companies")
      .select("*, projects(id, name, color)")
      .order("created_at", { ascending: false });
    setCompanies(data || []);
    setLoading(false);
  }

  async function loadProjects() {
    const { data } = await supabaseBrowser.from("projects").select("*").order("name", { ascending: true });
    setProjects(data || []);
  }

  async function createProjectInline() {
    setFormError("");
    if (!newProjectName.trim()) {
      setFormError("Project name is required.");
      return;
    }
    setCreatingProject(true);
    const { data, error } = await supabaseBrowser
      .from("projects")
      .insert({ name: newProjectName.trim(), color: newProjectColor })
      .select()
      .single();
    setCreatingProject(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setProjects([...projects, data].sort((a, b) => a.name.localeCompare(b.name)));
    setForm({ ...form, project_id: data.id });
    setNewProjectName("");
    setNewProjectColor("#5C1A2E");
  }

  async function createCompany(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.name.trim()) {
      setFormError("Company name is required.");
      return;
    }
    if (!form.project_id || form.project_id === NEW_PROJECT_VALUE) {
      setFormError("Please select or create a project.");
      return;
    }
    setSaving(true);
    const { error } = await supabaseBrowser.from("companies").insert({
      name: form.name.trim(),
      website: form.website.trim() || null,
      industry: form.industry.trim() || null,
      notes: form.notes.trim() || null,
      project_id: form.project_id,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm({ name: "", website: "", industry: "", notes: "", project_id: "" });
    setShowForm(false);
    loadCompanies();
  }

  const filteredCompanies = companies.filter(
    (c) => projectFilter === "all" || c.project_id === projectFilter
  );

  return (
    <div>
      <Topbar />
      <div className="container">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2>Companies</h2>
          <button className="btn" onClick={() => setShowForm(true)}>New Company</button>
        </div>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)", marginBottom: 16 }}
        >
          <option value="all">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {showForm && (
          <div className="modal-overlay" onClick={() => setShowForm(false)}>
            <form className="login-card" onClick={(e) => e.stopPropagation()} onSubmit={createCompany}>
              <h3 style={{ marginTop: 0 }}>New Company</h3>
              <label>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <label>Website</label>
              <input
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
              <label>Industry</label>
              <input
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              />
              <label>Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                style={{ width: "100%", padding: 10, margin: "6px 0 14px", borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)", fontFamily: "inherit", resize: "vertical" }}
              />
              <label>Project *</label>
              <select
                value={form.project_id}
                onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                style={{ width: "100%", padding: 10, margin: "6px 0 14px", borderRadius: 6, border: "1px solid var(--input-border)" }}
              >
                <option value="">— Select a project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value={NEW_PROJECT_VALUE}>+ Create new project…</option>
              </select>

              {form.project_id === NEW_PROJECT_VALUE && (
                <div
                  style={{
                    background: "var(--primary-tint)",
                    border: "1px solid var(--primary)",
                    borderRadius: 6,
                    padding: 10,
                    marginTop: -8,
                    marginBottom: 14,
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <input
                    placeholder="Project name (e.g. Dentists)"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid var(--input-border)" }}
                  />
                  <input
                    type="color"
                    value={newProjectColor}
                    onChange={(e) => setNewProjectColor(e.target.value)}
                    style={{ width: 40, height: 36, padding: 0, border: "none", borderRadius: 6 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={creatingProject}
                    onClick={createProjectInline}
                  >
                    {creatingProject ? "Creating…" : "Create"}
                  </button>
                </div>
              )}

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
        {loading ? <p>Loading…</p> : (
          <table>
            <thead><tr><th>Name</th><th>Project</th><th>Industry</th><th>Website</th></tr></thead>
            <tbody>
              {filteredCompanies.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    {c.projects ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.projects.color, display: "inline-block" }} />
                        {c.projects.name}
                      </span>
                    ) : "—"}
                  </td>
                  <td>{c.industry || "—"}</td>
                  <td>{c.website || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
