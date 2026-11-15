"use client"; // the writing area holds local state and autosaves

// Desk notes: one tap opens a blank page and the cursor is ready. Notes
// autosave as you type. Title, source and link sit behind a Details toggle.
// Tapping an existing note opens it in the same writing area.

import { useEffect, useRef, useState } from "react"; // local state
import { hasSupabase } from "@/lib/backend/client"; // share needs the live app
import {
  deleteNote, displayTitle, listNotes, noteHasContent, saveNote, shareNote, shareUrl, unshareNote,
  NOTE_MAX, NOTE_SOURCES, TITLE_MAX, type DeskNote, type NoteDraft,
} from "@/lib/notes"; // private desk notes

const blank = (): NoteDraft => ({ title: "", source: "", url: "", note: "" }); // empty writing area
const SAVE_WAIT = 700; // ms to wait after typing before saving

export function NotesDialog(props: { onClose: () => void }) {
  const [notes, setNotes] = useState<DeskNote[]>([]); // my notes, newest first
  const [view, setView] = useState<"write" | "list">("write"); // open straight on a blank page
  const [form, setForm] = useState<NoteDraft>(blank); // current writing
  const [noteId, setNoteId] = useState<string | null>(null); // saved id, or null while new
  const [shareToken, setShareToken] = useState<string | null>(null); // current share link, if any
  const [details, setDetails] = useState(false); // title / source / link, hidden by default
  const [filter, setFilter] = useState(""); // list source filter ("" = all)
  const [status, setStatus] = useState(""); // "Saving…", "Saved", or a calm error
  const [pending, setPending] = useState(false); // one delete/share at a time
  const [confirmDel, setConfirmDel] = useState(false); // confirm remove on this note

  const formRef = useRef(form); // latest draft for the debounced save
  const idRef = useRef(noteId); // latest id (so the first save can be followed by updates)
  const bodyRef = useRef<HTMLTextAreaElement>(null); // the writing area (for focus)
  const saving = useRef(Promise.resolve()); // one save at a time, in order
  formRef.current = form; // keep current
  idRef.current = noteId; // keep current

  const refresh = async () => { // reload the list
    const rows = await listNotes(); // own notes only
    setNotes(rows); // newest first
  };
  useEffect(() => { void refresh(); }, []); // load once when opened
  useEffect(() => { bodyRef.current?.focus(); }, [view, noteId]); // cursor ready on a new or opened note

  // Flush the current draft to the database (or this browser, in demo).
  const persist = () => {
    saving.current = saving.current.then(async () => { // queue behind any in-flight save
      const draft = formRef.current; // latest fields
      const id = idRef.current; // may already be saved
      if (!noteHasContent(draft) && !id) return; // don't create a blank row
      setStatus("Saving…"); // quiet status
      const res = await saveNote(draft, id ?? undefined); // insert or update
      if (res.ok) {
        idRef.current = res.id; // so the next keystroke updates this row
        setNoteId(res.id); // show share/remove
        setStatus("Saved"); // quiet status
        await refresh(); // list stays in step
      } else {
        setStatus(res.reason); // calm reason
      }
    });
    return saving.current; // so close/back can wait
  };

  // Autosave while typing in the writing area (no Save button).
  useEffect(() => {
    if (view !== "write") return; // list view doesn't save
    const t = window.setTimeout(() => { void persist(); }, SAVE_WAIT); // wait for a pause
    return () => window.clearTimeout(t); // restart when they type again
  }, [form, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { // blank page
    void persist(); // keep the previous note if they were mid-edit
    setNoteId(null); idRef.current = null; // new row on first save
    setForm(blank()); setShareToken(null); setDetails(false); setStatus(""); setConfirmDel(false); // reset
    setView("write"); // writing area
  };
  const openExisting = (n: DeskNote) => { // tap a note to edit it
    void persist(); // flush the one they were writing
    setNoteId(n.id); idRef.current = n.id; // this row
    setForm({ title: n.title, source: n.source ?? "", url: n.url ?? "", note: n.note }); // as stored
    setShareToken(n.shareToken); setDetails(false); setStatus(""); setConfirmDel(false); // closed details
    setView("write"); // straight into the writing area
  };
  const goList = async () => { // back to all notes
    await persist(); // don't lose the last keystrokes
    setView("list"); setConfirmDel(false); // list
    await refresh();
  };
  const close = async () => { // leave the dialog
    await persist(); // autosave on close
    props.onClose(); // dismiss
  };

  const share = async () => { // create or copy a public link
    await persist(); // need a saved row
    const id = idRef.current; // after save
    if (!id) { setStatus("Write a little first, then you can share."); return; } // nothing to share
    setPending(true);
    if (!shareToken) {
      const res = await shareNote(id); // new token
      if (!res.ok) { setPending(false); setStatus(res.reason); return; } // calm reason
      setShareToken(res.token); // remember
      await handLink(shareUrl(res.token)); // share or copy
    } else {
      await handLink(shareUrl(shareToken)); // already shared
    }
    setPending(false);
    await refresh();
  };
  const handLink = async (url: string) => { // Web Share, or copy
    try {
      if (typeof navigator.share === "function") { await navigator.share({ title: "Desk note", url }); setStatus("Link ready to share."); return; } // native sheet
    } catch { /* they cancelled, or share failed; fall through to copy */ }
    try {
      await navigator.clipboard.writeText(url); // copy
      setStatus("Link copied."); // confirm
    } catch {
      setStatus(url); // show the URL so they can copy it by hand
    }
  };
  const stopShare = async () => { // drop the public link
    const id = idRef.current; if (!id) return; // nothing to clear
    setPending(true);
    const ok = await unshareNote(id); // token -> null
    setPending(false);
    if (!ok) { setStatus("Couldn’t stop sharing. Try again?"); return; }
    setShareToken(null); setStatus("That link no longer works."); // confirm
    await refresh();
  };
  const remove = async () => { // delete after confirm
    const id = idRef.current; if (!id) { openNew(); return; } // unsaved: just reset
    setPending(true);
    const ok = await deleteNote(id); // own row only
    setPending(false);
    if (!ok) { setStatus("Couldn’t remove that note. Try again?"); return; }
    setConfirmDel(false); openNew(); await refresh(); setView("list"); // back to the list
  };

  const shown = filter ? notes.filter((n) => n.source === filter) : notes; // optional source filter
  const labelFor = (s: DeskNote["source"]) => NOTE_SOURCES.find((x) => x.id === s)?.label ?? ""; // display name

  return (
    <div className="veil" role="dialog" aria-modal="true" onClick={() => { void close(); }}>
      <div className="dialog notes" onClick={(e) => e.stopPropagation()}>
        {view === "write" ? (
          <>
            <h2>{noteId ? "Note" : "New note"}</h2>
            <p className="muted small">Private to you, unless you share a link. It saves as you write.</p>
            <textarea
              ref={bodyRef}
              id="note-body"
              className="note-write"
              maxLength={NOTE_MAX}
              rows={10}
              placeholder="Start writing…"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
            <button type="button" className="ghost small" onClick={() => setDetails((v) => !v)} style={{ marginTop: 8 }}>
              {details ? "Hide details" : "Details (title, source, link)"}
            </button>
            {details && (
              <div style={{ marginTop: 8 }}>
                <label htmlFor="note-title">Title (optional — otherwise the first line is used)</label>
                <input id="note-title" type="text" maxLength={TITLE_MAX} placeholder="Leave blank to use the first line" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <label htmlFor="note-source">Source (optional)</label>
                <select id="note-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  <option value="">No source</option>
                  {NOTE_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <label htmlFor="note-url">Link (optional)</label>
                <input id="note-url" type="text" maxLength={500} placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              </div>
            )}
            {status && <p className="small muted" role="status">{status}</p>}
            <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {hasSupabase && (shareToken ? (
                <>
                  <button type="button" className="ghost small" onClick={() => { void share(); }} disabled={pending}>Copy link</button>
                  <button type="button" className="ghost small" onClick={() => { void stopShare(); }} disabled={pending}>Stop sharing</button>
                </>
              ) : (
                <button type="button" className="ghost small" onClick={() => { void share(); }} disabled={pending}>Share</button>
              ))}
              {noteId && (confirmDel ? (
                <>
                  <button type="button" className="ghost small" onClick={() => { void remove(); }} disabled={pending}>Remove for good</button>
                  <button type="button" className="ghost small" onClick={() => setConfirmDel(false)}>Keep</button>
                </>
              ) : (
                <button type="button" className="ghost small" onClick={() => setConfirmDel(true)}>Remove</button>
              ))}
            </div>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => { void goList(); }}>Your notes{notes.length ? ` (${notes.length})` : ""}</button>
              <button type="button" className="sage" onClick={() => { void close(); }}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h2>Desk notes</h2>
            <p className="muted small">Private to you. Other people at the desk still only see your nickname, avatar and topic.</p>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <label htmlFor="note-filter" className="small muted" style={{ margin: 0 }}>Show</label>
              <select id="note-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">All sources</option>
                {NOTE_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <button type="button" className="sage small" onClick={openNew} style={{ marginLeft: "auto" }}>New note</button>
            </div>
            {shown.length === 0 ? (
              <p className="muted small" style={{ marginTop: 12 }}>{notes.length === 0 ? "No notes yet. Open a new note and just start writing." : "No notes from that source."}</p>
            ) : (
              <ul className="note-list">
                {shown.map((n) => (
                  <li className="note-item" key={n.id}>
                    <button type="button" className="note-open" onClick={() => openExisting(n)}>
                      <div className="note-item-title">{displayTitle(n)}</div>
                      <div className="small muted">{n.source ? labelFor(n.source) : "No source"}{n.shareToken ? " · Shared" : ""}{n.url ? " · has a link" : ""}</div>
                      {n.note && <div className="small" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{n.note.length > 160 ? `${n.note.slice(0, 160)}…` : n.note}</div>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="actions">
              <button type="button" className="ghost" onClick={() => { void close(); }}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
