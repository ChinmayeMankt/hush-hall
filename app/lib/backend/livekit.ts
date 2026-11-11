// Server-only LiveKit helpers (voice for small study rooms).
// Needs LIVEKIT_URL (wss://...), LIVEKIT_API_KEY and LIVEKIT_API_SECRET.
// Without them, voice is simply "not switched on" and rooms work without audio.

import "server-only"; // never in the browser bundle
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk"; // official server SDK

const URL_ = process.env.LIVEKIT_URL ?? ""; // e.g. wss://hush-hall-xxxx.livekit.cloud
const KEY = process.env.LIVEKIT_API_KEY ?? ""; // API key
const SECRET = process.env.LIVEKIT_API_SECRET ?? ""; // API secret

export const livekitConfigured = URL_.length > 0 && KEY.length > 0 && SECRET.length > 0; // all three needed
export const livekitUrl = URL_; // clients connect here
export const roomNameOf = (roomId: string) => `hh-${roomId}`; // LiveKit room for a study room

// Short-lived token for one person in one study room: mic audio only, no
// video, no screen share, no data messages, no recording or admin rights.
export async function voiceToken(roomId: string, userId: string, nickname: string): Promise<string> {
  const at = new AccessToken(KEY, SECRET, { identity: userId, name: nickname, ttl: "10m" }); // setting: 10-minute join window
  at.addGrant({ room: roomNameOf(roomId), roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false, canPublishSources: [TrackSource.MICROPHONE] }); // microphone only
  return at.toJwt(); // signed JWT
}

// Drop someone from a study room's call (owner removal, block, or moderator action).
export async function kickFromVoice(roomId: string, userId: string) {
  if (!livekitConfigured) return; // voice not switched on
  const http = URL_.replace(/^wss:/, "https:").replace(/^ws:/, "http:"); // API uses http(s)
  await new RoomServiceClient(http, KEY, SECRET).removeParticipant(roomNameOf(roomId), userId).catch(() => {}); // fine if they weren't connected
}
