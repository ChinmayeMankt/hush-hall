// Web App Manifest (served at /manifest.webmanifest). Makes the site
// installable and gives the Android app (a Trusted Web Activity) its name,
// colours and icons. Colours match the existing warm-paper look.
import type { MetadataRoute } from "next"; // manifest type

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", // stable app identity
    name: "Hush Hall", // full name
    short_name: "Hush Hall", // under the home-screen icon
    description: "A quiet virtual library: take a desk, write your topic, study next to others.", // store-style blurb
    start_url: "/", // the lobby (signed-in people go on to their hall from there)
    scope: "/", // the whole site belongs to the app
    display: "standalone", // no browser bar when installed
    orientation: "any", // the hall works upright and sideways
    background_color: "#f6efe2", // paper (splash background)
    theme_color: "#f6efe2", // paper, same as the header (status bar blends in)
    categories: ["education", "productivity"], // where it fits
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, // regular icon
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }, // large icon
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }, // full-bleed for Android masks
    ],
  };
}
