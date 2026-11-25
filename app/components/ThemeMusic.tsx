"use client";

import { useEffect } from "react";
import { startAmbient } from "@/lib/ambient";

// Starts the default playlist as soon as the app shell loads.
// Playback waits for the first click, tap or key if the browser blocks autoplay.
export default function ThemeMusic() {
  useEffect(() => {
    startAmbient("music"); // All tracks in order; HallView can change this later
    // Do not stop on unmount: the playlist should keep going across pages and Strict Mode remounts.
  }, []);

  return null;
}
