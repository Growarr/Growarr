<p align="center">
  <img src="logo.png" width="120" alt="Growarr logo">
</p>

<h1 align="center">Growarr</h1>

<p align="center">A garden map that knows the weather, waters itself intelligently, and talks to Home Assistant.</p>

<p align="center">
  <a href="https://github.com/Growarr/growarr/actions/workflows/docker-publish.yml"><img src="https://github.com/Growarr/growarr/actions/workflows/docker-publish.yml/badge.svg" alt="Build status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

Right now you find out about frost, dry soil, or a missed harvest window
the same way most people do: too late, by looking at the actual plant.
A spreadsheet won't warn you. A generic gardening app doesn't know your
sensors, your microclimate, or your Home Assistant setup. Growarr is a
real, drag-and-drop map of your greenhouse, beds and pots that
cross-references the local forecast, learns how your garden's own beds
actually run warmer or colder than the regional number, and puts one
clear answer on the screen every morning: here's what needs you today.
Self-hosted, and built to plug straight into a Home Assistant setup you
already run - not a new account, not another cloud service watching your
garden.

It's two things in one repo: **the panel** (a single Docker container) and
a free nightly **frost watch** that runs on GitHub Actions and texts your
phone before a cold snap hits.

<p align="center">
  <img src="docs/screenshot-demo.png" width="100%" alt="Growarr dashboard on desktop and mobile: garden map, weather, notifications and sensor history">
</p>

> [!NOTE]
> Work in progress. My wife does the actual gardening, and I just built the
> app around what she needs, so it's very much shaped by real day-to-day
> use rather than a finished spec. Feedback, bug reports and feature ideas
> are genuinely welcome.

## Why bother

- **It tells you what matters, once a day.** A notification center
  surfaces frost risk, dry soil and harvest windows, optionally
  prioritized and merged by Claude so you get one useful line instead of
  five - open the app, know exactly what to do, close it.
- **A map, not a form.** Drag greenhouses, beds and pots into place. Plants
  render as icons you can count, not a row in a table.
- **It learns your microclimate.** Link a temperature sensor and it figures
  out over time how much colder your north bed actually runs than the
  regional forecast says.
- **Sun and shadow, worked out for real.** See exactly which beds shade
  each other at any hour, computed from your garden's own coordinates.
- **Ask it anything.** Photograph a sick-looking plant and get an answer
  from Claude that's grounded in your actual sensors, not generic advice.
- **Feels native on a phone.** Bottom-sheet panels, a floating glass nav
  bar, dark mode. Not a desktop dashboard squeezed onto a small screen.
- **Your data, your box.** One container, one data file, your own Home
  Assistant entities. No accounts, no cloud sync.
- **Notes, history and a watering schedule, each their own page.** Every
  planting's notes in one list with a planting/harvest calendar, one
  searchable chart across every sensor you've linked, and weekday-based
  watering reminders (a stand-in for real irrigation until there's a valve
  to actually drive).

**Who it's for:** you already run Home Assistant and want your garden to
show up next to your thermostat and lights, not live in a separate app
with its own login. If that's not you yet, it still works fine without
HA - you just lose the sensor history, entity linking, and automations.

## Getting started

```bash
sudo mkdir -p /opt/docker/growarr && cd /opt/docker/growarr
sudo git clone https://github.com/Growarr/growarr.git .
cp .env.example .env   # fill in HA_TOKEN, GEO_LAT, GEO_LON
sudo docker compose up -d
```

