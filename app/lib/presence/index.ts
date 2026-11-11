// Single place that decides which presence backend the app uses:
// Supabase Realtime when the project env vars are set (the real app),
// otherwise the local BroadcastChannel demo (no network, for offline demos).

import { BroadcastPresence } from "./broadcastProvider"; // local demo
import { SupabasePresence } from "./supabaseProvider"; // real backend
import { hasSupabase } from "../backend/client"; // env check
import type { PresenceProvider } from "./types"; // contract

let instance: PresenceProvider | null = null; // one provider per tab

// Return the shared provider, creating it on first use (browser only).
export function getPresence(): PresenceProvider {
  if (!instance) instance = hasSupabase ? new SupabasePresence() : new BroadcastPresence(); // real first, demo fallback
  return instance; // same object for every component
}

export type { Member, JoinRequest, JoinResponse, Phase, SendResult, WalkState } from "./types"; // re-export types
export { walkers } from "./walkers"; // live positions of people walking (read every frame by the 3D hall)
