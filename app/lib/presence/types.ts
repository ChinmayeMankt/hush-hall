// Presence contract for Hush Hall.
// The UI only talks to this interface, so the local BroadcastChannel mock
// can be swapped for Supabase Realtime (or anything else) without UI changes.

// What a desk is doing right now; drives the soft colour of a desk.
export type Phase = "idle" | "focus" | "break"; // idle = seated but timer not running

// One person present in a hall (real tab or local demo student).
export interface Member {
  id: string; // stable per browser tab in the mock; auth user id later
  name: string; // display name chosen in the lobby
  avatar: string; // emoji avatar for the MVP (no uploads, no photos)
  color: string; // soft desk-lamp colour behind the avatar
  seat: string | null; // desk label like "B4", null while standing in the aisle
  topic: string; // public study topic written on the desk card
  phase: Phase; // focus / break / idle
  phaseEndsAt: number | null; // epoch ms when the current phase ends, if a timer runs
  hideFromRequests: boolean; // true = nobody can send this person a join request
  isDemo?: boolean; // true for the locally simulated students in the prototype
  lastSeen: number; // epoch ms of last heartbeat, used to drop stale tabs
}

// A quiet "may I join your study room?" note from one desk to another.
export interface JoinRequest {
  id: string; // unique request id
  hallId: string; // hall where both people sit
  from: Pick<Member, "id" | "name" | "avatar" | "seat">; // who is asking
  toId: string; // who is being asked
  note: string; // short optional note, capped in the UI
  sentAt: number; // epoch ms
}

// The receiver's answer to a JoinRequest.
export interface JoinResponse {
  requestId: string; // which request this answers
  fromId: string; // the receiver who answered
  toId: string; // the original sender
  accepted: boolean; // true = accept, false = politely decline
  roomName?: string; // name of the small study room when accepted
}

// Unsubscribe function returned by every listener.
export type Unsubscribe = () => void;

// The interface any realtime backend must implement.
export interface PresenceProvider {
  join(hallId: string, me: Member): void; // enter a hall and start announcing yourself
  update(me: Member): void; // push a change (seat, topic, phase, settings)
  leave(): void; // leave the hall and tell others
  onMembers(cb: (members: Member[]) => void): Unsubscribe; // live list of others in this hall
  sendRequest(toId: string, note: string): JoinRequest | null; // null if blocked/hidden
  respond(req: JoinRequest, accepted: boolean): void; // answer a request addressed to me
  onRequest(cb: (req: JoinRequest) => void): Unsubscribe; // requests addressed to me
  onResponse(cb: (res: JoinResponse) => void): Unsubscribe; // answers to my requests
  block(memberId: string): void; // locally block someone: hide them and drop their requests
}
