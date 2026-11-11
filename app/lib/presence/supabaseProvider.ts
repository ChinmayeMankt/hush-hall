// Real presence for Hush Hall on Supabase.
//  - Who is in the hall right now: Realtime Presence on a private channel
//    "hall:<id>" (only signed-up, non-banned users may join; see the SQL).
//  - Who sits where and their topic: the database (hall_desks), because desk
//    claims are enforced there. Presence only adds "live now" and the timer phase.
//  - Nickname / avatar / lamp colour / "takes requests": public_profiles(),
//    so nobody can pretend to be someone else by sending fake presence data.
//  - Join requests and answers: rows in join_requests, validated by SQL
//    functions and pushed to the two people involved by Postgres Changes.

import type { RealtimeChannel } from "@supabase/supabase-js"; // channel type
import { supabase, reasonOf } from "../backend/client"; // shared client
import type { JoinRequest, JoinResponse, Member, Phase, PresenceProvider, SendResult, Unsubscribe, WalkState } from "./types"; // contract
import { setWalker, cleanWalk } from "./walkers"; // live positions of people on foot

// What each tab announces on the presence channel (small and non-authoritative).
type Beacon = { phase: Phase; phaseEndsAt: number | null; seated?: boolean; walk?: WalkState | null }; // timer state, whether I hold a desk (so sitting/standing re-reads desks), plus where I stand while walking (position, facing, pose)
// Public profile fields from public_profiles().
type Pub = { id: string; nickname: string; avatar: string; color: string; takes_requests: boolean; show_topic: boolean }; // safe fields
// A desk row from hall_desks().
type DeskRow = { user_id: string; seat: string; topic: string; started_at: string }; // active desk

const REFRESH_MS = 20000; // setting: re-read desks/profiles every 20 s even without presence events (topic edits, holds)
const OFFLINE_REFRESH_MS = 6000; // setting: while the live channel is not connected, re-read desks every 6 s so taken desks and seated people still show

export class SupabasePresence implements PresenceProvider {
  private hall = ""; // current hall id
  private me: Member | null = null; // my latest state
  private chan: RealtimeChannel | null = null; // presence channel
  private inbox: RealtimeChannel | null = null; // my requests/answers channel
  private members: Member[] = []; // last computed list (others only)
  private profiles = new Map<string, { p: Pub; at: number }>(); // id -> public profile (+ when fetched)
  private blocked = new Set<string>(); // people I blocked
  private memberCbs = new Set<(m: Member[]) => void>(); // listeners
  private requestCbs = new Set<(r: JoinRequest) => void>(); // listeners
  private responseCbs = new Set<(r: JoinResponse) => void>(); // listeners
  private timer: ReturnType<typeof setInterval> | null = null; // periodic refresh
  private pending: ReturnType<typeof setTimeout> | null = null; // debounced refresh
  private seenRequests = new Set<string>(); // request ids already delivered (initial load + realtime can overlap)
  private myWalk: WalkState | null = null; // my position on foot, announced with my beacon
  private live = false; // true while the hall presence channel is connected (SUBSCRIBED)
  private lastRead = 0; // Date.now() of the last desk read (paces the fallback polling)
  private lastSig = ""; // who is here + their phase + walking flag at the last database read (walk steps alone skip the read)

