/* Pure helpers — no Obsidian imports, no I/O. Everything here is
 * directly exercised by the test suite. */

import {
    ASPECTS, AspectName, ASPECT_SYMBOLS,
    DEFAULT_SETTINGS, MOON_PHASE_EMOJI, MoonPluginSettings,
    NatalTransit, PlanetName, PLANET_GLYPHS, PLANETS, SkyAspect,
    GenerateChartBody,
} from './types';

/* ── Server URL normalization ── */

export function normalizeBaseUrl(url: string): string {
    return (url || '').trim().replace(/\/+$/, '');
}

export function joinUrl(base: string, path: string): string {
    const b = normalizeBaseUrl(base);
    const p = '/' + (path || '').replace(/^\/+/, '');
    return b + p;
}

/* ── Settings migration: v1 flat enableX fields → v2 nested maps ── */

export function migrateSettings(raw: any): MoonPluginSettings {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };

    // v2-ish: already has the new shape — merge over defaults
    const looksV2 = raw.planets || raw.aspects || raw.selectedChart !== undefined;
    if (looksV2) {
        return {
            ...DEFAULT_SETTINGS,
            ...raw,
            planets: { ...DEFAULT_SETTINGS.planets, ...(raw.planets || {}) },
            aspects: { ...DEFAULT_SETTINGS.aspects, ...(raw.aspects || {}) },
            techniques: { ...DEFAULT_SETTINGS.techniques, ...(raw.techniques || {}) },
        };
    }

    // v1 → v2 migration
    const planetMap: Record<string, PlanetName> = {
        enableSun: 'Sun', enableMoon: 'Moon', enableMercury: 'Mercury', enableVenus: 'Venus',
        enableMars: 'Mars', enableJupiter: 'Jupiter', enableSaturn: 'Saturn',
        enableUranus: 'Uranus', enableNeptune: 'Neptune', enablePluto: 'Pluto',
    };
    const aspectMap: Record<string, AspectName> = {
        enableConjunction: 'Conjunction', enableOpposition: 'Opposition',
        enableTrine: 'Trine', enableSquare: 'Square', enableSextile: 'Sextile',
        enableQuincunx: 'Quincunx', enableSemiSextile: 'Semi-sextile',
        enableSemiSquare: 'Semi-square', enableSesquiquadrate: 'Sesquiquadrate',
        enableQuintile: 'Quintile',
    };

    const planets = { ...DEFAULT_SETTINGS.planets };
    for (const [k, v] of Object.entries(planetMap)) {
        if (typeof raw[k] === 'boolean') planets[v] = raw[k];
    }
    const aspects = { ...DEFAULT_SETTINGS.aspects };
    for (const [k, v] of Object.entries(aspectMap)) {
        if (typeof raw[k] === 'boolean') aspects[v] = raw[k];
    }

    return {
        ...DEFAULT_SETTINGS,
        serverUrl: typeof raw.serverUrl === 'string' ? raw.serverUrl : DEFAULT_SETTINGS.serverUrl,
        planets,
        aspects,
    };
}

/* ── Aspect / planet filters ── */

export function enabledPlanetNames(settings: MoonPluginSettings): PlanetName[] {
    return PLANETS.filter(p => settings.planets[p]);
}

export function enabledAspectNames(settings: MoonPluginSettings): AspectName[] {
    return ASPECTS.filter(a => settings.aspects[a]);
}

export function filterSkyAspects(aspects: SkyAspect[], settings: MoonPluginSettings): SkyAspect[] {
    const enabledPlanets = new Set<string>(enabledPlanetNames(settings));
    const enabledAspects = new Set<string>(enabledAspectNames(settings));
    return aspects.filter(a =>
        enabledPlanets.has(a.planet1) &&
        enabledPlanets.has(a.planet2) &&
        enabledAspects.has(a.aspectName));
}

/* ── Natal transit normalization: lowercase → capitalized AspectName ── */

