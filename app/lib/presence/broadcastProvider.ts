// Local, account-free presence using the browser's BroadcastChannel API.
// Every open tab on the same origin acts as a different student, so you can
// open 2-3 tabs to see desks fill up and send join requests between them.
// Nothing leaves the browser: no server, no accounts, no network calls.

import type {
  JoinRequest,
  JoinResponse,
  Member,
  PresenceProvider,
  Unsubscribe,
} from "./types"; // shared contract

// Messages that travel over the channel between tabs.
type Wire =
  | { kind: "hello"; member: Member } // "I just arrived, please announce yourselves"
  | { kind: "state"; member: Member } // heartbeat / state change
  | { kind: "leave"; id: string } // "I left the hall"
  | { kind: "request"; req: JoinRequest } // join request to someone
  | { kind: "response"; res: JoinResponse }; // answer to a join request

// How often each tab re-announces itself, and when a silent tab counts as gone.
const HEARTBEAT_MS = 3000; // 3 s heartbeat keeps desks fresh
const STALE_MS = 10000; // no heartbeat for 10 s = treat the tab as closed

// Request rate limits (client-side here; the real backend must enforce them server-side too).
const REQ_WINDOW_MS = 10 * 60 * 1000; // rolling 10-minute window
const REQ_MAX_PER_WINDOW = 3; // at most 3 requests per sender per window
const REQ_SAME_TARGET_MS = 10 * 60 * 1000; // one request to the same person per 10 minutes

// Small helper to make ids without any library.
const rid = () => Math.random().toString(36).slice(2, 10); // 8 random base-36 chars

export class BroadcastPresence implements PresenceProvider {
  private channel: BroadcastChannel | null = null; // open channel for the current hall
  private hallId = ""; // which hall we are in
  private me: Member | null = null; // our own latest state
  private others = new Map<string, Member>(); // everyone else we have heard from
  private blocked = new Set<string>(); // ids this tab has blocked
  private memberCbs = new Set<(m: Member[]) => void>(); // member list listeners
  private requestCbs = new Set<(r: JoinRequest) => void>(); // incoming request listeners
  private responseCbs = new Set<(r: JoinResponse) => void>(); // incoming answer listeners
  private timer: ReturnType<typeof setInterval> | null = null; // heartbeat interval
  private sent: { toId: string; at: number }[] = []; // recent requests, for rate limiting

  // Enter a hall: open its channel, say hello, start heartbeating.
  join(hallId: string, me: Member) {
    this.leave(); // never be in two halls at once (hopping = leave + join)
    this.hallId = hallId; // remember the hall
    this.me = { ...me, lastSeen: Date.now() }; // store a fresh copy of ourselves
    this.channel = new BroadcastChannel(`hush-hall:${hallId}`); // one channel per hall
    this.channel.onmessage = (e: MessageEvent<Wire>) => this.handle(e.data); // route messages
    this.post({ kind: "hello", member: this.me }); // ask others to announce themselves
    this.timer = setInterval(() => this.tick(), HEARTBEAT_MS); // keep presence alive
  }

  // Push our latest state to everyone in the hall.
  update(me: Member) {
    this.me = { ...me, lastSeen: Date.now() }; // refresh timestamp
    this.post({ kind: "state", member: this.me }); // broadcast it
  }

  // Leave the hall cleanly.
  leave() {
    if (this.me && this.channel) this.post({ kind: "leave", id: this.me.id }); // tell others
    if (this.timer) clearInterval(this.timer); // stop heartbeat
    this.timer = null; // forget the interval
    this.channel?.close(); // close the channel
    this.channel = null; // forget it
    this.others.clear(); // nobody is visible once we leave
    this.emitMembers(); // let the UI clear the desks
  }

  // Subscribe to the live list of other members.
  onMembers(cb: (m: Member[]) => void): Unsubscribe {
    this.memberCbs.add(cb); // register
    cb(this.list()); // give the current list immediately
    return () => this.memberCbs.delete(cb); // unsubscribe handle
  }

