"use client"; // remembers a pasted URL in this browser

// A small collapsible Spotify player for the desk. Paste an official Spotify
// playlist, album or track link; it plays in Spotify's own embed. No sign-in.

import { useMemo, useState } from "react"; // local state
import { loadSpotifyUrl, saveSpotifyUrl, spotifyEmbedSrc } from "@/lib/spotify"; // parse + remember

export function SpotifyPlayer() {
  const [open, setOpen] = useState(false); // collapsed by default
  const [url, setUrl] = useState(loadSpotifyUrl); // last pasted link
  const [draft, setDraft] = useState(loadSpotifyUrl); // the input while editing
  const embed = useMemo(() => spotifyEmbedSrc(url), [url]); // official embed, or null

  const apply = () => { // remember and show
    const next = draft.trim(); // what they pasted
    setUrl(next); saveSpotifyUrl(next); // keep in this browser
    if (next) setOpen(true); // open the player once a link is set
  };
  const clear = () => { // forget the link
    setDraft(""); setUrl(""); saveSpotifyUrl(""); // empty
  };

  return (
    <div className="spotify-desk">
      <button type="button" className="ghost small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide music" : url ? "Music" : "Add music"}
      </button>
      {open && (
        <div className="spotify-body">
          <label htmlFor="spotify-url" className="small muted">Spotify playlist, album or track link</label>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <input id="spotify-url" type="url" placeholder="https://open.spotify.com/playlist/…" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
            <button type="button" className="sage small" onClick={apply}>Use link</button>
            {url && <button type="button" className="ghost small" onClick={clear}>Clear</button>}
          </div>
          {draft && !spotifyEmbedSrc(draft) && <p className="small muted">Use a link from open.spotify.com (playlist, album or track).</p>}
          {embed && (
            <iframe
              title="Spotify player"
              src={embed}
              width="100%"
              height="80"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              style={{ border: 0, borderRadius: 8, marginTop: 8, display: "block" }}
            />
          )}
        </div>
      )}
    </div>
  );
}
