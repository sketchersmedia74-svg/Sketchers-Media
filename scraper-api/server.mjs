/**
 * Standalone HTTP API around the Google Maps scraper, so it can be triggered
 * from Make.com's "HTTP > Make a request" module instead of running from the
 * command line by hand.
 *
 * Make.com can't run a headless browser itself, so this server still has to
 * run somewhere with Node + Playwright (this machine, a small VPS, etc.) —
 * Make.com just calls it over HTTP. If Make.com is calling out to your own
 * machine, you need it reachable from the internet (e.g. an ngrok/Cloudflare
 * tunnel) whenever the scenario runs.
 *
 * Endpoints:
 *   GET  /health                       -> { ok: true }
 *   POST /scrape                       -> runs a scrape and returns JSON results
 *     Headers: x-api-key: <SCRAPER_API_KEY>
 *     Body:    { "query": "dentists in Austin, TX", "limit": 40 }
 *               "query" is OPTIONAL — omit it and the server pulls the next
 *               location from locations.json in round-robin order, so a
 *               scheduled Make.com scenario that always sends the same
 *               (empty-query) request body still searches a new city each
 *               time. Edit locations.json to change the rotation list.
 *     Response: { "query": "...", "count": 12, "results": [ {name, phone, website, email, address, rating, mapsUrl}, ... ] }
 *
 * Point Make.com's HTTP module at POST https://<your-tunnel-or-host>/scrape
 * with header x-api-key set to SCRAPER_API_KEY, then feed the returned
 * `results` array into an Iterator module to fan it out to your CRM
 * (POST /api/companies + /api/contacts), a Google Sheet, Slack, etc.
 */

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrapeGoogleMaps } from "./scraper.mjs";
import { filterAndMarkSeen } from "./seenStore.mjs";
import { nextLocation, loadLocations } from "./locationRotation.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
// Simple browser dashboard (public/index.html) for running scrapes without
// curl/Postman/Make.com — it calls the same /scrape, /locations, /health
// endpoints below, just from a page instead of a script.
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 4100;
const API_KEY = process.env.SCRAPER_API_KEY;

if (!API_KEY) {
  console.error("SCRAPER_API_KEY is not set. Refusing to start without an API key configured.");
  process.exit(1);
}

function checkApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing x-api-key" });
  }
  next();
}

app.get("/health", (req, res) => res.json({ ok: true }));

// Simple in-memory guard so Make.com can't accidentally fire off overlapping
// scrapes (each run opens a real browser and can take minutes).
let scrapeInFlight = false;

// GET /locations -> current rotation list
app.get("/locations", checkApiKey, (req, res) => res.json({ locations: loadLocations() }));

app.post("/scrape", checkApiKey, async (req, res) => {
  const { limit, onlyNew = true } = req.body || {};
  let { query } = req.body || {};

  let usedRotation = false;
  if (!query) {
    query = nextLocation();
    usedRotation = true;
    if (!query) {
      return res.status(400).json({
        error:
          "No 'query' provided and locations.json is empty — either pass a query in the request body or add entries to locations.json.",
      });
    }
  }

  if (scrapeInFlight) {
    return res.status(429).json({ error: "A scrape is already running — try again shortly." });
  }

  scrapeInFlight = true;
  try {
    const results = await scrapeGoogleMaps({
      query,
      limit: Number.isFinite(limit) ? limit : 40,
      headless: true,
      onProgress: (row, i, total) => {
        if (row) console.log(`[${i}/${total}] ${row.name} — ${row.phone ?? "no phone"} — ${row.email ?? "no email"}`);
      },
    });

    // By default, skip businesses this endpoint has already returned on a
    // previous call (tracked in seen.json) so a repeated scheduled query
    // doesn't keep re-feeding Make.com the same listings. Pass
    // "onlyNew": false in the request body to get the full list back instead.
    if (onlyNew) {
      const { newResults, alreadySeenCount } = filterAndMarkSeen(results);
      return res.json({
        query,
        usedRotation,
        totalFound: results.length,
        alreadySeenCount,
        count: newResults.length,
        results: newResults,
      });
    }

    res.json({ query, usedRotation, count: results.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    scrapeInFlight = false;
  }
});

app.listen(PORT, () => {
  console.log(`Scraper API listening on http://localhost:${PORT}`);
});
