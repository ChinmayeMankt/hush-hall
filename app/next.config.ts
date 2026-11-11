// Next.js config for the Hush Hall prototype.
import type { NextConfig } from "next"; // type for the config object

// Keep config minimal: no external services, no images from remote hosts.
const nextConfig: NextConfig = {
  reactStrictMode: true, // surface side-effect bugs early in dev
  devIndicators: false, // hide the dev badge so screenshots stay clean
  // Character models: a glTF content type lets the server gzip them (lossless,
  // about 45% smaller on the wire), and a day of browser caching (then a quiet
  // background revalidate for a week) means return visits skip the download.
  async headers() {
    return [
      {
        source: "/models/:path*", // only VRM files (glTF binary) live here
        headers: [
          { key: "Content-Type", value: "model/gltf-binary" }, // compressible type (octet-stream is never gzipped)
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }, // cache 1 day, refresh in the background
        ],
      },
    ];
  },
};

export default nextConfig; // Next reads the default export
