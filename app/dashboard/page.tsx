"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Topbar from "../components/Topbar";

const STAGES = ["New", "Contacted", "Proposal", "Won", "Lost"];

type Deal = {
  id: string;
  title: string;
  value: number;
  stage: string;
  owner: string | null;
  contacts: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    calls: { summary: string; call_date: string; outcome: string }[];
  } | null;
};

export default function Dashboard() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ contact_id: "", title: "", value: "" });
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      await loadDeals();
      const { data: contactData } = await supabaseBrowser
        .from("contacts")
        .select("id, first_name, last_name")
        .order("first_name", { ascending: true });
      setContacts(contactData || []);
    })();
  }, []);

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
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm({ contact_id: "", title: "", value: "" });
    setShowForm(false);
    loadDeals();
  }

  async function loadDeals() {
    setLoading(true);
    const { data } = await supabaseBrowser
      .from("deals")
      .select("id, title, value, stage, owner, contacts(id, first_name, last_name, phone, calls(summary, call_date, outcome))")
      .order("updated_at", { ascending: false });
    setDeals((data as any) || []);
    setLoading(false);
  }

  async function moveStage(dealId: string, stage: string) {
    await supabaseBrowser.from("deals").update({ stage }).eq("id", dealId);
    loadDeals();
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

  const filteredDeals = deals.filter((d) => {
    const matchesOwner = owner === "all" || d.owner === owner;
    const name = d.contacts ? `${d.contacts.first_name} ${d.contacts.last_name || ""}` : "";
    const matchesSearch =
      !search ||
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      name.toLowerCase().includes(search.toLowerCase());
    return matchesOwner && matchesSearch;
  });

  return (
    <div>
      <Topbar />
      <div className="container">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2>Pipeline</h2>
          <button className="btn" onClick={() => setShowForm(true)}>New Deal</button>
        </div>
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
          <div className="board">
            {STAGES.map((stage) => (
              <div className="column" key={stage}>
                <h3>{stage} ({filteredDeals.filter((d) => d.stage === stage).length})</h3>
                {filteredDeals.filter((d) => d.stage === stage).map((deal) => {
                  const call = latestCall(deal);
                  return (
                    <div className="card" key={deal.id}>
                      <h4>{deal.title}</h4>
                      <div className="meta">
                        {deal.contacts ? `${deal.contacts.first_name} ${deal.contacts.last_name || ""}` : "No contact"}
                      </div>
                      <div className="value">${Number(deal.value || 0).toLocaleString()}</div>

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

                      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                        {deal.contacts?.phone && (
                          <button className="btn secondary" onClick={() => callNow(deal.contacts!.id)}>
                            Call now
                          </button>
                        )}
                        <select
                          value={deal.stage}
                          onChange={(e) => moveStage(deal.id, e.target.value)}
                          style={{ fontSize: 12 }}
                        >
                          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
