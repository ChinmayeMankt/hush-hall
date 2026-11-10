// Next.js config for the Hush Hall prototype.
import type { NextConfig } from "next"; // type for the config object

// Keep config minimal: no external services, no images from remote hosts.
const nextConfig: NextConfig = {
  reactStrictMode: true, // surface side-effect bugs early in dev
  devIndicators: false, // hide the dev badge so screenshots stay clean
};

export default nextConfig; // Next reads the default export
