# Dentist Scraper API

Standalone Google Maps scraper exposed as an HTTP API, so Make.com can trigger it directly instead of you running a script by hand.

This is **separate from the CRM app** — it has its own `package.json` and runs as its own process.

## Run it

```
cd scraper-api
npm install
npx playwright install chromium   # only needed once
$env:SCRAPER_API_KEY="pick-a-long-random-string"
npm start
```

Server listens on `http://localhost:4100` (override with `PORT`).

## Endpoints

- `GET /health` — no auth, just confirms the server is up.
- `POST /scrape` — runs a scrape and returns the results as JSON.
  - Header: `x-api-key: <SCRAPER_API_KEY>`
  - Body: `{ "query": "dentists in Austin, TX", "limit": 40 }`
  - Response: `{ "query": "...", "count": 12, "results": [{ name, phone, website, email, address, rating, mapsUrl }, ...] }`

A scrape can take a minute or more depending on `limit` — Make.com's HTTP module should be given a generous timeout (2–5 min).

## Wiring it into Make.com

Make.com has no way to run a headless browser, so this server still has to run somewhere real (this PC, a small VPS, a container host, etc.) — Make.com just calls it over HTTP.

1. **Expose this server to the internet.** If running on your own machine, use a tunnel like `ngrok http 4100` or a Cloudflare Tunnel — copy the `https://...` URL it gives you. (If you ever deploy this to a VPS/cloud box instead, use that box's URL and skip the tunnel.)
2. **In Make.com**, add an **HTTP > Make a request** module:
   - URL: `https://<your-tunnel-url>/scrape`
   - Method: `POST`
   - Headers: `x-api-key: <SCRAPER_API_KEY>`, `Content-Type: application/json`
   - Body: `{"query": "dentists in Austin, TX", "limit": 40}`
3. Add a **Schedule** trigger on the scenario for however often you want it to run.
4. Parse the response, then add an **Iterator** module over `results` to fan each listing out to whatever comes next — for example a second HTTP module calling the CRM's own `/api/companies` + `/api/contacts` endpoints (see the main repo's `.env.local` for `CRM_API_KEY`), or a Google Sheets / Slack module.

### Note on the tunnel

If you run this on your own PC, the tunnel URL changes every time you restart `ngrok` (unless you pay for a reserved domain), so you'd need to update the Make.com module's URL each time. For a "set it and forget it" automation, moving this server to a small always-on VPS (DigitalOcean, Railway, Fly.io, etc.) with a fixed URL is the more durable option — happy to help with that deploy when you're ready.
