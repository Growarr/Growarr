<p align="center">
  <img src="logo.png" width="140" alt="Growarr logo">
</p>

<h1 align="center">Growarr</h1>

<p align="center"><strong>A self-hosted garden map, planting journal and frost watch that talks to Home Assistant.</strong></p>

<p align="center">
  <a href="https://github.com/mathiasmholm/growarr/actions/workflows/docker-publish.yml"><img src="https://github.com/mathiasmholm/growarr/actions/workflows/docker-publish.yml/badge.svg" alt="Docker publish status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node-%3E%3D22-339933?logo=node.js&logoColor=white" alt="Node >=22">
</p>

## Links

- [What it is](#what-it-is)
- [Features](#features)
- [Smart insights (Claude)](#smart-insights-claude)
- [Notifications](#notifications)
- [Getting started — frost warning](#getting-started--frost-warning)
- [Getting started — the panel](#getting-started--the-panel)
- [Reverse proxy setup](#reverse-proxy-setup)
- [API reference](#api-reference)
- [Roadmap](#roadmap)

## What it is

Growarr is two things in one repo, built for a single Home Assistant home-lab
setup (no multi-tenant, no login — see [Security model](#security-model)):

1. **Frost warning** — a free GitHub Actions job that checks
   [SMHI's forecast](https://opendata.smhi.se) (Swedish weather institute,
   free, no API key) once a night and pushes a [ntfy.sh](https://ntfy.sh)
   notification if frost is expected.
2. **The panel** — a Docker container with a visual dashboard for your
   garden: a drag-and-drop map, a planting journal, weather-aware watering
   advice, and optional Claude-powered features, all backed by Home
   Assistant entities you already have.

No login screen — the same security model as the rest of a typical
Home Assistant home-lab: the panel is only reachable through your own
network/VPN, or behind whatever Zero Trust layer already guards your other
self-hosted apps.

## Features

### Dashboard & garden map

- **Today's weather** as a slim strip at the top of the map card (icon,
  today's high/low, a frost chip when relevant) — everything about the
  place at a glance, without squeezing the richer map into a shared box.
- **Weather & watering** in the side column — the full 5-day forecast with
  real weather icons and frost highlighted, followed by a Claude-generated
  watering recommendation that factors in the forecast, your zones/plantings
  and the latest readings from connected soil-moisture sensors (see
  [Smart insights](#smart-insights-claude)). Falls back to a simple
  rule-based tip (based on expected rainfall) if `ANTHROPIC_API_KEY` isn't set.
- **Multiple garden maps** — tabs above the map (e.g. "Front yard",
  "Backyard", "Greenhouse"). Click a tab to switch; zones belong to whichever
  map they were created on. New maps are added via **Create new** → **Map**.
- **Freeform garden map**, drawn top-down: greenhouses as glass panels with
  a ridge beam, raised beds as wooden frames around dark soil, outdoor beds
  as organic soil shapes, and indoor zones as bright shelves with terracotta
  pots. A bed looks the same whether it stands alone or is nested as a
  section inside a greenhouse.

  The map keeps itself framed — after any change (new zone, moved bed, tab
  switch, screen rotation) it re-zooms so the whole garden fits, which
  matters on mobile where zones' fixed pixel widths would otherwise spill
  past the frame. Zoom or pan yourself and the auto-fit steps aside; click
  the percentage button to hand control back. Pinch-to-zoom, ctrl/⌘ + scroll
  on desktop, and vertical swipes still scroll the page as usual.

  Click **Edit layout** to enable move mode, and **Done, lock positions**
  when finished. While editing you can drag zones, sections, and individual
  plantings into place, resize via the corner handle, and flip a zone/bed
  with ⟳ to swap its width/height. Everything saves automatically.
- **Compact map mode (default)** — a scaled site-plan view instead of the
  full illustrated cards: same width, height and orientation as the real
  zones, just flat-colored by zone type with a small dot instead of the
  glass/wood textures. **Click a zone to zoom in on it** — the camera pans
  and enlarges exactly like tapping a cluster on Apple/Google Maps, other
  zones dim, and the zone opens in its full, planting-filled form. A small
  "← zone name" chip in the top-left zooms back out. The **Map** button
  switches to always showing every zone fully illustrated side by side
  (required for layout editing, which is only available in that mode).
- **Four ways to view the garden** — a tab row above the map:
  - **Overview** — the map, as above.
  - **By zone** — a summary card per zone (type, quantity planted, linked
    sensor readings); clicking opens the same detail panel as the map.
  - **By plant** — the only view that crosses zone boundaries: every
    planting with the same name is rolled up into one variety, regardless of
    which zone or map it's on (e.g. "Cucumbers" in both the greenhouse and a
    raised bed add up to one total). Click a variety to see where it grows
    and the history of every linked sensor.
  - **History** — the same content as the history card in the side column,
    in its own, larger layout.
- **Quantities and filled areas** — a planting is *one variety in one spot*
  and carries a quantity, set on creation and editable later. The quantity
  is drawn as that many icons, so a bed with six cucumbers actually looks
  like it holds six cucumbers, with a small number pinned on for precision.
  Two layouts: **clustered** (icons grouped and moved as one object — handy
  when several varieties share a bed) and **fill the area** (spread evenly
  across the whole bed — perfect for a bed that's just cucumbers; two filled
  varieties in the same space split it between them, so "half carrots, half
  beets" works too). Icons shrink automatically to fit, however many there
  are.
- **Quick-add** — click a zone and add plantings right there: a free-text
  field with suggestions (your own varieties first, seeded with common
  vegetables) instead of a wall of buttons — type freely or pick from the
  list, the same pattern as the Home Assistant entity search in Settings.
- **Zone & plant details** — click a zone or planting on the map to select
  it and view/edit quantity, soil type, free-text notes, and link any number
  of Home Assistant entities (the latest value shows as a badge right on the
  map, e.g. 💧 42% on a greenhouse) plus a history graph per linked entity.
  On a wide screen this is a panel below the map; **on phones it slides up
  as a bottom sheet** instead, with a drag handle, background dimming, and
  swipe-down to close — the same gesture as native iOS/Android apps.
- **History** — a combined view of every linked entity over time (logged
  hourly), building up from the day you connect an entity — no backfilled
  data.
- **☀️ Sun map** — click **Sun** above the map to see the shadows greenhouses
  and beds cast at any time of day, computed purely from the garden's
  coordinates (no weather API needed for the sun's position itself). Drag
  the slider to watch the shadows move through the day. Zone details also
  show **≈ X hours of sun today**, calculated by sampling the day every 15
  minutes and checking whether the zone's center falls in another zone's
  shadow. Requires a **height** set per zone (a sensible default is applied
  per zone type) and the map's **orientation and scale** saved under
  Settings → "Map's real-world layout" — otherwise the sun map doesn't know
  which way is north or how big a meter is on screen.
- **🌡️ Per-zone microclimate** — if a zone has a temperature sensor linked,
  the panel compares it against SMHI's forecast for your location and learns
  over time how much warmer or colder that zone actually runs (median of at
  least 12 readings). The frost warning on the dashboard then breaks down
  per zone instead of showing one regional number.
- **📷 QR labels** — in zone details, the **QR label** button gives you a
  print-ready code to tape on the bed. Scan it with your phone's camera and
  the zone opens directly (`#zon=<id>`) — no map navigation needed. Generated
  and rendered entirely client-side (no external service, no network image).
- **Custom blocks** — add your own cards to the dashboard: either a set of
  Home Assistant entities (shown as color-coded readout tiles) or a camera
  snapshot from a Home Assistant camera entity, with soft, semi-transparent
  controls to refresh or open it full-screen. Configured under Settings,
  where you also choose the main or side column, and reorder/move blocks
  with ↑/↓ and ⇄.
- **🌿 AI chat** — a bubble in the bottom-right corner where you can ask
  anything and **attach photos** ("why does this plant look like this?").
  Claude gets your zones, plantings, linked sensor readings and history, and
  the weather forecast, and weighs the photo against the sensor data in its
  answer. Requires `ANTHROPIC_API_KEY` (see
  [Smart insights](#smart-insights-claude)). Photos are downscaled in the
  browser before sending and are never stored on the server.
- **🔔 Notification center** — see [Notifications](#notifications) below.
- **Mobile navigation** — the sidebar (Overview/Settings) sits as a fixed,
  frosted-glass pill floating above the bottom edge on phones, rather than a
  strip at the top — the natural spot for navigation in a mobile app, and
  out of the way of the notification bell/"Create new" button that already
  floats top-right.
- **Light/Dark/System appearance** — under Settings; a manual choice is
  saved locally in the browser (not on the server, so it's per device, not
  per person).

### Icon language

Structural icons (zone type, sensor type, frost, "sensor unreachable",
camera controls) are thin, single-color line icons in the same style as the
sidebar's home/gear icons, rather than emoji — a more coherent, "designed"
feel than mixing different platforms' emoji fonts. Plants and weather stay
as emoji on purpose: 19 vegetables or SMHI's already-polished weather
symbols as line icons would cost recognizability without much upside.

## Smart insights (Claude)

Two features use [Anthropic's Claude API](https://console.anthropic.com) to
turn your raw garden data into short, plain-language insights — both are
entirely optional and degrade gracefully without a key.

- **Watering recommendation** — the server sends a summary of your zones,
  plantings, latest sensor readings and the forecast to Claude
  (`claude-sonnet-5`) and asks for a short, concrete recommendation. Cached
  server-side for **4 hours**, so cost stays negligible no matter how often
  the panel is loaded. Without a key, a simple rule-based tip (based on
  expected rainfall) is shown instead — nothing breaks.
- **AI-prioritized notifications** — the rule-based notification candidates
  (see [Notifications](#notifications)) are sent to Claude along with the
  same garden summary. Claude **prioritizes** them by actual urgency for
  your specific garden, **merges** closely related notifications into one,
  and **rewrites** the text into a short, concrete sentence. A small
  **"✨ Prioritized by AI"** label appears when this happened. Claude can
  never invent new notifications or facts — every id in its response must
  already exist among the candidates, or it's silently discarded. Cached for
  a few hours per candidate set; without a key or if the call fails, the
  plain rule-based rows are shown as usual.

**`ANTHROPIC_API_KEY`** — get one at
[console.anthropic.com](https://console.anthropic.com) (separate from a
Claude.ai subscription, billed per call). **Never put the key in
`docker-compose.yml`** (it's committed and public) — only in your own,
gitignored `.env` file.

## Notifications

Both notification sources — the dashboard's notification center and the
nightly frost job — can send to **ntfy** and/or a **Home Assistant webhook**:

- **ntfy topic** — push to your phone via [ntfy.sh](https://ntfy.sh).
- **HA webhook URL** — optional, POSTs `{ title, message }` to a Home
  Assistant webhook URL (**Settings → Automations → Webhook trigger** in
  Home Assistant gives you the URL). An HA automation can then do whatever
  you like with it (show it on a screen, speak it aloud, flash a light) in
  addition to the ntfy push. Set one, both, or neither — entirely optional.

**🔔 Notification center** — the bell icon top-right (next to "Create new")
collects current issues computed from your own data: frost risk (calibrated
per zone where possible), soil too dry/too wet, unusually cold or warm,
sensors that can't be reached, and harvest reminders for plantings whose
harvest month is now. Each notification can be **marked done (✓)** or
**dismissed (×)** — the choice is saved server-side so it won't reappear on
your next visit or on another device. A handled notification resurfaces
automatically if the same condition still applies the next day (or next
month for harvest reminders) — it's "done for now," not gone for good.

**The daily harvest-reminder check** is configured directly in the UI —
click the gear icon top-right and fill in the ntfy topic/webhook URL, no
SSH or docker-compose needed. The `NTFY_TOPIC`/`WEBHOOK_URL` environment
variables in docker-compose still work as defaults if you'd rather set them
there (e.g. before you've opened the panel for the first time) — whatever
is saved via the gear icon in the panel wins if both are set.

**The frost-warning job on GitHub Actions** is a separate, scheduled process
that runs on GitHub's own servers and has no access to the panel's data file
— it can *not* be configured via the gear icon, and needs its own repo
secrets (see below).

## Getting started — frost warning

1. Create GitHub repo secrets **`GEO_LAT`** and **`GEO_LON`** (your garden's
   coordinates, e.g. `59.85` and `17.63` — look it up on
   [OpenStreetMap](https://www.openstreetmap.org) and right-click the spot
   to get the coordinates).
2. Set secret **`NTFY_TOPIC`** and/or secret **`WEBHOOK_URL`** (see
   [Notifications](#notifications)).
3. Optional: repo variable **`FROST_TROSKEL`** (degrees C, default `3` — a
   margin against ground frost, since SMHI's forecast is air temperature 2m
   up, not ground temperature).
4. **Actions** tab → **Frostvarning** → **Run workflow** to test immediately,
   otherwise it runs automatically every evening at 18:00 (Swedish summer
   time).

Without `GEO_LAT`/`GEO_LON` the job skips itself and logs why, instead of
failing — otherwise the scheduled run would alert every night just because
the watch hadn't been set up yet.

## Getting started — the panel

```bash
sudo mkdir -p /opt/docker/growarr
cd /opt/docker/growarr
sudo git clone https://github.com/mathiasmholm/growarr.git .
```

Copy the environment template and fill in `HA_TOKEN` and `GEO_LAT`/`GEO_LON`
(the ntfy topic/webhook URL can be left blank here and set via the gear icon
in the panel after start instead, see [Notifications](#notifications)),
then start:

```bash
sudo cp .env.example .env
sudo nano .env   # fill in HA_TOKEN, GEO_LAT, GEO_LON, etc.
sudo docker compose up -d
```

The image is built and pushed to GHCR automatically by GitHub Actions on
every push (see `.github/workflows/docker-publish.yml`). If you run
[Watchtower](https://containrrr.dev/watchtower/) with the label already set
on the container, new versions roll out automatically — no manual
`git pull`/`docker compose up --build` needed after the first install.

Test it: `curl http://127.0.0.1:8097/api/vader` (note: `127.0.0.1`, not just
`localhost` — otherwise IPv6/IPv4 resolution can get in the way).

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default `8097`) | Port the panel listens on |
| `HA_URL` | Yes, for HA features | Home Assistant base URL, e.g. `http://localhost:8123` |
| `HA_TOKEN` | Yes, for HA features | Long-lived Home Assistant access token |
| `GEO_LAT` / `GEO_LON` | Yes, for weather/sun map | Your garden's coordinates |
| `NTFY_TOPIC` | No | Default ntfy topic for harvest reminders (overridable in-app) |
| `WEBHOOK_URL` | No | Default Home Assistant webhook URL (overridable in-app) |
| `ANTHROPIC_API_KEY` | No | Enables Claude-powered watering insight, AI chat and notification prioritization |

## Reverse proxy setup

A **Custom Location** on whatever reverse proxy already fronts your
Home Assistant instance (e.g. Nginx Proxy Manager):

- Location: `/growarr`
- Forward Hostname/IP: same as you already use for Home Assistant
- Forward Port: `8097`

Then add a page to Home Assistant's sidebar (**Settings → Dashboards → Add
Dashboard → New dashboard from a URL**) pointing at
`https://<your-domain>/growarr/` — **don't forget the trailing slash**, or
the panel will look for its own API calls in the wrong place.

## API reference

| Method | Path | Body | Does |
|---|---|---|---|
| GET | `/` | – | The panel (HTML) |
| GET | `/api/vader` | – | 5-day weather forecast from SMHI, plus current temperature and coordinates (used by the sun map) |
| GET | `/api/odlingar` | – | Fetches zones + the planting journal |
| POST | `/api/odlingar` | `{ namn, zonId?, antal?, layout?, planterad?, skordFonster?, skordManad?, anteckning? }` | Adds a planting (`antal`: 1–200, `layout`: `klunga`/`fyll`) |
| POST | `/api/odlingar/uppdatera` | `{ id, antal?, layout?, x?, y?, planterad?, skordFonster?, skordManad?, anteckning?, jord?, enhetIds? }` | Updates a planting, incl. quantity, layout and position within its zone |
| POST | `/api/odlingar/ta-bort` | `{ id }` | Removes a planting |
| POST | `/api/zoner` | `{ namn, typ?, x?, y?, kartaId?, foralderId? }` | Adds a zone (`typ`: `vaxthus`/`utomhus`/`inomhus`/`odlingslada`/`annat`). With `foralderId` it becomes a section inside that zone |
| POST | `/api/kartor` | `{ namn }` | Adds a garden map (tab) |
| POST | `/api/kartor/ta-bort` | `{ id }` | Removes a map (its zones move to the first remaining one) |
| POST | `/api/widgets` | `{ titel, typ, enhetIds?, entityId?, kolumn? }` | Adds a custom block (`typ`: `entiteter`/`kamera`, `kolumn`: `huvud`/`sido`) |
| POST | `/api/widgets/uppdatera` | `{ id, titel?, enhetIds?, entityId?, kolumn? }` | Updates a custom block |
| POST | `/api/widgets/ordna` | `{ ids: [...] }` | Saves new block order (↑/↓ in the panel) |
| POST | `/api/widgets/ta-bort` | `{ id }` | Removes a custom block |
| GET | `/api/kamera?entityId=` | – | Proxies a snapshot from a Home Assistant camera entity (the HA token stays server-side) |
| POST | `/api/zoner/uppdatera` | `{ id, jord?, anteckning?, enhetIds?, x?, y?, bredd?, hojd?, hojdM?, foralderId? }` | Updates a zone, incl. map position/size, height (for the sun map), and which zone it's nested in |
| POST | `/api/zoner/ta-bort` | `{ id }` | Removes a zone (plantings become uncategorized, sections move up one level) |
| GET | `/api/enheter/status` | – | Fetches current state for every watched Home Assistant entity |
| POST | `/api/enheter` | `{ entityId, namn? }` | Adds a watched Home Assistant entity |
| POST | `/api/enheter/ta-bort` | `{ id }` | Removes a watched entity |
| GET | `/api/ha-entiteter` | – | The full Home Assistant entity list, for searchable autocomplete (requires `HA_TOKEN`) |
| GET | `/api/historik` | – | Fetches logged history for entities linked to zones/plantings |
| GET | `/api/bevattning` | – | Fetches the Claude-generated watering insight (cached 4h) |
| POST | `/api/chatt` | `{ meddelanden: [{ roll, text, bild? }] }` | AI chat with an optional photo (`bild: { typ, data }`, base64) |
| GET | `/api/installningar` | – | Fetches the saved ntfy topic/webhook URL plus the map's orientation/scale |
| POST | `/api/installningar` | `{ ntfyTopic?, webhookUrl?, norrGrader?, kartaBreddM? }` | Saves settings (via the gear icon in the panel) |
| POST | `/api/notiser` | `{ id, atgard: "klar"\|"avvisad" }` | Marks a notification-center item as handled, so it won't reappear |
| POST | `/api/notiser/ai` | `{ kandidater: [{ id, titel, text, niva }] }` | Lets Claude prioritize/merge/rewrite the notification center's candidates (requires `ANTHROPIC_API_KEY`, otherwise the candidates are returned unchanged) |

## Security model

There's no login. The panel is meant to sit on a private network — reachable
only through your own LAN/VPN, or behind whatever Zero Trust layer (e.g.
Cloudflare Access, Tailscale) already protects the rest of your home-lab.
Don't expose it directly to the public internet without adding your own
authentication layer in front of it.

## Roadmap

Automatic watering isn't built yet (it needs known valve/pump entities,
which most people don't have until they own a house with irrigation
hardware) — but the "Entities" list is already the foundation for it: add
soil-moisture sensors there first, and once you know exactly which
integration/entity your watering valve will be (e.g. a `switch`- or
`valve`-entity), automation logic (e.g. "water if soil moisture is under
X% and no rain is expected") can be built on top of the same data.

Contributions and feature ideas are welcome — open an issue or a PR.
