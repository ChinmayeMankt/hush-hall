// Root layout: warm paper background, serif headings, no external fonts or trackers.
import type { Metadata, Viewport } from "next";
import "./globals.css";
import ThemeMusic from "@/components/ThemeMusic";
import { Analytics } from "@vercel/analytics/react";

// Title and description for the browser tab.
export const metadata: Metadata = {
  title: "Hush Hall · a quiet virtual library",
  description: "Take a desk, write your topic, study quietly next to others.",
  icons: { apple: "/apple-touch-icon.png" },
};

// Browser/status-bar colour for installed use (matches the manifest).
export const viewport: Viewport = { themeColor: "#f6efe2" };

// Wrap every page in the same calm shell.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeMusic />
        <Analytics />
        {/* Thin header with the name only: no counters, no feeds */}
        <header className="topbar">
          <a href="/" className="brand">Hush Hall</a>
          <span className="tagline">a quiet virtual library</span>
        </header>
        {/* Page content */}
        <main>{children}</main>
      </body>
    </html>
  );
}
