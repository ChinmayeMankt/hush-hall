"use client"; // moderator tools run as the signed-in moderator

// Report queue for the moderators (Chinmaye and Priya). Urgent reasons
// (harassment, sexual content, hate, seems under 18) sort first with a
// 24-hour "act by" time. Nothing here is public, and the reported person
// never sees who reported them.

import { useCallback, useEffect, useState } from "react"; // React hooks
import { supabase, callApi, hasSupabase } from "@/lib/backend/client"; // backend
import { REPORT_REASONS } from "@/lib/account"; // labels

// One queue row from mod_queue().
type Row = { id: string; created_at: string; urgent: boolean; due_at: string | null; reason: string; note: string; status: string; action: string | null; mod_note: string | null; hall_id: string | null; room_id: string | null; reported_id: string; reported_nickname: string; reported_topic: string | null; reporter_nickname: string | null; reports_on_account: number; account_flags: string }; // columns

const ACTIONS = [
  { id: "none", label: "No action" }, // dismiss / nothing needed
  { id: "warn", label: "Warn (private notice)" }, // calm notice on their next visit
  { id: "remove_topic", label: "Remove topic" }, // topic hidden from others
  { id: "suspend_rooms", label: "Suspend rooms + requests" }, // no rooms or voice
  { id: "ban", label: "Close account (ban)" }, // can't use the app
  { id: "restore", label: "Lift all holds" }, // undo automatic or earlier holds
]; // moderator choices

export default function ModQueue() {
  const [rows, setRows] = useState<Row[] | null>(null); // queue
  const [filter, setFilter] = useState("open"); // open (incl. reviewing) / all
  const [denied, setDenied] = useState(false); // not a moderator
  const [msg, setMsg] = useState(""); // status

  // Load the queue (the SQL function refuses non-moderators).
  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc("mod_queue", { p_status: filter }); // moderators only
    if (error) { setDenied(true); return; } // not allowed
    setRows(data as Row[]); // show
  }, [filter]);
  useEffect(() => { if (hasSupabase) load(); }, [load]);

  // Save a decision.
  const decide = async (r: Row, status: string, action: string, note: string) => {
    const res = await callApi<{ ok?: boolean }>("/api/mod/act", { id: r.id, status, action, note }); // SQL applies it; voice kicked if needed
    setMsg(res.ok ? "Saved." : "Couldn’t save that decision."); // result
    load(); // refresh
  };

  if (!hasSupabase) return <p className="muted">The report queue needs the real backend (demo mode has no server).</p>; // demo
  if (denied) return <p className="muted">This page is only for Hush Hall moderators.</p>; // not a moderator
  if (!rows) return <p className="muted">Loading the queue…</p>; // loading
  const label = (id: string) => REPORT_REASONS.find((x) => x.id === id)?.label ?? id; // reason label
  return (
    <div>
      <div className="hall-head">
        <h1>Report queue</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "auto" }}>
          <option value="open">Open and in review</option>
          <option value="actioned">Actioned</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </select>
      </div>
      <p className="small muted">Check once a day. Urgent reports (harassment and safety) show an “act by” time 24 hours after they were filed.</p>
      {msg && <p className="small muted">{msg}</p>}
      {rows.length === 0 && <p className="muted">Nothing here. Quiet day.</p>}
      {rows.map((r) => <ReportCard key={r.id} r={r} label={label(r.reason)} onDecide={decide} />)}
    </div>
  );
}

// One report with its decision form.
function ReportCard({ r, label, onDecide }: { r: Row; label: string; onDecide: (r: Row, status: string, action: string, note: string) => void }) {
  const [action, setAction] = useState(r.action ?? "none"); // chosen action
  const [note, setNote] = useState(r.mod_note ?? ""); // private note
  const overdue = r.due_at && Date.parse(r.due_at) < Date.now() && (r.status === "open" || r.status === "reviewing"); // past 24 h
  return (
    <section className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{label}{r.urgent ? " · urgent" : ""}</b>
        <span className="small muted">{new Date(r.created_at).toLocaleString()} · {r.status}{r.due_at ? ` · act by ${new Date(r.due_at).toLocaleString()}${overdue ? " (past due)" : ""}` : ""}</span>
      </div>
      <p className="small">Reported: <b>{r.reported_nickname}</b>{r.reported_topic ? ` · topic “${r.reported_topic}”` : ""} · {r.reports_on_account} report{r.reports_on_account === 1 ? "" : "s"} on this account{r.account_flags ? ` · now: ${r.account_flags}` : ""}</p>
      <p className="small muted">From: {r.reporter_nickname ?? "(deleted account)"} · {r.hall_id ? `hall ${r.hall_id}` : r.room_id ? "study room" : "—"}</p>
      {r.note && <p className="small">“{r.note}”</p>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: "auto" }}>{ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
        <input type="text" maxLength={500} placeholder="Private note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <button className="ghost small" onClick={() => onDecide(r, "reviewing", r.action ?? "none", note)}>Mark in review</button>
        <button className="ghost small" onClick={() => onDecide(r, "dismissed", "none", note)}>Dismiss</button>
        <button className="sage small" onClick={() => onDecide(r, "actioned", action, note)}>Save action</button>
      </div>
    </section>
  );
}
