import { describe, it, expect } from 'vitest';
import {
    buildCycleQuery, buildGenerateChartBody, enabledAspectNames, enabledPlanetNames,
    filterNatalTransits, filterSkyAspects, formatPlanetLine, formatSkyAspectLine,
    joinUrl, migrateSettings, moonPhaseEmoji, natalAspectName,
    natalTransitQuery, natalTransitToSkyAspect, normalizeBaseUrl, planetGlyph,
} from '../pure';
import { DEFAULT_SETTINGS, NatalTransit, SkyAspect } from '../types';

/* ── URL helpers ── */

describe('normalizeBaseUrl', () => {
    it('strips trailing slashes', () => {
        expect(normalizeBaseUrl('http://baratie:3000/')).toBe('http://baratie:3000');
        expect(normalizeBaseUrl('http://baratie:3000///')).toBe('http://baratie:3000');
    });
    it('trims whitespace', () => {
        expect(normalizeBaseUrl('  http://x/  ')).toBe('http://x');
    });
    it('handles empty / undefined', () => {
        expect(normalizeBaseUrl('')).toBe('');
        // @ts-expect-error testing undefined path
        expect(normalizeBaseUrl(undefined)).toBe('');
    });
});

describe('joinUrl', () => {
    it('joins base + path with single slash', () => {
        expect(joinUrl('http://x', '/foo')).toBe('http://x/foo');
        expect(joinUrl('http://x/', 'foo')).toBe('http://x/foo');
        expect(joinUrl('http://x///', '///foo')).toBe('http://x/foo');
    });
});

/* ── Settings migration ── */

describe('migrateSettings', () => {
    it('returns defaults for null/undefined/empty input', () => {
        expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
        expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
        expect(migrateSettings({})).toEqual(DEFAULT_SETTINGS);
    });

    it('migrates v1 flat enableX fields → v2 nested maps', () => {
        const v1 = {
            serverUrl: 'http://baratie:3000',
            enableSun: false, enableMoon: true, enableMercury: true, enableVenus: true,
            enableMars: true, enableJupiter: true, enableSaturn: true,
            enableUranus: true, enableNeptune: true, enablePluto: true,
            enableConjunction: true, enableOpposition: true, enableTrine: true,
            enableSquare: true, enableSextile: true,
            enableQuincunx: false, enableSemiSextile: true, enableSemiSquare: false,
            enableSesquiquadrate: false, enableQuintile: false,
        };
        const out = migrateSettings(v1);
        expect(out.serverUrl).toBe('http://baratie:3000');
        expect(out.planets.Sun).toBe(false);
        expect(out.planets.Moon).toBe(true);
        expect(out.aspects.Conjunction).toBe(true);
        expect(out.aspects['Semi-sextile']).toBe(true);
        expect(out.aspects.Quintile).toBe(false);
        // v2-only fields should fall back to defaults
        expect(out.defaultChart).toBe('');
        expect(out.trackedCharts).toEqual([]);
        expect(out.useNatalChart).toBe(false);
        expect(out.majorOnly).toBe(true);
        expect(out.natalOrb).toBe(8);
    });

    it('preserves v2 settings when already migrated', () => {
        const v2 = {
            serverUrl: 'http://baratie:3000',
            selectedChart: 'chris',           // v1.2 legacy field — migrated to defaultChart
            useNatalChart: true,
            majorOnly: false,
            natalOrb: 5,
            planets: { ...DEFAULT_SETTINGS.planets, Pluto: false },
            aspects: { ...DEFAULT_SETTINGS.aspects, Quintile: true },
        };
        const out = migrateSettings(v2);
        expect(out.defaultChart).toBe('chris');
        expect(out.trackedCharts).toContain('chris');
        expect(out.useNatalChart).toBe(true);
        expect(out.majorOnly).toBe(false);
        expect(out.natalOrb).toBe(5);
        expect(out.planets.Pluto).toBe(false);
        expect(out.planets.Sun).toBe(true); // defaults filled in
        expect(out.aspects.Quintile).toBe(true);
    });

    it('fills in missing nested-map keys with defaults', () => {
        const partial = {
            planets: { Sun: false }, // only one set
            aspects: { Conjunction: false },
        };
        const out = migrateSettings(partial);
        expect(out.planets.Sun).toBe(false);
        expect(out.planets.Moon).toBe(true);     // from defaults
        expect(out.aspects.Conjunction).toBe(false);
        expect(out.aspects.Trine).toBe(true);    // from defaults
    });
});

