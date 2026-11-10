// Root layout: warm paper background, serif headings, no external fonts or trackers.
import type { Metadata } from "next"; // page metadata type
import "./globals.css"; // all styling lives in one calm stylesheet

// Title and description for the browser tab.
export const metadata: Metadata = {
  title: "Hush Hall · a quiet virtual library", // tab title
  description: "Take a desk, write your topic, study quietly next to others.", // short description
};

// Wrap every page in the same calm shell.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
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
