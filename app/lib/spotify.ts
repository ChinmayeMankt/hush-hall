// Paste a Spotify playlist, album or track URL and turn it into the official embed.
// The URL is kept in this browser only (no account, no keys, no OAuth).

const LOCAL_KEY = "hh.spotifyUrl"; // where the pasted URL is remembered
const ALLOWED = new Set(["playlist", "album", "track", "episode", "show"]); // official embed types

// Read the last pasted Spotify URL (empty if none).
export function loadSpotifyUrl(): string {
  if (typeof localStorage === "undefined") return ""; // server render
  return localStorage.getItem(LOCAL_KEY) ?? ""; // as typed
}

// Remember a pasted URL (or clear it with an empty string).
export function saveSpotifyUrl(url: string) {
  if (typeof localStorage === "undefined") return; // server
  const s = url.trim(); // ignore surrounding spaces
  if (s) localStorage.setItem(LOCAL_KEY, s); // keep what they pasted
  else localStorage.removeItem(LOCAL_KEY); // cleared
}

// Official embed src for a pasted open.spotify.com link or a spotify: URI, or null if not recognised.
export function spotifyEmbedSrc(raw: string): string | null {
  const s = raw.trim(); // ignore spaces
  if (!s) return null; // nothing pasted
  const uri = /^spotify:(playlist|album|track|episode|show):([A-Za-z0-9]+)$/.exec(s); // native URI
  if (uri) return `https://open.spotify.com/embed/${uri[1]}/${uri[2]}`; // official embed
  try {
    const u = new URL(s); // throws if not a URL
    if (u.protocol !== "http:" && u.protocol !== "https:") return null; // no other schemes
    const host = u.hostname.replace(/^www\./, ""); // drop www
    if (host !== "open.spotify.com" && host !== "play.spotify.com") return null; // official hosts only
    const parts = u.pathname.split("/").filter(Boolean); // path segments
    const intl = parts[0]?.startsWith("intl-"); // e.g. /intl-en/playlist/id
    const type = intl ? parts[1] : parts[0]; // playlist / album / track / …
    const id = (intl ? parts[2] : parts[1])?.split("?")[0] ?? ""; // the id, no query
    if (!type || !ALLOWED.has(type) || !/^[A-Za-z0-9]+$/.test(id)) return null; // unknown shape
    return `https://open.spotify.com/embed/${type}/${id}`; // official embed only (never the raw URL)
  } catch {
    return null; // not a URL
  }
}
