/**
 * CLI wrapper around the Google Maps scraper (see ../scraper-api/scraper.mjs
 * for the core logic, which is shared with the standalone HTTP API used by
 * Make.com).
 *
 * Usage:
 *   node scripts/scrape-dentists.mjs "dentists in Austin, TX" --limit 60 --out dentists.csv
 *
 * To push straight into the CRM instead of (or in addition to) the CSV, add:
 *   --push-to-crm --crm-url https://your-crm.example.com --project Dentists
 * This calls the CRM's existing POST /api/companies and POST /api/contacts
 * routes (the same x-api-key-protected endpoints Make.com scenarios use), so
 * every scraped listing shows up as a company + contact automatically.
 * Requires CRM_API_KEY (and optionally CRM_URL) set in the environment —
 * see .env.local, or set CRM_API_KEY inline when running from Task Scheduler.
 *
 * Notes:
 * - Only public data is read (Google's own results panel + the business's
 *   own public website). No login, no paid API.
 * - Email discovery is best-effort: many listings simply have no public
 *   email, in which case the field is left blank.
 * - Respect Google Maps' Terms of Service and any site-specific robots
 *   rules for the websites you visit. Add delays / lower --limit if you
 *   are scraping at any real volume.
 */

import fs from "node:fs";
import path from "node:path";
import { scrapeGoogleMaps } from "../scraper-api/scraper.mjs";

function parseArgs(argv) {
  const args = {
    query: null,
    limit: 40,
    out: "dentists.csv",
    headless: true,
    pushToCrm: false,
    crmUrl: process.env.CRM_URL || null,
    project: null,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--headed") args.headless = false;
    else if (a === "--push-to-crm") args.pushToCrm = true;
    else if (a === "--crm-url") args.crmUrl = argv[++i];
    else if (a === "--project") args.project = argv[++i];
    else rest.push(a);
  }
  args.query = rest.join(" ");
  return args;
}

function toCsvRow(fields) {
  return fields
    .map((f) => {
      const s = (f ?? "").toString().replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    })
    .join(",");
}

async function crmFetch(crmUrl, apiKey, pathname, options = {}) {
  const res = await fetch(new URL(pathname, crmUrl), {
    ...options,
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, ...options.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${pathname} -> ${res.status}: ${body}`);
  }
  return res.json();
}

async function resolveProjectId(crmUrl, apiKey, projectName) {
  if (!projectName) return null;
  const projects = await crmFetch(crmUrl, apiKey, "/api/projects").catch(() => []);
  const existing = projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());
  if (existing) return existing.id;
  const created = await crmFetch(crmUrl, apiKey, "/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: projectName }),
  }).catch(() => null);
  return created?.id ?? null;
}

async function pushResultToCrm(crmUrl, apiKey, projectId, row) {
  const companies = await crmFetch(crmUrl, apiKey, "/api/companies").catch(() => []);
  let company = companies.find((c) => c.name.toLowerCase() === row.name.toLowerCase());
  if (!company) {
    company = await crmFetch(crmUrl, apiKey, "/api/companies", {
      method: "POST",
      body: JSON.stringify({
        name: row.name,
        website: row.website || null,
        industry: "Dentist",
        notes: row.address || null,
        project_id: projectId,
      }),
    });
  }

  // Skip creating a duplicate contact if this business was already scraped
  // in a previous run (matched by company, since Maps has no stable business ID
  // we store) — leaves any existing contact (owner, notes, call history) untouched.
  const contacts = await crmFetch(crmUrl, apiKey, "/api/contacts").catch(() => []);
  const existingContact = contacts.find((c) => c.company_id === company.id);
  if (existingContact) {
    return { ...existingContact, skipped: true };
  }

  return crmFetch(crmUrl, apiKey, "/api/contacts", {
    method: "POST",
    body: JSON.stringify({
      first_name: row.name,
      email: row.email || null,
      phone: row.phone || null,
      company_id: company.id,
      source: "google_maps_scrape",
    }),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error('Usage: node scripts/scrape-dentists.mjs "dentists in Austin, TX" --limit 60 --out dentists.csv');
    process.exit(1);
  }

  if (args.pushToCrm && (!args.crmUrl || !process.env.CRM_API_KEY)) {
    console.error("--push-to-crm requires --crm-url (or CRM_URL env) and CRM_API_KEY set in the environment.");
    process.exit(1);
  }

  console.log(`Scraping Google Maps for: "${args.query}" (limit ${args.limit})`);
  const results = await scrapeGoogleMaps({
    ...args,
    onProgress: (row, i, total) => {
      if (row) console.log(`[${i}/${total}] ${row.name} — ${row.phone ?? "no phone"} — ${row.email ?? "no email"}`);
    },
  });

  const header = ["name", "phone", "website", "email", "address", "rating", "mapsUrl"];
  const lines = [toCsvRow(header)];
  for (const r of results) {
    lines.push(toCsvRow(header.map((h) => r[h])));
  }

  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\nSaved ${results.length} listings to ${outPath}`);

  if (args.pushToCrm) {
    console.log(`\nPushing ${results.length} listings into the CRM at ${args.crmUrl} ...`);
    const projectId = await resolveProjectId(args.crmUrl, process.env.CRM_API_KEY, args.project);
    let created = 0;
    let skipped = 0;
    for (const row of results) {
      try {
        const result = await pushResultToCrm(args.crmUrl, process.env.CRM_API_KEY, projectId, row);
        if (result.skipped) skipped++;
        else created++;
      } catch (err) {
        console.warn(`Failed to push "${row.name}": ${err.message}`);
      }
    }
    console.log(`Pushed ${created} new contact(s), skipped ${skipped} already in the CRM (out of ${results.length} listings).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