  // Enter a hall: join its presence channel and my private inbox.
  join(hallId: string, me: Member) {
    this.leave(); // one hall at a time
    this.hall = hallId; // remember
    this.me = me; // my state
    const sb = supabase(); // client
    sb.from("blocks").select("blocked_id").then(({ data }) => { (data ?? []).forEach((r: { blocked_id: string }) => this.blocked.add(r.blocked_id)); this.schedule(); }); // my block list
    this.chan = sb.channel(`hall:${hallId}`, { config: { private: true, presence: { key: me.id } } }); // one key per account (several tabs merge)
    this.chan.on("presence", { event: "sync" }, () => this.synced()); // someone came, left, changed, or took a step
    // The hall channel is private, so the join must carry my signed-in token, not the
    // anonymous key. Load the session and hand its token to Realtime before joining;
    // otherwise the join can be refused and nobody else ever appears.
    const chan = this.chan; // this join's channel (a later join replaces it)
    void sb.auth.getSession() // the stored session (refreshed if needed)
      .then(({ data }) => (data.session ? sb.realtime.setAuth(data.session.access_token) : undefined)) // give Realtime my user token for the private join
      .catch(() => undefined) // no session: the join will report why below
      .then(() => {
        if (this.chan !== chan) return; // left or moved halls meanwhile
        chan.subscribe((status, err) => {
          this.live = status === "SUBSCRIBED"; // connected or not
          if (status === "SUBSCRIBED") { this.track(); this.schedule(); return; } // announce myself and read the desks now
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { console.warn("Hush Hall: live hall channel not connected (desks still update from the database)", status, err?.message ?? ""); sb.realtime.setAuth().catch(() => {}); } // say why in the console; refresh the token for the automatic retry
        });
      });
    this.inbox = sb.channel(`inbox:${me.id}`) // Postgres Changes for rows that involve me (RLS filters them)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "join_requests", filter: `to_id=eq.${me.id}` }, (e) => this.gotRequest(e.new as ReqRow)) // a note for me
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "join_requests", filter: `from_id=eq.${me.id}` }, (e) => this.gotAnswer(e.new as ReqRow)) // an answer to my note
      .subscribe(); // start listening
    sb.from("join_requests").select("id,from_id,to_id,hall_id,note,status,room_id,created_at").eq("to_id", me.id).eq("status", "pending").gte("created_at", new Date(Date.now() - 30 * 60000).toISOString()) // setting: notes from the last 30 min still matter
      .then(({ data }) => (data ?? []).forEach((r) => this.gotRequest(r as ReqRow))); // notes sent while I was away
    this.timer = setInterval(() => { if (Date.now() - this.lastRead >= (this.live ? REFRESH_MS : OFFLINE_REFRESH_MS)) this.schedule(); }, 2000); // safety refresh: slow while live, quicker while the live channel is down
  }

  // Push my timer state (desk + topic are already in the database).
  update(me: Member) {
    const changed = !this.me || this.me.phase !== me.phase || this.me.phaseEndsAt !== me.phaseEndsAt || this.me.seat !== me.seat || !!this.me.walking !== !!me.walking; // anything others see? (walking on/off included)
    this.me = me; // keep latest
    if (changed) { this.track(); this.schedule(); } // re-announce and re-read desks (my own seat change)
  }

  // Announce my position on foot (the hall calls this a few times a second at most while I move).
  walk(state: WalkState | null) {
    this.myWalk = state; // keep the latest
    this.track(); // re-announce on the same presence channel
  }

  // Leave the hall and stop listening.
  leave() {
    this.myWalk = null; this.lastSig = ""; this.live = false; // nothing to announce after leaving
    this.members.forEach((m) => setWalker(m.id, null)); // forget everyone's walking position
    const sb = this.chan || this.inbox ? supabase() : null; // only if joined
    if (this.chan) { this.chan.untrack().catch(() => {}); sb!.removeChannel(this.chan); } // gone from presence
    if (this.inbox) sb!.removeChannel(this.inbox); // stop notes
    this.chan = null; this.inbox = null; // forget
    if (this.timer) clearInterval(this.timer); // stop refresh
    if (this.pending) clearTimeout(this.pending); // and any queued one
    this.timer = null; this.pending = null; // forget
    this.members = []; this.emit(); // clear the desks
  }

  onMembers(cb: (m: Member[]) => void): Unsubscribe {
    this.memberCbs.add(cb); // register
    cb(this.members); // current list now
    return () => this.memberCbs.delete(cb); // unsubscribe
  }

  // Send a request through the SQL function (it enforces every rule).
  async sendRequest(toId: string, note: string): Promise<SendResult> {
    if (!this.me) return { ok: false, reason: "error" }; // not in a hall
    const { data, error } = await supabase().rpc("send_join_request", { p_to: toId, p_hall: this.hall, p_note: note.slice(0, 80) }); // validated server-side
    if (error) { const r = reasonOf(error); return { ok: false, reason: r === "rate_limited" ? "rate_limited" : r === "unavailable" ? "unavailable" : "error" }; } // vague on purpose
    return { ok: true, req: { id: data as string, hallId: this.hall, from: { id: this.me.id, name: this.me.name, avatar: this.me.avatar, seat: this.me.seat }, toId, note, sentAt: Date.now() } }; // sent
  }

  // Answer a request: accept opens (or joins) a small room in the database.
  async respond(req: JoinRequest, accepted: boolean): Promise<JoinResponse | null> {
    const { data, error } = await supabase().rpc("respond_join_request", { p_id: req.id, p_accept: accepted }); // server decides the room
    if (error) return null; // e.g. sender left, or can't use rooms right now
    return { requestId: req.id, fromId: this.me?.id ?? "", toId: req.from.id, accepted, roomId: (data as string | null) ?? undefined }; // outcome
  }

  onRequest(cb: (r: JoinRequest) => void): Unsubscribe {
    this.requestCbs.add(cb); // register
    return () => this.requestCbs.delete(cb); // unsubscribe
  }

  onResponse(cb: (r: JoinResponse) => void): Unsubscribe {
    this.responseCbs.add(cb); // register
    return () => this.responseCbs.delete(cb); // unsubscribe
  }

  // Block someone (server also cancels requests and separates shared rooms).
  async block(memberId: string) {
    this.blocked.add(memberId); // hide right away
    setWalker(memberId, null); // hide them on foot too
    this.members = this.members.filter((m) => m.id !== memberId); this.emit(); // refresh desks
    await supabase().rpc("block_user", { p_user: memberId }); // persist + clean up
  }

  // ---- internals ----

  // Announce my timer phase on the presence channel.
  private track() {
    if (!this.chan || !this.me) return; // not ready
    const b: Beacon = { phase: this.me.phase, phaseEndsAt: this.me.phaseEndsAt, seated: !!this.me.seat, walk: this.me.seat ? null : this.myWalk }; // small payload (never a walking position while seated)
    this.chan.track(b).catch(() => {}); // best effort (reconnects re-track)
  }

  // A presence sync arrived: copy walking positions straight into the walker
  // store, and only re-read the database when something besides a step changed.
  private synced() {
    if (!this.chan || !this.me) return; // left meanwhile
    const state = this.chan.presenceState<Beacon>(); // key -> list of tab beacons
    const parts: string[] = []; // signature pieces
    for (const id of Object.keys(state).sort()) {
      if (id === this.me.id) continue; // my own beacon
      const b = state[id][state[id].length - 1]; // latest tab wins (same rule as refresh)
      const w = this.blocked.has(id) ? null : cleanWalk(b?.walk); // checked position, none for blocked people
      setWalker(id, w); // update (or clear) their figure on foot
      parts.push(`${id}:${b?.phase}:${b?.phaseEndsAt}:${b?.seated ? 1 : 0}:${w ? 1 : 0}`); // what the desks and labels depend on (sit/stand, timer, walk on/off)
    }
    const sig = parts.join("|"); // compact signature
    if (sig !== this.lastSig) { this.lastSig = sig; this.schedule(); } // arrivals, departures, timers, walk on/off: re-read desks
  }

  // Coalesce bursts of presence events into one database read.
  private schedule() {
    if (this.pending) return; // already queued
    this.pending = setTimeout(() => { this.pending = null; this.refresh().catch(() => {}); }, 300); // 0.3 s debounce
  }

  // Rebuild the member list: live presence x database desks x public profiles.
  private async refresh() {
    if (!this.chan || !this.me) return; // left meanwhile
    const sb = supabase(); // client
    const state = this.chan.presenceState<Beacon>(); // key -> list of tab beacons
    const live = Object.keys(state).filter((id) => id !== this.me!.id && !this.blocked.has(id)); // other accounts here now
    this.lastRead = Date.now(); // paces the fallback polling
    const { data: desks } = await sb.rpc("hall_desks", { p_hall: this.hall }); // who sits where (authoritative)
    const deskBy = new Map(((desks ?? []) as DeskRow[]).map((d) => [d.user_id, d])); // user -> desk
    // Everyone to show: people live on the channel, plus everyone holding a desk with a
    // recent heartbeat. Desks come from the database, so a taken desk and its student
    // show up even when the live channel is slow or not connected.
    const ids = [...new Set([...live, ...[...deskBy.keys()].filter((id) => id !== this.me!.id && !this.blocked.has(id))])]; // union, without me or blocked people
    const now = Date.now(); // for profile cache age
    const need = ids.filter((id) => { const c = this.profiles.get(id); return !c || now - c.at > REFRESH_MS; }); // missing or old
    if (need.length) {
      const { data: pubs } = await sb.rpc("public_profiles", { ids: need }); // safe public fields
      ((pubs ?? []) as Pub[]).forEach((p) => this.profiles.set(p.id, { p, at: now })); // cache
    }
    this.members = ids.flatMap((id) => {
      const pub = this.profiles.get(id)?.p; // public profile
      if (!pub) return []; // banned / unknown: not shown
      const beacons = state[id] ?? []; // this account's tabs
      const b = beacons[beacons.length - 1]; // latest tab wins
      const desk = deskBy.get(id); // their desk, if seated
      return [{
        id, name: pub.nickname, avatar: pub.avatar, color: pub.color, // who (from the database)
        seat: desk?.seat ?? null, topic: pub.show_topic ? desk?.topic ?? "" : "", // where + what (from the database)
        phase: (desk ? b?.phase ?? "idle" : "idle") as Phase, phaseEndsAt: desk ? b?.phaseEndsAt ?? null : null, // timer (from presence)
        hideFromRequests: !pub.takes_requests, lastSeen: now, // privacy + freshness
        walking: !desk && !!cleanWalk(b?.walk), // on foot only when they hold no desk
      } satisfies Member];
    });
    this.emit(); // tell the hall
  }

  // Fan out the member list.
  private emit() { this.memberCbs.forEach((cb) => cb(this.members)); } // notify listeners

  // A request row addressed to me arrived (realtime or initial load).
  private async gotRequest(r: ReqRow) {
    if (r.status !== "pending" || this.seenRequests.has(r.id) || this.blocked.has(r.from_id)) return; // stale, duplicate, or blocked
    this.seenRequests.add(r.id); // once
    let pub = this.profiles.get(r.from_id)?.p; // sender's public profile
    if (!pub) { const { data } = await supabase().rpc("public_profiles", { ids: [r.from_id] }); pub = (data as Pub[] | null)?.[0]; if (pub) this.profiles.set(pub.id, { p: pub, at: Date.now() }); } // fetch if needed
    if (!pub) return; // sender can't be shown (e.g. banned meanwhile)
    const seat = this.members.find((m) => m.id === r.from_id)?.seat ?? null; // their desk, if in this hall
    const req: JoinRequest = { id: r.id, hallId: r.hall_id, from: { id: r.from_id, name: pub.nickname, avatar: pub.avatar, seat }, toId: r.to_id, note: r.note, sentAt: Date.parse(r.created_at) }; // UI shape
    this.requestCbs.forEach((cb) => cb(req)); // deliver
  }

  // One of my requests was answered.
  private gotAnswer(r: ReqRow) {
    if (r.status !== "accepted" && r.status !== "declined") return; // only real answers (not "cancelled")
    const res: JoinResponse = { requestId: r.id, fromId: r.to_id, toId: r.from_id, accepted: r.status === "accepted", roomId: r.room_id ?? undefined }; // UI shape
    this.responseCbs.forEach((cb) => cb(res)); // deliver
  }
}

// join_requests row as delivered by PostgREST / Postgres Changes.
type ReqRow = { id: string; from_id: string; to_id: string; hall_id: string; note: string; status: string; room_id: string | null; created_at: string }; // columns