/* ── Filters ── */

describe('enabledPlanetNames / enabledAspectNames', () => {
    it('returns only enabled planets, in canonical order', () => {
        const s = { ...DEFAULT_SETTINGS, planets: { ...DEFAULT_SETTINGS.planets, Mercury: false, Mars: false } };
        const names = enabledPlanetNames(s);
        expect(names).toContain('Sun');
        expect(names).not.toContain('Mercury');
        expect(names).not.toContain('Mars');
        expect(names.indexOf('Sun')).toBeLessThan(names.indexOf('Moon')); // canonical order preserved
    });

    it('returns only enabled aspects', () => {
        const s = { ...DEFAULT_SETTINGS };
        const names = enabledAspectNames(s);
        expect(names).toEqual(['Conjunction', 'Opposition', 'Trine', 'Square', 'Sextile']);
    });
});

describe('filterSkyAspects', () => {
    const sample: SkyAspect[] = [
        { planet1: 'Sun', planet2: 'Mercury', aspectName: 'Conjunction', aspectSymbol: '☌',
          exactAngle: '4', orb: '4', planet1Sign: 'Taurus', planet2Sign: 'Gemini',
          planet1Retrograde: false, planet2Retrograde: false },
        { planet1: 'Sun', planet2: 'Mars', aspectName: 'Semi-sextile', aspectSymbol: '⚺',
          exactAngle: '28', orb: '2', planet1Sign: 'Taurus', planet2Sign: 'Aries',
          planet1Retrograde: false, planet2Retrograde: false },
        { planet1: 'Mars', planet2: 'Pluto', aspectName: 'Square', aspectSymbol: '□',
          exactAngle: '84', orb: '6', planet1Sign: 'Aries', planet2Sign: 'Aquarius',
          planet1Retrograde: false, planet2Retrograde: false },
    ];

    it('keeps aspects where both planets and the aspect type are enabled', () => {
        const result = filterSkyAspects(sample, DEFAULT_SETTINGS);
        expect(result.map(a => a.aspectName)).toEqual(['Conjunction', 'Square']);
        // Semi-sextile disabled by default → filtered out
    });

    it('drops aspects when a planet is disabled', () => {
        const s = { ...DEFAULT_SETTINGS, planets: { ...DEFAULT_SETTINGS.planets, Mars: false } };
        const result = filterSkyAspects(sample, s);
        expect(result.map(a => a.planet1 + a.planet2)).toEqual(['SunMercury']);
    });

    it('returns empty array when all aspects disabled', () => {
        const s = {
            ...DEFAULT_SETTINGS,
            aspects: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.aspects).map(k => [k, false])) as any,
        };
        expect(filterSkyAspects(sample, s)).toEqual([]);
    });
});

/* ── Natal-transit normalization ── */

describe('natalAspectName', () => {
    it('maps lowercase to canonical AspectName', () => {
        expect(natalAspectName('conjunction')).toBe('Conjunction');
        expect(natalAspectName('SQUARE')).toBe('Square');
        expect(natalAspectName('semi-sextile')).toBe('Semi-sextile');
        expect(natalAspectName('semisextile')).toBe('Semi-sextile');
    });
    it('returns null for unknown / empty', () => {
        expect(natalAspectName('')).toBeNull();
        expect(natalAspectName('garbage')).toBeNull();
    });
});

