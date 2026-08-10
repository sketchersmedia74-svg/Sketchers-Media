"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { stageColor } from "@/lib/stageColor";
import Sidebar from "../../components/Sidebar";

type Stage = {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
};

type Pipeline = {
  id: string;
  name: string;
  created_at: string;
};

export default function PipelinesSettingsPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stagesByPipeline, setStagesByPipeline] = useState<Record<string, Stage[]>>({});
  const [dealCounts, setDealCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [newStageName, setNewStageName] = useState<Record<string, string>>({});
  const [renamingPipeline, setRenamingPipeline] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      await loadAll();
    })();
  }, []);

  async function loadAll() {
    setLoading(true);
    const { data: pipelineData } = await supabaseBrowser
      .from("pipelines")
      .select("*")
      .order("created_at", { ascending: true });
    setPipelines(pipelineData || []);

    const { data: stageData } = await supabaseBrowser
      .from("pipeline_stages")
      .select("*")
      .order("position", { ascending: true });
    const grouped: Record<string, Stage[]> = {};
    (stageData || []).forEach((s: Stage) => {
      grouped[s.pipeline_id] = grouped[s.pipeline_id] || [];
      grouped[s.pipeline_id].push(s);
    });
    setStagesByPipeline(grouped);

    const { data: deals } = await supabaseBrowser.from("deals").select("pipeline_id");
    const counts: Record<string, number> = {};
    (deals || []).forEach((d: any) => {
      if (d.pipeline_id) counts[d.pipeline_id] = (counts[d.pipeline_id] || 0) + 1;
    });
    setDealCounts(counts);

    setLoading(false);
  }

  async function createPipeline(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!newPipelineName.trim()) {
      setFormError("Pipeline name is required.");
      return;
    }
    setSaving(true);
    const { data: pipeline, error } = await supabaseBrowser
      .from("pipelines")
      .insert({ name: newPipelineName.trim() })
      .select()
      .single();
    if (error) {
      setSaving(false);
      setFormError(error.message);
      return;
    }
    // Seed a starter stage so a brand-new pipeline isn't immediately empty.
    await supabaseBrowser.from("pipeline_stages").insert({ pipeline_id: pipeline.id, name: "New", position: 0 });
    setSaving(false);
    setNewPipelineName("");
    setShowForm(false);
    loadAll();
  }

  async function deletePipeline(id: string, name: string) {
    const dealCount = dealCounts[id] || 0;
    const confirmed = window.confirm(
      dealCount > 0
        ? `Delete "${name}"? ${dealCount} deal(s) currently on this pipeline will keep their stage text but no longer be linked to a pipeline. This cannot be undone.`
        : `Delete "${name}"? This cannot be undone.`
    );
    if (!confirmed) return;
    await supabaseBrowser.from("pipelines").delete().eq("id", id);
    loadAll();
  }

  async function startRename(pipeline: Pipeline) {
    setRenamingPipeline(pipeline.id);
    setRenameValue(pipeline.name);
  }

  async function saveRename() {
    if (!renamingPipeline || !renameValue.trim()) {
      setRenamingPipeline(null);
      return;
    }
    await supabaseBrowser.from("pipelines").update({ name: renameValue.trim() }).eq("id", renamingPipeline);
    setRenamingPipeline(null);
    loadAll();
  }

  async function addStage(pipelineId: string) {
    const name = (newStageName[pipelineId] || "").trim();
    if (!name) return;
    const currentStages = stagesByPipeline[pipelineId] || [];
    const nextPosition = currentStages.length ? Math.max(...currentStages.map((s) => s.position)) + 1 : 0;
    await supabaseBrowser.from("pipeline_stages").insert({ pipeline_id: pipelineId, name, position: nextPosition });
    setNewStageName({ ...newStageName, [pipelineId]: "" });
    loadAll();
  }

  async function renameStage(stageId: string, name: string) {
    if (!name.trim()) return;
    await supabaseBrowser.from("pipeline_stages").update({ name: name.trim() }).eq("id", stageId);
    loadAll();
  }

  async function deleteStage(stageId: string, pipelineId: string) {
    const stages = stagesByPipeline[pipelineId] || [];
    if (stages.length <= 1) {
      alert("A pipeline needs at least one stage.");
      return;
    }
    if (!window.confirm("Delete this stage? Deals currently on it will keep the stage name as plain text.")) return;
    await supabaseBrowser.from("pipeline_stages").delete().eq("id", stageId);
    loadAll();
  }

  async function moveStage(pipelineId: string, stageId: string, direction: -1 | 1) {
    const stages = [...(stagesByPipeline[pipelineId] || [])].sort((a, b) => a.position - b.position);
    const index = stages.findIndex((s) => s.id === stageId);
    const swapIndex = index + direction;
    if (index === -1 || swapIndex < 0 || swapIndex >= stages.length) return;
    const a = stages[index];
    const b = stages[swapIndex];
    await Promise.all([
      supabaseBrowser.from("pipeline_stages").update({ position: b.position }).eq("id", a.id),
      supabaseBrowser.from("pipeline_stages").update({ position: a.position }).eq("id", b.id),
    ]);
    loadAll();
  }

  async function toggleFlag(stage: Stage, flag: "is_won" | "is_lost") {
    await supabaseBrowser.from("pipeline_stages").update({ [flag]: !stage[flag] }).eq("id", stage.id);
    loadAll();
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <div className="container">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2>Pipelines</h2>
            <button className="btn" onClick={() => setShowForm(true)}>New Pipeline</button>
          </div>
          <p style={{ color: "var(--text-muted)", marginTop: -8, marginBottom: 20 }}>
            Create separate pipelines for different processes (e.g. "Sales", "Onboarding"), each with its own
            custom stages — pick a pipeline on the main Pipeline page to work it.
          </p>

          {showForm && (
            <div className="modal-overlay" onClick={() => setShowForm(false)}>
              <form className="login-card" onClick={(e) => e.stopPropagation()} onSubmit={createPipeline}>
                <h3 style={{ marginTop: 0 }}>New Pipeline</h3>
                <label>Name</label>
                <input
                  value={newPipelineName}
                  onChange={(e) => setNewPipelineName(e.target.value)}
                  placeholder="e.g. Onboarding"
                  required
                />
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button className="btn" type="submit" disabled={saving} style={{ flex: 1 }}>
                    {saving ? "Saving…" : "Create"}
                  </button>
                  <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setShowForm(false)}>
                    Cancel
                  </button>
                </div>
                {formError && <p className="error">{formError}</p>}
              </form>
            </div>
          )}

          {loading ? (
            <p>Loading…</p>
          ) : pipelines.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No pipelines yet.</p>
          ) : (
            pipelines.map((pipeline) => {
              const stages = (stagesByPipeline[pipeline.id] || []).sort((a, b) => a.position - b.position);
              return (
                <div className="card" key={pipeline.id} style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    {renamingPipeline === pipeline.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={saveRename}
                        onKeyDown={(e) => e.key === "Enter" && saveRename()}
                        style={{ fontSize: 16, fontWeight: 600, padding: "4px 8px" }}
                      />
                    ) : (
                      <h3 style={{ margin: 0, cursor: "pointer" }} onClick={() => startRename(pipeline)} title="Click to rename">
                        {pipeline.name}
                      </h3>
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="meta" style={{ margin: 0 }}>{dealCounts[pipeline.id] || 0} deal(s)</span>
                      <button
                        className="btn secondary"
                        style={{ padding: "4px 10px", fontSize: 12, color: "#d33" }}
                        onClick={() => deletePipeline(pipeline.id, pipeline.name)}
                      >
                        Delete Pipeline
                      </button>
                    </div>
                  </div>

                  <table>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Stage</th>
                        <th>Won?</th>
                        <th>Lost?</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {stages.map((stage, i) => (
                        <tr key={stage.id}>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button
                              className="btn secondary"
                              style={{ padding: "2px 8px", fontSize: 12 }}
                              disabled={i === 0}
                              onClick={() => moveStage(pipeline.id, stage.id, -1)}
                            >
                              ↑
                            </button>{" "}
                            <button
                              className="btn secondary"
                              style={{ padding: "2px 8px", fontSize: 12 }}
                              disabled={i === stages.length - 1}
                              onClick={() => moveStage(pipeline.id, stage.id, 1)}
                            >
                              ↓
                            </button>
                          </td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ width: 10, height: 10, borderRadius: "50%", background: stageColor(stage.name), flexShrink: 0 }} />
                              <input
                                defaultValue={stage.name}
                                onBlur={(e) => e.target.value !== stage.name && renameStage(stage.id, e.target.value)}
                                style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
                              />
                            </div>
                          </td>
                          <td>
                            <input type="checkbox" checked={stage.is_won} onChange={() => toggleFlag(stage, "is_won")} />
                          </td>
                          <td>
                            <input type="checkbox" checked={stage.is_lost} onChange={() => toggleFlag(stage, "is_lost")} />
                          </td>
                          <td>
                            <button
                              className="btn secondary"
                              style={{ padding: "2px 10px", fontSize: 12, color: "#d33" }}
                              onClick={() => deleteStage(stage.id, pipeline.id)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <input
                      placeholder="New stage name…"
                      value={newStageName[pipeline.id] || ""}
                      onChange={(e) => setNewStageName({ ...newStageName, [pipeline.id]: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && addStage(pipeline.id)}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
                    />
                    <button className="btn secondary" onClick={() => addStage(pipeline.id)}>Add Stage</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
