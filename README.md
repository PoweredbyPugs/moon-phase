# Obsidian Moon

An astrology and divination toolkit for Obsidian — moon phase, planetary positions, aspects, transits to your natal chart, 9 Star Ki, I Ching hexagram casting, midpoints, eclipses, and Vimshottari dashas. Everything lands as text at the cursor, plays nicely with Templater, and is built around a tabbed settings UI.

## ⚠️ Required dependency: Sweph-server

Obsidian Moon is a thin client. All ephemeris and chart math happens on a small Node/Express service called **[Sweph-server](https://github.com/PoweredbyPugs/Sweph-server)**. You need one running and reachable from your Obsidian machine. It ships with a Dockerfile and `docker compose` setup; the README there has full instructions.

> **Roadmap:** a future release of Obsidian Moon will bundle a one-click setup script that provisions Sweph-server on your machine via Docker so you don't have to clone and run it yourself.

Once it's running, point **Settings → Obsidian Moon → General → Server URL** at it (e.g. `http://localhost:3000` or, if you're on a homelab/tailnet, `http://yourhost:3000`).

---

## Features

- Current moon phase + sign + exact degree
- Next major moon phase this week, exact timestamp
- All planetary positions or a single planet, with retrograde marks
- All current aspects, filtered by planet or aspect type
- **Natal-chart mode** — pick a saved chart and aspect commands return transits to *your* planets via `/transits/:name/now`
- **Create new charts from settings** — date / time / location-search form posts to `/generate-chart`
- **9 Star Ki** — today's Ki cascade and natal Ki personal-cycle (pure client-side)
- **I Ching** — three-coin cast, primary + relating hexagrams, King Wen names + judgments (pure client-side)
- **Midpoint transits**, **eclipses**, **Vimshottari dashas** — opt-in via the Techniques tab, powered by Sweph-server endpoints
- Templater-friendly: every getter exposed on `window.ObsidianMoon` (and `window.MoonPhasePlugin` as an alias)
- Tabbed settings UI: **General · Natal Chart · Planets · Aspects · Techniques**

---

## Commands

### Sky & natal

| Command | Output |
|---|---|
| Current Moon Phase | `🌕 Libra` |
| Current Moon Degree | `🌕 Libra 15.2˚` |
| Weekly Phase | Next major phase this week with its sign |
| All Planetary Positions | One line per visible planet |
| *Planet* Position | A single planet's sign + degree |
| All Current Aspects | All visible aspects (sky-to-sky, **or** transit-to-natal when natal mode is on) |
| *Planet* Aspects | Aspects involving that planet |
| *Aspect* Aspects | Aspects of one type (Conjunction / Square / etc.) |

### Techniques (toggle in settings to show)

| Command | Output |
|---|---|
| Cast Hexagram | I Ching cast with primary + relating hexagram |
| Today's 9 Star Ki | Year / Month / Third Ki for today |
| Natal 9 Star Ki | Birth Ki + today's personal cycle |
| Midpoint Transits | Current transits aspecting natal midpoints |
| Next Eclipse | Next solar or lunar eclipse within configured lookahead |
| Vimshottari Dashas | Vedic dasha periods for the selected chart |

---

## Templater integration

```js
window.ObsidianMoon
```

| Function | Returns |
|---|---|
| `getCurrentMoonPhase()` | `"🌕 Libra"` |
| `getCurrentMoonDegree()` | `"🌕 Libra 15.2˚"` |
| `getWeeklyPhase()` | `"🌓 Capricorn"` |
| `getPlanetaryData()` | `{localEasternTime, planets: [...]}` |
| `getAspectsData()` | `{localEasternTime, aspects: [...]}` |
| `getNatalTransits(chartName?)` | Rich natal-transit response (with phase, isExact, isTight, …) |
| `getNatalChart(chartName?)` | Full saved natal chart record |
| `listSavedCharts()` | Saved-chart names |
| `getTodaysKi()` | Markdown report for today's Ki |
| `getNatalKi()` | Birth Ki + today's personal cycle |
| `getDailyHexagram()` | Hexagram cast as markdown |
| `getMidpointTransits(chartName?)` | Markdown list of current midpoint transits |
| `getNextEclipse()` | One-line "Next eclipse: …" |
| `getDashas(chartName?, levels?)` | Markdown list of dasha periods |