describe('natalTransitToSkyAspect', () => {
    it('reshapes a planet→planet natal transit', () => {
        const t: NatalTransit = {
            transit: { planet: 'Pluto', sign: 'Aquarius', degree: '5.48', isRetrograde: true },
            natal: { planet: 'Pluto', sign: 'Scorpio', degree: '5.83', house: 3 },
            aspect: 'square', symbol: '□', orb: '0.35', nature: 'major',
            isExact: true, isTight: true, phase: 'separating',
        };
        const out = natalTransitToSkyAspect(t)!;
        expect(out.aspectName).toBe('Square');
        expect(out.planet1).toBe('Pluto');
        expect(out.planet2).toBe('Pluto');
        expect(out.planet1Sign).toBe('Aquarius');
        expect(out.planet2Sign).toBe('Scorpio');
        expect(out.planet1Retrograde).toBe(true);
        expect(out.planet2Retrograde).toBe(false);
    });

    it('handles transit→angle (Ascendant / Midheaven)', () => {
        const t: NatalTransit = {
            transit: { planet: 'Mercury', sign: 'Gemini', degree: '1.18', isRetrograde: false },
            natal: { point: 'Ascendant', sign: 'Virgo', degree: '0.87', longitude: 150.87 },
            aspect: 'square', symbol: '□', orb: '0.31', nature: 'angular', isExact: true,
        };
        const out = natalTransitToSkyAspect(t)!;
        expect(out.planet2).toBe('Ascendant');
        expect(out.aspectName).toBe('Square');
    });

    it('returns null for unrecognized aspect name', () => {
        const t: NatalTransit = {
            transit: { planet: 'Sun', sign: 'Taurus', degree: '11', isRetrograde: false },
            natal: { planet: 'Sun', sign: 'Taurus', degree: '11' },
            aspect: 'frog', symbol: '?', orb: '0', nature: 'major', isExact: false,
        };
        expect(natalTransitToSkyAspect(t)).toBeNull();
    });
});

describe('filterNatalTransits', () => {
    const transits: NatalTransit[] = [
        { transit: { planet: 'Pluto', sign: 'Aquarius', degree: '5', isRetrograde: true },
          natal: { planet: 'Pluto', sign: 'Scorpio', degree: '6', house: 3 },
          aspect: 'square', symbol: '□', orb: '0.35', nature: 'major', isExact: true },
        { transit: { planet: 'Pluto', sign: 'Aquarius', degree: '5', isRetrograde: true },
          natal: { planet: 'Venus', sign: 'Gemini', degree: '6', house: 10 },
          aspect: 'trine', symbol: '△', orb: '0.58', nature: 'major', isExact: true },
        { transit: { planet: 'Mercury', sign: 'Gemini', degree: '1', isRetrograde: false },
          natal: { point: 'Ascendant', sign: 'Virgo', degree: '0.87' },
          aspect: 'square', symbol: '□', orb: '0.31', nature: 'angular', isExact: true },
        { transit: { planet: 'Chiron', sign: 'Gemini', degree: '12', isRetrograde: false },
          natal: { planet: 'Sun', sign: 'Taurus', degree: '11' },
          aspect: 'semi-sextile', symbol: '⚺', orb: '1', nature: 'minor', isExact: false },
    ];

    it('drops transits whose transit planet is disabled', () => {
        const s = { ...DEFAULT_SETTINGS, planets: { ...DEFAULT_SETTINGS.planets, Pluto: false } };
        const out = filterNatalTransits(transits, s);
        const planets = out.map(o => o.planet1);
        expect(planets).not.toContain('Pluto');
        expect(planets).toContain('Mercury');
    });

    it('drops transits whose aspect type is disabled (Semi-sextile off by default)', () => {
        const out = filterNatalTransits(transits, DEFAULT_SETTINGS);
        expect(out.find(o => o.planet1 === 'Chiron')).toBeUndefined();
    });

    it('drops transits with unknown transit planets (Chiron not in our PLANETS list)', () => {
        // Even with semi-sextile enabled, Chiron is not in our enabled-planets set
        const s = {
            ...DEFAULT_SETTINGS,
            aspects: { ...DEFAULT_SETTINGS.aspects, 'Semi-sextile': true },
        };
        const out = filterNatalTransits(transits, s);
        expect(out.find(o => o.planet1 === 'Chiron')).toBeUndefined();
    });

    it('passes through enabled planet+aspect combos and preserves order', () => {
        const out = filterNatalTransits(transits, DEFAULT_SETTINGS);
        expect(out.map(o => `${o.planet1}-${o.planet2}-${o.aspectName}`)).toEqual([
            'Pluto-Pluto-Square',
            'Pluto-Venus-Trine',
            'Mercury-Ascendant-Square',
        ]);
    });
});

