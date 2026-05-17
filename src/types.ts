/* Plain, dependency-free shared types. Pure code that lives here is
 * exercised by the test suite without needing to mock Obsidian. */

export const PLANETS = [
    'Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
    'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
] as const;
export type PlanetName = typeof PLANETS[number];

export const ASPECTS = [
    'Conjunction', 'Opposition', 'Trine', 'Square', 'Sextile',
    'Quincunx', 'Semi-sextile', 'Semi-square', 'Sesquiquadrate', 'Quintile',
] as const;
export type AspectName = typeof ASPECTS[number];

export const ASPECT_SYMBOLS: Record<AspectName, string> = {
    'Conjunction': '☌',
    'Opposition': '☍',
    'Trine': '△',
    'Square': '□',
    'Sextile': '⚹',
    'Quincunx': '⚻',
    'Semi-sextile': '⚺',
    'Semi-square': '⚼',
    'Sesquiquadrate': '⚿',
    'Quintile': 'Q',
};

export const PLANET_GLYPHS: Record<string, string> = {
    Sun: '☉', Moon: '☽', Mercury: '☿', Venus: '♀', Mars: '♂',
    Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Pluto: '♇',
    'North Node': '☊', 'South Node': '☋', Chiron: '⚷',
    Ascendant: 'ASC', Midheaven: 'MC',
};

export const MOON_PHASE_EMOJI: Record<string, string> = {
    'New Moon': '🌑',
    'Waxing Crescent': '🌒',
    'First Quarter': '🌓',
    'Waxing Gibbous': '🌔',
    'Full Moon': '🌕',
    'Waning Gibbous': '🌖',
    'Last Quarter': '🌗',
    'Waning Crescent': '🌘',
};

export interface MoonData {
    moonPhase: string;
    moonSign: string;
    degreeInSign: string;
    moonAge?: string;
    localEasternTime?: string;
}

export interface PlanetPosition {
    name: string;
    sign: string;
    degreeInSign: string;
    isRetrograde: boolean;
    longitude?: number;
}

export interface PlanetsResponse {
    localEasternTime: string;
    planets: PlanetPosition[];
}

/* Sky-to-sky aspect — shape returned by /aspects-now. */
export interface SkyAspect {
    planet1: string;
    planet2: string;
    aspectName: string;
    aspectSymbol: string;
    exactAngle: string;
    orb: string;
    planet1Sign: string;
    planet2Sign: string;
    planet1Retrograde: boolean;
    planet2Retrograde: boolean;
}

export interface AspectsResponse {
    localEasternTime: string;
    aspects: SkyAspect[];
}

/* Natal transit — shape returned by /transits/:name/now. Note the schema
 * differs from /aspects-now: aspect names are lowercase, fields are nested. */
export interface NatalTransit {
    transit: {
        planet: string;
        sign: string;
        degree: string;
        isRetrograde: boolean;
        speed?: number;
    };
    natal: {
        planet?: string;     // when transit hits a natal planet
        point?: string;      // when transit hits an angle (Ascendant, Midheaven)
        sign: string;
        degree: string;
        house?: number;
        longitude?: number;
    };
    aspect: string;          // lowercase: "conjunction", "square", etc.
    symbol: string;
    orb: string;
    nature: string;          // "major" | "angular" | ...
    isExact: boolean;
    isTight?: boolean;
    phase?: 'applying' | 'separating' | 'exact';
    isToLordOfYear?: boolean;
}

export interface NatalTransitsResponse {
    name: string;
    timestamp: string;
    currentAge?: number;
    profection?: {
        lordOfYear: string;
        activatedHouse: number;
        profectedSign: string;
    };
    transitCount: number;
    transits: NatalTransit[];
}

export interface ChartsListResponse {
    charts: string[];
}

/* ── Settings shape ── */

export interface MoonPluginSettings {
    serverUrl: string;
    selectedChart: string;            // saved-chart name, empty = sky-to-sky mode
    useNatalChart: boolean;           // when on + selectedChart set, aspect commands hit /transits/:name/now
    majorOnly: boolean;               // pass major=true to natal transit endpoint
    natalOrb: number;                 // pass orb=N to natal transit endpoint
    planets: Record<PlanetName, boolean>;
    aspects: Record<AspectName, boolean>;
}

export const DEFAULT_SETTINGS: MoonPluginSettings = {
    serverUrl: 'http://localhost:3000',
    selectedChart: '',
    useNatalChart: false,
    majorOnly: true,
    natalOrb: 8,
    planets: {
        Sun: true, Moon: true, Mercury: true, Venus: true, Mars: true,
        Jupiter: true, Saturn: true, Uranus: true, Neptune: true, Pluto: true,
    },
    aspects: {
        Conjunction: true, Opposition: true, Trine: true, Square: true, Sextile: true,
        Quincunx: false, 'Semi-sextile': false, 'Semi-square': false,
        Sesquiquadrate: false, Quintile: false,
    },
};

/* ── Body shape for POST /generate-chart on the real server ── */

export interface GenerateChartBody {
    name: string;
    year: number;
    month: number;       // 1-12
    day: number;         // 1-31
    hour: number;        // 0-23
    minute: number;      // 0-59
    latitude: number;
    longitude: number;
    timezone: string;    // IANA
    save: boolean;
}
