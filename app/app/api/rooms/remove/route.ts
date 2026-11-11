// Room owner removes someone: the database rule runs as the owner (so only
// the owner can do it), then the person is dropped from the voice call.

import { asUser, json, serverConfigured, userFrom } from "@/lib/backend/server"; // server helpers
import { kickFromVoice } from "@/lib/backend/livekit"; // LiveKit removal

export async function POST(req: Request) {
  if (!serverConfigured) return json({ ok: false, reason: "server_not_configured" }, 503); // env missing
  const who = await userFrom(req); // verified caller
  if (!who) return json({ ok: false, reason: "not_signed_in" }, 401); // must be signed in
  const { roomId, userId } = (await req.json().catch(() => ({}))) as { roomId?: string; userId?: string }; // target
  if (!roomId || !userId) return json({ ok: false, reason: "bad_request" }, 400); // both required
  const { error } = await asUser(who.token).rpc("remove_from_room", { p_room: roomId, p_user: userId }); // owner-only rule in SQL
  if (error) return json({ ok: false, reason: "not_allowed" }, 403); // not the owner, or room closed
  await kickFromVoice(roomId, userId); // out of the call too
  return json({ ok: true }); // done
}
