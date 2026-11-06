# Mugetsu photo portfolio

The code for **photo.mugetsu.xyz**: a photo portfolio that builds itself from a folder of albums on the TrueNAS.

You drop exported photos into album folders on an SMB share. The site notices, makes web-sized copies (with GPS and all other metadata stripped), reads the camera settings, and rebuilds itself. There's no admin page, no login and no database, so the public site has nothing to break into.

Built with [Astro](https://astro.build) (static pages), React (photo-page keyboard and swipe controls), and [sharp](https://sharp.pixelplumbing.com) (image processing). The design is "Moonless": dark, editorial, Anton + Space Grotesk, with the 無月 mark.

## How it works

```
/photos  (your SMB share, mounted read-only)
  01 Coast/*.jpg ─┐
  02 Hills/*.jpg ─┤  1. scan folders, read EXIF (never GPS)
  site.json      ─┘  2. make AVIF + WebP copies at 640/1024/1600/2400px, metadata stripped
                     3. write library.json
                     4. astro build → static HTML
/data    (writable)  5. swap the new site in and serve it on :8080
  img/  library.json  site/
```

The server watches `/photos` and rebuilds about 5 seconds after the last change. Photos that were already processed are reused, so a rebuild with one new photo takes a few seconds. Deleted photos have their resized copies cleaned up. If a build fails, the previous version stays online.

## Adding photos

```
portfolio/
├── site.json                 ← optional: your name, intro, links
├── 01 Coast/                 ← one folder per album
│   ├── album.json            ← optional: description, cover, …
│   ├── still-water.jpg
│   └── sunny-shoreline.jpg
├── 02 Hills/
│   └── …
└── Drafts/
    └── album.json            ← { "hidden": true } keeps an album off the site
```

- **Albums** are folders. A leading number sets the order and is dropped from the title: `01 Coast` becomes "Coast" at `/albums/coast/`. Renaming a folder changes its URL.
- **Photos** can be `.jpg`, `.png`, `.webp`, `.avif` or `.tif`. HEIC isn't supported, so export JPEGs.
- **Titles** come from the photo's embedded Title (Lightroom: Metadata → Title), or else from the file name: `moon-over-still-water.jpg` becomes "Moon over still water". **Captions** come from the embedded Caption/Description.
- **Order** within an album is by capture time. Set `"sort": "name"` in `album.json` to use file names instead.
- **Exporting:** JPEG, sRGB, about 3000–4000 px on the long edge, quality 85–90. Bigger files work but take longer to process and nobody will see the difference.
- **Location:** GPS is never read and is stripped from every published image. Your originals on the NAS are untouched.

`album.json` (every field optional):

```json
{
  "title": "Coast",
  "description": "Beaches and open water, from midday to blue hour.",
  "cover": "still-water.jpg",
  "order": 1,
  "sort": "date",
  "hidden": false
}
```

`site.json` (every field optional):

```json
{
  "title": "Mugetsu",
  "author": "Your Name",
  "location": "Your City",
  "intro": "One or two lines about you and what you shoot.",
  "instagram": "yourhandle",
  "email": "you@example.com",
  "featured": ["coast/still-water", "fog/into-the-pines"]
}
```

`featured` picks the home page photos (`album-slug/photo-slug`, as in their URLs). Without it, the home page shows your 12 newest photos.

## Running it locally

Needs Node 24 or newer (it runs the TypeScript directly).

```bash
npm install
npm run dev          # sample photos, live-reloading dev server on :4321
npm run serve        # the production server (watch + rebuild) on :8080
npm test             # unit and integration tests
npm run typecheck
```

Point it at real photos with `PHOTOS_DIR`, e.g. `PHOTOS_DIR=//nas/portfolio npm run serve`. `sample-photos/` holds generated stand-ins with fake camera data. One has GPS and one is stored sideways, so the tests can prove both are handled.

## Deploying to TrueNAS

1. **The image.** On every push to `main`, CI runs the tests, smoke-tests the container (including as the TrueNAS `apps` user and with the data folder on its own volume), then publishes `ghcr.io/miteshn/photo-portfolio:latest`. The repo is public, so the image is too: TrueNAS can pull it without credentials.

2. **Create two datasets.**
   - **Photos**, e.g. `Pool2/photos/portfolio`: share it over SMB; this is where album folders go.
   - **Data**, e.g. `Pool2/apps/photo-portfolio`: resized images and the built site. You can delete its contents at any time and it will rebuild.

3. **Dataset permissions.** The container runs as TrueNAS's built-in `apps` user (uid 568). In each dataset's ACL editor, give `apps`:
   - **Read** on the photos dataset (its subfolders included)
   - **Modify** on the data dataset

4. **Install the app.** Apps → Discover Apps → ⋮ → **Install via YAML**, then paste [`compose.yaml`](compose.yaml) with your dataset paths. The site comes up on port 30880. The first start processes every photo, so give it a minute. Open `http://<nas-ip>:30880/healthz` to see progress.

5. **Add it to the Cloudflare Tunnel.** Zero Trust → Networks → Tunnels → your tunnel → Public hostnames → Add:
   - **Hostname:** `photo.mugetsu.xyz`
   - **Service:** `http://<nas-ip>:30880`

   Cloudflare creates the DNS record itself. Resized images are served with year-long cache headers, so Cloudflare keeps them at the edge and repeat visitors don't touch your upload bandwidth.

6. **Updating** works like the other NAS apps: `sudo docker pull ghcr.io/miteshn/photo-portfolio:latest`, then restart the app in the Apps UI.

## Configuration

| Variable | Default (container) | What it does |
| --- | --- | --- |
| `PHOTOS_DIR` | `/photos` | Folder of albums. |
| `DATA_DIR` | `/data` | Writable folder for images, the manifest and the built site. |
| `SITE_URL` | `https://photo.mugetsu.xyz` | Used for link previews, canonical URLs and the sitemap. |
| `PORT` | `8080` | Port the server listens on. |
| `REBUILD_DEBOUNCE_MS` | `5000` | Wait this long after the last change before rebuilding. |
| `RESCAN_MINUTES` | `30` | Re-check the folder this often, in case a change event was missed. `0` turns it off. |
| `WATCH_MODE` | `auto` | `polling` for network filesystems where change events don't arrive; `off` to rebuild only on restart and rescans. |
| `CONCURRENCY` | `2` | Photos resized in parallel. Raise for a faster first run, lower to keep the NAS quiet. |

## Troubleshooting

- **Is it working?** `/healthz` shows whether a site is built, the last build's time and counts, and the last error.
- **A new photo doesn't show up:** wait about 10 seconds and refresh. The app's logs show `Change: …` and `Site updated: …` lines. If changes never register, set `WATCH_MODE=polling`.
- **A photo is missing:** the logs say `skipped <file>: <reason>`. Usually it's an unsupported format (HEIC) or a damaged file.
- **Start fresh:** stop the app, empty the data dataset, start it again.

## Project layout

```
src/lib/        pipeline: folder scan, EXIF, image processing, layout, manifest
src/pages/      home, album, photo, 404, robots.txt
src/components/ header, footer, photo grid, album list, <picture>, keyboard/swipe island
server/         production server: watch, rebuild, serve
scripts/        `npm run process` (scan + resize without serving)
tests/          vitest suites
```
