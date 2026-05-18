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

/* /cycle/:planet response */
export interface CycleTimelinePoint {
    date: string;
    jd?: number;
    longitude: number;
    sign: string;
    degreeInSign: string;
    isRetrograde: boolean;
}

export interface CycleNatalEvent {
    chart: string;
    transitDate: string;
    transitLongitude: number;
    natalPoint: string;
    natalLongitude: number;
    aspect: string;
    orb: number;
    isExact?: boolean;
    isApplying?: boolean;
}

export interface CycleResponse {
    planet: string;
    start: string;
    end: string;
    interval: string;
    intervalHours: number;
    cyclePeriodDays?: number;
    pointCount: number;
    timeline: CycleTimelinePoint[];
    natalCharts: string[];
    natalEventCount: number;
    natalEvents: CycleNatalEvent[];
}

/* ── Settings shape ── */

export interface TechniqueSettings {
    ki: boolean;
    hexagram: boolean;
    midpoints: boolean;
    eclipses: boolean;
    dashas: boolean;
}

export type DayHexagramMethod = 'plum-blossom' | 'ymd-hash';

/* Oracle settings — currently I Ching only. Tarot will land here later. */
export interface OracleSettings {
    hexagramSource: string;          // source_title CONTAINS filter for DeKorne lookup
    journalFolder: string;           // vault folder for saved casts
    dayMethod: DayHexagramMethod;    // how "From the day" derives a hexagram
    autosaveCasts: boolean;          // when on, every modal cast is journaled
}

export type LLMProviderId = 'off' | 'openai' | 'anthropic' | 'ollama';

export interface LLMSettings {
    provider: LLMProviderId;
    model: string;
    openaiBaseUrl: string;
    openaiApiKey: string;
    anthropicBaseUrl: string;
    anthropicApiKey: string;
    ollamaBaseUrl: string;
    maxTokens: number;
    temperature: number;
    memoryFolder: string;        // vault folder for saved readings
    knowledgeLimit: number;      // chunks to retrieve per synthesis call
}

export type KnowledgeBackendId = 'off' | 'neo4j';

export interface KnowledgeSettings {
    backend: KnowledgeBackendId;
    neo4jHttpUri: string;       // http://localhost:7474
    neo4jDatabase: string;       // default 'neo4j'
    neo4jUser: string;
    neo4jPassword: string;
    neo4jIndexName: string;
    defaultResultLimit: number;
    hexagramSource: string;      // i.e. "Gnostic Book of Changes" — used to scope hexagram lookups
}

export interface MoonPluginSettings {
    serverUrl: string;
    knowledge: KnowledgeSettings;
    llm: LLMSettings;
    oracle: OracleSettings;
    // ── Charts ──
    trackedCharts: string[];          // saved-chart names the user cares about
    defaultChart: string;             // one of trackedCharts; used when a command needs a single chart
    // ── Aspect / transit behavior ──
    useNatalChart: boolean;           // when on + defaultChart set, aspect commands hit /transits/:name/now
    majorOnly: boolean;
    natalOrb: number;
    planets: Record<PlanetName, boolean>;
    aspects: Record<AspectName, boolean>;
    // ── Techniques ──
    techniques: TechniqueSettings;
    midpointOrb: number;
    eclipseLookaheadMonths: number;
    birthDate: string;
    // ── Cycle defaults ──
    cycleInterval: 'hourly' | '6h' | 'daily' | 'weekly';
    cycleOrb: number;
    cycleLookaheadMonths: number;
}

export const DEFAULT_SETTINGS: MoonPluginSettings = {
    serverUrl: 'http://localhost:3000',
    trackedCharts: [],
    defaultChart: '',
    useNatalChart: false,
    majorOnly: true,
    natalOrb: 8,
    cycleInterval: 'daily',
    cycleOrb: 1,
    cycleLookaheadMonths: 6,
    knowledge: {
        backend: 'off',
        neo4jHttpUri: 'http://localhost:7474',
        neo4jDatabase: 'neo4j',
        neo4jUser: 'neo4j',
        neo4jPassword: '',
        neo4jIndexName: 'interpretation_text',
        defaultResultLimit: 5,
        hexagramSource: 'Gnostic Book of Changes',
    },
    oracle: {
        hexagramSource: 'Gnostic Book of Changes',
        journalFolder: 'ObsidianMoon/oracle',
        dayMethod: 'plum-blossom',
        autosaveCasts: false,
    },
    llm: {
        provider: 'off',
        model: 'claude-sonnet-4-6',
        openaiBaseUrl: 'https://api.openai.com',
        openaiApiKey: '',
        anthropicBaseUrl: 'https://api.anthropic.com',
        anthropicApiKey: '',
        ollamaBaseUrl: 'http://localhost:11434',
        maxTokens: 1500,
        temperature: 0.7,
        memoryFolder: 'ObsidianMoon/memory',
        knowledgeLimit: 6,
    },
    planets: {
        Sun: true, Moon: true, Mercury: true, Venus: true, Mars: true,
        Jupiter: true, Saturn: true, Uranus: true, Neptune: true, Pluto: true,
    },
    aspects: {
        Conjunction: true, Opposition: true, Trine: true, Square: true, Sextile: true,
        Quincunx: false, 'Semi-sextile': false, 'Semi-square': false,
        Sesquiquadrate: false, Quintile: false,
    },
    techniques: {
        ki: true,
        hexagram: true,
        midpoints: false,
        eclipses: false,
        dashas: false,
    },
    midpointOrb: 2,
    eclipseLookaheadMonths: 12,
    birthDate: '',
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
