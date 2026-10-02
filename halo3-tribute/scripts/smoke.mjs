import { chromium } from "playwright";

const url = process.env.RINGFALL_URL || "http://localhost:5173/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector("#start-btn");

// Title visible
const title = await page.locator("h1").innerText();
if (title.trim() !== "RINGFALL") throw new Error(`Bad title: ${title}`);

await page.click("#start-btn");
await page.waitForSelector("#hud:not(.hidden)");
await page.waitForTimeout(500);

const g1 = await page.evaluate(() => {
  const g = window.__RINGFALL__;
  return {
    running: g.running,
    alive: g.player.alive,
    shields: g.player.shields,
    protect: g.player.spawnProtect,
  };
});
console.log("after deploy", g1);
if (!g1.running || !g1.alive) throw new Error("Game did not start");

// Force death past spawn protect
await page.evaluate(() => {
  const g = window.__RINGFALL__;
  g.player.spawnProtect = 0;
  g.player.takeDamage(500, g.audio);
});
await page.waitForSelector("#end-screen:not(.hidden)", { timeout: 3000 });
const endTitle = await page.locator("#end-title").innerText();
console.log("end title", endTitle);
if (endTitle !== "KIA") throw new Error(`Expected KIA, got ${endTitle}`);

// Redeploy
await page.click("#restart-btn");
await page.waitForFunction(
  () => document.getElementById("end-screen").classList.contains("hidden"),
  { timeout: 3000 },
);
await page.waitForTimeout(300);
const g2 = await page.evaluate(() => {
  const g = window.__RINGFALL__;
  return {
    running: g.running,
    alive: g.player.alive,
    shields: g.player.shields,
    health: g.player.health,
    endHidden: document.getElementById("end-screen").classList.contains("hidden"),
  };
});
console.log("after redeploy", g2);
if (!g2.running || !g2.alive || g2.shields < 100 || !g2.endHidden) {
  throw new Error("Redeploy failed: " + JSON.stringify(g2));
}

// Pause / resume
await page.evaluate(() => {
  const g = window.__RINGFALL__;
  g.paused = true;
  document.getElementById("pause-screen").classList.remove("hidden");
});
await page.click("#pause-screen");
await page.waitForTimeout(200);
const g3 = await page.evaluate(() => {
  const g = window.__RINGFALL__;
  return {
    paused: g.paused,
    pauseHidden: document.getElementById("pause-screen").classList.contains("hidden"),
  };
});
console.log("after resume click", g3);
if (g3.paused || !g3.pauseHidden) throw new Error("Pause resume failed");

if (errors.length) {
  console.warn("page errors", errors);
  throw new Error("Page errors present");
}

console.log("SMOKE OK");
await browser.close();
