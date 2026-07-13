"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Topbar from "../../components/Topbar";

export default function ContactDetailPage() {
  const [contact, setContact] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [taskForm, setTaskForm] = useState({ description: "", due_date: "" });
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const router = useRouter();
  const params = useParams();
  const contactId = params?.id as string;

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      const { data: contactData } = await supabaseBrowser
        .from("contacts")
        .select("*, companies(name)")
        .eq("id", contactId)
        .single();
      setContact(contactData);
      await loadNotes();
      await loadTasks();
      setLoading(false);
    })();
  }, [contactId]);

  async function deleteContact() {
    const confirmed = window.confirm(
      "Delete this contact? This will also permanently delete their deals and call history. This cannot be undone."
    );
    if (!confirmed) return;
    setDeleteError("");
    setDeleting(true);
    const { error } = await supabaseBrowser.from("contacts").delete().eq("id", contactId);
    setDeleting(false);
    if (error) {
      setDeleteError(error.message);
      return;
    }
    router.push("/contacts");
  }

  async function toggleDoNotCall(value: boolean) {
    await supabaseBrowser.from("contacts").update({ do_not_call: value }).eq("id", contactId);
    setContact((prev: any) => (prev ? { ...prev, do_not_call: value } : prev));
  }

  async function loadNotes() {
    const { data } = await supabaseBrowser
      .from("notes")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false });
    setNotes(data || []);
  }

  async function loadTasks() {
    const { data } = await supabaseBrowser
      .from("tasks")
      .select("*")
      .eq("contact_id", contactId)
      .order("due_date", { ascending: true });
    setTasks(data || []);
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    setTaskError("");
    if (!taskForm.description.trim()) {
      setTaskError("Task description is required.");
      return;
    }
    setTaskSaving(true);
    const { error } = await supabaseBrowser.from("tasks").insert({
      contact_id: contactId,
      description: taskForm.description.trim(),
      due_date: taskForm.due_date || null,
    });
    setTaskSaving(false);
    if (error) {
      setTaskError(error.message);
      return;
    }
    setTaskForm({ description: "", due_date: "" });
    loadTasks();
  }

  async function toggleTaskCompleted(taskId: string, completed: boolean) {
    await supabaseBrowser.from("tasks").update({ completed }).eq("id", taskId);
    loadTasks();
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!noteText.trim()) {
      setError("Note text is required.");
      return;
    }
    setSaving(true);
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    const { error } = await supabaseBrowser.from("notes").insert({
      contact_id: contactId,
      text: noteText.trim(),
      created_by: session?.user?.email || null,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNoteText("");
    loadNotes();
  }

  if (loading) {
    return (
      <div>
        <Topbar />
        <div className="container"><p>Loading…</p></div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div>
        <Topbar />
        <div className="container"><p>Contact not found.</p></div>
      </div>
    );
  }

  return (
    <div>
      <Topbar />
      <div className="container">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="/contacts" style={{ fontSize: 13, color: "var(--text-secondary)" }}>&larr; Back to Contacts</a>
          <button className="btn secondary" onClick={deleteContact} disabled={deleting} style={{ color: "#d33" }}>
            {deleting ? "Deleting…" : "Delete Contact"}
          </button>
        </div>
        {deleteError && <p className="error">{deleteError}</p>}
        <h2 style={{ marginBottom: 4 }}>{contact.first_name} {contact.last_name}</h2>
        <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
          {contact.companies?.name || "No company"} · {contact.phone || "No phone"} · {contact.email || "No email"} · Source: {contact.source || "manual"}
        </div>
        <div style={{ color: "var(--text-muted)", marginBottom: 16 }}>
          Call attempts: {contact.call_attempts || 0}
          {contact.max_attempts_reached && (
            <span style={{ color: "#d33" }}> · Max attempts reached (no answer x3)</span>
          )}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={!!contact.do_not_call}
            onChange={(e) => toggleDoNotCall(e.target.checked)}
          />
          Do not call
        </label>

        <h3>Tasks & Reminders</h3>
        <form onSubmit={addTask} style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <input
            placeholder="Task description…"
            value={taskForm.description}
            onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
            style={{
              flex: 1,
              minWidth: 200,
              padding: 10,
              borderRadius: 6,
              border: "1px solid var(--input-border)",
              background: "var(--input-bg)",
              color: "var(--text)",
            }}
          />
          <input
            type="date"
            value={taskForm.due_date}
            onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
            style={{
              padding: 10,
              borderRadius: 6,
              border: "1px solid var(--input-border)",
              background: "var(--input-bg)",
              color: "var(--text)",
            }}
          />
          <button className="btn" type="submit" disabled={taskSaving}>
            {taskSaving ? "Saving…" : "Add Task"}
          </button>
        </form>
        {taskError && <p className="error">{taskError}</p>}

        {tasks.length === 0 ? (
          <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>No tasks yet.</p>
        ) : (
          <div style={{ marginBottom: 24 }}>
            {tasks.map((t) => {
              const overdue = !t.completed && t.due_date && new Date(t.due_date) < new Date(new Date().toDateString());
              return (
                <div className="card" key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={t.completed}
                    onChange={(e) => toggleTaskCompleted(t.id, e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <div style={{ textDecoration: t.completed ? "line-through" : "none", color: t.completed ? "var(--text-muted)" : "var(--text)" }}>
                      {t.description}
                    </div>
                    <div className="meta" style={{ marginTop: 4, marginBottom: 0, color: overdue ? "#d33" : undefined }}>
                      {t.due_date ? `Due ${new Date(t.due_date).toLocaleDateString()}` : "No due date"}
                      {overdue && " · Overdue"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <h3>Activity Timeline</h3>
        <form onSubmit={addNote} style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "flex-start" }}>
          <textarea
            placeholder="Add a note…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 6,
              border: "1px solid var(--input-border)",
              background: "var(--input-bg)",
              color: "var(--text)",
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Add Note"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}

        {notes.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No notes yet.</p>
        ) : (
          <div>
            {notes.map((n) => (
              <div className="card" key={n.id}>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
                <div className="meta" style={{ marginTop: 6, marginBottom: 0 }}>
                  {n.created_by || "Unknown"} · {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
