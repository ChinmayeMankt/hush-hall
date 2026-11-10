// Headless walkthrough of the prototype that saves PNG screenshots.
// Two tabs in one browser context = two students sharing a BroadcastChannel.
// Usage: dev server on :3123, then `node scripts/screenshots.mjs`.

import { chromium } from "playwright-core"; // browser driver (no bundled browser download)

const BASE = process.env.BASE_URL ?? "http://localhost:3123"; // dev server
const OUT = new URL("../../screenshots/", import.meta.url).pathname; // /workspace/hush-hall/screenshots/
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome"; // system Chrome on the box

const browser = await chromium.launch({ executablePath: CHROME, headless: true }); // start Chrome
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); // shared context
const shot = (p, name) => p.screenshot({ path: `${OUT}${name}`, fullPage: false }); // helper

// Walk a tab through the lobby with a given name and avatar, then into a hall.
async function enter(page, name, avatarIdx) {
  await page.goto(`${BASE}/`); // lobby
  await page.fill("#name", name); // write the name on the library card
  await page.locator(".avatar-pick").nth(avatarIdx).click(); // choose an avatar
}

// Sit at a desk with a topic.
async function sit(page, seat, topic) {
  await page.getByRole("button", { name: `Desk ${seat}, vacant` }).click(); // tap the vacant desk
  await page.fill("#topic", topic); // write the topic
  await page.getByRole("button", { name: "Sit down & start" }).click(); // start the ritual
}

// Tab A = Chinmaye.
const a = await ctx.newPage(); // first tab
await enter(a, "Chinmaye", 0); // owl avatar
await shot(a, "00-lobby.png"); // lobby screenshot
await a.goto(`${BASE}/hall/main-reading?view=2d`); // walk in
await a.waitForSelector(".desk"); // desks rendered

// Tab B = a second (local) student.
const b = await ctx.newPage(); // second tab
await enter(b, "Riya", 2); // leaf avatar
await b.goto(`${BASE}/hall/main-reading?view=2d`); // same hall
await b.waitForSelector(".desk"); // desks rendered
await sit(b, "C4", "Plant tissue culture notes"); // B sits
await a.waitForSelector('[aria-label^="Desk C4, Riya"]', { timeout: 10000 }); // A sees B live
await shot(a, "01-hall-view.png"); // hall view (standing, sees others)

// A sits and the focus timer starts.
await sit(a, "B3", "Bioprocess: fermentation kinetics"); // A sits
await a.waitForTimeout(2200); // let the clock tick a couple of seconds
await shot(a, "02-seated-timer.png"); // seated + timer view

// A takes a break: the gentle break card appears.
await a.getByRole("button", { name: "Take a break" }).click(); // early break
await a.waitForTimeout(800); // settle
await shot(a, "03-break.png"); // break screen
await a.getByRole("button", { name: "Hide this" }).click(); // dismiss the break card

// B takes a break too (requests are only allowed outside focus), then asks A.
await b.getByRole("button", { name: "Take a break" }).click(); // B on break
await b.getByRole("button", { name: "Hide this" }).click(); // dismiss
await b.waitForSelector('[aria-label^="Desk B3, Chinmaye"]', { timeout: 10000 }); // B sees A's desk
await b.locator('[aria-label^="Desk B3, Chinmaye"]').click(); // open A's desk card
await b.fill("#note", "Also revising bioprocess, sync breaks?"); // short note
await shot(b, "03b-desk-card.png"); // desk card: nickname, avatar, topic only
await b.getByRole("button", { name: "Send request" }).click(); // send

// A receives the quiet note and accepts.
await a.waitForSelector(".note", { timeout: 10000 }); // note arrives
await shot(a, "04-join-request.png"); // incoming request
await a.getByRole("button", { name: "Accept" }).click(); // accept
await b.waitForSelector(".room-banner", { timeout: 10000 }); // B sees the room
await shot(b, "05-request-accepted.png"); // B's view after acceptance

// A stands up and sees the recap.
await a.getByRole("button", { name: "Stand up" }).click(); // stand up
await a.waitForSelector("#recap"); // recap dialog
await a.fill("#recap", "Revised Monod kinetics, 6 problems"); // one-line recap
await shot(a, "06-recap.png"); // recap screen
await a.getByRole("button", { name: "Save & stand up" }).click(); // save

await browser.close(); // done
console.log("screenshots saved to", OUT); // report
