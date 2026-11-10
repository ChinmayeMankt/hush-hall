// Single place that decides which presence backend the app uses.
// Today: the local BroadcastChannel mock. Later: a SupabasePresence class
// implementing the same PresenceProvider interface (see docs/STACK.md).

import { BroadcastPresence } from "./broadcastProvider"; // local mock
import type { PresenceProvider } from "./types"; // contract

let instance: PresenceProvider | null = null; // one provider per tab

// Return the shared provider, creating it on first use (browser only).
export function getPresence(): PresenceProvider {
  if (!instance) instance = new BroadcastPresence(); // swap this line for Supabase later
  return instance; // same object for every component
}

export type { Member, JoinRequest, JoinResponse, Phase } from "./types"; // re-export types
