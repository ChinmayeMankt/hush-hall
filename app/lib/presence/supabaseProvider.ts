// Real presence for Hush Hall on Supabase.
//  - Who is in the hall right now: Realtime Presence on a private channel
//    "hall:<id>" (only signed-up, non-banned users may join; see the SQL).
//  - Who sits where and their topic: the database (hall_desks), because desk
//    claims are enforced there. Presence only adds "live now" and the timer phase.
//  - Nickname / avatar / lamp colour / "takes requests": public_profiles(),
//    so nobody can pretend to be someone else by sending fake presence data.
//  - Who walks where: the database too (walk_update / hall_walkers, see
//    0002_hall_walkers.sql), read about once a second, so people on foot show
//    up even when the live channel is down. When the live channel works, its
//    faster updates are used instead for that person (never both at once).
//  - Join requests and answers: rows in join_requests, validated by SQL
//    functions and pushed to the two people involved by Postgres Changes.

import type { RealtimeChannel } from "@supabase/supabase-js"; // channel type
import { supabase, reasonOf } from "../backend/client"; // shared client
import type { JoinRequest, JoinResponse, Member, Phase, PresenceProvider, SendResult, Unsubscribe, WalkState } from "./types"; // contract
import { setWalker, cleanWalk } from "./walkers"; // live positions of people on foot

// What each tab announces on the presence channel (small and non-authoritative).
type Beacon = { phase: Phase; phaseEndsAt: number | null; seated?: boolean; walk?: WalkState | null }; // timer state, whether I hold a desk (so sitting/standing re-reads desks), plus where I stand while walking (position, facing, pose)
// Public profile fields from public_profiles().
type Pub = { id: string; nickname: string; avatar: string; color: string; takes_requests: boolean; show_topic: boolean; look?: string }; // safe fields (look: wardrobe, once migration 0003 is in)
// A walker row from hall_walkers() (age_ms / stamp by the database clock).
type WalkRow = { user_id: string; x: number; z: number; ry: number; pose: string; age_ms: number; stamp: number | string; topic?: string }; // someone on foot (topic: floor sitters, once migration 0003 is in)
// A desk row from hall_desks().
type DeskRow = { user_id: string; seat: string; topic: string; started_at: string }; // active desk

