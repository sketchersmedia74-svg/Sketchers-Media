"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { downloadCsv } from "@/lib/csv";
import Sidebar from "../components/Sidebar";

const STAGES = ["New", "Contacted", "Proposal", "Won", "Lost"];

const LOST_REASONS = [
  { value: "not_interested", label: "Not interested" },
  { value: "no_budget", label: "No budget" },
  { value: "bad_timing", label: "Bad timing" },
  { value: "competitor", label: "Went with a competitor" },
  { value: "other", label: "Other" },
];

type Deal = {
  id: string;
  title: string;
  value: number;
  stage: string;
  owner: string | null;
  lost_reason: string | null;
  created_at: string;
  contacts: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    company_id: string | null;
    companies: { project_id: string | null } | null;
    calls: { summary: string; call_date: string; outcome: string }[];
  } | null;
};

type SortKey = "title" | "contact" | "stage" | "value" | "owner" | "created_at";

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="app-shell"><Sidebar /><div className="app-main"><div className="container"><p>Loading…</p></div></div></div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [dueTasks, setDueTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState(() => searchParams.get("owner") || "all");
  const [fromDate, setFromDate] = useState(() => searchParams.get("from") || "");
  const [toDate, setToDate] = useState(() => searchParams.get("to") || "");
  const [view, setView] = useState<"board" | "table">("board");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ contact_id: "", title: "", value: "", owner: "" });
  const [teamMembers, setTeamMembers] = useState<{ id: string; email: string }[]>([]);
  const [teamNames, setTeamNames] = useState<{ id: string; name: string }[]>([]);
  const [editingOwnerDealId, setEditingOwnerDealId] = useState<string | null>(null);
  const [editDealId, setEditDealId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", value: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [lostDealId, setLostDealId] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [myDealsOnly, setMyDealsOnly] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [projectFilter, setProjectFilter] = useState("all");
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      setCurrentUserEmail(session.user.email || null);
      await loadDeals();
      const { data: contactData } = await supabaseBrowser
        .from("contacts")
        .select("id, first_name, last_name")
        .order("first_name", { ascending: true });
      setContacts(contactData || []);
      const { data: projectData } = await supabaseBrowser
        .from("projects")
        .select("*")
        .order("name", { ascending: true });
      setProjects(projectData || []);
      await loadDueTasks();
      const teamRes = await fetch("/api/team-members");
      if (teamRes.ok) setTeamMembers(await teamRes.json());
      const namesRes = await fetch("/api/team-names");
      if (namesRes.ok) setTeamNames(await namesRes.json());
    })();
  }, []);

  async function loadDueTasks() {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabaseBrowser
      .from("tasks")
      .select("id, description, due_date, contact_id, contacts(first_name, last_name)")
      .eq("completed", false)
      .lte("due_date", today)
      .order("due_date", { ascending: true });
    setDueTasks(data || []);
  }

  async function completeTask(taskId: string) {
    await supabaseBrowser.from("tasks").update({ completed: true }).eq("id", taskId);
    loadDueTasks();
  }

  async function createDeal(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.contact_id) {
      setFormError("Please select a contact.");
      return;
    }
    if (!form.title.trim()) {
      setFormError("Deal title is required.");
      return;
    }
    setSaving(true);
    const { error } = await supabaseBrowser.from("deals").insert({
      title: form.title.trim(),
      contact_id: form.contact_id,
      value: form.value ? Number(form.value) : 0,
      stage: "New",
      owner: form.owner || null,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm({ contact_id: "", title: "", value: "", owner: "" });
    setShowForm(false);
    loadDeals();
  }

  async function updateOwner(dealId: string, ownerEmail: string) {
    await supabaseBrowser.from("deals").update({ owner: ownerEmail || null }).eq("id", dealId);
    setEditingOwnerDealId(null);
    loadDeals();
  }

  function openEditDeal(deal: Deal) {
    setEditForm({ title: deal.title, value: String(deal.value || 0) });
    setEditError("");
    setEditDealId(deal.id);
  }

  async function saveEditDeal(e: React.FormEvent) {
    e.preventDefault();
    if (!editDealId) return;
    if (!editForm.title.trim()) {
      setEditError("Deal title is required.");
      return;
    }
    setEditSaving(true);
    const { error } = await supabaseBrowser
      .from("deals")
      .update({ title: editForm.title.trim(), value: editForm.value ? Number(editForm.value) : 0 })
      .eq("id", editDealId);
    setEditSaving(false);
    if (error) {
      setEditError(error.message);
      return;
    }
    setEditDealId(null);
    loadDeals();
  }

  async function loadDeals() {
    setLoading(true);
    const { data } = await supabaseBrowser
      .from("deals")
      .select("id, title, value, stage, owner, lost_reason, created_at, contacts(id, first_name, last_name, phone, company_id, companies(project_id), calls(summary, call_date, outcome))")
      .order("updated_at", { ascending: false });
    setDeals((data as any) || []);
    setLoading(false);
  }

  async function moveStage(dealId: string, stage: string) {
    if (stage === "Lost") {
      setLostReason("");
      setLostDealId(dealId);
      return;
    }
    await supabaseBrowser.from("deals").update({ stage, lost_reason: null }).eq("id", dealId);
    loadDeals();
  }

  async function confirmLostReason(e: React.FormEvent) {
    e.preventDefault();
    if (!lostDealId || !lostReason) return;
    await supabaseBrowser
      .from("deals")
      .update({ stage: "Lost", lost_reason: lostReason })
      .eq("id", lostDealId);
    setLostDealId(null);
    setLostReason("");
    loadDeals();
  }

  function handleDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    if (destination.droppableId === source.droppableId) return;
    moveStage(draggableId, destination.droppableId);
  }

  async function callNow(contactId: string) {
    const res = await fetch("/api/internal/trigger-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contactId }),
    });
    const json = await res.json();
    alert(res.ok ? "AI call triggered." : `Failed: ${json.error}`);
  }

  function latestCall(deal: Deal) {
    const calls = deal.contacts?.calls || [];
    if (!calls.length) return null;
    return [...calls].sort((a, b) => new Date(b.call_date).getTime() - new Date(a.call_date).getTime())[0];
  }

  const owners = Array.from(new Set(deals.map((d) => d.owner).filter(Boolean))) as string[];

  // Combines actual login accounts (identified by email) with name-only
  // roster entries (for teams sharing a single login) into one assignable
  // owner list for the dropdowns below.
  const ownerOptions = [
    ...teamMembers.map((m) => m.email),
    ...teamNames.map((n) => n.name),
  ];

  const now = new Date();
  const monthTotal = deals.filter((d) => {
    const created = new Date(d.created_at);
    return created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
  }).length;
  const stageCounts = STAGES.reduce((acc, s) => {
    acc[s] = deals.filter((d) => d.stage === s).length;
    return acc;
  }, {} as Record<string, number>);
  const conversionRate = deals.length ? Math.round((stageCounts["Won"] / deals.length) * 1000) / 10 : 0;

  const filteredDeals = deals.filter((d) => {
    const matchesOwner = owner === "all" || d.owner === owner;
    const name = d.contacts ? `${d.contacts.first_name} ${d.contacts.last_name || ""}` : "";
    const matchesSearch =
      !search ||
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      name.toLowerCase().includes(search.toLowerCase());
    const createdDate = d.created_at.slice(0, 10);
    const matchesFrom = !fromDate || createdDate >= fromDate;
    const matchesTo = !toDate || createdDate <= toDate;
    const matchesMine = !myDealsOnly || d.owner === currentUserEmail;
    const matchesProject = projectFilter === "all" || d.contacts?.companies?.project_id === projectFilter;
    return matchesOwner && matchesSearch && matchesFrom && matchesTo && matchesMine && matchesProject;
  });

  function contactName(d: Deal) {
    return d.contacts ? `${d.contacts.first_name} ${d.contacts.last_name || ""}`.trim() : "No contact";
  }

  const sortedDeals = [...filteredDeals].sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    switch (sortKey) {
      case "contact":
        av = contactName(a).toLowerCase();
        bv = contactName(b).toLowerCase();
        break;
      case "value":
        av = Number(a.value || 0);
        bv = Number(b.value || 0);
        break;
      case "created_at":
        av = a.created_at;
        bv = b.created_at;
        break;
      default:
        av = (a[sortKey] || "").toString().toLowerCase();
        bv = (b[sortKey] || "").toString().toLowerCase();
    }
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortAsc ? " ▲" : " ▼";
  }

  function exportCsv() {
    downloadCsv(
      "deals.csv",
      filteredDeals.map((d) => ({
        title: d.title,
        contact: contactName(d),
        stage: d.stage,
        value: d.value,
        owner: d.owner || "",
        created_date: d.created_at.slice(0, 10),
      }))
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
      <div className="container">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2>Pipeline</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn secondary"
              onClick={() => setView(view === "board" ? "table" : "board")}
            >
              {view === "board" ? "Table view" : "Board view"}
            </button>
            <button className="btn secondary" onClick={exportCsv}>Export CSV</button>
            <button className="btn" onClick={() => setShowForm(true)}>New Deal</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          <div className="card" style={{ flex: "1 1 140px", margin: 0, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>This Month</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{monthTotal}</div>
          </div>
          {STAGES.map((s) => (
            <div className="card" key={s} style={{ flex: "1 1 110px", margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>{s}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{stageCounts[s]}</div>
            </div>
          ))}
          <div className="card" style={{ flex: "1 1 140px", margin: 0, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>Conversion Rate</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)" }}>{conversionRate}%</div>
          </div>
        </div>

        {dueTasks.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ margin: "4px 0 8px", fontSize: 14, textTransform: "uppercase", color: "var(--primary)" }}>
              Due Today / Overdue ({dueTasks.length})
            </h3>
            {dueTasks.map((t) => {
              const overdue = new Date(t.due_date) < new Date(new Date().toISOString().slice(0, 10));
              const contactName = t.contacts ? `${t.contacts.first_name} ${t.contacts.last_name || ""}` : "Unknown contact";
              return (
                <div className="card" key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div>{t.description}</div>
                    <div className="meta" style={{ marginBottom: 0, color: overdue ? "#d33" : undefined }}>
                      <a href={`/contacts/${t.contact_id}`}>{contactName}</a> · Due {new Date(t.due_date).toLocaleDateString()}
                      {overdue && " · Overdue"}
                    </div>
                  </div>
                  <button className="btn secondary" onClick={() => completeTask(t.id)}>Mark done</button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input
            placeholder="Search deal title or contact…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #ddd", minWidth: 260 }}
          />
          <select value={owner} onChange={(e) => setOwner(e.target.value)} style={{ padding: "8px 10px", borderRadius: 6 }}>
            <option value="all">All owners</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
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
          <button
            className={myDealsOnly ? "btn" : "btn secondary"}
            onClick={() => setMyDealsOnly(!myDealsOnly)}
            disabled={!currentUserEmail}
            title={currentUserEmail ? undefined : "Sign in to use this filter"}
          >
            My Deals
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)" }}
            />
          </label>
        </div>

        {showForm && (
          <div className="modal-overlay" onClick={() => setShowForm(false)}>
            <form className="login-card" onClick={(e) => e.stopPropagation()} onSubmit={createDeal}>
              <h3 style={{ marginTop: 0 }}>New Deal</h3>
              <label>Contact</label>
              <select
                value={form.contact_id}
                onChange={(e) => setForm({ ...form, contact_id: e.target.value })}
                style={{ width: "100%", padding: 10, margin: "6px 0 14px", borderRadius: 6, border: "1px solid #ddd" }}
              >
                <option value="">— Select a contact —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.first_name} {c.last_name || ""}</option>
                ))}
              </select>
              <label>Deal title</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
              <label>Value ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
              <label>Owner</label>
              <select
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                style={{ width: "100%", padding: 10, margin: "6px 0 14px", borderRadius: 6, border: "1px solid #ddd" }}
              >
                <option value="">— Unassigned —</option>
                {ownerOptions.map((o) => (
                  <option key={o} value={o}>{o}</option>
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

        {editDealId && (
          <div className="modal-overlay" onClick={() => setEditDealId(null)}>
            <form className="login-card" onClick={(e) => e.stopPropagation()} onSubmit={saveEditDeal}>
              <h3 style={{ marginTop: 0 }}>Edit Deal</h3>
              <label>Deal title</label>
              <input
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                required
              />
              <label>Value ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editForm.value}
                onChange={(e) => setEditForm({ ...editForm, value: e.target.value })}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" type="submit" disabled={editSaving} style={{ flex: 1 }}>
                  {editSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ flex: 1 }}
                  onClick={() => setEditDealId(null)}
                >
                  Cancel
                </button>
              </div>
              {editError && <p className="error">{editError}</p>}
            </form>
          </div>
        )}

        {lostDealId && (
          <div className="modal-overlay" onClick={() => setLostDealId(null)}>
            <form className="login-card" onClick={(e) => e.stopPropagation()} onSubmit={confirmLostReason}>
              <h3 style={{ marginTop: 0 }}>Why was this deal lost?</h3>
              <label>Reason</label>
              <select
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                style={{ width: "100%", padding: 10, margin: "6px 0 14px", borderRadius: 6, border: "1px solid var(--input-border)" }}
                required
              >
                <option value="">— Select a reason —</option>
                {LOST_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" type="submit" style={{ flex: 1 }}>Confirm</button>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ flex: 1 }}
                  onClick={() => setLostDealId(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
        {loading ? <p>Loading…</p> : view === "table" ? (
          <table>
            <thead>
              <tr>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("title")}>Title{sortIndicator("title")}</th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("contact")}>Contact{sortIndicator("contact")}</th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("stage")}>Stage{sortIndicator("stage")}</th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("value")}>Value{sortIndicator("value")}</th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("owner")}>Owner{sortIndicator("owner")}</th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("created_at")}>Created{sortIndicator("created_at")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedDeals.map((d) => (
                <tr key={d.id}>
                  <td>{d.title}</td>
                  <td>{contactName(d)}</td>
                  <td>{d.stage}</td>
                  <td>${Number(d.value || 0).toLocaleString()}</td>
                  <td>{d.owner || "—"}</td>
                  <td>{new Date(d.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="board">
              {STAGES.map((stage) => {
                const stageDeals = filteredDeals.filter((d) => d.stage === stage);
                return (
                  <Droppable droppableId={stage} key={stage}>
                    {(provided, snapshot) => (
                      <div
                        className="column"
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        style={{ background: snapshot.isDraggingOver ? "var(--primary-tint)" : undefined }}
                      >
                        <h3>{stage} ({stageDeals.length})</h3>
                        {stageDeals.map((deal, index) => {
                          const call = latestCall(deal);
                          return (
                            <Draggable draggableId={deal.id} index={index} key={deal.id}>
                              {(dragProvided, dragSnapshot) => (
                                <div
                                  className="card"
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  style={{
                                    ...dragProvided.draggableProps.style,
                                    boxShadow: dragSnapshot.isDragging ? "0 4px 14px rgba(0,0,0,0.2)" : undefined,
                                  }}
                                >
                                  <h4>{deal.title}</h4>
                                  <div className="meta">
                                    {deal.contacts ? `${deal.contacts.first_name} ${deal.contacts.last_name || ""}` : "No contact"}
                                  </div>
                                  <div className="value">${Number(deal.value || 0).toLocaleString()}</div>

                                  <div className="meta" style={{ marginTop: 4 }}>
                                    {editingOwnerDealId === deal.id ? (
                                      <select
                                        autoFocus
                                        value={deal.owner || ""}
                                        onChange={(e) => updateOwner(deal.id, e.target.value)}
                                        onBlur={() => setEditingOwnerDealId(null)}
                                        style={{ fontSize: 12 }}
                                      >
                                        <option value="">— Unassigned —</option>
                                        {ownerOptions.map((o) => (
                                          <option key={o} value={o}>{o}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span
                                        style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                                        title="Click to change owner"
                                        onClick={() => setEditingOwnerDealId(deal.id)}
                                      >
                                        Owner: {deal.owner || "Unassigned"}
                                      </span>
                                    )}
                                  </div>

                                  {stage === "Lost" && deal.lost_reason && (
                                    <div className="meta" style={{ marginTop: 4 }}>
                                      Reason: {LOST_REASONS.find((r) => r.value === deal.lost_reason)?.label || deal.lost_reason}
                                    </div>
                                  )}

                                  {stage === "Contacted" && call && (
                                    <div className="call-summary">
                                      <span className="label">AI Call Summary</span>
                                      {call.summary}
                                      {call.outcome && <div style={{ marginTop: 4, color: "#555" }}>Outcome: {call.outcome}</div>}
                                    </div>
                                  )}
                                  {stage === "Contacted" && !call && (
                                    <div className="call-summary" style={{ borderLeftColor: "#aaa", color: "#888" }}>
                                      No AI call logged yet.
                                    </div>
                                  )}

                                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    {deal.contacts?.phone && (
                                      <button className="btn secondary" onClick={() => callNow(deal.contacts!.id)}>
                                        Call now
                                      </button>
                                    )}
                                    <button className="btn secondary" onClick={() => openEditDeal(deal)}>
                                      Edit
                                    </button>
                                    <select
                                      value={deal.stage}
                                      onChange={(e) => moveStage(deal.id, e.target.value)}
                                      style={{ fontSize: 12 }}
                                    >
                                      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                );
              })}
            </div>
          </DragDropContext>
        )}
      </div>
      </div>
    </div>
  );
}
