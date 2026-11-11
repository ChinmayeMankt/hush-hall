// Moderator decision on a report. The SQL function checks the caller is a
// moderator and applies the account change; for room suspensions and bans we
// also drop the person from any live voice call straight away.

import { admin, asUser, json, serverConfigured, userFrom } from "@/lib/backend/server"; // server helpers
import { kickFromVoice } from "@/lib/backend/livekit"; // LiveKit removal

export async function POST(req: Request) {
  if (!serverConfigured) return json({ ok: false, reason: "server_not_configured" }, 503); // env missing
  const who = await userFrom(req); // verified caller
  if (!who) return json({ ok: false, reason: "not_signed_in" }, 401); // must be signed in
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: string; action?: string; note?: string }; // decision
  const { error } = await asUser(who.token).rpc("moderate_report", { p_id: b.id, p_status: b.status, p_action: b.action, p_note: b.note ?? "" }); // moderator-only rule in SQL
  if (error) return json({ ok: false, reason: "not_allowed" }, 403); // not a moderator, or bad values
  if (b.action === "suspend_rooms" || b.action === "ban") { // must leave voice now
    const db = admin(); // service client
    const { data: rep } = await db.from("reports").select("reported_id").eq("id", b.id!).maybeSingle(); // who
    const uid = (rep as { reported_id: string } | null)?.reported_id; // reported account
    if (uid) {
      const since = new Date(Date.now() - 6 * 3600000).toISOString(); // rooms they were in during the last 6 hours
      const { data: rooms } = await db.from("room_members").select("room_id").eq("user_id", uid).gte("joined_at", since); // recent rooms
      await Promise.all(((rooms ?? []) as { room_id: string }[]).map((r) => kickFromVoice(r.room_id, uid))); // drop from each call
    }
  }
  return json({ ok: true }); // saved
}
