"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Sidebar from "../components/Sidebar";

const STAGES = ["New", "Contacted", "Proposal", "Won", "Lost"];
const STALLED_DAYS = 14;
// Ordinal sequential ramp (one hue, light -> dark) for the funnel stages —
// mixed against the card surface so it adapts automatically in dark mode.
const FUNNEL_MIX = [28, 45, 62, 79, 96];

type Deal = {
  id: string;
  title: string;
  stage: string;
  value: number;
  owner: string | null;
  created_at: string;
  updated_at: string;
  contacts: {
    id: string;
    first_name: string;
    last_name: string | null;
    created_at: string;
    call_attempts: number | null;
    calls: { outcome: string; call_date: string }[];
  } | null;
};

type Contact = {
  id: string;
  first_name: string;
  last_name: string | null;
  source: string | null;
  owner: string | null;
  created_at: string;
};

type Company = { id: string; name: string };
type TaskRow = { id: string; contact_id: string; description: string; due_date: string | null; created_at: string; completed: boolean };
type NoteRow = { id: string; contact_id: string; created_at: string };

function formatDuration(ms: number) {
  const hours = ms / 3600000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60000))} min`;
  if (hours < 48) return `${hours.toFixed(1)} hrs`;
  return `${(hours / 24).toFixed(1)} days`;
}

function daysBetween(fromDate: string, toDate: string) {
  return Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) + 1;
}

function Trend({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return null;
  if (previous === 0 && current === 0) return null;
  const delta = previous === 0 ? 100 : Math.round(((current - previous) / previous) * 100);
  const up = delta >= 0;
  return (
    <div style={{ fontSize: 11, color: up ? "#0a7a3d" : "#c0392b", marginTop: 2 }}>
      {up ? "▲" : "▼"} {Math.abs(delta)}% vs prior period
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<div className="app-shell"><Sidebar /><div className="app-main"><div className="container"><p>Loading…</p></div></div></div>}>
      <OverviewContent />
    </Suspense>
  );
}

function OverviewContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [selectedRep, setSelectedRep] = useState(() => searchParams.get("rep") || "");
  const [ownerNames, setOwnerNames] = useState<Map<string, string>>(new Map());
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [fullName, setFullName] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [search, setSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const notifBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
      if (notifBoxRef.current && !notifBoxRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [teamFilter, setTeamFilter] = useState(() => searchParams.get("team") || "all");
  const [fromDate, setFromDate] = useState(() => searchParams.get("from") || "");
  const [toDate, setToDate] = useState(() => searchParams.get("to") || "");

  // Keep the URL in sync with the active filters so this view is bookmarkable/shareable.
  useEffect(() => {
    const params = new URLSearchParams();
    if (teamFilter !== "all") params.set("team", teamFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (selectedRep) params.set("rep", selectedRep);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [teamFilter, fromDate, toDate, selectedRep]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      setUserEmail(session.user.email || "");
      setUserId(session.user.id);

      const { data: profile } = await supabaseBrowser
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .single();
      setFullName(profile?.full_name || null);

      const { data: profilesData } = await supabaseBrowser
        .from("profiles")
        .select("email, full_name");
      const nameMap = new Map<string, string>();
      (profilesData || []).forEach((p: { email: string; full_name: string | null }) => {
        if (p.full_name) nameMap.set(p.email, p.full_name);
      });
      setOwnerNames(nameMap);

      const { data: dealData } = await supabaseBrowser
        .from("deals")
        .select("id, title, stage, value, owner, created_at, updated_at, contacts(id, first_name, last_name, created_at, call_attempts, calls(outcome, call_date))")
        .order("created_at", { ascending: false });
      setDeals((dealData as any) || []);

      const { data: contactData } = await supabaseBrowser
        .from("contacts")
        .select("id, first_name, last_name, source, owner, created_at")
        .order("created_at", { ascending: false });
      setContacts(contactData || []);

      const { data: companyData } = await supabaseBrowser
        .from("companies")
        .select("id, name");
      setCompanies(companyData || []);

      const { data: taskData } = await supabaseBrowser
        .from("tasks")
        .select("id, contact_id, description, due_date, created_at, completed");
      setTasks(taskData || []);

      const { data: noteData } = await supabaseBrowser
        .from("notes")
        .select("id, contact_id, created_at");
      setNotes(noteData || []);

      setLoading(false);
    })();
  }, []);

  const owners = Array.from(new Set(deals.map((d) => d.owner).filter(Boolean))) as string[];
  const ownerLabel = (email: string) => ownerNames.get(email) || email;

  function inRangeOf(dateStr: string, from: string, to: string) {
    const d = dateStr.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }
  const inRange = (dateStr: string) => inRangeOf(dateStr, fromDate, toDate);

  const filteredDeals = deals.filter((d) => {
    const matchesTeam = teamFilter === "all" || d.owner === teamFilter;
    return matchesTeam && inRange(d.created_at);
  });

  const filteredContacts = contacts.filter((c) => {
    const matchesTeam = teamFilter === "all" || c.owner === teamFilter;
    return matchesTeam && inRange(c.created_at);
  });

  function latestOutcome(deal: Deal) {
    const calls = deal.contacts?.calls || [];
    if (!calls.length) return null;
    return [...calls].sort((a, b) => new Date(b.call_date).getTime() - new Date(a.call_date).getTime())[0].outcome;
  }

  const pendingLeads = filteredDeals.filter((d) => d.stage === "New").length;
  const totalLeads = filteredDeals.length;
  const contactedLeads = filteredDeals.filter((d) => d.stage === "Contacted").length;

  const stalledCutoff = Date.now() - STALLED_DAYS * 24 * 60 * 60 * 1000;
  const hotDeals = filteredDeals.filter((d) => latestOutcome(d) === "interested").length;
  const totalDeals = filteredDeals.length;
  const stalledDeals = filteredDeals.filter(
    (d) => !["Won", "Lost"].includes(d.stage) && new Date(d.updated_at).getTime() < stalledCutoff
  ).length;

  // Prior-period comparison: only meaningful once a concrete date range is picked.
  let prevPendingLeads: number | null = null;
  let prevTotalLeads: number | null = null;
  let prevContactedLeads: number | null = null;
  let prevHotDeals: number | null = null;
  let prevTotalDeals: number | null = null;
  let prevStalledDeals: number | null = null;

  if (fromDate && toDate) {
    const span = daysBetween(fromDate, toDate);
    const prevTo = new Date(new Date(fromDate).getTime() - 86400000).toISOString().slice(0, 10);
    const prevFrom = new Date(new Date(fromDate).getTime() - span * 86400000).toISOString().slice(0, 10);
    const prevDeals = deals.filter((d) => {
      const matchesTeam = teamFilter === "all" || d.owner === teamFilter;
      return matchesTeam && inRangeOf(d.created_at, prevFrom, prevTo);
    });
    prevPendingLeads = prevDeals.filter((d) => d.stage === "New").length;
    prevTotalLeads = prevDeals.length;
    prevContactedLeads = prevDeals.filter((d) => d.stage === "Contacted").length;
    prevHotDeals = prevDeals.filter((d) => latestOutcome(d) === "interested").length;
    prevTotalDeals = prevDeals.length;
    prevStalledDeals = prevDeals.filter(
      (d) => !["Won", "Lost"].includes(d.stage) && new Date(d.updated_at).getTime() < stalledCutoff
    ).length;
  }

  const sourceCounts: Record<string, number> = {};
  filteredContacts.forEach((c) => {
    const key = c.source || "manual";
    sourceCounts[key] = (sourceCounts[key] || 0) + 1;
  });
  const sourceEntries = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);
  const maxSourceCount = Math.max(1, ...sourceEntries.map(([, n]) => n));

  const stageStats = STAGES.map((stage) => {
    const stageDeals = filteredDeals.filter((d) => d.stage === stage);
    return {
      stage,
      count: stageDeals.length,
      value: stageDeals.reduce((sum, d) => sum + Number(d.value || 0), 0),
    };
  });
  const maxStageCount = Math.max(1, ...stageStats.map((s) => s.count));

  // Rep performance: response time & persistence for one selected team member
  const effectiveRep = selectedRep || owners[0] || "";
  const repContactsById = new Map<string, Deal["contacts"]>();
  deals.forEach((d) => {
    if (d.owner === effectiveRep && d.contacts) repContactsById.set(d.contacts.id, d.contacts);
  });
  const repContacts = Array.from(repContactsById.values());

  const responseTimesMs: number[] = [];
  repContacts.forEach((c) => {
    const calls = c?.calls || [];
    if (!calls.length || !c?.created_at) return;
    const firstCall = calls.reduce((min, call) => (new Date(call.call_date) < new Date(min.call_date) ? call : min), calls[0]);
    const diff = new Date(firstCall.call_date).getTime() - new Date(c.created_at).getTime();
    if (diff >= 0) responseTimesMs.push(diff);
  });
  const avgResponseMs = responseTimesMs.length
    ? responseTimesMs.reduce((a, b) => a + b, 0) / responseTimesMs.length
    : null;

  const attemptCounts = repContacts.map((c) => c?.call_attempts || 0).filter((n) => n > 0);
  const avgPersistence = attemptCounts.length
    ? attemptCounts.reduce((a, b) => a + b, 0) / attemptCounts.length
    : null;

  // Contact -> owner/name lookup (via their deal), so tasks/notes can be filtered by team
  // and notifications can show a human-readable contact name.
  const contactOwnerById = new Map<string, string | null>();
  const contactNameById = new Map<string, string>();
  deals.forEach((d) => {
    if (d.contacts) {
      contactOwnerById.set(d.contacts.id, d.owner);
      contactNameById.set(d.contacts.id, `${d.contacts.first_name} ${d.contacts.last_name || ""}`.trim());
    }
  });

  const filteredTasks = tasks.filter((t) => {
    const matchesTeam = teamFilter === "all" || contactOwnerById.get(t.contact_id) === teamFilter;
    return matchesTeam && inRange(t.due_date || t.created_at);
  });
  const completedFollowUps = filteredTasks.filter((t) => t.completed).length;
  const pendingFollowUps = filteredTasks.length - completedFollowUps;

  const filteredNotes = notes.filter((n) => {
    const matchesTeam = teamFilter === "all" || contactOwnerById.get(n.contact_id) === teamFilter;
    return matchesTeam && inRange(n.created_at);
  });

  const activityCounts = [
    { label: "Deals", count: filteredDeals.length },
    { label: "Notes", count: filteredNotes.length },
    { label: "Follow-ups", count: filteredTasks.length },
  ];
  const maxActivityCount = Math.max(1, ...activityCounts.map((a) => a.count));

  // Notifications: overdue follow-ups, stalled deals, and fresh "interested" outcomes,
  // scoped to whatever team/date filters are currently active on this page.
  const today = new Date().toISOString().slice(0, 10);
  const notifications = useMemo(() => {
    const items: { id: string; text: string; href: string }[] = [];
    filteredTasks
      .filter((t) => !t.completed && t.due_date && t.due_date < today)
      .forEach((t) => {
        const name = contactNameById.get(t.contact_id) || "a contact";
        items.push({ id: `task-${t.id}`, text: `Overdue follow-up with ${name}: ${t.description}`, href: `/contacts/${t.contact_id}` });
      });
    filteredDeals
      .filter((d) => !["Won", "Lost"].includes(d.stage) && new Date(d.updated_at).getTime() < stalledCutoff)
      .forEach((d) => {
        items.push({ id: `stalled-${d.id}`, text: `Deal "${d.title}" has stalled (no activity in ${STALLED_DAYS}+ days)`, href: d.contacts ? `/contacts/${d.contacts.id}` : "/dashboard" });
      });
    filteredDeals
      .filter((d) => latestOutcome(d) === "interested")
      .forEach((d) => {
        items.push({ id: `hot-${d.id}`, text: `🔥 "${d.title}" marked interested`, href: d.contacts ? `/contacts/${d.contacts.id}` : "/dashboard" });
      });
    return items.slice(0, 12);
  }, [filteredTasks, filteredDeals]);

  const emailFallbackName = userEmail
    .split("@")[0]
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ") || userEmail;
  const displayName = fullName || emailFallbackName;
  const initial = (displayName[0] || "?").toUpperCase();

  function startEditingName() {
    setNameDraft(fullName || "");
    setEditingName(true);
  }

  async function saveName() {
    setSavingName(true);
    const { error } = await supabaseBrowser
      .from("profiles")
      .update({ full_name: nameDraft.trim() || null })
      .eq("id", userId);
    setSavingName(false);
    if (!error) {
      setFullName(nameDraft.trim() || null);
      setEditingName(false);
    }
  }

  function drillHref(base = "/dashboard") {
    const params = new URLSearchParams();
    if (teamFilter !== "all") params.set("owner", teamFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return { contacts: [], companies: [], deals: [] };
    return {
      contacts: contacts.filter((c) => `${c.first_name} ${c.last_name || ""}`.toLowerCase().includes(q)).slice(0, 5),
      companies: companies.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 5),
      deals: deals.filter((d) => d.title.toLowerCase().includes(q)).slice(0, 5),
    };
  }, [search, contacts, companies, deals]);
  const hasSearchResults = searchResults.contacts.length || searchResults.companies.length || searchResults.deals.length;

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <div className="overview-topbar" style={{ position: "relative" }}>
          <div ref={searchBoxRef} style={{ position: "relative", flex: 1, maxWidth: 420 }}>
            <input
              className="overview-search"
              placeholder="Search contacts, companies, deals…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setShowResults(true); }}
              onFocus={() => setShowResults(true)}
              style={{ width: "100%", maxWidth: "none" }}
            />
            {showResults && search.trim() && (
              <div className="search-dropdown">
                {!hasSearchResults ? (
                  <div className="search-dropdown-empty">No matches for "{search}"</div>
                ) : (
                  <>
                    {searchResults.contacts.length > 0 && (
                      <div className="search-group">
                        <div className="search-group-label">Contacts</div>
                        {searchResults.contacts.map((c) => (
                          <a key={c.id} href={`/contacts/${c.id}`} className="search-result">
                            {c.first_name} {c.last_name || ""}
                          </a>
                        ))}
                      </div>
                    )}
                    {searchResults.companies.length > 0 && (
                      <div className="search-group">
                        <div className="search-group-label">Companies</div>
                        {searchResults.companies.map((c) => (
                          <a key={c.id} href="/companies" className="search-result">{c.name}</a>
                        ))}
                      </div>
                    )}
                    {searchResults.deals.length > 0 && (
                      <div className="search-group">
                        <div className="search-group-label">Deals</div>
                        {searchResults.deals.map((d) => (
                          <a key={d.id} href="/dashboard" className="search-result">{d.title}</a>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div ref={notifBoxRef} style={{ position: "relative" }}>
            <button
              className="sidebar-icon-btn"
              style={{ color: "var(--text)", position: "relative" }}
              title="Notifications"
              onClick={() => setShowNotifications((v) => !v)}
            >
              🔔
              {notifications.length > 0 && <span className="notif-badge">{notifications.length}</span>}
            </button>
            {showNotifications && (
              <div className="notif-dropdown">
                {notifications.length === 0 ? (
                  <div className="search-dropdown-empty">You're all caught up.</div>
                ) : (
                  notifications.map((n) => (
                    <a key={n.id} href={n.href} className="notif-item">{n.text}</a>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="overview-user">
            <div className="overview-avatar">{initial}</div>
            <div>
              {editingName ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveName()}
                    placeholder="Your name"
                    style={{ fontSize: 13, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)", width: 140 }}
                  />
                  <button className="btn" style={{ padding: "3px 8px", fontSize: 12 }} onClick={saveName} disabled={savingName}>
                    {savingName ? "…" : "Save"}
                  </button>
                </div>
              ) : (
                <div
                  style={{ fontWeight: 600, fontSize: 14, cursor: "pointer" }}
                  title="Click to edit your name"
                  onClick={startEditingName}
                >
                  {displayName}
                </div>
              )}
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Sketchers Media</div>
            </div>
          </div>
        </div>

        <div className="container">
          {loading ? (
            <p>Loading…</p>
          ) : (
            <div className="overview-panels">
              {/* Left panel: leads */}
              <div className="overview-panel">
                <div className="overview-panel-filters">
                  <select
                    value={teamFilter}
                    onChange={(e) => setTeamFilter(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)" }}
                  >
                    <option value="all">All Team</option>
                    {owners.map((o) => <option key={o} value={o}>{ownerLabel(o)}</option>)}
                  </select>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)" }}
                  />
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)" }}
                  />
                </div>

                <div className="overview-stats">
                  <a className="overview-stat" href={drillHref()}>
                    <div className="label">Pending Leads</div>
                    <div className="num" style={{ color: "var(--primary)" }}>{pendingLeads}</div>
                    <Trend current={pendingLeads} previous={prevPendingLeads} />
                  </a>
                  <a className="overview-stat" href={drillHref()}>
                    <div className="label">Total Leads</div>
                    <div className="num">{totalLeads}</div>
                    <Trend current={totalLeads} previous={prevTotalLeads} />
                  </a>
                  <a className="overview-stat" href={drillHref()}>
                    <div className="label">Contacted Leads</div>
                    <div className="num">{contactedLeads}</div>
                    <Trend current={contactedLeads} previous={prevContactedLeads} />
                  </a>
                </div>

                <h3 style={{ fontSize: 14, textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 12px" }}>
                  Leads by Source
                </h3>
                {sourceEntries.length === 0 ? (
                  <p style={{ color: "var(--text-muted)" }}>No contacts yet.</p>
                ) : (
                  sourceEntries.map(([source, count]) => (
                    <div className="viz-bar-row" key={source}>
                      <div className="viz-bar-label">{source}</div>
                      <div className="viz-bar-track">
                        <div className="viz-bar-fill" style={{ width: `${(count / maxSourceCount) * 100}%` }}>
                          <span className="viz-bar-value">{count}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Right panel: deals */}
              <div className="overview-panel">
                <div className="overview-panel-filters">
                  <select
                    value={teamFilter}
                    onChange={(e) => setTeamFilter(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)" }}
                  >
                    <option value="all">All Team</option>
                    {owners.map((o) => <option key={o} value={o}>{ownerLabel(o)}</option>)}
                  </select>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)" }}
                  />
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)" }}
                  />
                </div>

                <div className="overview-stats">
                  <a className="overview-stat" href={drillHref()}>
                    <div className="label">Hot Deals</div>
                    <div className="num" style={{ color: "var(--primary)" }}>{hotDeals}</div>
                    <Trend current={hotDeals} previous={prevHotDeals} />
                  </a>
                  <a className="overview-stat" href={drillHref()}>
                    <div className="label">Total Deals</div>
                    <div className="num">{totalDeals}</div>
                    <Trend current={totalDeals} previous={prevTotalDeals} />
                  </a>
                  <a className="overview-stat" href={drillHref()}>
                    <div className="label">Stalled Deals</div>
                    <div className="num">{stalledDeals}</div>
                    <Trend current={stalledDeals} previous={prevStalledDeals} />
                  </a>
                </div>

                <h3 style={{ fontSize: 14, textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 12px" }}>
                  Pipeline Funnel
                </h3>
                {stageStats.map((s, i) => {
                  const widthPct = 35 + (s.count / maxStageCount) * 65;
                  const mixPct = FUNNEL_MIX[i];
                  const useDarkText = mixPct < 55;
                  return (
                    <div className="viz-funnel-row" key={s.stage}>
                      <a
                        className="viz-funnel-bar"
                        href={drillHref()}
                        style={{
                          width: `${widthPct}%`,
                          background: `color-mix(in srgb, var(--primary) ${mixPct}%, var(--card-bg))`,
                          color: useDarkText ? "var(--text)" : "#fff",
                          textDecoration: "none",
                        }}
                      >
                        <span className="stage-name">{s.stage}</span>
                        <span className="stage-value">{s.count} (${s.value.toLocaleString()})</span>
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!loading && (
            <div className="overview-panels" style={{ marginTop: 20 }}>
              {/* Rep performance */}
              <div className="overview-panel" style={{ minWidth: 280 }}>
                <select
                  value={effectiveRep}
                  onChange={(e) => setSelectedRep(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)", marginBottom: 20 }}
                >
                  {owners.length === 0 && <option value="">No team members yet</option>}
                  {owners.map((o) => <option key={o} value={o}>{ownerLabel(o)}</option>)}
                </select>

                <div style={{ display: "flex", gap: 0 }}>
                  <div style={{ flex: 1, textAlign: "center", padding: "0 10px" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>Avg Response Time</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: avgResponseMs === null ? "var(--text-muted)" : "var(--text)" }}>
                      {avgResponseMs === null ? "Not calculated yet" : formatDuration(avgResponseMs)}
                    </div>
                  </div>
                  <div style={{ width: 1, background: "var(--border)" }} />
                  <div style={{ flex: 1, textAlign: "center", padding: "0 10px" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>Lead Persistence</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: avgPersistence === null ? "var(--text-muted)" : "var(--text)" }}>
                      {avgPersistence === null ? "Not calculated yet" : `${avgPersistence.toFixed(1)} attempts`}
                    </div>
                  </div>
                </div>
              </div>

              {/* Follow-up summary — uses the same team/date filters set above */}
              <div className="overview-panel">
                <h3 style={{ marginTop: 0, fontSize: 15 }}>Follow-up Summary</h3>
                {filteredTasks.length === 0 ? (
                  <div className="overview-empty">There is no data for Follow-ups!</div>
                ) : (
                  <div className="overview-stats">
                    <div className="overview-stat">
                      <div className="label">Total</div>
                      <div className="num">{filteredTasks.length}</div>
                    </div>
                    <div className="overview-stat">
                      <div className="label">Completed</div>
                      <div className="num" style={{ color: "var(--primary)" }}>{completedFollowUps}</div>
                    </div>
                    <div className="overview-stat">
                      <div className="label">Pending</div>
                      <div className="num">{pendingFollowUps}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Activities summary — uses the same team/date filters set above */}
              <div className="overview-panel">
                <h3 style={{ marginTop: 0, fontSize: 15 }}>Activities Summary</h3>
                {activityCounts.every((a) => a.count === 0) ? (
                  <div className="overview-empty">There is no activity in this range.</div>
                ) : (
                  activityCounts.map((a) => (
                    <div className="viz-bar-row" key={a.label}>
                      <div className="viz-bar-label">{a.label}</div>
                      <div className="viz-bar-track">
                        <div className="viz-bar-fill" style={{ width: `${(a.count / maxActivityCount) * 100}%` }}>
                          <span className="viz-bar-value">{a.count}</span>
                        </div>
                      </div>
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
