// Headless walkthrough of the 3D hall that saves 3d-*.png screenshots.
// Uses software WebGL (SwiftShader via ANGLE) so it runs on a server without a GPU.
// Usage: dev server on :3123, then `node scripts/screenshots3d.mjs`.

import { chromium } from "playwright-core"; // browser driver

const BASE = process.env.BASE_URL ?? "http://localhost:3123"; // dev server
const OUT = new URL("../../screenshots/", import.meta.url).pathname; // screenshots folder
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome"; // system Chrome
const ONLY = process.env.ONLY ?? ""; // optional: run only the overview shot while iterating

// Software GL flags for headless Chrome.
const browser = await chromium.launch({
  executablePath: CHROME, // system Chrome
  headless: true, // no window
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"], // CPU WebGL
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); // shared context = shared BroadcastChannel
const shot = (p, name) => p.screenshot({ path: `${OUT}${name}` }); // helper
const settle = (p, ms = 4500) => p.waitForTimeout(ms); // let the slow camera ease finish

// Lobby -> name + avatar -> hall in 3D view.
async function enter(page, name, avatarIdx) {
  await page.goto(`${BASE}/`); // lobby
  await page.fill("#name", name); // nickname
  await page.locator(".avatar-pick").nth(avatarIdx).click(); // avatar
  await page.goto(`${BASE}/hall/main-reading?view=3d`); // hall, 3D
  await page.waitForSelector(".hall3d canvas", { timeout: 30000 }); // canvas mounted
  await page.waitForFunction(() => typeof window.__hhProject === "function", null, { timeout: 30000 }); // scene ready
}

// Screen position of a desk (dev-only hook in Hall3D).
const deskXY = (p, seat) => p.evaluate((s) => window.__hhProject(s), seat); // {x,y}

// Click a desk in 3D, write a topic and sit.
async function sit(page, seat, topic) {
  await page.bringToFront(); // background tabs pause rendering; bring this one forward
  await page.waitForTimeout(800); // let a few frames render
  const pt = await deskXY(page, seat); // where the desk is on screen
  await page.mouse.click(pt.x, pt.y); // click it
  try { await page.waitForSelector("#topic", { timeout: 8000 }); } // sit dialog should open
  catch (e) { await page.screenshot({ path: "/tmp/fail.png" }); console.log("sit failed at", seat, pt, await page.evaluate(() => document.querySelector(".dialog")?.innerText ?? "no dialog")); throw e; } // debug aid
  await page.fill("#topic", topic); // topic
  await page.getByRole("button", { name: "Sit down & start" }).click(); // sit
}

// Second student sits first so the hall has a real (non-demo) person.
const b = await ctx.newPage(); // tab B
await enter(b, "Riya", 2); // leaf avatar
await sit(b, "C4", "Plant tissue culture notes"); // B sits

// Tab A = Chinmaye, standing: overview.
const a = await ctx.newPage(); // tab A
await enter(a, "Chinmaye", 0); // owl avatar
await a.waitForSelector(".tag3d", { timeout: 15000 }); // tags rendered
await settle(a, 2500); // let tags settle
await shot(a, "3d-overview.png"); // overview
if (ONLY === "overview") { await browser.close(); process.exit(0); } // quick iteration mode

// Hover a real occupied desk (B1 = demo student Meera).
let pt = await deskXY(a, "B1"); // desk position
await a.mouse.move(pt.x, pt.y); // hover
await a.waitForSelector(".card-preview", { timeout: 5000 }); // preview card appears
await settle(a, 800); // settle
await shot(a, "3d-desk-hover.png"); // hover screenshot
await a.mouse.click(pt.x, pt.y); // click opens the existing desk card
await a.waitForSelector(".dialog", { timeout: 5000 }); // card open
await shot(a, "3d-desk-card.png"); // desk card (nickname, avatar, topic only)
await a.getByRole("button", { name: "Close" }).click(); // close it

// B takes a break: break pose visible from A's overview.
await b.getByRole("button", { name: "Break", exact: true }).click(); // B on break
await a.bringToFront(); // back to A so it renders
await settle(a, 3500); // pose eases in
await shot(a, "3d-break-pose.png"); // overview with stretching students

// A sits: slow camera move to first-person with the minimal timer HUD.
await a.mouse.move(5, 5); // move pointer away from desks
await sit(a, "D4", "Bioprocess: fermentation kinetics"); // A sits facing C row
await settle(a, 6000); // camera glide finishes
await shot(a, "3d-first-person.png"); // seated + timer

// A takes a break in first-person: compact break card, room stays visible.
await a.getByRole("button", { name: "Break", exact: true }).click(); // A on break
await settle(a, 1500); // settle
await shot(a, "3d-first-person-break.png"); // break in first-person

// Close-up of neighbours' faces (dev-only ?cam= preview camera) from a third tab.
const c = await ctx.newPage(); // tab C, just watching
await c.goto(`${BASE}/hall/main-reading?view=3d&cam=1.0,1.7,3.1,2.2,1.2,0.4`); // camera over row D looking at row C
await c.waitForSelector(".hall3d canvas", { timeout: 30000 }); // mounted
await settle(c, 7000); // camera settles
await shot(c, "3d-avatars-closeup.png"); // faces close-up

// Overview zoomed in with the + button (faces readable at overview distance).
await a.bringToFront(); // back to A
await a.getByRole("button", { name: "Stand up" }).click(); // stand up
await a.getByRole("button", { name: "Save & stand up" }).click(); // save recap, camera glides back
await a.getByRole("button", { name: "Zoom in" }).click(); // zoom
await a.getByRole("button", { name: "Zoom in" }).click(); // zoom more
await a.getByRole("button", { name: "Zoom in" }).click(); // closest
await a.mouse.move(5, 5); // pointer away
await settle(a, 7000); // glide
await shot(a, "3d-overview-zoomed.png"); // zoomed overview

await browser.close(); // done
console.log("3D screenshots saved to", OUT); // report