const REFRESH_MS = 20000; // setting: re-read desks/profiles every 20 s even without presence events (topic edits, holds)
const WALK_POLL_MS = 1000; // setting: read other walkers from the database once a second while anyone is on foot (me or them)
const WALK_IDLE_POLL_MS = 3000; // setting: otherwise check every 3 s, so someone who starts walking shows up quickly
const WALK_BEAT_MS = 5000; // setting: while I stand still on foot, re-save my position every 5 s (rows older than 20 s are hidden)
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
  private presWalk = new Map<string, WalkState>(); // positions from the live channel (fast, when it works)
  private dbWalk = new Map<string, { w: WalkState; stamp: number; age: number; topic: string }>(); // positions from the database (always), plus a floor sitter's filtered topic
  private legacyWalk = false; // true = the database has only the 0002 walker functions (no floor pose / topic yet)
  private shown = new Map<string, string>(); // id -> which sample the 3D hall has now (so repeats aren't re-sent)
  private walkSig = ""; // who was on foot at the last database read (a change re-reads profiles)
  private lastWalkPoll = 0; // Date.now() of the last walker read
  private walkBusy = false; // a walker read is in flight
  private walkOffUntil = 0; // Date.now() until which walker reads/writes pause (database not updated yet)
  private wNext: { s: WalkState | null } | null = null; // my newest position waiting to be saved (null s = clear)
  private wBusy = false; // a save is in flight
  private stored = false; // I have a saved walker row (so leaving clears it)
  private lastSave = 0; // Date.now() of my last position save
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
          if (!this.live && this.presWalk.size) { const ids = [...this.presWalk.keys()]; this.presWalk.clear(); ids.forEach((id) => this.publish(id)); } // channel dropped: fall back to database positions for people on foot
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
    this.timer = setInterval(() => this.tick(), 250); // desks, walkers, and my walking heartbeat (each paced on its own below)
  }

  // Push my timer state (desk + topic are already in the database).
  update(me: Member) {
    if (me.seat && this.stored) this.save(null); // sat down: off my feet everywhere (the database also does this on sit)
    const changed = !this.me || this.me.phase !== me.phase || this.me.phaseEndsAt !== me.phaseEndsAt || this.me.seat !== me.seat || !!this.me.walking !== !!me.walking; // anything others see? (walking on/off included)
    this.me = me; // keep latest
    if (changed) { this.track(); this.schedule(); } // re-announce and re-read desks (my own seat change)
  }

  // Announce my position on foot (the hall calls this a few times a second at most while I move).
  walk(state: WalkState | null) {
    this.myWalk = state; // keep the latest
    this.track(); // re-announce on the same presence channel
    this.save(state); // and in the database, so people without the live channel see me too
  }

  // Leave the hall and stop listening.
  leave() {
    if (this.stored) { this.stored = false; supabase().rpc("walk_clear").then(() => {}, () => {}); } // take my walker row away (a closed tab expires on its own after 20 s)
    this.myWalk = null; this.lastSig = ""; this.live = false; this.walkSig = ""; this.wNext = null; // nothing to announce after leaving
    this.members.forEach((m) => setWalker(m.id, null)); // forget everyone's walking position
    this.shown.forEach((_, id) => setWalker(id, null)); // including walkers not yet in the member list
    this.presWalk.clear(); this.dbWalk.clear(); this.shown.clear(); // and both sources
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
    this.presWalk.delete(memberId); this.dbWalk.delete(memberId); this.publish(memberId); // hide them on foot too
    this.members = this.members.filter((m) => m.id !== memberId); this.emit(); // refresh desks
    await supabase().rpc("block_user", { p_user: memberId }); // persist + clean up
  }

  // ---- internals ----

  // Announce my timer phase on the presence channel.
  private track() {
    if (!this.chan || !this.me) return; // not ready
    const w = this.me.seat || !this.myWalk ? null : { x: this.myWalk.x, z: this.myWalk.z, ry: this.myWalk.ry, pose: this.myWalk.pose }; // position + pose only: topics always come from the database (filtered), never from presence
    const b: Beacon = { phase: this.me.phase, phaseEndsAt: this.me.phaseEndsAt, seated: !!this.me.seat, walk: w }; // small payload (never a walking position while seated)
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
      if (w) this.presWalk.set(id, w); else this.presWalk.delete(id); // live-channel position (or none)
      this.publish(id); // update (or clear) their figure on foot
      parts.push(`${id}:${b?.phase}:${b?.phaseEndsAt}:${b?.seated ? 1 : 0}:${w ? (w.pose === "floor" ? 2 : 1) : 0}`); // what the desks and labels depend on (sit/stand, timer, walk on/off)
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
    const ids = [...new Set([...live, ...[...deskBy.keys(), ...this.dbWalk.keys()].filter((id) => id !== this.me!.id && !this.blocked.has(id))])]; // union (live, seated, walking), without me or blocked people
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
      const floor = !desk && (this.presWalk.get(id) ?? this.dbWalk.get(id)?.w)?.pose === "floor"; // sitting on the floor (live channel first, then database)
      return [{
        id, name: pub.nickname, avatar: pub.avatar, color: pub.color, // who (from the database)
        seat: desk?.seat ?? null, topic: pub.show_topic ? desk?.topic ?? (floor ? this.dbWalk.get(id)?.topic ?? "" : "") : "", // where + what (from the database: desk topic, or floor topic)
        floor, look: pub.look ?? "", // sitting on the floor? + wardrobe (from the database)
        phase: (desk ? b?.phase ?? "idle" : "idle") as Phase, phaseEndsAt: desk ? b?.phaseEndsAt ?? null : null, // timer (from presence)
        hideFromRequests: !pub.takes_requests, lastSeen: now, // privacy + freshness
        walking: !desk && (this.presWalk.has(id) || this.dbWalk.has(id)), // on foot only when they hold no desk (live channel or database)
      } satisfies Member];
    });
    this.emit(); // tell the hall
  }

  // Every 250 ms: re-read desks when due, read walkers when due, and keep my
  // walker row fresh while I stand still on foot.
  private tick() {
    const now = Date.now(); // timing
    if (now - this.lastRead >= (this.live ? REFRESH_MS : OFFLINE_REFRESH_MS)) this.schedule(); // safety refresh: slow while live, quicker while the live channel is down
    const busy = this.dbWalk.size > 0 || !!this.myWalk; // anyone on foot?
    const hidden = typeof document !== "undefined" && document.hidden; // background tab
    const every = hidden ? 5000 : busy ? WALK_POLL_MS : WALK_IDLE_POLL_MS; // setting: background tabs check every 5 s
    if (now - this.lastWalkPoll >= every) void this.pollWalkers(); // read other walkers
    if (this.myWalk && this.me && !this.me.seat && now - this.lastSave >= WALK_BEAT_MS) this.save(this.myWalk); // heartbeat while standing still
  }

  // Database writes for my position: keep only the newest, one call at a time
  // (so a late "walking" save can never land after "stopped").
  private save(state: WalkState | null) {
    if (!this.me || !this.hall) return; // not in a hall
    if (state && this.me.seat) state = null; // never on foot while holding a desk
    if (!state && !this.stored && !this.wBusy) return; // nothing saved, nothing to clear
    this.wNext = { s: state }; // newest wins
    this.lastSave = Date.now(); // paces the heartbeat
    if (!this.wBusy) void this.flushSaves(); // start sending
  }

  // Send queued saves one by one.
  private async flushSaves() {
    this.wBusy = true; // one at a time
    try {
      while (this.wNext) {
        const { s } = this.wNext; this.wNext = null; // take the newest
        if (s && Date.now() < this.walkOffUntil) continue; // database not ready for walkers: skip quietly
        const sb = supabase(); // client
        // Save where I stand (with the topic while on the floor). Before migration 0003
        // the database only knows walking/idle without a topic: save that instead.
        const full = () => sb.rpc("walk_update", { p_hall: this.hall, p_x: s!.x, p_z: s!.z, p_ry: s!.ry, p_pose: s!.pose, p_topic: s!.pose === "floor" ? s!.topic ?? "" : null }); // current functions
        const legacy = () => sb.rpc("walk_update", { p_hall: this.hall, p_x: s!.x, p_z: s!.z, p_ry: s!.ry, p_pose: s!.pose === "walking" ? "walking" : "idle" }); // 0002 functions
        let { error } = s ? await (this.legacyWalk ? legacy() : full()) : await sb.rpc("walk_clear"); // or that I stopped
        if (s && error && missingFn(error) && !this.legacyWalk) { this.legacyWalk = true; ({ error } = await legacy()); } // older database: fall back (floor shows as standing there)
        if (error) { if (missingFn(error)) this.walkOffUntil = Date.now() + 60000; continue; } // functions not installed yet: try again in a minute
        this.stored = !!s; // remember whether a row exists now
      }
    } finally { this.wBusy = false; } // ready for the next one
  }

  // Read everyone else on foot in this hall from the database.
  private async pollWalkers() {
    if (!this.me || this.walkBusy || Date.now() < this.walkOffUntil) return; // not in a hall, already reading, or not installed
    this.walkBusy = true; this.lastWalkPoll = Date.now(); // one read at a time
    const hall = this.hall; // the hall this read is for
    try {
      const { data, error } = await supabase().rpc("hall_walkers", { p_hall: hall }); // fresh walkers, rules applied in the database
      if (hall !== this.hall || !this.me) return; // left or moved meanwhile
      if (error) { if (missingFn(error)) this.walkOffUntil = Date.now() + 60000; return; } // not installed yet: check again in a minute
      const seen = new Set<string>(); // who is on foot now
      for (const r of (data ?? []) as WalkRow[]) {
        if (r.user_id === this.me.id || this.blocked.has(r.user_id)) continue; // never me, never blocked people
        const w = cleanWalk({ x: r.x, z: r.z, ry: r.ry, pose: r.pose }); // same checks as live positions
        if (!w) continue; // malformed: skip
        seen.add(r.user_id); // still here
        this.dbWalk.set(r.user_id, { w, stamp: Number(r.stamp), age: Math.max(0, r.age_ms), topic: typeof r.topic === "string" ? r.topic : "" }); // newest known position (+ filtered floor topic)
        this.publish(r.user_id); // hand it to the 3D hall (only if it's a new step)
      }
      for (const id of [...this.dbWalk.keys()]) if (!seen.has(id)) { this.dbWalk.delete(id); this.publish(id); } // stopped, sat, or left
      const sig = [...seen].sort().map((id) => { const d = this.dbWalk.get(id)!; return d.w.pose === "floor" ? `${id}:floor:${d.topic}` : id; }).join(","); // who is on foot, and who sits on the floor with which topic
      if (sig !== this.walkSig) { this.walkSig = sig; this.schedule(); } // someone started or stopped walking: rebuild the list (profiles, walking flag)
    } catch { /* network hiccup: the next tick tries again */ } finally { this.walkBusy = false; } // ready for the next read
  }

  // Give the 3D hall one person's position: the live channel's when it has one
  // (fresher), otherwise the database's. Same sample twice is not re-sent, so
  // the smoothing sees each real step once.
  private publish(id: string) {
    const p = this.blocked.has(id) ? undefined : this.presWalk.get(id); // live position
    const d = this.blocked.has(id) ? undefined : this.dbWalk.get(id); // database position
    const sig = p ? `p:${p.x}:${p.z}:${p.ry}:${p.pose}` : d ? `d:${d.stamp}` : ""; // which sample
    if ((this.shown.get(id) ?? "") === sig) return; // nothing new
    if (sig) this.shown.set(id, sig); else this.shown.delete(id); // remember
    setWalker(id, p ?? d?.w ?? null, p ? 0 : d?.age ?? 0); // database samples carry their age
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

// True if a call failed because the walker functions aren't in the database yet.
function missingFn(e: { code?: string; message?: string }) {
  return e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? ""); // PostgREST / Postgres "no such function"
}

// join_requests row as delivered by PostgREST / Postgres Changes.
type ReqRow = { id: string; from_id: string; to_id: string; hall_id: string; note: string; status: string; room_id: string | null; created_at: string }; // columns
