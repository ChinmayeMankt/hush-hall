// "Delete account": removes the login and, through ON DELETE CASCADE, the
// profile, sittings and history, usual desks, walking position, blocks,
// requests, room memberships, notices and reports this person filed (or that
// were filed about them). Nothing is kept or frozen: the rows are gone.
// Checked by supabase/tests/account_delete_test.sql.

import { admin, json, serverConfigured, userFrom } from "@/lib/backend/server"; // server helpers
import { kickFromVoice, livekitConfigured } from "@/lib/backend/livekit"; // drop a live voice call

export async function POST(req: Request) {
  if (!serverConfigured) return json({ ok: false, reason: "server_not_configured" }, 503); // env vars missing
  const who = await userFrom(req); // verified caller
  if (!who) return json({ ok: false, reason: "not_signed_in" }, 401); // must be signed in
  const body = (await req.json().catch(() => ({}))) as { confirm?: string }; // typed confirmation
  if (body.confirm !== "DELETE") return json({ ok: false, reason: "confirm" }, 400); // guard against accidents
  const db = admin(); // service client (server only)
  // Leave any live voice call first, so a deleted account isn't still heard.
  if (livekitConfigured) {
    const { data: rooms } = await db.from("room_members").select("room_id").eq("user_id", who.user.id).is("left_at", null); // rooms I'm in now
    await Promise.all(((rooms ?? []) as { room_id: string }[]).map((r) => kickFromVoice(r.room_id, who.user.id).catch(() => {}))); // best effort: deletion goes ahead regardless
  }
  const { error } = await db.auth.admin.deleteUser(who.user.id, false); // hard delete (not soft): cascades through every table
  if (error) return json({ ok: false, reason: "error" }, 500); // unexpected
  return json({ ok: true }); // gone
}
