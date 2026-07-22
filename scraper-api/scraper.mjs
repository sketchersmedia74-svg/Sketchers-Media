/**
 * Core Google Maps scraping logic (Playwright-based): drive Chromium against
 * maps.google.com, scroll the results panel, open each listing, read the
 * side panel fields, then visit the business website to look for a public
 * contact email. Used by both server.mjs (the HTTP API) and the CLI script
 * in ../scripts/scrape-dentists.mjs.
 *
 * Only public data is read (Google's own results panel + the business's own
 * public website). No login, no paid API. Email discovery is best-effort —
 * many listings simply have no public email, in which case it's left blank.
 */

import { chromium } from "playwright";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IGNORE_EMAIL_PATTERN =
  /\.(png|jpg|jpeg|gif|svg|webp)$|@(example|domain|email|address|yourdomain|sentry|wixpress|godaddy)\.|^(no-?reply|donotreply|test|user|name|email)@/i;

async function findEmailOnWebsite(context, url) {
  if (!url) return null;
  const page = await context.newPage();
  try {
    const candidates = [url, new URL("/contact", url).href, new URL("/contact-us", url).href];
    for (const target of candidates) {
      try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15000 });
      } catch {
        continue;
      }
      const mailto = await page
        .locator('a[href^="mailto:"]')
        .first()
        .getAttribute("href")
        .catch(() => null);
      if (mailto) {
        // Some sites have malformed mailto: hrefs (e.g. "mailto:http://user@host") —
        // re-extract just the valid email portion rather than trusting the raw string.
        const decoded = decodeURIComponent(mailto.replace(/^mailto:/, "").split("?")[0]);
        const valid = decoded.match(EMAIL_RE)?.[0];
        if (valid && !IGNORE_EMAIL_PATTERN.test(valid)) return valid;
      }
      const html = await page.content();
      const matches = html.match(EMAIL_RE);
      if (matches) {
        const found = matches.find((m) => !IGNORE_EMAIL_PATTERN.test(m));
        if (found) return found;
      }
    }
  } catch {
    // ignore — no email found
  } finally {
    await page.close();
  }
  return null;
}

export async function scrapeGoogleMaps({ query, limit = 40, headless = true, onProgress }) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(20000);
  const page = await context.newPage();

  try {
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
    });

    // Dismiss EU/US cookie-consent interstitial if it appears.
    for (const label of [/Accept all/i, /I agree/i, /Reject all/i]) {
      const btn = page.getByRole("button", { name: label }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        break;
      }
    }

    const feedSelector = 'div[role="feed"]';
    await page.waitForSelector(feedSelector, { timeout: 30000 });

    // Scroll the results feed until we have enough listings or it stops growing.
    let listingHrefs = new Set();
    let stagnantRounds = 0;
    while (listingHrefs.size < limit && stagnantRounds < 6) {
      const hrefs = await page.$$eval('div[role="feed"] a[href*="/maps/place/"]', (as) =>
        as.map((a) => a.href)
      );
      const before = listingHrefs.size;
      hrefs.forEach((h) => listingHrefs.add(h));
      if (listingHrefs.size === before) stagnantRounds++;
      else stagnantRounds = 0;

      await page.evaluate((sel) => {
        const feed = document.querySelector(sel);
        if (feed) feed.scrollTop = feed.scrollHeight;
      }, feedSelector);
      await page.waitForTimeout(1200);
    }

    const results = [];
    const hrefs = Array.from(listingHrefs).slice(0, limit);

    for (const href of hrefs) {
      try {
        await page.goto(href, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(800);

        const name = await page.locator("h1").first().innerText().catch(() => "");

        const website = await page
          .locator('a[data-item-id="authority"]')
          .first()
          .getAttribute("href")
          .catch(() => null);

        const phone = await page
          .locator('button[data-item-id^="phone:tel:"]')
          .first()
          .getAttribute("data-item-id")
          .then((v) => (v ? v.replace("phone:tel:", "") : null))
          .catch(() => null);

        const address = await page
          .locator('button[data-item-id="address"]')
          .first()
          .innerText()
          .then((v) => v.replace(/\s*\n\s*/g, " ").replace(/^[^a-zA-Z0-9]+/, "").trim())
          .catch(() => "");

        const rating = await page
          .locator('div[role="img"][aria-label*="stars"]')
          .first()
          .getAttribute("aria-label")
          .catch(() => null);

        let email = null;
        if (website) {
          email = await findEmailOnWebsite(context, website);
        }

        const row = { name, phone, website, email, address, rating, mapsUrl: href };
        results.push(row);
        onProgress?.(row, results.length, hrefs.length);
      } catch (err) {
        onProgress?.(null, results.length, hrefs.length, err);
      }
    }

    return results;
  } finally {
    await browser.close();
  }
}