### Example daily-note template

```markdown
---
date: <% tp.date.now("YYYY-MM-DD") %>
moon: <% await window.ObsidianMoon.getCurrentMoonDegree() %>
ki:   <% (await window.ObsidianMoon.getTodaysKi()).split('\n')[2] %>
---

# <% tp.date.now("MMMM D, YYYY") %>

Today's moon: <% await window.ObsidianMoon.getCurrentMoonDegree() %>
Major phase this week: <% await window.ObsidianMoon.getWeeklyPhase() %>

<% await window.ObsidianMoon.getDailyHexagram() %>
```

---

## Development

```bash
npm install
npm run dev      # watch-mode build
npm run build    # production build
npm test         # vitest run — 53 tests
```

Code layout:

```
main.ts                       # Obsidian-coupled glue: commands, settings UI, HTTP
src/types.ts                  # Shared type defs + constants
src/pure.ts                   # Pure logic: settings migration, URL building, filters
src/techniques/ki.ts          # 9 Star Ki (pure TS, no server)
src/techniques/hexagram.ts    # I Ching cast + King Wen lookup (pure TS, no server)
src/__tests__/                # vitest suite (Ki canonical fixture, hexagram integrity, …)
```

---

## Roadmap

**Phase 1 — Techniques layer ✅**

- Pure-TS 9 Star Ki + I Ching
- Plugin commands for Sweph-server endpoints: midpoint transits, eclipses, dashas
- Techniques settings tab

**Phase 1.5 — Planetary cycles ✅**

- `GET /cycle/:planet` server endpoint: timeline + natal-chart aspect crossings
- Multi-chart settings (`trackedCharts` + `defaultChart`, "set default", "remove")
- "Plot Planetary Cycle" modal command
- `getCycle()` Templater helper for daily-ritual roll-ups

**Phase 2 — Knowledge layer ✅**

- Pluggable `KnowledgeBackend` interface
- Neo4j backend (full-text search over `Interpretation` nodes; Stella-compatible schema)
- "Knowledge Search" modal + "Interpret Selected Placement" command
- Placement parser: turns "♂ Capricorn 15˚" / "Venus conjunct Pluto" into a structured query

**Phase 3 — Synthesis layer ✅**

- LLM provider plumbing: OpenAI-compatible, Anthropic, Ollama
- "Insert Chart Reading", "Discover Patterns", "Interpret Selected Placement (LLM)" commands
- Prompt templates inspired by Stella
- Memory loop: every reading saved as a markdown note in a vault folder, with frontmatter for Dataview

**Phase 4 — One-command Sweph-server setup**

- Settings button: "Install Sweph-server here" — provisions Docker locally, downloads ephemeris files, writes URL into settings

**Phase 5 — Ergonomics + ecosystem**

- Animated cycle view (using `/cycle/:planet` timeline data)
- Hexagram modal with line-by-line interpretation
- "Aspect right now" status bar item
- Vault-native fallback for knowledge layer (BM25/TF-IDF over markdown)
- Community-plugin store submission

---

## Credits

- **Swiss Ephemeris** by Astrodienst, via [pyswisseph](https://github.com/astrorigin/pyswisseph) / [sweph npm](https://www.npmjs.com/package/sweph) — the engine behind every position and transit
- **Stella MCP** ([PoweredbyPugs/Stella-mcp](https://github.com/PoweredbyPugs/Stella-mcp)) — the techniques in Phase 1 are ports of Stella's Python implementations
- **OpenStreetMap / Nominatim** — location search in the chart-creation form
- I Ching judgments distilled from Wilhelm/Baynes (public domain)
