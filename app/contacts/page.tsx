"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Topbar from "../components/Topbar";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    company_id: "",
  });
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      await loadContacts();
      const { data: companyData } = await supabaseBrowser
        .from("companies")
        .select("id, name")
        .order("name", { ascending: true });
      setCompanies(companyData || []);
    })();
  }, []);

  async function loadContacts() {
    setLoading(true);
    const { data } = await supabaseBrowser
      .from("contacts")
      .select("*, companies(name), calls(summary, call_date, outcome)")
      .order("created_at", { ascending: false });
    setContacts(data || []);
    setLoading(false);
  }

  async function createContact(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.first_name.trim()) {
      setFormError("First name is required.");
      return;
    }
    setSaving(true);
    const { error } = await supabaseBrowser.from("contacts").insert({
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      company_id: form.company_id || null,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm({ first_name: "", last_name: "", phone: "", email: "", company_id: "" });
    setShowForm(false);
    loadContacts();
  }

  return (
    <div>
      <Topbar />
      <div className="container">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2>Contacts</h2>
          <button className="btn" onClick={() => setShowForm(true)}>New Contact</button>
        </div>
        <input
          placeholder="Search by name, email, phone, or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", minWidth: 320, marginBottom: 16 }}
        />

        {showForm && (
          <div className="modal-overlay" onClick={() => setShowForm(false)}>
            <form className="login-card" onClick={(e) => e.stopPropagation()} onSubmit={createContact}>
              <h3 style={{ marginTop: 0 }}>New Contact</h3>
              <label>First name</label>
              <input
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
              />
              <label>Last name</label>
              <input
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              />
              <label>Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <label>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <label>Company</label>
              <select
                value={form.company_id}
                onChange={(e) => setForm({ ...form, company_id: e.target.value })}
                style={{ width: "100%", padding: 10, margin: "6px 0 14px", borderRadius: 6, border: "1px solid #ddd" }}
              >
                <option value="">— None —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
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
            <thead>
              <tr>
                <th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>Last AI Call Summary</th>
              </tr>
            </thead>
            <tbody>
              {contacts
                .filter((c) => {
                  if (!search) return true;
                  const s = search.toLowerCase();
                  return (
                    `${c.first_name} ${c.last_name || ""}`.toLowerCase().includes(s) ||
                    (c.email || "").toLowerCase().includes(s) ||
                    (c.phone || "").toLowerCase().includes(s) ||
                    (c.companies?.name || "").toLowerCase().includes(s)
                  );
                })
                .map((c) => {
                const calls = c.calls || [];
                const last = calls.length
                  ? [...calls].sort((a: any, b: any) => new Date(b.call_date).getTime() - new Date(a.call_date).getTime())[0]
                  : null;
                return (
                  <tr key={c.id}>
                    <td>{c.first_name} {c.last_name}</td>
                    <td>{c.companies?.name || "—"}</td>
                    <td>{c.phone || "—"}</td>
                    <td>{c.email || "—"}</td>
                    <td>{last ? last.summary : <span style={{ color: "#999" }}>No calls yet</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
