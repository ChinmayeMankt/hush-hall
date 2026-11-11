"use client"; // live room state

// A small study room (2-4 people who accepted each other). Shows who's in it,
// lets anyone leave, lets the owner remove someone, and holds the voice panel.
// Membership changes (join, leave, removal) arrive live from the database.

import { useEffect } from "react"; // effects
import { leaveRoom, loadMyRoom, removeFromRoom, watchRoom, type Room, type RoomMember } from "@/lib/rooms"; // room data
import VoicePanel from "./VoicePanel"; // LiveKit voice

export default function RoomPanel(props: { room: Room; myId: string; onChange: (r: Room | null) => void; say: (m: string) => void; onReport: (m: RoomMember) => void }) {
  const { room, myId, onChange, say } = props; // inputs
  const amOwner = room.ownerId === myId; // owner controls

  // Re-read the room whenever its membership changes; tell me calmly if I'm no longer in it.
  useEffect(() => watchRoom(room.id, async () => {
    const r = await loadMyRoom(myId); // fresh state
    if (!r || r.id !== room.id) say("You’re no longer in that study room."); // left, removed, or room closed
    onChange(r); // new state (null = no room)
  }), [room.id, myId, onChange, say]);

  // Leave the room (and the call).
  const leave = async () => { await leaveRoom(room.id); onChange(null); say("You left the study room. Your desk is still yours."); }; // calm

  // Owner removes someone; they can't rejoin this room.
  const remove = async (m: RoomMember) => {
    if (!window.confirm(`Remove ${m.name} from this room? They won’t be able to rejoin it.`)) return; // confirm
    say((await removeFromRoom(room.id, m.id)) ? `${m.name} was removed from the room.` : "Couldn’t remove them just now."); // result
  };

  return (
    <div className="room-banner">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><b>Study room:</b> {room.name} <span className="muted small">· {room.members.length} of 4</span></div>
        <button className="ghost small" onClick={leave}>Leave room</button>
      </div>
      {/* Members: nickname + avatar only */}
      <ul className="room-members">
        {room.members.map((m) => (
          <li key={m.id}>
            <span>{m.avatar} {m.name}{m.isOwner ? " · started this room" : ""}{m.isMe ? " (you)" : ""}</span>
            {!m.isMe && (
              <span className="row" style={{ gap: 4 }}>
                {amOwner && <button className="ghost small" onClick={() => remove(m)}>Remove</button>}
                <button className="ghost small" onClick={() => props.onReport(m)}>Report</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <VoicePanel roomId={room.id} names={Object.fromEntries(room.members.map((m) => [m.id, `${m.avatar} ${m.name}`]))} />
    </div>
  );
}
