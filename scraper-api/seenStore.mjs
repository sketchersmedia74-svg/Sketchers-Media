/**
 * Tiny persisted "have we scraped this business before" store, so repeated
 * /scrape calls (e.g. Make.com hitting the same query on a schedule) only
 * return newly-seen listings instead of the same businesses every time.
 *
 * Keyed by the listing's Google Maps place URL with the query string
 * stripped off (the path itself is stable for a given business across
 * searches; only the trailing ?authuser=...&hl=...&rclk=1 params vary).
 *
 * Backed by a flat JSON file next to this module — fine at this volume
 * (hundreds/thousands of businesses), no need for a real database.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STORE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "seen.json");

function load() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function save(set) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(Array.from(set)), "utf8");
}

export function keyFor(row) {
  return (row.mapsUrl || "").split("?")[0];
}

/**
 * Splits results into { newResults, alreadySeenCount } and persists every
 * key (new and old) as seen, so the next call skips them too.
 */
export function filterAndMarkSeen(results) {
  const seen = load();
  const newResults = [];
  let alreadySeenCount = 0;

  for (const row of results) {
    const key = keyFor(row);
    if (key && seen.has(key)) {
      alreadySeenCount++;
    } else {
      newResults.push(row);
    }
    if (key) seen.add(key);
  }

  save(seen);
  return { newResults, alreadySeenCount };
}
