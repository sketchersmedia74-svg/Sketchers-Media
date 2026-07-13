"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { downloadCsv, parseCsv } from "@/lib/csv";
import Topbar from "../components/Topbar";

const IMPORT_FIELDS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "company", label: "Company" },
] as const;
type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

function guessColumnMap(headers: string[]): Record<ImportFieldKey, number> {
  const map: Record<ImportFieldKey, number> = {
    first_name: -1,
    last_name: -1,
    phone: -1,
    email: -1,
    company: -1,
  };
  headers.forEach((h, i) => {
    const s = h.toLowerCase();
    if (map.first_name === -1 && s.includes("first")) map.first_name = i;
    else if (map.last_name === -1 && s.includes("last")) map.last_name = i;
    else if (map.phone === -1 && (s.includes("phone") || s.includes("mobile") || s.includes("tel"))) map.phone = i;
    else if (map.email === -1 && s.includes("mail")) map.email = i;
    else if (map.company === -1 && (s.includes("company") || s.includes("organization") || s.includes("organisation"))) map.company = i;
  });
  return map;
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [projectFilter, setProjectFilter] = useState("all");
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
    source: "manual",
  });
  const [duplicate, setDuplicate] = useState<any>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<ImportFieldKey, number>>({
    first_name: -1,
    last_name: -1,
    phone: -1,
    email: -1,
    company: -1,
  });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; dupSkipped: number; invalidSkipped: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      await loadContacts();
      const { data: companyData } = await supabaseBrowser
        .from("companies")
        .select("id, name, project_id")
        .order("name", { ascending: true });
      setCompanies(companyData || []);
      const { data: projectData } = await supabaseBrowser
        .from("projects")
        .select("*")
        .order("name", { ascending: true });
      setProjects(projectData || []);
    })();
  }, []);

  async function loadContacts() {
    setLoading(true);
    const { data } = await supabaseBrowser
      .from("contacts")
      .select("*, companies(name, project_id), calls(summary, call_date, outcome)")
      .order("created_at", { ascending: false });
    setContacts(data || []);
    setLoading(false);
  }

  async function checkDuplicatePhone() {
    const phone = form.phone.trim();
    if (!phone) {
      setDuplicate(null);
      setConfirmDuplicate(false);
      return;
    }
    const { data } = await supabaseBrowser
      .from("contacts")
      .select("id, first_name, last_name, phone")
      .eq("phone", phone)
      .limit(1);
    const match = data && data.length ? data[0] : null;
    setDuplicate(match);
    setConfirmDuplicate(false);
  }

  async function createContact(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.first_name.trim()) {
      setFormError("First name is required.");
      return;
    }
    if (duplicate && !confirmDuplicate) {
      setFormError("A contact with this phone number already exists. Confirm below to save anyway.");
      return;
    }
    setSaving(true);
    const { error } = await supabaseBrowser.from("contacts").insert({
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      company_id: form.company_id || null,
      source: form.source || "manual",
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm({ first_name: "", last_name: "", phone: "", email: "", company_id: "", source: "manual" });
    setDuplicate(null);
    setConfirmDuplicate(false);
    setShowForm(false);
    loadContacts();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, rows } = parseCsv(String(reader.result || ""));
      setImportHeaders(headers);
      setImportRows(rows);
      setColumnMap(guessColumnMap(headers));
      setImportResult(null);
      setShowImport(true);
    };
    reader.readAsText(file);
  }

  async function runImport() {
    setImporting(true);
    let added = 0;
    let dupSkipped = 0;
    let invalidSkipped = 0;

    const seenPhones = new Set(contacts.map((c) => c.phone).filter(Boolean));
    const companyIdByName = new Map<string, string>(
      companies.map((c) => [c.name.trim().toLowerCase(), c.id])
    );

    for (const row of importRows) {
      const get = (key: ImportFieldKey) => {
        const idx = columnMap[key];
        return idx >= 0 ? (row[idx] || "").trim() : "";
      };
      const first_name = get("first_name");
      const last_name = get("last_name");
      const phone = get("phone");
      const email = get("email");
      const companyName = get("company");

      if (!first_name) {
        invalidSkipped++;
        continue;
      }
      if (phone && seenPhones.has(phone)) {
        dupSkipped++;
        continue;
      }

      let company_id: string | null = null;
      if (companyName) {
        const key = companyName.toLowerCase();
        if (companyIdByName.has(key)) {
          company_id = companyIdByName.get(key)!;
        } else {
          const { data: newCompany, error: companyError } = await supabaseBrowser
            .from("companies")
            .insert({ name: companyName })
            .select()
            .single();
          if (!companyError && newCompany) {
            company_id = newCompany.id;
            companyIdByName.set(key, newCompany.id);
          }
        }
      }

      const { error } = await supabaseBrowser.from("contacts").insert({
        first_name,
        last_name: last_name || null,
        phone: phone || null,
        email: email || null,
        company_id,
      });

      if (error) {
        invalidSkipped++;
        continue;
      }
      if (phone) seenPhones.add(phone);
      added++;
    }

    setImportResult({ added, dupSkipped, invalidSkipped });
    setImporting(false);
    loadContacts();
    const { data: companyData } = await supabaseBrowser
      .from("companies")
      .select("id, name")
      .order("name", { ascending: true });
    setCompanies(companyData || []);
  }

  const filteredContacts = contacts.filter((c) => {
    const matchesProject = projectFilter === "all" || c.companies?.project_id === projectFilter;
    if (!matchesProject) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      `${c.first_name} ${c.last_name || ""}`.toLowerCase().includes(s) ||
      (c.email || "").toLowerCase().includes(s) ||
      (c.phone || "").toLowerCase().includes(s) ||
      (c.companies?.name || "").toLowerCase().includes(s)
    );
  });

  function exportCsv() {
    downloadCsv(
      "contacts.csv",
      filteredContacts.map((c) => ({
        first_name: c.first_name,
        last_name: c.last_name || "",
        company: c.companies?.name || "",
        phone: c.phone || "",
        email: c.email || "",
      }))
    );
  }

  return (
    <div>
      <Topbar />
      <div className="container">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2>Contacts</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="file"
              accept=".csv"
              ref={fileInputRef}
              onChange={handleFileSelected}
              style={{ display: "none" }}
            />
            <button className="btn secondary" onClick={() => fileInputRef.current?.click()}>Import CSV</button>
            <button className="btn secondary" onClick={exportCsv}>Export CSV</button>
            <button className="btn" onClick={() => setShowForm(true)}>New Contact</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input
            placeholder="Search by name, email, phone, or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", minWidth: 320 }}
          />
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)" }}
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

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
                onBlur={checkDuplicatePhone}
              />
              {duplicate && (
                <div
                  style={{
                    background: "var(--primary-tint)",
                    border: "1px solid var(--primary)",
                    borderRadius: 6,
                    padding: 10,
                    marginTop: -8,
                    marginBottom: 14,
                    fontSize: 13,
                  }}
                >
                  <div style={{ marginBottom: 6 }}>
                    ⚠️ A contact with this phone number already exists:{" "}
                    <a href={`/contacts/${duplicate.id}`} target="_blank" rel="noreferrer">
                      {duplicate.first_name} {duplicate.last_name || ""}
                    </a>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: "normal" }}>
                    <input
                      type="checkbox"
                      checked={confirmDuplicate}
                      onChange={(e) => setConfirmDuplicate(e.target.checked)}
                    />
                    Save anyway, this is a different person
                  </label>
                </div>
              )}
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
              <label>Source</label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                style={{ width: "100%", padding: 10, margin: "6px 0 14px", borderRadius: 6, border: "1px solid #ddd" }}
              >
                <option value="manual">Manual</option>
                <option value="apify_scrape">Apify Scrape</option>
                <option value="referral">Referral</option>
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

        {showImport && (
          <div className="modal-overlay" onClick={() => { if (!importing) setShowImport(false); }}>
            <div
              className="login-card"
              onClick={(e) => e.stopPropagation()}
              style={{ width: 560, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto" }}
            >
              <h3 style={{ marginTop: 0 }}>Import Contacts from CSV</h3>

              {!importResult ? (
                <>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    {importRows.length} row{importRows.length === 1 ? "" : "s"} found. Map each field to a column from your file.
                  </p>
                  {IMPORT_FIELDS.map((f) => (
                    <div key={f.key} style={{ marginBottom: 10 }}>
                      <label>{f.label}{f.key === "first_name" && " *"}</label>
                      <select
                        value={columnMap[f.key]}
                        onChange={(e) => setColumnMap({ ...columnMap, [f.key]: Number(e.target.value) })}
                        style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--input-border)" }}
                      >
                        <option value={-1}>— Not mapped —</option>
                        {importHeaders.map((h, i) => (
                          <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  ))}

                  <div style={{ margin: "12px 0", overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          {IMPORT_FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.slice(0, 5).map((row, i) => (
                          <tr key={i}>
                            {IMPORT_FIELDS.map((f) => {
                              const idx = columnMap[f.key];
                              return <td key={f.key}>{idx >= 0 ? row[idx] : "—"}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {importRows.length > 5 && (
                      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>…and {importRows.length - 5} more row(s)</p>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn"
                      disabled={columnMap.first_name === -1 || importing}
                      onClick={runImport}
                      style={{ flex: 1 }}
                    >
                      {importing ? "Importing…" : `Import ${importRows.length} Contact(s)`}
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={importing}
                      style={{ flex: 1 }}
                      onClick={() => setShowImport(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    ✅ {importResult.added} contact{importResult.added === 1 ? "" : "s"} added.<br />
                    ⚠️ {importResult.dupSkipped} skipped as duplicate phone number{importResult.dupSkipped === 1 ? "" : "s"}.<br />
                    {importResult.invalidSkipped > 0 && (
                      <>❌ {importResult.invalidSkipped} skipped (missing first name or error).<br /></>
                    )}
                  </p>
                  <button className="btn" style={{ width: "100%" }} onClick={() => setShowImport(false)}>
                    Done
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {loading ? <p>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>Attempts</th><th>Last AI Call Summary</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.map((c) => {
                const calls = c.calls || [];
                const last = calls.length
                  ? [...calls].sort((a: any, b: any) => new Date(b.call_date).getTime() - new Date(a.call_date).getTime())[0]
                  : null;
                return (
                  <tr key={c.id}>
                    <td><a href={`/contacts/${c.id}`}>{c.first_name} {c.last_name}</a></td>
                    <td>{c.companies?.name || "—"}</td>
                    <td>{c.phone || "—"}</td>
                    <td>{c.email || "—"}</td>
                    <td>
                      {c.call_attempts || 0}
                      {c.max_attempts_reached && <span title="Max attempts reached" style={{ color: "#d33" }}> ⚠</span>}
                    </td>
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