/* ── Query/body builders ── */

describe('natalTransitQuery', () => {
    it('includes major=true and orb=N when configured', () => {
        const qs = natalTransitQuery({ ...DEFAULT_SETTINGS, majorOnly: true, natalOrb: 8 });
        expect(qs).toBe('?major=true&orb=8');
    });
    it('omits major when off', () => {
        const qs = natalTransitQuery({ ...DEFAULT_SETTINGS, majorOnly: false, natalOrb: 6 });
        expect(qs).toBe('?orb=6');
    });
    it('omits orb when not finite', () => {
        const qs = natalTransitQuery({ ...DEFAULT_SETTINGS, majorOnly: true, natalOrb: NaN as any });
        expect(qs).toBe('?major=true');
    });
});

describe('buildGenerateChartBody', () => {
    it('packs HTML date + time into year/month/day/hour/minute', () => {
        const body = buildGenerateChartBody({
            name: 'chris', date: '1986-05-01', time: '14:35',
            latitude: 28.5383, longitude: -81.3792,
            timezone: 'America/New_York',
        });
        expect(body).toEqual({
            name: 'chris',
            year: 1986, month: 5, day: 1, hour: 14, minute: 35,
            latitude: 28.5383, longitude: -81.3792,
            timezone: 'America/New_York',
            save: true,
        });
    });

    it('throws on missing required fields', () => {
        expect(() => buildGenerateChartBody({
            name: '', date: '1986-05-01', time: '14:35',
            latitude: 0, longitude: 0, timezone: 'UTC',
        })).toThrow();
        expect(() => buildGenerateChartBody({
            name: 'x', date: '', time: '14:35',
            latitude: 0, longitude: 0, timezone: 'UTC',
        })).toThrow();
        expect(() => buildGenerateChartBody({
            name: 'x', date: '1986-05-01', time: '',
            latitude: 0, longitude: 0, timezone: 'UTC',
        })).toThrow();
    });

    it('respects save=false', () => {
        const body = buildGenerateChartBody({
            name: 'x', date: '2020-01-01', time: '00:00',
            latitude: 0, longitude: 0, timezone: 'UTC', save: false,
        });
        expect(body.save).toBe(false);
    });
});

/* ── Formatters / glyphs ── */

describe('moonPhaseEmoji & planetGlyph', () => {
    it('returns expected emoji per phase, fallback 🌙', () => {
        expect(moonPhaseEmoji('New Moon')).toBe('🌑');
        expect(moonPhaseEmoji('Full Moon')).toBe('🌕');
        expect(moonPhaseEmoji('garbage')).toBe('🌙');
    });
    it('returns expected glyph per planet, fallback ★', () => {
        expect(planetGlyph('Sun')).toBe('☉');
        expect(planetGlyph('Ascendant')).toBe('ASC');
        expect(planetGlyph('Bulbasaur')).toBe('★');
    });
});

describe('formatPlanetLine & formatSkyAspectLine', () => {
    it('formats planet lines with retro mark', () => {
        expect(formatPlanetLine({ name: 'Mercury', sign: 'Gemini', degreeInSign: '1.18', isRetrograde: false }))
            .toBe('☿ Gemini 1.18˚');
        expect(formatPlanetLine({ name: 'Pluto', sign: 'Aquarius', degreeInSign: '5.48', isRetrograde: true }))
            .toBe('♇ Aquarius 5.48˚ ℞');
    });
    it('formats sky aspect lines', () => {
        const line = formatSkyAspectLine({
            planet1: 'Sun', planet2: 'Mercury', aspectName: 'Conjunction', aspectSymbol: '☌',
            exactAngle: '4', orb: '4', planet1Sign: 'Taurus', planet2Sign: 'Gemini',
            planet1Retrograde: false, planet2Retrograde: false,
        });
        expect(line).toBe('☉ ☌ ☿');
    });
    it('marks retrograde sides', () => {
        const line = formatSkyAspectLine({
            planet1: 'Pluto', planet2: 'Mars', aspectName: 'Square', aspectSymbol: '□',
            exactAngle: '90', orb: '0', planet1Sign: 'Aquarius', planet2Sign: 'Aries',
            planet1Retrograde: true, planet2Retrograde: false,
        });
        expect(line).toBe('♇ ℞ □ ♂');
    });
});

