// Measures how fast the 3D hall loads in a production build (next start).
// Network is throttled to a fixed "good home broadband" profile so the
// numbers compare before/after changes; frame rate uses software WebGL, so
// it is only useful as a relative number on the same machine.
// Usage: `next build && next start -p 3124`, then `BASE_URL=http://localhost:3124 node scripts/perf3d.mjs`.

import { chromium } from "playwright-core"; // browser driver

const BASE = process.env.BASE_URL ?? "http://localhost:3124"; // production server
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome"; // system Chrome
const MBPS = Number(process.env.MBPS ?? 40); // throttled download speed in megabits/s

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }); // CPU WebGL
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); // fresh cache
const page = await ctx.newPage(); // one tab
const cdp = await ctx.newCDPSession(page); // DevTools protocol for throttling
await cdp.send("Network.enable"); // needed for throttling
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 30, downloadThroughput: (MBPS * 1e6) / 8, uploadThroughput: (10 * 1e6) / 8 }); // fixed profile

await page.goto(`${BASE}/`); // lobby
await page.fill("#name", "Perf"); // nickname
await page.locator(".avatar-pick").nth(0).click(); // avatar
const t0 = Date.now(); // wall clock start of the hall load
await page.goto(`${BASE}/hall/main-reading?view=3d`); // hall, 3D
await page.waitForSelector(".hall3d canvas", { timeout: 60000 }); // canvas mounted
const canvasMs = Date.now() - t0; // time to first 3D canvas
// Wait until VRM downloads stop arriving (no new .vrm entries for 3 s).
let last = -1, stableSince = Date.now(); // change tracking
while (Date.now() - stableSince < 3000 && Date.now() - t0 < 180000) {
  const n = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes(".vrm") && e.responseEnd > 0).length); // finished VRMs
  if (n !== last) { last = n; stableSince = Date.now(); } // still changing
  await page.waitForTimeout(250); // poll
}
const res = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => ({ name: e.name, type: e.initiatorType, size: e.transferSize, body: e.decodedBodySize, end: e.responseEnd }))); // all resources
const vrm = res.filter((r) => r.name.includes(".vrm")); // models
const js = res.filter((r) => r.name.endsWith(".js")); // scripts
await page.waitForTimeout(3000); // let models be instantiated and shaders compiled
const fps = await page.evaluate(() => new Promise((ok) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 5000) requestAnimationFrame(f); else ok(n / ((performance.now() - s) / 1000)); }; requestAnimationFrame(f); })); // frames per second over 5 s
console.log(JSON.stringify({
  throttleMbps: MBPS, // network profile
  canvasMs, // navigation -> canvas in DOM
  vrmFiles: vrm.length, // models downloaded
  vrmTransferKB: Math.round(vrm.reduce((a, r) => a + r.size, 0) / 1024), // bytes over the wire
  vrmDecodedKB: Math.round(vrm.reduce((a, r) => a + r.body, 0) / 1024), // bytes after decompression
  lastVrmDoneMs: Math.round(Math.max(0, ...vrm.map((r) => r.end))), // page start -> last model finished
  jsTransferKB: Math.round(js.reduce((a, r) => a + r.size, 0) / 1024), // scripts over the wire
  fpsSoftwareGL: Math.round(fps * 10) / 10, // relative only (no GPU)
}, null, 1)); // report
await browser.close(); // done
