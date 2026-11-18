"use client"; // local form state

// "Your desk": the items you've unlocked and the five spots they can go in.
// Quiet by design: no counters that reset, no locked-item gallery, no nudges.
// Changes save as you pick; others see them on whatever desk you sit at.

import { useState } from "react"; // working copy of the arrangement
import { DESK_ITEMS, DESK_SPOTS, ITEM_BY_ID, STUDY_DAY_MIN_MINUTES, nextUnlock, sameSpots, type DeskItemId, type DeskKit, type DeskSpots, type SpotId } from "@/lib/deskKit"; // rules + shapes

// Where each spot sits in the little desk drawing (4 columns; row 1 = far side, row 2 = nearer you).
const CELL: Record<SpotId, { col: number; row: number }> = {
  "2": { col: 1, row: 1 }, // back, beside the lamp
  "4": { col: 4, row: 1 }, // on the old books
  "1": { col: 1, row: 2 }, // corner by the lamp
  "3": { col: 3, row: 2 }, // beside your book
  "5": { col: 4, row: 2 }, // corner by the books
};

export function DeskKitDialog(props: {
  kit: DeskKit | null; // my kit (null while loading)
  fresh?: DeskItemId[]; // items that just unlocked (gently marked "new")
  onSave: (spots: DeskSpots) => Promise<boolean>; // save; false = didn't go through
  onClose: () => void; // close
}) {
  const [spots, setSpots] = useState<DeskSpots>(props.kit?.spots ?? {}); // working copy
  const [msg, setMsg] = useState(""); // quiet save status
  const kit = props.kit; // shorthand
  const unlocked = kit?.unlocked ?? []; // what I can place
  const next = kit ? nextUnlock(kit.studyDays) : null; // the next item, if any

  // Put an item in a spot (or clear it). An item moves if it was already elsewhere.
  const pick = async (spot: SpotId, item: DeskItemId | "") => {
    const nextSpots: DeskSpots = { ...spots }; // copy
    for (const s of DESK_SPOTS) if (item && nextSpots[s.id] === item) delete nextSpots[s.id]; // one place per item
    if (item) nextSpots[spot] = item; else delete nextSpots[spot]; // place or clear
    if (sameSpots(nextSpots, spots)) return; // nothing changed
    const before = spots; // for undo on failure
    setSpots(nextSpots); // show right away
    setMsg("Saving…"); // quiet
    const ok = await props.onSave(nextSpots); // save
    if (ok) setMsg(item ? "Saved. It goes with you to any desk." : "Taken off. It stays on your shelf for whenever you want it."); // done
    else { setSpots(before); setMsg("Couldn’t save that just now. Try again?"); } // put it back
  };

  return (
    <div className="veil" role="dialog" aria-modal="true" aria-label="Your desk" onClick={props.onClose}>
      <div className="dialog desk-kit" onClick={(e) => e.stopPropagation()}>
        <h2>Your desk</h2>
        {!kit ? <p className="muted small">Opening your drawer…</p> : (
          <>
            {unlocked.length === 0 ? (
              <p className="small">Your shelf is empty for now. After your first study day, a small plant appears here.</p>
            ) : (
              <>
                {/* The shelf: everything unlocked so far (kept for good) */}
                <div className="kit-shelf" aria-label="Your shelf">
                  {unlocked.map((id) => {
                    const it = ITEM_BY_ID.get(id)!; // item details
                    return <span key={id} className="kit-item" title={it.line}>{it.name}{props.fresh?.includes(id) && <span className="muted small"> · new</span>}</span>;
                  })}
                </div>
                {/* The five spots, laid out like the desk seen from your chair */}
                <div className="kit-desk" aria-label="Five spots on your desk">
                  <div className="kit-side small muted" style={{ gridColumn: 1, gridRow: 3 }}>Lamp side</div>
                  <div className="kit-work small muted" style={{ gridColumn: 2, gridRow: 2 }}>Your book</div>
                  <div className="kit-side small muted" style={{ gridColumn: 4, gridRow: 3, textAlign: "right" }}>Book side</div>
                  {DESK_SPOTS.map((s) => (
                    <label key={s.id} className="kit-spot" style={{ gridColumn: CELL[s.id].col, gridRow: CELL[s.id].row }}>
                      <span className="small muted">{s.label}</span>
                      <span className="kit-pick">
                        <select value={spots[s.id] ?? ""} onChange={(e) => { void pick(s.id, e.target.value as DeskItemId | ""); }}>
                          <option value="">Empty</option>
                          {unlocked.map((id) => <option key={id} value={id}>{ITEM_BY_ID.get(id)!.name}</option>)}
                        </select>
                        {/* One tap to take an item off the desk (it stays on your shelf) */}
                        {spots[s.id] && <button type="button" className="ghost small kit-off" aria-label={`Take the ${ITEM_BY_ID.get(spots[s.id]!)!.name.toLowerCase()} off the desk`} title="Take off (stays on your shelf)" onClick={(e) => { e.preventDefault(); void pick(s.id, ""); }}>×</button>}
                      </span>
                    </label>
                  ))}
                </div>
                {msg && <p className="small muted">{msg}</p>}
              </>
            )}
            {/* One gentle line about what comes next, and what counts */}
            <p className="small muted" style={{ marginTop: 12 }}>
              {next ? `Next: ${next.item.name.toLowerCase()} after ${next.at} study day${next.at === 1 ? "" : "s"}.` : `All ${DESK_ITEMS.length} items are on your shelf.`}{" "}
              A study day is a sitting of {STUDY_DAY_MIN_MINUTES} minutes or more that ends with a recap. Items stay yours for good, placed or not, and an empty desk is fine too.
            </p>
          </>
        )}
        <div className="actions">
          <button type="button" className="ghost" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// The small, calm note after a recap when something new unlocked. "Place it"
// places only one item (the newest); anything else waits on the shelf.
export function UnlockNote(props: { items: DeskItemId[]; onPlace: () => void; onLater: () => void }) {
  const names = props.items.map((id) => ITEM_BY_ID.get(id)?.name.toLowerCase() ?? id); // e.g. ["small plant"]
  const newest = names[names.length - 1]; // the one "Place it" puts on the desk
  const what = names.length === 1 ? `A ${names[0]} is` : `The ${names.slice(0, -1).join(", ")} and ${newest} are`; // plain sentence
  return (
    <div className="notes">
      <div className="note" role="status">
        <div>{what} now on your shelf. {names.length === 1 ? "Place it?" : `Place the ${newest}?`}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="sage small" onClick={props.onPlace}>Place it</button>
          <button className="ghost small" onClick={props.onLater}>Later</button>
        </div>
      </div>
    </div>
  );
}