That's a working panel at `:8097`. GitHub Actions rebuilds and republishes
the image on every push; pair it with [Watchtower](https://containrrr.dev/watchtower/)
and updates roll out on their own.

Prefer to update on your own terms instead? Check the
[releases](https://github.com/Growarr/growarr/releases) for a specific
version, e.g. `v0.1.0`, and pin `docker-compose.yml` to it:

```yaml
image: ghcr.io/growarr/growarr:v0.1.0 # instead of :latest
```

<details>
<summary><strong>Environment variables</strong></summary>

| Variable | Required | What it does |
|---|---|---|
| `PORT` | No (default `8097`) | Port the panel listens on |
| `HA_URL` | For Home Assistant features | Your HA base URL |
| `HA_TOKEN` | For Home Assistant features | A long-lived HA access token |
| `GEO_LAT`, `GEO_LON` | For weather & sun map | Your garden's coordinates |
| `NTFY_TOPIC` | No | Push notifications via [ntfy.sh](https://ntfy.sh) (can also be set later in the UI) |
| `WEBHOOK_URL` | No | Forward notifications to a Home Assistant webhook instead/as well |
| `ANTHROPIC_API_KEY` | No | Unlocks Claude's watering insight, photo chat, and notification prioritization |
| `APP_PASSWORD` | No | Requires a login (one shared household password) to use the panel at all; unset by default, so existing installs keep working with no login |
| `TRUSTED_NETWORKS` | No | Comma-separated CIDRs (e.g. `192.168.1.0/24`) that skip the login when `APP_PASSWORD` is set. Nothing is trusted by default, not even `127.0.0.1` - a reverse proxy on the same host forwards real, outside traffic to Growarr over loopback too, so trusting it by default would silently let everyone in |

Everything except `PORT`, `APP_PASSWORD` and `TRUSTED_NETWORKS` also has a
matching field in Settings, so you can skip straight to `docker compose up
-d` with a blank `.env` and fill the rest in through the UI.

</details>

<details>
<summary><strong>Frost watch setup</strong></summary>

The nightly job is separate from the panel and runs on GitHub's own
infrastructure, so it needs its own repo secrets:

1. Add secrets **`GEO_LAT`** and **`GEO_LON`**.
2. Add secret **`NTFY_TOPIC`** and/or **`WEBHOOK_URL`**.
3. Optional: repo variable **`FROST_THRESHOLD`** (°C, default `3`). Margin
   against ground frost, since the forecast is air temperature 2m up.
4. Run it once by hand from the **Actions** tab, or wait for the nightly
   schedule (18:00 Swedish time).

Missing coordinates just skip the run quietly instead of failing.

</details>

<details>
<summary><strong>Reverse proxy</strong></summary>

Point a custom location at the panel, e.g. in Nginx Proxy Manager:

- Location: `/growarr`
- Forward to: your HA host, port `8097`

Then add it to Home Assistant's sidebar as a dashboard pointing at
`https://your-domain/growarr/`. Keep the trailing slash, or the panel's
own API calls end up in the wrong place.

</details>

<details>
<summary><strong>API reference</strong></summary>

| Method | Path | Does |
|---|---|---|
| GET | `/api/weather` | 5-day forecast + coordinates |
| GET / POST | `/api/plantings` | List / add plantings |
| POST | `/api/plantings/update` | Update a planting |
| POST | `/api/plantings/delete` | Delete a planting |
| POST | `/api/zones` | Add a zone (greenhouse, bed, pot…) |
| POST | `/api/zones/update` | Update a zone's position, size, height, soil |
| POST | `/api/zones/delete` | Delete a zone |
| POST | `/api/maps` | Add a garden map (tab) |
| POST | `/api/maps/update` | Change a map's background mode/photo alignment |
| POST | `/api/maps/delete` | Delete a map |
| POST | `/api/maps/image` | Upload a map's aerial background photo |
| POST | `/api/maps/image/delete` | Remove a map's background photo |
| GET | `/api/map-image` | Serve a map's uploaded background photo |
| GET / POST | `/api/widgets` | List / add custom dashboard blocks |
| POST | `/api/widgets/update` | Update a dashboard block |
| POST | `/api/widgets/reorder` | Reorder dashboard blocks |
| POST | `/api/widgets/delete` | Delete a dashboard block |
| GET | `/api/devices/status` | Current state of watched HA entities |
| POST | `/api/devices` | Watch a new HA entity |
| POST | `/api/devices/delete` | Stop watching an entity |
| GET | `/api/ha-entities` | Full HA entity list, for autocomplete |
| GET | `/api/camera` | Proxy a snapshot from an HA camera entity already shown in the panel |
| GET | `/api/history` | Logged sensor history |
| GET | `/api/watering` | Claude's watering insight |
| POST | `/api/chat` | Chat with Claude, with optional photo |
| GET / POST | `/api/settings` | Read / save settings |
| GET | `/api/version` | Running version, and a newer one if main has already moved on |
| POST | `/api/notifications` | Mark a notification handled |
| POST | `/api/notifications/ai` | Let Claude prioritize the notification list |
| POST | `/api/schedules` | Add a watering schedule |
| POST | `/api/schedules/delete` | Delete a watering schedule |
| GET | `/api/schedules/suggestions` | Claude's suggested schedules, based on sensor history |
| GET | `/api/automations` | List HA automations, flagging which are linked to the garden |
| POST | `/api/automations/link` | Link an existing HA automation to the garden |
| POST | `/api/automations/unlink` | Unlink one |
| POST | `/api/automations/toggle` | Turn a linked automation on/off |
| POST | `/api/automations/draft` | Claude drafts a new automation from linked entities |
| POST | `/api/automations/revise` | Claude edits an existing automation |
| POST | `/api/automations/create` | Write a drafted/revised automation to Home Assistant |
| POST | `/api/metrics/sync` | Export drying-trend metrics as HA sensors |
| POST | `/api/login` | Log in (only exists when `APP_PASSWORD` is set) |
| POST | `/api/logout` | Clear the login session |

</details>

## Login is optional

By default the panel has no auth of its own, same model as the rest of a
typical home-lab - keep it behind your VPN, your LAN, or whatever Zero
Trust layer already fronts your other self-hosted apps. Set `APP_PASSWORD` if you want a login anyway (see the environment
variables table above): one shared household password, a signed session
cookie, and an optional `TRUSTED_NETWORKS` allowlist to skip it from
specific addresses.

## What's next

Automatic watering. The software side is already built and waiting: link a
`switch.` or `valve.` entity to a zone the same way you'd link a soil
sensor, and a "Draft an automation" button appears on that zone's watering
schedule (and on its moisture trend, which is already tracked regardless
of a schedule) - Claude drafts a real Home Assistant automation from it,
off by default until you turn it on. What's missing is a valve to link.

Ideas and PRs welcome.
