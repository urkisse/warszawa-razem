# Warszawa Razem / Warsaw Together – demo

Interactive map of places for young people in Warsaw. Hand-written code, no site builders:
a small Node build script turns JSON content into plain static HTML/CSS/JS (PL + EN).
There is no server and no database: the finished site is a folder of files.

```bash
npm install          # Leaflet (map), protomaps-leaflet (map tiles), Sveltia CMS (editing panel)
npm run dev          # build + serve on http://localhost:4173, rebuilds on every change
npm run build        # writes the finished site to ./dist
```

Build settings (environment variables, all optional):

| Variable | Meaning | Example |
|---|---|---|
| `SITE_URL` | public address, used for canonical URLs and the sitemap | `https://warszawa-razem.pl` |
| `BASE_PATH` | only if the site lives in a sub-folder of its domain | `/warszawa-razem` |

`BASE_PATH=/warszawa-razem npm run dev` serves the site under that path exactly like GitHub Pages does.

## URLs

| | Polish (primary) | English |
|---|---|---|
| Home (map + list) | `/` | `/en/` |
| Place | `/miejsca/<slug>/` | `/en/places/<slug>/` |
| About | `/o-projekcie/` | `/en/about/` |
| Editing panel | `/admin/` | |

Every page has `<link rel="canonical">`, `hreflang` pl/en/x-default, Open Graph tags, JSON-LD (TouristAttraction,
BreadcrumbList) and is listed in `sitemap.xml`. Filter state is in the URL: `/?cat=music,sport&view=list`.

## Editing content

### With the editing panel (for non-developers)

Open `<site address>/admin/`. Sign in with **GitHub** (needs a GitHub account with write access to the repository)
or with an **access token**:

1. GitHub -> Settings -> Developer settings -> Personal access tokens -> *Fine-grained tokens* -> Generate.
2. Repository access: only `warszawa-razem`. Permissions: **Contents: Read and write**.
3. In the panel choose *Sign In Using Access Token* and paste it (the token stays in the browser).

In the panel you can add, edit and delete places: PL and EN texts, categories, coordinates, address, website
and photos (with author and licence). **Save = a commit to the repository; the site is rebuilt and republished
automatically within about a minute.** Uploaded photos are resized to 1600 px. The panel is Sveltia CMS
(Decap-CMS-compatible); its fields are defined in `admin/config.yml`.

The panel is themed to match the website (colours, fonts and corner radius are set with Sveltia's own variables
in `admin/index.html`; the logo is `admin/logo.svg`) and shows places as a photo list/gallery with a category filter.

**Changing the panel safely:** `node tools/admin-test.mjs`, then `python3 -m http.server 4190 -d .admin-test`
and open http://localhost:4190/ -> *Start Demo*. This is a login-free sandbox of the panel with the real places and
photos (edits stay in the browser, nothing is sent anywhere), so changes to `admin/config.yml` or the theme can be
checked, including a save, before they are published. A configuration error is shown on the login screen.

Not editable in the panel yet: interface texts (`content/ui.json`), the About page and the category
definitions (`content/categories.json`). Edit those files directly or add them to `admin/config.yml`.

### By hand

Each place is one file, `content/places/<slug>.json`: `slug`, `categories` (`integration`, `culture`, `sport`,
`music`, `friends`), `lat`/`lng`, `address`, `website`, `photos`, and the `pl` and `en` blocks. The build fails
with a clear message if something is missing. Photos live in `content/photos/` and are listed per place:

```json
"photos": [
  { "image": "content/photos/hala-koszyki-01.jpg", "author": "Name", "license": "CC BY-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0", "source": "https://..." }
]
```

The first photo is the cover; the first three are shown on the place page. A place without photos gets generated
placeholder illustrations. Photos from Wikimedia Commons (the demo set) must keep their author/licence line.

## Publishing

`.github/workflows/pages.yml` builds the site and publishes it to **GitHub Pages** on every push to `main`
(including commits made by the editing panel). One-time setup: repository *Settings -> Pages -> Source:
GitHub Actions*. The site is plain static files, so it can be hosted anywhere (Cloudflare Pages, Netlify, nginx,
the city hall's own server): run `npm run build` with the right `SITE_URL`/`BASE_PATH` and upload `dist/`.
The host must support HTTP Range requests (needed for the map file).

**Custom domain:** Settings -> Pages -> Custom domain, then a DNS record at the registrar. The workflow picks up the
new address automatically (no `BASE_PATH` any more).

**Transferring the project** (to the city hall's GitHub organisation): Settings -> Transfer ownership. Afterwards
update `repo:` (and `site_url`) in `admin/config.yml`, re-enable Pages, set the custom domain, and give the editors
write access to the repository.

## Map tiles (self-hosted, free)

The map is a vector basemap read from **one static file**, `content/map/warsaw.pmtiles` (~30 MB, OpenStreetMap
data in the Protomaps format), drawn in Leaflet by `protomaps-leaflet`. It is copied to `dist/assets/map/` and
served with the site: no tile server, no API key, no third-party requests, no cookies.

Re-create or refresh the file (needs the `pmtiles` CLI, e.g. `brew install pmtiles`; builds are published daily
at https://build.protomaps.com):

```bash
pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles content/map/warsaw.pmtiles \
  --bbox=20.82,52.08,21.30,52.38 --maxzoom=14
```

Zoom 14 is the last level in the file; closer zooms are scaled up and stay sharp (vector). To cover a wider area
raise the bbox (and the `BOUNDS` constant in `src/app.js`); to change the look change `flavor` in `baseMap()`.
The map attribution "© OpenStreetMap contributors · Protomaps" must stay visible (ODbL licence).

## Claude artifact demo (optional)

`node tools/build-artifact.mjs` packs the site into one self-contained page (`artifact/index.html`, ignored by git)
for the Claude artifact viewer, which blocks external files; it uses its own offline basemap
(`artifact/basemap.json`, made by `tools/make-basemap.mjs` from Overpass data).

## Demo vs. production

* All places, texts and illustrations are **sample content** – verify facts, coordinates and opening info.
* Not part of the demo: domain registration, DNS/HTTPS on the city hall's domain, user accounts and roles beyond
  GitHub's, an approval step before publishing (can be added with branch protection and pull requests).
