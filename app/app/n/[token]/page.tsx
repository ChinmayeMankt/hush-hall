// Public, read-only view of one shared desk note. Looked up by token only
// (get_shared_note). Nothing else about the owner is shown. Text is rendered
// as text (no HTML). Links must be http(s) and open in a new tab.

import type { Metadata } from "next"; // tab title
import { createClient } from "@supabase/supabase-js"; // anon client, no session
import { validNoteUrl, NOTE_SOURCES } from "@/lib/notes"; // http(s) only + source labels

const TOKEN_OK = /^[A-Za-z0-9_-]{20,64}$/; // same shape the database checks
type Shared = { title: string; source: string | null; url: string | null; note: string; updated_at: string }; // RPC row

// Load one note by token, or null if it isn't shared / doesn't exist.
async function loadShared(token: string): Promise<Shared | null> {
  if (!TOKEN_OK.test(token)) return null; // reject odd tokens without a lookup
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""; // project URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""; // public key (RLS stays closed; the RPC is security definer)
  if (!url || !anon) return null; // demo / unconfigured: no public notes
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }); // stateless
  const { data, error } = await sb.rpc("get_shared_note", { p_token: token }); // only that note
  if (error || !data) return null; // missing, or 0005 not applied
  const row = (Array.isArray(data) ? data[0] : data) as Shared | undefined; // table-returning RPC
  return row ?? null; // none
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params; // Next.js 16 params
  const note = await loadShared(token); // may be missing
  return { title: note?.title?.trim() ? `${note.title} · Hush Hall` : "Shared note · Hush Hall", robots: { index: false, follow: false } }; // don't index share links
}

export default async function SharedNotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; // route token
  const note = await loadShared(token); // one note, or none
  const source = NOTE_SOURCES.find((s) => s.id === note?.source)?.label; // known sources only
  const link = note?.url && validNoteUrl(note.url) ? note.url : null; // http(s) only
  return (
    <article className="card prose narrow">
      {note ? (
        <>
          <h1>{note.title.trim() || "A desk note"}</h1>
          <p className="small muted">A shared note from a Hush Hall desk.{source ? ` · ${source}` : ""}</p>
          {note.note ? <div className="shared-note" style={{ whiteSpace: "pre-wrap" }}>{note.note}</div> : <p className="muted">This note has no text.</p>}
          {link && <p><a href={link} target="_blank" rel="noopener noreferrer">Open link</a></p>}
        </>
      ) : (
        <>
          <h1>This note isn’t available</h1>
          <p className="muted">The link may have been stopped, or it isn’t a Hush Hall share link.</p>
        </>
      )}
      <p className="small muted" style={{ marginTop: 24 }}><a href="/">Hush Hall</a></p>
    </article>
  );
}
