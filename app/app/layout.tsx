// Root layout: warm paper background, serif headings, no external fonts or trackers.
import type { Metadata, Viewport } from "next"; // page metadata + viewport types
import "./globals.css"; // all styling lives in one calm stylesheet
import ThemeMusic from "@/components/ThemeMusic";

// Title and description for the browser tab.
export const metadata: Metadata = {
  title: "Hush Hall · a quiet virtual library", // tab title
  description: "Take a desk, write your topic, study quietly next to others.", // short description
  icons: { apple: "/apple-touch-icon.png" }, // home-screen icon on iPhone/iPad (the favicon stays app/icon.svg)
};

// Browser/status-bar colour for installed use (matches the manifest).
export const viewport: Viewport = { themeColor: "#f6efe2" }; // paper, same as the header

// Wrap every page in the same calm shell.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeMusic />
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
