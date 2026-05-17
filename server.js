const express = require("express");
const cors = require("cors");
const sweph = require("sweph");
const moment = require("moment-timezone");

let geoTz = null;
try { geoTz = require("geo-tz"); } catch (_) { /* optional dep — /timezone-at falls back if missing */ }

const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));

sweph.set_ephe_path("ephemeris");
console.log("Ephemeris path set to 'ephemeris'");

const SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer",
  "Leo", "Virgo", "Libra", "Scorpio",
  "Sagittarius", "Capricorn", "Aquarius", "Pisces",
];

const PLANETS = [
  { id: sweph.constants.SE_SUN, name: "Sun" },
  { id: sweph.constants.SE_MOON, name: "Moon" },
  { id: sweph.constants.SE_MERCURY, name: "Mercury" },
  { id: sweph.constants.SE_VENUS, name: "Venus" },
  { id: sweph.constants.SE_MARS, name: "Mars" },
  { id: sweph.constants.SE_JUPITER, name: "Jupiter" },
  { id: sweph.constants.SE_SATURN, name: "Saturn" },
  { id: sweph.constants.SE_URANUS, name: "Uranus" },
  { id: sweph.constants.SE_NEPTUNE, name: "Neptune" },
  { id: sweph.constants.SE_PLUTO, name: "Pluto" },
];

const DEFAULT_ASPECTS = [
  { name: "Conjunction",    symbol: "☌", angle: 0,   orb: 8 },
  { name: "Sextile",        symbol: "⚹", angle: 60,  orb: 5 },
  { name: "Square",         symbol: "□", angle: 90,  orb: 7 },
  { name: "Trine",          symbol: "△", angle: 120, orb: 7 },
  { name: "Opposition",     symbol: "☍", angle: 180, orb: 8 },
  { name: "Quincunx",       symbol: "⚻", angle: 150, orb: 3 },
  { name: "Semi-sextile",   symbol: "⚺", angle: 30,  orb: 2 },
  { name: "Semi-square",    symbol: "⚼", angle: 45,  orb: 2 },
  { name: "Sesquiquadrate", symbol: "⚿", angle: 135, orb: 2 },
  { name: "Quintile",       symbol: "Q", angle: 72,  orb: 2 },
];

const FLAGS = sweph.constants.SEFLG_SWIEPH | sweph.constants.SEFLG_SPEED;

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

function pickTz(req) {
  const tz = (req.query && req.query.tz) || "America/New_York";
  return moment.tz.zone(tz) ? tz : "America/New_York";
}

function nowIn(tz) { return moment.tz(tz); }

function julianDay(m) {
  const u = m.clone().utc();
  const hour = u.hour() + u.minute() / 60 + u.second() / 3600;
  return sweph.julday(u.year(), u.month() + 1, u.date(), hour, sweph.constants.SE_GREG_CAL);
}

