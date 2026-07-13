# Sketchers Media CRM — Desktop Shell

A thin Electron wrapper that opens the deployed CRM
(https://sketchers-media.vercel.app) in its own native window — no browser
tabs/URL bar, its own taskbar/dock icon. It does not run any of the Next.js
app itself; it just points a window at the live site, so it always reflects
whatever is currently deployed on Vercel and needs an internet connection to
work (same as using the site in a browser).

## Run it locally (dev)

```
cd electron
npm install
npm start
```

## Build an installer

```
cd electron
npm install
npm run dist
```

Output lands in `electron/dist/`:
- Windows: an NSIS installer (`.exe`)
- macOS: a `.dmg`
- Linux: an `.AppImage`

You can only build for the OS you're currently on (e.g. build the `.exe` from
Windows, the `.dmg` from a Mac) unless you set up cross-platform signing —
electron-builder does not reliably cross-compile installers for other OSes.

## Changing which URL it points to

Edit `APP_URL` at the top of `main.js`.

## Icon

`icon.png` is copied from `public/logo.png`. It works as-is on Windows/Linux,
but for a polished macOS `.dmg`/dock icon you'll want a proper `.icns` file
(and a `.ico` for a crisper Windows installer icon) — convert `icon.png` with
a tool like https://cloudconvert.com/png-to-icns or `electron-icon-builder`,
then update the `icon` paths in `package.json`'s `build` section.
