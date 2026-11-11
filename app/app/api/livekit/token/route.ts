// Voice token for a study room. Only people currently in the room (not
// removed, not suspended, not banned) get one, and only for that room.

import { admin, json, serverConfigured, userFrom } from "@/lib/backend/server"; // server helpers
import { livekitConfigured, livekitUrl, voiceToken } from "@/lib/backend/livekit"; // LiveKit

export async function POST(req: Request) {
  if (!serverConfigured) return json({ ok: false, reason: "server_not_configured" }, 503); // Supabase env missing
  if (!livekitConfigured) return json({ ok: false, reason: "voice_not_configured" }, 503); // LiveKit env missing: rooms work without voice
  const who = await userFrom(req); // verified caller
  if (!who) return json({ ok: false, reason: "not_signed_in" }, 401); // must be signed in
  const { roomId } = (await req.json().catch(() => ({}))) as { roomId?: string }; // which room
  if (!roomId) return json({ ok: false, reason: "room" }, 400); // required
  const db = admin(); // service client
  const [{ data: member }, { data: room }, { data: me }] = await Promise.all([
    db.from("room_members").select("user_id").eq("room_id", roomId).eq("user_id", who.user.id).is("left_at", null).eq("removed", false).maybeSingle(), // in the room now
    db.from("rooms").select("id").eq("id", roomId).is("closed_at", null).maybeSingle(), // room still open
    db.from("profiles").select("nickname,banned,rooms_suspended").eq("id", who.user.id).maybeSingle(), // account holds
  ]); // in parallel
  const p = me as { nickname: string; banned: boolean; rooms_suspended: boolean } | null; // typed
  if (!member || !room || !p || p.banned || p.rooms_suspended) return json({ ok: false, reason: "not_allowed" }, 403); // not for this person
  return json({ ok: true, url: livekitUrl, token: await voiceToken(roomId, who.user.id, p.nickname) }); // join details
}
