"use client";

import { useEffect } from "react";
import { startAmbient, stopAmbient } from "@/lib/ambient";

export default function ThemeMusic() {
  useEffect(() => {
    startAmbient("music");
    return () => stopAmbient();
  }, []);

  return null;
}