/* ── Cycle query builder ── */

describe('buildCycleQuery', () => {
    it('builds minimal query (planet, start, end)', () => {
        const { planet, query } = buildCycleQuery({
            planet: 'Venus', start: '2026-05-17', end: '2026-08-17',
        });
        expect(planet).toBe('venus');
        const params = new URLSearchParams(query);
        expect(params.get('start')).toBe('2026-05-17');
        expect(params.get('end')).toBe('2026-08-17');
    });

    it('includes interval and orb when set', () => {
        const { query } = buildCycleQuery({
            planet: 'mars', start: '2026-01-01', end: '2026-12-31',
            interval: 'weekly', orb: 0.5,
        });
        const params = new URLSearchParams(query);
        expect(params.get('interval')).toBe('weekly');
        expect(params.get('orb')).toBe('0.5');
    });

    it('appends natalChart as repeated params', () => {
        const { query } = buildCycleQuery({
            planet: 'jupiter', start: '2026-01-01', end: '2026-12-31',
            natalCharts: ['chris', 'megan'],
        });
        const params = new URLSearchParams(query);
        expect(params.getAll('natalChart')).toEqual(['chris', 'megan']);
    });

    it('joins natalPoints and aspects with commas', () => {
        const { query } = buildCycleQuery({
            planet: 'saturn', start: '2026-01-01', end: '2027-01-01',
            natalPoints: ['Sun', 'Mars', 'Ascendant'],
            aspects: ['conjunction', 'opposition'],
        });
        const params = new URLSearchParams(query);
        expect(params.get('natalPoints')).toBe('Sun,Mars,Ascendant');
        expect(params.get('aspects')).toBe('conjunction,opposition');
    });

    it('throws on missing required fields', () => {
        expect(() => buildCycleQuery({ planet: '', start: 'x', end: 'y' })).toThrow();
        expect(() => buildCycleQuery({ planet: 'mars', start: '', end: 'y' })).toThrow();
        expect(() => buildCycleQuery({ planet: 'mars', start: 'x', end: '' })).toThrow();
    });

    it('skips empty chart names', () => {
        const { query } = buildCycleQuery({
            planet: 'venus', start: '2026-01-01', end: '2026-06-01',
            natalCharts: ['', 'chris', ''],
        });
        const params = new URLSearchParams(query);
        expect(params.getAll('natalChart')).toEqual(['chris']);
    });
});

/* ── Settings migration: v1.2 → v1.3 (selectedChart → defaultChart + trackedCharts) ── */

describe('migrateSettings: v1.2 → v1.3 chart handling', () => {
    it('promotes selectedChart to defaultChart and seeds trackedCharts', () => {
        const v12 = {
            serverUrl: 'http://baratie:3000',
            selectedChart: 'chris',
            planets: {},
            aspects: {},
        };
        const out = migrateSettings(v12);
        expect(out.defaultChart).toBe('chris');
        expect(out.trackedCharts).toEqual(['chris']);
    });

    it('preserves explicit trackedCharts when given', () => {
        const v13 = {
            defaultChart: 'megan',
            trackedCharts: ['chris', 'megan'],
            planets: {},
            aspects: {},
        };
        const out = migrateSettings(v13);
        expect(out.defaultChart).toBe('megan');
        expect(out.trackedCharts).toEqual(['chris', 'megan']);
    });

    it('does not duplicate defaultChart in trackedCharts if already present', () => {
        const v13 = {
            defaultChart: 'chris',
            trackedCharts: ['chris', 'megan'],
            planets: {},
            aspects: {},
        };
        const out = migrateSettings(v13);
        expect(out.trackedCharts).toEqual(['chris', 'megan']);
    });

    it('fills cycle defaults when missing', () => {
        const v12 = { selectedChart: 'chris', planets: {}, aspects: {} };
        const out = migrateSettings(v12);
        expect(out.cycleInterval).toBe('daily');
        expect(out.cycleOrb).toBe(1);
        expect(out.cycleLookaheadMonths).toBe(6);
    });
});
