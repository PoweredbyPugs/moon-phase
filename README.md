# Obsidian Moon Plugin

Pulls real astrological data — moon phase, sign, planetary positions, aspects, and **transits to your natal chart** — from a local Swiss Ephemeris server and drops it into your notes.

## Features

- Current moon phase + sign + exact degree
- Next major moon phase in the current week (exact timestamp, not a rough estimate)
- All planetary positions or a single planet
- All current aspects, filtered by planet or aspect type
- **Birth chart support** — enter your birth data in settings (date / time / location lookup), then aspect commands compute **transits to your natal planets** instead of plain sky-to-sky aspects
- Templater-friendly: every data getter is exposed on `window.MoonPhasePlugin`
- Tabbed settings UI: General · Birth Chart · Planets · Aspects (with per-aspect orb sliders)

## Setup

### 1. Run the Swiss Ephemeris server

The plugin is a thin client — calculations happen in a separate Node/Express server that you run locally (or on your homelab). See `sweph-server-setup.md` for the Docker walkthrough.

Quick path:

```bash
cd path/to/this/plugin
docker compose up -d --build
```

The server listens on port 3000. Point the plugin's **Settings → General → Server URL** at it.

### 2. Configure the plugin

Open **Settings → Community plugins → Moon Phase**.

- **General** — server URL, your timezone (auto-detected), and a "use natal chart for transits" master toggle.
- **Birth Chart** — date, time, location (with an OpenStreetMap-backed search box that auto-fills latitude / longitude / timezone), and a "Preview natal chart" button.
- **Planets** — toggle which planets appear in lists and aspect calculations.
- **Aspects** — toggle each aspect type and adjust its orb of influence (in degrees) with a slider.

## Commands

| Command | Output |
|---|---|
| Current Moon Phase | `🌕 Libra` |
| Current Moon Degree | `🌕 Libra 15.2˚` |
| Weekly Phase | Next major phase this week with its sign |
| All Planetary Positions | One line per visible planet |
| `<Planet>` Position | A single planet's sign + degree |
| All Current Aspects | All visible aspects (sky-to-sky, or transit-to-natal if enabled) |
| `<Planet>` Aspects | Aspects involving that planet |
| `<Aspect>` Aspects | Aspects of a given type (Conjunction / Square / etc.) |

When **Use natal chart for transits** is on and birth data is filled in, aspect commands compare today's sky against your natal chart and tag each line `(natal)`.

## Templater integration

The plugin exposes its API on `window.MoonPhasePlugin`. Common helpers:

| Function | Returns |
|---|---|
| `getCurrentMoonPhase()` | `"🌕 Libra"` |
| `getCurrentMoonDegree()` | `"🌕 Libra 15.2˚"` |
| `getWeeklyPhase()` | `"🌓 Capricorn"` (or a not-this-week message) |
| `getPlanetaryData()` | `{localTime, planets: [...]}` |
| `getAspectsData()` | `{localTime, aspects: [...]}` — automatically uses natal mode if enabled |
| `getTransitsToNatal()` | Same shape as above but always computes transits to natal |
| `getNatalChart()` | `{planets, houses, ascendant, midheaven}` |

### Example daily note template

```
---
date: <% tp.date.now("YYYY-MM-DD") %>
moon: <% await window.MoonPhasePlugin.getCurrentMoonDegree() %>
---

# <% tp.date.now("MMMM D, YYYY") %>

Today's moon is <% await window.MoonPhasePlugin.getCurrentMoonDegree() %>
Major phase this week: <% await window.MoonPhasePlugin.getWeeklyPhase() %>
```

## Troubleshooting

- **`Error fetching ...`** — usually means the plugin can't reach the server. Verify the URL in settings and try the **Test** button on the General tab.
- **Wrong sign or degree** — confirm your timezone in settings. The server now respects whatever timezone you pass; older versions hard-coded `America/New_York`.
- **Natal transits don't work** — make sure birth date / time / latitude / longitude / timezone are all filled. The location-search box fills these for you.

## Endpoints (for reference)

| Method | Path | Purpose |
|---|---|---|
| GET | `/moon-now?tz=X` | Current moon phase / sign / degree |
| GET | `/planets-now?tz=X&planets=Sun…` | Planetary positions |
| GET | `/aspects-now?tz=X&planets=…&aspects=…&orb_<Aspect>=N` | Sky-to-sky aspects with custom orbs |
| POST | `/natal-chart` | Body `{birth}` — natal positions + houses |
| POST | `/transits-to-natal` | Body `{tz, birth, planets, aspects}` — transits aspecting natal |
| GET | `/weekly-major-phase?tz=X` | Exact next major moon phase |
| GET | `/moon-phases?start=YYYY-MM-DD&end=YYYY-MM-DD&tz=X` | All major phases in range |
| GET | `/timezone-at?lat=…&lon=…` | IANA timezone for coordinates (needs `geo-tz`) |
| GET | `/test` | Health check |