const NATAL_ASPECT_MAP: Record<string, AspectName> = {
    'conjunction': 'Conjunction',
    'opposition': 'Opposition',
    'trine': 'Trine',
    'square': 'Square',
    'sextile': 'Sextile',
    'quincunx': 'Quincunx',
    'semi-sextile': 'Semi-sextile',
    'semisextile': 'Semi-sextile',
    'semi-square': 'Semi-square',
    'semisquare': 'Semi-square',
    'sesquiquadrate': 'Sesquiquadrate',
    'quintile': 'Quintile',
};

export function natalAspectName(raw: string): AspectName | null {
    if (!raw) return null;
    return NATAL_ASPECT_MAP[raw.toLowerCase()] ?? null;
}

export function natalTransitToSkyAspect(t: NatalTransit): SkyAspect | null {
    const aspectName = natalAspectName(t.aspect);
    if (!aspectName) return null;
    const natalLabel = t.natal.planet ?? t.natal.point ?? 'Natal';
    return {
        planet1: t.transit.planet,
        planet2: natalLabel,
        aspectName,
        aspectSymbol: t.symbol || ASPECT_SYMBOLS[aspectName],
        exactAngle: '',
        orb: t.orb,
        planet1Sign: t.transit.sign,
        planet2Sign: t.natal.sign,
        planet1Retrograde: !!t.transit.isRetrograde,
        planet2Retrograde: false,
    };
}

export function filterNatalTransits(transits: NatalTransit[], settings: MoonPluginSettings): SkyAspect[] {
    const enabledPlanets = new Set<string>(enabledPlanetNames(settings));
    const enabledAspects = new Set<AspectName>(enabledAspectNames(settings));
    const out: SkyAspect[] = [];
    for (const t of transits) {
        if (!enabledPlanets.has(t.transit.planet)) continue;
        const mapped = natalTransitToSkyAspect(t);
        if (!mapped) continue;
        if (!enabledAspects.has(mapped.aspectName as AspectName)) continue;
        out.push(mapped);
    }
    return out;
}

/* ── /transits/:name/now query string builder ── */

export function natalTransitQuery(settings: MoonPluginSettings): string {
    const params = new URLSearchParams();
    if (settings.majorOnly) params.set('major', 'true');
    if (Number.isFinite(settings.natalOrb)) params.set('orb', String(settings.natalOrb));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

/* ── /generate-chart body from form values ── */

export function buildGenerateChartBody(input: {
    name: string;
    date: string;        // YYYY-MM-DD
    time: string;        // HH:mm
    latitude: number;
    longitude: number;
    timezone: string;
    save?: boolean;
}): GenerateChartBody {
    if (!input.name) throw new Error('Chart name is required');
    if (!input.date) throw new Error('Birth date is required');
    if (!input.time) throw new Error('Birth time is required');
    const [y, m, d] = input.date.split('-').map(Number);
    const [hh, mm] = input.time.split(':').map(Number);
    if (![y, m, d, hh, mm].every(Number.isFinite)) {
        throw new Error('Invalid date or time');
    }
    return {
        name: input.name,
        year: y,
        month: m,
        day: d,
        hour: hh,
        minute: mm,
        latitude: input.latitude,
        longitude: input.longitude,
        timezone: input.timezone,
        save: input.save !== false,
    };
}

/* ── Formatting helpers (used by both the plugin and tests) ── */

export function moonPhaseEmoji(phase: string): string {
    return MOON_PHASE_EMOJI[phase] ?? '🌙';
}

export function planetGlyph(name: string): string {
    return PLANET_GLYPHS[name] ?? '★';
}

export function formatPlanetLine(p: { name: string; sign: string; degreeInSign: string; isRetrograde: boolean }): string {
    const retro = p.isRetrograde ? ' ℞' : '';
    return `${planetGlyph(p.name)} ${p.sign} ${p.degreeInSign}˚${retro}`;
}

export function formatSkyAspectLine(a: SkyAspect): string {
    const g1 = planetGlyph(a.planet1);
    const g2 = planetGlyph(a.planet2);
    const r1 = a.planet1Retrograde ? ' ℞' : '';
    const r2 = a.planet2Retrograde ? ' ℞' : '';
    return `${g1}${r1} ${a.aspectSymbol} ${g2}${r2}`;
}
