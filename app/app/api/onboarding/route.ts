// Finish sign-up: 18+ check, house rules acceptance, nickname + avatar.
// Runs on the server so the age rule can't be skipped. The date of birth is
// used for this one check and is never stored. Under-18 sign-ups are refused
// and their just-created login is deleted, so no account remains.

import { admin, json, serverConfigured, userFrom } from "@/lib/backend/server"; // server helpers
import { ageOn, MIN_AGE, TERMS_VERSION } from "@/lib/legal"; // age + terms version
import { AVATARS, LAMP_COLORS_SIGNUP } from "@/lib/signupOptions"; // allowed choices

// Today's date in India (the launch audience), so the birthday edge is the user's own day.
function todayIndia(): Date {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); // "YYYY-MM-DD"
  const [y, m, d] = p.split("-").map(Number); // parts
  return new Date(y, m - 1, d); // local Date with that calendar day
}

export async function POST(req: Request) {
  if (!serverConfigured) return json({ ok: false, reason: "server_not_configured" }, 503); // env vars missing
  const who = await userFrom(req); // verified caller
  if (!who) return json({ ok: false, reason: "not_signed_in" }, 401); // must sign in first
  const body = (await req.json().catch(() => ({}))) as { birthDate?: string; nickname?: string; avatar?: string; color?: string; acceptTerms?: boolean }; // form
  const db = admin(); // service client
  const { data: existing } = await db.from("profiles").select("id").eq("id", who.user.id).maybeSingle(); // already onboarded?
  if (existing) return json({ ok: true }); // nothing to do
  const age = ageOn(body.birthDate ?? "", todayIndia()); // whole years
  if (age === null) return json({ ok: false, reason: "bad_date" }, 400); // not a real date
  if (age < MIN_AGE) { await db.auth.admin.deleteUser(who.user.id); return json({ ok: false, reason: "under18" }, 403); } // refuse and remove the login
  if (body.acceptTerms !== true) return json({ ok: false, reason: "terms" }, 400); // must tick the box themselves
  const nickname = (body.nickname ?? "").trim().replace(/\s+/g, " ").slice(0, 24); // tidy nickname
  if (!nickname) return json({ ok: false, reason: "nickname" }, 400); // required
  const { data: okText } = await db.rpc("text_ok", { t: nickname }); // moderator word list
  if (okText === false) return json({ ok: false, reason: "nickname_not_allowed" }, 400); // blocked word
  const avatar = AVATARS.includes(body.avatar ?? "") ? body.avatar! : AVATARS[0]; // only offered avatars
  const color = LAMP_COLORS_SIGNUP.includes(body.color ?? "") ? body.color! : LAMP_COLORS_SIGNUP[0]; // only offered colours
  const now = new Date().toISOString(); // timestamps
  const { error } = await db.from("profiles").insert({ id: who.user.id, nickname, avatar, color, adult_confirmed_at: now, terms_version: TERMS_VERSION, terms_accepted_at: now }); // no date of birth stored
  if (error) return json({ ok: false, reason: "error" }, 500); // unexpected
  return json({ ok: true }); // welcome in
}
