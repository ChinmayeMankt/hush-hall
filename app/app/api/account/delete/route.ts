// "Delete my data": removes the login and, through ON DELETE CASCADE, the
// profile, sittings and history, usual desks, blocks, requests, room
// memberships and reports this person filed (or that were filed about them).

import { admin, json, serverConfigured, userFrom } from "@/lib/backend/server"; // server helpers

export async function POST(req: Request) {
  if (!serverConfigured) return json({ ok: false, reason: "server_not_configured" }, 503); // env vars missing
  const who = await userFrom(req); // verified caller
  if (!who) return json({ ok: false, reason: "not_signed_in" }, 401); // must be signed in
  const body = (await req.json().catch(() => ({}))) as { confirm?: string }; // typed confirmation
  if (body.confirm !== "DELETE") return json({ ok: false, reason: "confirm" }, 400); // guard against accidents
  const { error } = await admin().auth.admin.deleteUser(who.user.id); // cascades through every table
  if (error) return json({ ok: false, reason: "error" }, 500); // unexpected
  return json({ ok: true }); // gone
}
