// Small study rooms (2-4 people who accepted each other's request).
// Real mode: rooms live in Postgres; membership changes arrive over Realtime.
// Demo mode: a room is just a local name (no audio), like the old prototype.

import { hasSupabase, supabase, callApi } from "./backend/client"; // backend

// One person in my room.
export interface RoomMember { id: string; name: string; avatar: string; isOwner: boolean; isMe: boolean } // display fields only
// My current room.
export interface Room { id: string; name: string; ownerId: string | null; members: RoomMember[] } // what the panel shows

// Read my current room (or null), with members' public profiles.
export async function loadMyRoom(myId: string): Promise<Room | null> {
  if (!hasSupabase) return null; // demo rooms are local state in HallView
  const sb = supabase(); // client
  const { data: mine } = await sb.from("room_members").select("room_id").eq("user_id", myId).is("left_at", null).limit(1).maybeSingle(); // my active membership
  const roomId = (mine as { room_id: string } | null)?.room_id; // room id
  if (!roomId) return null; // not in a room
  const [{ data: room }, { data: rows }] = await Promise.all([
    sb.from("rooms").select("id,name,owner_id").eq("id", roomId).maybeSingle(), // the room (RLS: members only)
    sb.from("room_members").select("user_id").eq("room_id", roomId).is("left_at", null), // who is in it
  ]); // in parallel
  if (!room) return null; // closed meanwhile
  const ids = ((rows ?? []) as { user_id: string }[]).map((r) => r.user_id); // member ids
  const { data: pubs } = await sb.rpc("public_profiles", { ids }); // nicknames + avatars
  const r = room as { id: string; name: string; owner_id: string | null }; // typed
  const members = ((pubs ?? []) as { id: string; nickname: string; avatar: string }[]).map((p) => ({ id: p.id, name: p.nickname, avatar: p.avatar, isOwner: p.id === r.owner_id, isMe: p.id === myId })); // panel rows
  return { id: r.id, name: r.name, ownerId: r.owner_id, members }; // room
}

// Call `cb` whenever membership of a room changes (join, leave, removal).
export function watchRoom(roomId: string, cb: () => void): () => void {
  if (!hasSupabase) return () => {}; // demo: nothing to watch
  const sb = supabase(); // client
  const ch = sb.channel(`room-members:${roomId}`).on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` }, () => cb()).subscribe(); // RLS limits this to members
  return () => { sb.removeChannel(ch); }; // stop
}

// Leave my room (the room closes when the last person leaves).
export async function leaveRoom(roomId: string) {
  if (hasSupabase) await supabase().rpc("leave_room", { p_room: roomId }); // database
}

// Owner removes someone: database first, then they're dropped from the voice call too.
export async function removeFromRoom(roomId: string, userId: string): Promise<boolean> {
  const r = await callApi<{ ok?: boolean }>("/api/rooms/remove", { roomId, userId }); // server route (also kicks from LiveKit)
  return r.ok; // removed?
}
