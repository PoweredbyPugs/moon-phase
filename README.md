# Obsidian Moon Plugin

A thin Obsidian client for the [Sweph Astrological API](https://github.com/PoweredbyPugs/Sweph-server) — pulls live moon-phase, planetary-position, aspect, and **transit-to-natal-chart** data from your local Swiss Ephemeris server and drops it into your notes.

## Features

- Current moon phase + sign + exact degree
- Next major moon phase in the current week
- All planetary positions or a single planet, with retrograde marks
- All current aspects, filtered by planet or aspect type
- **Natal-chart mode** — pick a chart you've saved on the server and aspect commands return transits to *your* planets via `/transits/:name/now`
- **Create new charts from settings** — date / time / location-search form posts to `/generate-chart`
- Templater-friendly: every getter is exposed on `window.MoonPhasePlugin`
- Tabbed settings UI: General · Natal Chart · Planets · Aspects

## Setup

### 1. Run the Sweph Astrological API server

The plugin is a thin client — all calculations happen in a separate Node/Express server. Source lives at **`PoweredbyPugs/Sweph-server`**. See that repo's README for Docker deployment.

### 2. Configure the plugin

Open **Settings → Community plugins → Moon Phase**.

- **General** — point the server URL at your Sweph instance (e.g. `http://baratie:3000`). Click **Test** to confirm reachability.
- **Natal Chart** — pick a saved chart from the dropdown (loaded live via `GET /charts`), or fill in the **Create a new chart** form to add one.
- **Planets** — toggle which planets appear in position lists and aspect calculations.
- **Aspects** — toggle which aspect types are shown.

## Commands

| Command | Output |
|---|---|
| Current Moon Phase | `🌕 Libra` |
| Current Moon Degree | `🌕 Libra 15.2˚` |
| Weekly Phase | Next major phase this week with its sign |
| All Planetary Positions | One line per visible planet |
| `<Planet>` Position | A single planet's sign + degree |
| All Current Aspects | All visible aspects (sky-to-sky, **or** transit-to-natal when natal mode is on) |
| `<Planet>` Aspects | Aspects involving that planet |
| `<Aspect>` Aspects | Aspects of one type (Conjunction / Square / etc.) |

When **Use natal chart for transits** is on and a chart is selected, aspect commands hit `GET /transits/:name/now?major=…&orb=…` and return transits between the current sky and your saved natal chart.

## Templater integration

The plugin exposes its API on `window.MoonPhasePlugin`:

| Function | Returns |
|---|---|
| `getCurrentMoonPhase()` | `"🌕 Libra"` |
| `getCurrentMoonDegree()` | `"🌕 Libra 15.2˚"` |
| `getWeeklyPhase()` | `"🌓 Capricorn"` |
| `getPlanetaryData()` | `{localEasternTime, planets: [...]}` |
| `getAspectsData()` | `{localEasternTime, aspects: [...]}` — always sky-to-sky |
| `getNatalTransits(chartName?)` | Full natal-transit response (with phase, isExact, isTight, etc.) |
| `getNatalChart(chartName?)` | The full stored natal chart record |
| `listSavedCharts()` | Array of saved-chart names |

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

## Development

```bash
npm install
npm run dev      # watch-mode build
npm run build    # production build
npm test         # vitest run
```

Pure logic (settings migration, URL building, response normalization) lives in `src/pure.ts` and is exercised by `src/__tests__/pure.test.ts`. Obsidian-coupled code lives in `main.ts`.

## Endpoints used (for reference)

All paths are documented live at `GET /api-info` on the server.

| Method | Path | Purpose |
|---|---|---|
| GET | `/moon-now` | Current moon phase / sign / degree |
| GET | `/planets-now` | All planetary positions |
| GET | `/aspects-now` | Sky-to-sky aspects |
| GET | `/weekly-major-phase` | Major moon phase this week |
| GET | `/charts` | List saved chart names |
| GET | `/chart/:name` | Full natal chart record |
| POST | `/generate-chart` | Create + optionally save a chart |
| GET | `/transits/:name/now?major=true&orb=N` | Transits to a saved natal chart |
| GET | `/test` | Health check |