  // Send a join request; refuses if the target hid themselves or is blocked.
  sendRequest(toId: string, note: string): JoinRequest | null {
    if (!this.me) return null; // must be in a hall first
    const target = this.others.get(toId); // look up the receiver
    if (!target || target.hideFromRequests || this.blocked.has(toId)) return null; // respect privacy
    const now = Date.now(); // current time
    this.sent = this.sent.filter((s) => now - s.at < REQ_WINDOW_MS); // forget old requests
    if (this.sent.length >= REQ_MAX_PER_WINDOW) return null; // too many recently
    if (this.sent.some((s) => s.toId === toId && now - s.at < REQ_SAME_TARGET_MS)) return null; // no repeat nagging
    this.sent.push({ toId, at: now }); // record this one
    const req: JoinRequest = {
      id: rid(), // new request id
      hallId: this.hallId, // same hall
      from: { id: this.me.id, name: this.me.name, avatar: this.me.avatar, seat: this.me.seat }, // public bits only
      toId, // receiver
      note: note.slice(0, 80), // hard cap the note length
      sentAt: Date.now(), // timestamp
    };
    this.post({ kind: "request", req }); // deliver to the receiver's tab
    return req; // caller can show "request sent"
  }

  // Answer a request that was sent to us.
  respond(req: JoinRequest, accepted: boolean) {
    if (!this.me) return; // not in a hall
    const res: JoinResponse = {
      requestId: req.id, // which request
      fromId: this.me.id, // us
      toId: req.from.id, // original sender
      accepted, // the decision
      roomName: accepted ? `${req.from.name} & ${this.me.name}` : undefined, // simple room name
    };
    this.post({ kind: "response", res }); // send it back
  }

  // Listen for requests addressed to us.
  onRequest(cb: (r: JoinRequest) => void): Unsubscribe {
    this.requestCbs.add(cb); // register
    return () => this.requestCbs.delete(cb); // unsubscribe handle
  }

  // Listen for answers to our requests.
  onResponse(cb: (r: JoinResponse) => void): Unsubscribe {
    this.responseCbs.add(cb); // register
    return () => this.responseCbs.delete(cb); // unsubscribe handle
  }

  // Block someone for this tab: hide their desk details and ignore their requests.
  block(memberId: string) {
    this.blocked.add(memberId); // remember the block
    this.emitMembers(); // refresh the UI without them
  }

  // ---- internals ----

  // Route one incoming message from another tab.
  private handle(msg: Wire) {
    if (!this.me) return; // ignore if we already left
    if (msg.kind === "hello" || msg.kind === "state") {
      if (msg.member.id === this.me.id) return; // ignore our own echo
      this.others.set(msg.member.id, { ...msg.member, lastSeen: Date.now() }); // upsert member
      if (msg.kind === "hello") this.post({ kind: "state", member: this.me }); // reply so newcomer sees us
      this.emitMembers(); // update desks
    } else if (msg.kind === "leave") {
      this.others.delete(msg.id); // drop them
      this.emitMembers(); // update desks
    } else if (msg.kind === "request") {
      if (msg.req.toId !== this.me.id) return; // not for us
      if (this.me.hideFromRequests || this.blocked.has(msg.req.from.id)) return; // silently drop
      this.requestCbs.forEach((cb) => cb(msg.req)); // hand to the UI
    } else if (msg.kind === "response") {
      if (msg.res.toId !== this.me.id) return; // not for us
      this.responseCbs.forEach((cb) => cb(msg.res)); // hand to the UI
    }
  }

  // Heartbeat: re-announce ourselves and prune silent tabs.
  private tick() {
    if (!this.me) return; // nothing to do outside a hall
    this.update(this.me); // re-send our state with a fresh timestamp
    const now = Date.now(); // current time
    let changed = false; // track whether anyone was pruned
    this.others.forEach((m, id) => {
      if (now - m.lastSeen > STALE_MS) {
        this.others.delete(id); // tab closed or crashed
        changed = true; // remember to refresh
      }
    });
    if (changed) this.emitMembers(); // refresh desks only if needed
  }

  // Current visible members, minus anyone we blocked.
  private list(): Member[] {
    return [...this.others.values()].filter((m) => !this.blocked.has(m.id)); // hide blocked
  }

  // Notify all member listeners.
  private emitMembers() {
    const l = this.list(); // compute once
    this.memberCbs.forEach((cb) => cb(l)); // fan out
  }

  // Post safely (channel may be closed during navigation).
  private post(msg: Wire) {
    try {
      this.channel?.postMessage(msg); // structured-clone send to other tabs
    } catch {
      // channel closed mid-navigation; safe to ignore
    }
  }
}