function normalize(angle) {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

function signFromLongitude(lon) {
  const n = normalize(lon);
  const idx = Math.floor(n / 30);
  return { sign: SIGNS[idx], degreeInSign: (n % 30).toFixed(2), longitude: n };
}

function calcPlanet(jd, planet) {
  const res = sweph.calc(jd, planet.id, FLAGS);
  if (!res || (res.flag !== 0 && res.flag !== 2)) {
    throw new Error(`Calc failed for ${planet.name}: ${res && res.error}`);
  }
  const lon = res.data[0];
  const speed = res.data[3];
  const { sign, degreeInSign, longitude } = signFromLongitude(lon);
  const isRetrograde = planet.id !== sweph.constants.SE_SUN &&
                       planet.id !== sweph.constants.SE_MOON &&
                       speed < 0;
  return { name: planet.name, sign, degreeInSign, isRetrograde, longitude, speed };
}

function calcAllPlanets(jd) {
  return PLANETS.map(p => calcPlanet(jd, p));
}

function moonPhaseInfo(m) {
  const jd = julianDay(m);
  const moon = calcPlanet(jd, PLANETS[1]);
  const sun  = calcPlanet(jd, PLANETS[0]);
  const phaseAngle = normalize(moon.longitude - sun.longitude);

  let phaseName = "New Moon";
  if      (phaseAngle >= 22.5  && phaseAngle < 67.5)  phaseName = "Waxing Crescent";
  else if (phaseAngle >= 67.5  && phaseAngle < 112.5) phaseName = "First Quarter";
  else if (phaseAngle >= 112.5 && phaseAngle < 157.5) phaseName = "Waxing Gibbous";
  else if (phaseAngle >= 157.5 && phaseAngle < 202.5) phaseName = "Full Moon";
  else if (phaseAngle >= 202.5 && phaseAngle < 247.5) phaseName = "Waning Gibbous";
  else if (phaseAngle >= 247.5 && phaseAngle < 292.5) phaseName = "Last Quarter";
  else if (phaseAngle >= 292.5 && phaseAngle < 337.5) phaseName = "Waning Crescent";

  return {
    moonPhase: phaseName,
    moonSign: moon.sign,
    degreeInSign: moon.degreeInSign,
    phaseAngle: phaseAngle.toFixed(2),
    phaseAngleNum: phaseAngle,
  };
}

function isMajorPhase(name) {
  return name === "New Moon" || name === "Full Moon" ||
         name === "First Quarter" || name === "Last Quarter";
}

/* Filter helpers: turn query/body params into the planets and aspects lists
 * actually requested. Falls back to the server defaults if no filter given. */

function filterPlanets(allPlanets, requested) {
  if (!requested || requested.length === 0) return allPlanets;
  const set = new Set(requested.map(s => s.toLowerCase()));
  return allPlanets.filter(p => set.has(p.name.toLowerCase()));
}

function buildAspectTypes(requestedNames, orbOverrides) {
  // requestedNames: array of aspect names to include, or null = all defaults
  // orbOverrides: object like {Conjunction: 8, Trine: 7, ...}
  const wanted = requestedNames && requestedNames.length
    ? new Set(requestedNames.map(s => s.toLowerCase()))
    : null;
  return DEFAULT_ASPECTS
    .filter(a => !wanted || wanted.has(a.name.toLowerCase()))
    .map(a => ({ ...a, orb: orbOverrides[a.name] != null ? Number(orbOverrides[a.name]) : a.orb }));
}

function parseOrbOverrides(query) {
  const out = {};
  for (const key of Object.keys(query || {})) {
    if (key.startsWith("orb_")) {
      const name = key.slice(4);
      const val = parseFloat(query[key]);
      if (Number.isFinite(val)) out[name] = val;
    }
  }
  return out;
}

function asList(value) {
  if (value == null) return null;
  return Array.isArray(value) ? value : [value];
}

/* ─────────────────────────────────────────────────────────────────────────
 * /moon-now — current moon phase + sign + degree
 * ────────────────────────────────────────────────────────────────────── */
app.get("/moon-now", (req, res) => {
  try {
    const tz = pickTz(req);
    const now = nowIn(tz);
    const info = moonPhaseInfo(now);
    res.json({
      localTime: now.format(),
      localEasternTime: now.format(), // back-compat
      tz,
      moonPhase: info.moonPhase,
      moonSign: info.moonSign,
      degreeInSign: info.degreeInSign,
    });
  } catch (err) {
    console.error("Error in /moon-now:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * /planets-now — current positions of all planets
 * ────────────────────────────────────────────────────────────────────── */
app.get("/planets-now", (req, res) => {
  try {
    const tz = pickTz(req);
    const now = nowIn(tz);
    const jd = julianDay(now);
    const planets = filterPlanets(calcAllPlanets(jd), asList(req.query.planets))
      .map(p => ({
        name: p.name,
        sign: p.sign,
        degreeInSign: p.degreeInSign,
        isRetrograde: p.isRetrograde,
        longitude: p.longitude,
      }));
    res.json({ localTime: now.format(), localEasternTime: now.format(), tz, planets });
  } catch (err) {
    console.error("Error in /planets-now:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * /aspects-now — current sky-to-sky aspects with configurable filtering
 * Query: ?planets=Sun&planets=Moon&aspects=Trine&orb_Trine=6 …
 * ────────────────────────────────────────────────────────────────────── */
app.get("/aspects-now", (req, res) => {
  try {
    const tz = pickTz(req);
    const now = nowIn(tz);
    const jd = julianDay(now);

    const planets = filterPlanets(calcAllPlanets(jd), asList(req.query.planets));
    const aspectTypes = buildAspectTypes(asList(req.query.aspects), parseOrbOverrides(req.query));

    const aspects = computeAspects(planets, planets, aspectTypes, { sameSet: true });
    res.json({ localTime: now.format(), localEasternTime: now.format(), tz, aspects });
  } catch (err) {
    console.error("Error in /aspects-now:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * /natal-chart — POST with {birth: {date, time, latitude, longitude, timezone}}
 * Returns planet positions, houses (Placidus by default), ASC, MC.
 * ────────────────────────────────────────────────────────────────────── */
app.post("/natal-chart", (req, res) => {
  try {
    const birth = (req.body && req.body.birth) || {};
    const m = birthMoment(birth);
    const jd = julianDay(m);
    const planets = calcAllPlanets(jd).map(p => ({
      name: p.name,
      sign: p.sign,
      degreeInSign: p.degreeInSign,
      isRetrograde: p.isRetrograde,
      longitude: p.longitude,
    }));

    let houses = null, ascendant = null, midheaven = null;
    const hasLocation = Number.isFinite(birth.latitude) && Number.isFinite(birth.longitude);
    if (hasLocation) {
      const houseSystem = (req.body && req.body.houseSystem) || "P"; // Placidus
      const h = sweph.houses(jd, birth.latitude, birth.longitude, houseSystem);
      if (h && h.data && h.data.houses) {
        houses = h.data.houses.map((lon, i) => ({
          house: i + 1,
          ...signFromLongitude(lon),
        }));
        if (h.data.points) {
          ascendant = signFromLongitude(h.data.points[0]);
          midheaven = signFromLongitude(h.data.points[1]);
        }
      }
    }

    res.json({
      birth,
      utcInstant: m.clone().utc().format(),
      planets,
      houses,
      ascendant,
      midheaven,
    });
  } catch (err) {
    console.error("Error in /natal-chart:", err);
    res.status(400).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * /transits-to-natal — POST with {tz, birth, planets?, aspects?}
 * Returns aspects between CURRENT sky positions (transits) and NATAL positions.
 * aspects param: [{name: "Conjunction", orb: 6}, ...]
 * ────────────────────────────────────────────────────────────────────── */
app.post("/transits-to-natal", (req, res) => {
  try {
    const body = req.body || {};
    const tz = body.tz && moment.tz.zone(body.tz) ? body.tz : "America/New_York";
    const birth = body.birth || {};
    const natalMoment = birthMoment(birth);
    const natalJd = julianDay(natalMoment);
    const allNatal = calcAllPlanets(natalJd);

    const now = nowIn(tz);
    const transitJd = julianDay(now);
    const allTransit = calcAllPlanets(transitJd);

    const requestedPlanets = asList(body.planets);
    const natalPlanets = filterPlanets(allNatal, requestedPlanets);
    const transitPlanets = filterPlanets(allTransit, requestedPlanets);

    // aspects can come as ["Conjunction", "Trine"] or [{name,orb}, ...]
    const requestedAspects = body.aspects;
    let requestedAspectNames = null;
    let orbOverrides = {};
    if (Array.isArray(requestedAspects) && requestedAspects.length) {
      if (typeof requestedAspects[0] === "string") {
        requestedAspectNames = requestedAspects;
      } else {
        requestedAspectNames = requestedAspects.map(a => a.name).filter(Boolean);
        for (const a of requestedAspects) {
          if (a && a.name && Number.isFinite(a.orb)) orbOverrides[a.name] = a.orb;
        }
      }
    }
    const aspectTypes = buildAspectTypes(requestedAspectNames, orbOverrides);

    const aspects = computeAspects(transitPlanets, natalPlanets, aspectTypes, { sameSet: false })
      .map(a => ({ ...a, natal: true }));

    res.json({
      localTime: now.format(),
      tz,
      birthInstantUTC: natalMoment.clone().utc().format(),
      aspects,
    });
  } catch (err) {
    console.error("Error in /transits-to-natal:", err);
    res.status(400).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * /timezone-at — best-effort IANA timezone for given lat/lng (geo-tz)
 * ────────────────────────────────────────────────────────────────────── */
app.get("/timezone-at", (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: "lat and lon required" });
    }
    if (!geoTz) {
      return res.status(501).json({ error: "geo-tz module not installed on server" });
    }
    // geo-tz 7+: find()  -> array; geo-tz 8+: same. Older: default export.
    const finder = geoTz.find || geoTz.default || geoTz;
    const zones = finder(lat, lon);
    if (!zones || zones.length === 0) {
      return res.status(404).json({ error: "No timezone resolved for coordinates" });
    }
    res.json({ timezone: zones[0], candidates: zones });
  } catch (err) {
    console.error("Error in /timezone-at:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * /weekly-major-phase — exact moment of the next major phase this week
 * (uses binary search for ~5-minute precision instead of nearest-snap heuristic)
 * ────────────────────────────────────────────────────────────────────── */
app.get("/weekly-major-phase", (req, res) => {
  try {
    const tz = pickTz(req);
    const now = nowIn(tz);

    // Monday → Sunday window in user's tz
    const currentDay = now.day(); // 0=Sun
    const daysToMonday = currentDay === 0 ? 6 : currentDay - 1;
    const monday = now.clone().subtract(daysToMonday, "days").startOf("day");
    const sunday = monday.clone().add(6, "days").endOf("day");

    const phases = findMajorPhasesInRange(monday, sunday);
    if (phases.length > 0) {
      // Pick the next one after `now`, falling back to the closest if all are past
      const future = phases.filter(p => moment.tz(`${p.date} ${p.time}`, "YYYY-MM-DD HH:mm", tz).isSameOrAfter(now));
      const chosen = future[0] || phases[phases.length - 1];
      return res.json({
        date: `${chosen.date} ${chosen.time}:00`,
        moonPhase: chosen.phase,
        moonSign: chosen.moonSign,
        degreeInSign: chosen.degreeInSign,
      });
    }

    // No major phase fell in the week — find the next one beyond Sunday
    const lookahead = sunday.clone().add(14, "days");
    const future = findMajorPhasesInRange(now, lookahead);
    if (future.length > 0) {
      const next = future[0];
      return res.json({
        date: `${next.date} ${next.time}:00`,
        moonPhase: next.phase,
        moonSign: next.moonSign,
        degreeInSign: next.degreeInSign,
      });
    }

    res.json({});
  } catch (err) {
    console.error("Error in /weekly-major-phase:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * /moon-phases — exact major phases between start and end (date strings)
 * ────────────────────────────────────────────────────────────────────── */
app.get("/moon-phases", (req, res) => {
  try {
    const tz = pickTz(req);
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "start and end query params required (YYYY-MM-DD)" });
    }
    const startDate = moment.tz(start, tz).startOf("day");
    const endDate = moment.tz(end, tz).endOf("day");
    if (!startDate.isValid() || !endDate.isValid()) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    res.json({ phases: findMajorPhasesInRange(startDate, endDate) });
  } catch (err) {
    console.error("Error in /moon-phases:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * /test — health check
 * ────────────────────────────────────────────────────────────────────── */
app.get("/test", (_req, res) => {
  res.json({ status: "Server is running correctly" });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Core: aspect computation (sky-to-sky or transits-to-natal)
 * ────────────────────────────────────────────────────────────────────── */

function computeAspects(setA, setB, aspectTypes, opts) {
  const out = [];
  const sameSet = opts && opts.sameSet;
  for (let i = 0; i < setA.length; i++) {
    const a = setA[i];
    const jStart = sameSet ? i + 1 : 0;
    for (let j = jStart; j < setB.length; j++) {
      const b = setB[j];
      if (sameSet && a.name === b.name) continue;

      let angle = Math.abs(a.longitude - b.longitude) % 360;
      if (angle > 180) angle = 360 - angle;

      for (const t of aspectTypes) {
        const diff = Math.abs(angle - t.angle);
        if (diff <= t.orb) {
          out.push({
            planet1: a.name,
            planet2: b.name,
            aspectName: t.name,
            aspectSymbol: t.symbol,
            exactAngle: angle.toFixed(2),
            orb: diff.toFixed(2),
            planet1Sign: a.sign,
            planet2Sign: b.sign,
            planet1Retrograde: !!a.isRetrograde,
            planet2Retrograde: !!b.isRetrograde,
          });
          break; // best (first-matching) aspect between this pair
        }
      }
    }
  }
  return out;
}

/* Returns array of {phase, date, time, moonSign, degreeInSign} in start..end.
 * Coarse 6-hour scan + 12-step binary search → ~5-minute precision. */
function findMajorPhasesInRange(startMoment, endMoment) {
  const targets = [
    { phase: "New Moon", angle: 0 },
    { phase: "First Quarter", angle: 90 },
    { phase: "Full Moon", angle: 180 },
    { phase: "Last Quarter", angle: 270 },
  ];

  const phases = [];
  let prev = null;
  const tz = startMoment.tz();
  const cursor = startMoment.clone().subtract(1, "day");
  const stopAt = endMoment.clone().add(1, "day").valueOf();

  while (cursor.valueOf() <= stopAt) {
    const info = moonPhaseInfo(cursor);
    const angle = info.phaseAngleNum;

    if (prev !== null) {
      for (const target of targets) {
        const crossed = target.angle === 0
          ? (prev.angle > 300 && angle < 60)
          : (prev.angle < target.angle && angle >= target.angle);
        if (!crossed) continue;

        // Binary search for exact crossing within [prev.time, cursor]
        let lo = prev.time.clone();
        let hi = cursor.clone();
        for (let i = 0; i < 14; i++) {
          const mid = lo.clone().add(hi.diff(lo) / 2, "ms");
          const midAngle = moonPhaseInfo(mid).phaseAngleNum;
          const past = target.angle === 0 ? (midAngle < 60) : (midAngle >= target.angle);
          if (past) hi = mid; else lo = mid;
        }
        const exact = hi.tz(tz);
        if (exact.isSameOrAfter(startMoment) && exact.isSameOrBefore(endMoment)) {
          const exactInfo = moonPhaseInfo(exact);
          phases.push({
            phase: target.phase,
            date: exact.format("YYYY-MM-DD"),
            time: exact.format("HH:mm"),
            moonSign: exactInfo.moonSign,
            degreeInSign: exactInfo.degreeInSign,
          });
        }
      }
    }

    prev = { angle, time: cursor.clone() };
    cursor.add(6, "hours");
  }

  phases.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  // Dedupe: same date + phase
  return phases.filter((p, i) =>
    i === 0 || p.date !== phases[i - 1].date || p.phase !== phases[i - 1].phase);
}

/* Build a Moment for a birth record: date+time in the birth timezone. */
function birthMoment(birth) {
  if (!birth || !birth.date) throw new Error("birth.date is required");
  const tz = birth.timezone && moment.tz.zone(birth.timezone) ? birth.timezone : "UTC";
  const time = birth.time || "12:00";
  const m = moment.tz(`${birth.date} ${time}`, "YYYY-MM-DD HH:mm", tz);
  if (!m.isValid()) throw new Error("Invalid birth date/time");
  return m;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Server start
 * ────────────────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Sweph service listening on port ${PORT} on all interfaces`);
  console.log(`Test the server at: http://localhost:${PORT}/test`);
});
