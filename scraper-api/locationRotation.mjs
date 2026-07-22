/**
 * Round-robins through a list of search queries (locations.json) so a
 * scheduled caller (Make.com) that hits /scrape without a "query" gets a
 * different location each time instead of repeating the same one.
 *
 * The current position is persisted in rotationState.json so it survives
 * server restarts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCATIONS_PATH = path.join(DIR, "locations.json");
const STATE_PATH = path.join(DIR, "rotationState.json");

export function loadLocations() {
  try {
    const list = JSON.parse(fs.readFileSync(LOCATIONS_PATH, "utf8"));
    if (!Array.isArray(list) || list.length === 0) throw new Error("empty");
    return list;
  } catch {
    return [];
  }
}

function loadIndex() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")).index ?? 0;
  } catch {
    return 0;
  }
}

function saveIndex(index) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ index }), "utf8");
}

/** Returns the next query in the rotation and advances the persisted pointer. */
export function nextLocation() {
  const locations = loadLocations();
  if (locations.length === 0) return null;

  const index = loadIndex() % locations.length;
  const query = locations[index];
  saveIndex((index + 1) % locations.length);
  return query;
}
