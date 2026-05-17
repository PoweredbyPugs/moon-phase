import {
    App,
    Editor,
    MarkdownView,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    requestUrl,
} from 'obsidian';

/* ──────────────────────────────────────────────────────────────────────── *
 * Types
 * ──────────────────────────────────────────────────────────────────────── */

interface MoonData {
    moonPhase: string;
    moonSign: string;
    degreeInSign: string;
    localEasternTime?: string;
}

interface WeeklyMoonPhase {
    date: string;
    moonPhase: string;
    moonSign: string;
}

interface PlanetData {
    name: string;
    sign: string;
    degreeInSign: string;
    isRetrograde: boolean;
    longitude?: number;
}

interface PlanetsResponse {
    localTime: string;
    planets: PlanetData[];
}

interface AspectData {
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
    natal?: boolean; // true if this is a transit-to-natal aspect (planet2 is natal)
}

interface AspectsResponse {
    localTime: string;
    aspects: AspectData[];
}

interface NatalChartResponse {
    planets: PlanetData[];
    houses?: { house: number; sign: string; degreeInSign: string; longitude: number }[];
    ascendant?: { sign: string; degreeInSign: string; longitude: number };
    midheaven?: { sign: string; degreeInSign: string; longitude: number };
}

type PlanetName =
    | 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars'
    | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune' | 'Pluto';

type AspectName =
    | 'Conjunction' | 'Opposition' | 'Trine' | 'Square' | 'Sextile'
    | 'Quincunx' | 'Semi-sextile' | 'Semi-square' | 'Sesquiquadrate' | 'Quintile';

const PLANETS: PlanetName[] = [
    'Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
    'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
];

const ASPECTS: AspectName[] = [
    'Conjunction', 'Opposition', 'Trine', 'Square', 'Sextile',
    'Quincunx', 'Semi-sextile', 'Semi-square', 'Sesquiquadrate', 'Quintile',
];

const ASPECT_SYMBOLS: Record<AspectName, string> = {
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

/* ──────────────────────────────────────────────────────────────────────── *
 * Settings
 * ──────────────────────────────────────────────────────────────────────── */

interface BirthChart {
    date: string;          // YYYY-MM-DD
    time: string;          // HH:mm (24h, local)
    locationName: string;  // human-readable
    latitude: number;      // decimal degrees, N positive
    longitude: number;     // decimal degrees, E positive
    timezone: string;      // IANA tz, e.g. America/New_York
}

interface MoonPluginSettings {
    serverUrl: string;
    timezone: string;          // user's current timezone (drives "now" lookups)
    useNatalChart: boolean;    // when on, transit commands compute aspects to natal
    birth: BirthChart;
    planets: Record<PlanetName, boolean>;
    aspects: Record<AspectName, boolean>;
    orbs: Record<AspectName, number>;
}

const DEFAULT_ORBS: Record<AspectName, number> = {
    'Conjunction': 8,
    'Opposition': 8,
    'Trine': 7,
    'Square': 7,
    'Sextile': 5,
    'Quincunx': 3,
    'Semi-sextile': 2,
    'Semi-square': 2,
    'Sesquiquadrate': 2,
    'Quintile': 2,
};

const DEFAULT_SETTINGS: MoonPluginSettings = {
    serverUrl: 'http://localhost:3000',
    timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    useNatalChart: false,
    birth: {
        date: '',
        time: '12:00',
        locationName: '',
        latitude: 0,
        longitude: 0,
        timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    },
    planets: {
        'Sun': true, 'Moon': true, 'Mercury': true, 'Venus': true, 'Mars': true,
        'Jupiter': true, 'Saturn': true, 'Uranus': true, 'Neptune': true, 'Pluto': true,
    },
    aspects: {
        'Conjunction': true, 'Opposition': true, 'Trine': true, 'Square': true, 'Sextile': true,
        'Quincunx': false, 'Semi-sextile': false, 'Semi-square': false, 'Sesquiquadrate': false, 'Quintile': false,
    },
    orbs: { ...DEFAULT_ORBS },
};

/* ──────────────────────────────────────────────────────────────────────── *
 * Plugin
 * ──────────────────────────────────────────────────────────────────────── */

export default class MoonPlugin extends Plugin {
    settings!: MoonPluginSettings;

    // Public API surface — bound so Templater can call them via window.MoonPhasePlugin
    public api = {
        getMoonData: this.getMoonData.bind(this),
        getMoonPhaseEmoji: this.getMoonPhaseEmoji.bind(this),
        getCurrentMoonPhase: this.getCurrentMoonPhase.bind(this),
        getCurrentMoonDegree: this.getCurrentMoonDegree.bind(this),
        getWeeklyPhase: this.getWeeklyPhase.bind(this),
        getWeeklyMajorPhase: this.getWeeklyMajorPhase.bind(this),
        getPlanetaryData: this.getPlanetaryData.bind(this),
        getPlanetGlyph: this.getPlanetGlyph.bind(this),
        getAspectsData: this.getAspectsData.bind(this),
        getTransitsToNatal: this.getTransitsToNatal.bind(this),
        getNatalChart: this.getNatalChart.bind(this),
    };

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new MoonSettingTab(this.app, this));

        // Expose for Templater
        (window as any).MoonPhasePlugin = this.api;

        /* ── Phase / Moon ── */
        this.addCommand({
            id: 'current-moon-phase',
            name: 'Current Moon Phase',
            editorCallback: (editor: Editor) => {
                this.getCurrentMoonPhase().then(s => editor.replaceSelection(s));
            },
        });

        this.addCommand({
            id: 'current-moon-degree',
            name: 'Current Moon Degree',
            editorCallback: (editor: Editor) => {
                this.getCurrentMoonDegree().then(s => editor.replaceSelection(s));
            },
        });

        this.addCommand({
            id: 'weekly-phase',
            name: 'Weekly Phase',
            editorCallback: (editor: Editor) => {
                this.getWeeklyPhase().then(s => editor.replaceSelection(s));
            },
        });

        /* ── Planet positions ── */
        this.addCommand({
            id: 'planetary-positions',
            name: 'All Planetary Positions',
            editorCallback: (editor: Editor) => {
                this.getPlanetaryData().then(data => {
                    const output = data.planets.map(p => this.formatPlanetLine(p)).join('\n');
                    editor.replaceSelection(output);
                }).catch(err => this.handleError(editor, 'planetary data', err));
            },
        });

        for (const planetName of PLANETS) {
            this.addCommand({
                id: `${planetName.toLowerCase()}-position`,
                name: `${planetName} Position`,
                editorCallback: (editor: Editor) => {
                    this.getPlanetaryData().then(data => {
                        const planet = data.planets.find(p => p.name === planetName);
                        if (planet) editor.replaceSelection(this.formatPlanetLine(planet));
                        else editor.replaceSelection(`Error: ${planetName} data not found`);
                    }).catch(err => this.handleError(editor, `${planetName} data`, err));
                },
            });
        }

        /* ── Aspects ── */
        this.addCommand({
            id: 'all-aspects',
            name: 'All Current Aspects',
            editorCallback: (editor: Editor) => {
                this.getAspectsData().then(data => {
                    if (data.aspects.length === 0) {
                        editor.replaceSelection('No significant aspects currently.');
                        return;
                    }
                    editor.replaceSelection(data.aspects.map(a => this.formatAspectLine(a)).join('\n'));
                }).catch(err => this.handleError(editor, 'aspects data', err));
            },
        });

        for (const planetName of PLANETS) {
            this.addCommand({
                id: `${planetName.toLowerCase()}-aspects`,
                name: `${planetName} Aspects`,
                editorCallback: (editor: Editor) => {
                    this.getAspectsData().then(data => {
                        const relevant = data.aspects.filter(a =>
                            a.planet1 === planetName || a.planet2 === planetName,
                        );
                        if (relevant.length === 0) {
                            editor.replaceSelection(`No significant aspects for ${planetName} currently.`);
                            return;
                        }
                        // Always show the asked-for planet on the left for clarity
                        const output = relevant.map(a => {
                            const reordered = a.planet1 === planetName ? a : {
                                ...a,
                                planet1: a.planet2,
                                planet2: a.planet1,
                                planet1Sign: a.planet2Sign,
                                planet2Sign: a.planet1Sign,
                                planet1Retrograde: a.planet2Retrograde,
                                planet2Retrograde: a.planet1Retrograde,
                            };
                            return this.formatAspectLine(reordered);
                        }).join('\n');
                        editor.replaceSelection(output);
                    }).catch(err => this.handleError(editor, `${planetName} aspects`, err));
                },
            });
        }

        for (const aspectName of ['Conjunction', 'Opposition', 'Trine', 'Square', 'Sextile'] as AspectName[]) {
            this.addCommand({
                id: `${aspectName.toLowerCase()}-aspects`,
                name: `${aspectName} Aspects`,
                editorCallback: (editor: Editor) => {
                    this.getAspectsData().then(data => {
                        const relevant = data.aspects.filter(a => a.aspectName === aspectName);
                        if (relevant.length === 0) {
                            editor.replaceSelection(`No ${aspectName} aspects currently.`);
                            return;
                        }
                        editor.replaceSelection(relevant.map(a => this.formatAspectLine(a)).join('\n'));
                    }).catch(err => this.handleError(editor, `${aspectName} aspects`, err));
                },
            });
        }
    }

    onunload() {
        try { delete (window as any).MoonPhasePlugin; } catch { /* ignore */ }
    }

    /* ── Settings IO + migration from v1 (flat enableX fields) ── */
    async loadSettings() {
        const raw: any = (await this.loadData()) || {};
        const migrated = this.migrate(raw);
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...migrated,
            birth: { ...DEFAULT_SETTINGS.birth, ...(migrated.birth || {}) },
            planets: { ...DEFAULT_SETTINGS.planets, ...(migrated.planets || {}) },
            aspects: { ...DEFAULT_SETTINGS.aspects, ...(migrated.aspects || {}) },
            orbs: { ...DEFAULT_SETTINGS.orbs, ...(migrated.orbs || {}) },
        };
    }

    private migrate(raw: any): Partial<MoonPluginSettings> {
        // If already in new shape, just pass it through.
        if (raw.planets || raw.aspects || raw.orbs || raw.birth) return raw;

        // v1 had flat enableSun/enableMoon/.../enableConjunction/... fields.
        const out: any = {
            serverUrl: raw.serverUrl ?? DEFAULT_SETTINGS.serverUrl,
            planets: {} as Record<PlanetName, boolean>,
            aspects: {} as Record<AspectName, boolean>,
        };
        const mapPlanet: Record<string, PlanetName> = {
            enableSun: 'Sun', enableMoon: 'Moon', enableMercury: 'Mercury', enableVenus: 'Venus',
            enableMars: 'Mars', enableJupiter: 'Jupiter', enableSaturn: 'Saturn',
            enableUranus: 'Uranus', enableNeptune: 'Neptune', enablePluto: 'Pluto',
        };
        const mapAspect: Record<string, AspectName> = {
            enableConjunction: 'Conjunction', enableOpposition: 'Opposition',
            enableTrine: 'Trine', enableSquare: 'Square', enableSextile: 'Sextile',
            enableQuincunx: 'Quincunx', enableSemiSextile: 'Semi-sextile',
            enableSemiSquare: 'Semi-square', enableSesquiquadrate: 'Sesquiquadrate',
            enableQuintile: 'Quintile',
        };
        for (const k of Object.keys(mapPlanet)) {
            if (typeof raw[k] === 'boolean') out.planets[mapPlanet[k]] = raw[k];
        }
        for (const k of Object.keys(mapAspect)) {
            if (typeof raw[k] === 'boolean') out.aspects[mapAspect[k]] = raw[k];
        }
        return out;
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /* ── HTTP: always use Obsidian's requestUrl (no CORS preflight from app:// origin) ── */
    private async req<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
        const base = this.settings.serverUrl.replace(/\/+$/, '');
        const url = `${base}${path.startsWith('/') ? path : '/' + path}`;
        const res = await requestUrl({
            url,
            method: opts?.method ?? 'GET',
            contentType: opts?.body ? 'application/json' : undefined,
            body: opts?.body ? JSON.stringify(opts.body) : undefined,
            throw: false,
        });
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`HTTP ${res.status} from ${url}: ${res.text?.slice(0, 200) ?? ''}`);
        }
        return res.json as T;
    }

    /* ── Data fetchers ── */
    async getMoonData(): Promise<MoonData> {
        return this.req<MoonData>(`/moon-now?tz=${encodeURIComponent(this.settings.timezone)}`);
    }

    async getPlanetaryData(): Promise<PlanetsResponse> {
        const data = await this.req<PlanetsResponse>(
            `/planets-now?tz=${encodeURIComponent(this.settings.timezone)}`,
        );
        return {
            ...data,
            planets: data.planets.filter(p => this.settings.planets[p.name as PlanetName]),
        };
    }

    async getAspectsData(): Promise<AspectsResponse> {
        if (this.settings.useNatalChart && this.hasBirthChart()) {
            return this.getTransitsToNatal();
        }
        const params = this.buildAspectQuery();
        const data = await this.req<AspectsResponse>(`/aspects-now?${params}`);
        return data;
    }

    async getTransitsToNatal(): Promise<AspectsResponse> {
        if (!this.hasBirthChart()) {
            throw new Error('Birth chart not configured — set it in Moon Phase settings.');
        }
        const body = {
            tz: this.settings.timezone,
            birth: this.settings.birth,
            planets: this.enabledList(this.settings.planets),
            aspects: this.enabledAspectsWithOrbs(),
        };
        return this.req<AspectsResponse>('/transits-to-natal', { method: 'POST', body });
    }

    async getNatalChart(): Promise<NatalChartResponse> {
        if (!this.hasBirthChart()) {
            throw new Error('Birth chart not configured — set it in Moon Phase settings.');
        }
        return this.req<NatalChartResponse>('/natal-chart', {
            method: 'POST',
            body: { birth: this.settings.birth },
        });
    }

    async getWeeklyMajorPhase(): Promise<WeeklyMoonPhase | null> {
        try {
            const data = await this.req<any>(
                `/weekly-major-phase?tz=${encodeURIComponent(this.settings.timezone)}`,
            );
            if (data.moonPhase) {
                return { date: data.date, moonPhase: data.moonPhase, moonSign: data.moonSign };
            }
            return null;
        } catch (err) {
            console.error('Error fetching weekly moon phase:', err);
            return null;
        }
    }

    /* ── Templater-friendly string helpers ── */
    async getCurrentMoonPhase(): Promise<string> {
        try {
            const m = await this.getMoonData();
            return `${this.getMoonPhaseEmoji(m.moonPhase)} ${m.moonSign}`;
        } catch {
            return 'Error fetching moon data';
        }
    }

    async getCurrentMoonDegree(): Promise<string> {
        try {
            const m = await this.getMoonData();
            return `${this.getMoonPhaseEmoji(m.moonPhase)} ${m.moonSign} ${m.degreeInSign}˚`;
        } catch {
            return 'Error fetching moon data';
        }
    }

    async getWeeklyPhase(): Promise<string> {
        const phase = await this.getWeeklyMajorPhase();
        if (!phase) return 'No major moon phase this week.';
        return `${this.getMoonPhaseEmoji(phase.moonPhase)} ${phase.moonSign}`;
    }

    /* ── Helpers ── */
    private hasBirthChart(): boolean {
        const b = this.settings.birth;
        return !!(b.date && b.time && b.timezone &&
            Number.isFinite(b.latitude) && Number.isFinite(b.longitude));
    }

    private enabledList<K extends string>(map: Record<K, boolean>): K[] {
        return (Object.keys(map) as K[]).filter(k => map[k]);
    }

    private enabledAspectsWithOrbs(): Array<{ name: AspectName; orb: number }> {
        return ASPECTS
            .filter(a => this.settings.aspects[a])
            .map(a => ({ name: a, orb: this.settings.orbs[a] ?? DEFAULT_ORBS[a] }));
    }

    private buildAspectQuery(): string {
        const params = new URLSearchParams();
        params.set('tz', this.settings.timezone);
        for (const p of this.enabledList(this.settings.planets)) params.append('planets', p);
        for (const { name, orb } of this.enabledAspectsWithOrbs()) {
            params.append('aspects', name);
            params.append(`orb_${name}`, String(orb));
        }
        return params.toString();
    }

    private formatPlanetLine(p: PlanetData): string {
        const glyph = this.getPlanetGlyph(p.name);
        const retro = p.isRetrograde ? ' ℞' : '';
        return `${glyph} ${p.sign} ${p.degreeInSign}˚${retro}`;
    }

    private formatAspectLine(a: AspectData): string {
        const g1 = this.getPlanetGlyph(a.planet1);
        const g2 = this.getPlanetGlyph(a.planet2);
        const r1 = a.planet1Retrograde ? ' ℞' : '';
        const r2 = a.planet2Retrograde ? ' ℞' : '';
        const natalTag = a.natal ? ' (natal)' : '';
        return `${g1}${r1} ${a.aspectSymbol} ${g2}${r2}${natalTag}`;
    }

    private handleError(editor: Editor, what: string, err: unknown) {
        console.error(`Error fetching ${what}:`, err);
        editor.replaceSelection(`Error fetching ${what}. Check console for details.`);
    }

    getMoonPhaseEmoji(phase: string): string {
        switch (phase) {
            case 'New Moon': return '🌑';
            case 'Waxing Crescent': return '🌒';
            case 'First Quarter': return '🌓';
            case 'Waxing Gibbous': return '🌔';
            case 'Full Moon': return '🌕';
            case 'Waning Gibbous': return '🌖';
            case 'Last Quarter': return '🌗';
            case 'Waning Crescent': return '🌘';
            default: return '🌙';
        }
    }

    getPlanetGlyph(planetName: string): string {
        switch (planetName) {
            case 'Sun': return '☉';
            case 'Moon': return '☽';
            case 'Mercury': return '☿';
            case 'Venus': return '♀';
            case 'Mars': return '♂';
            case 'Jupiter': return '♃';
            case 'Saturn': return '♄';
            case 'Uranus': return '♅';
            case 'Neptune': return '♆';
            case 'Pluto': return '♇';
            case 'Ascendant': return 'ASC';
            case 'Midheaven': return 'MC';
            default: return '★';
        }
    }
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Settings UI — tabbed, following the Periodic Ritual pattern
 * ──────────────────────────────────────────────────────────────────────── */

type TabId = 'general' | 'birth' | 'planets' | 'aspects';

interface NominatimResult {
    display_name: string;
    lat: string;
    lon: string;
}

class MoonSettingTab extends PluginSettingTab {
    plugin: MoonPlugin;
    private activeTab: TabId = 'general';
    private locationSearchTimer: number | null = null;

    constructor(app: App, plugin: MoonPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Moon Phase Settings' });

        const tabs: Array<{ id: TabId; label: string }> = [
            { id: 'general', label: 'General' },
            { id: 'birth', label: 'Birth Chart' },
            { id: 'planets', label: 'Planets' },
            { id: 'aspects', label: 'Aspects' },
        ];

        const bar = containerEl.createDiv({ cls: 'moon-tab-bar' });
        for (const t of tabs) {
            const btn = bar.createEl('button', {
                text: t.label,
                cls: 'moon-tab' + (this.activeTab === t.id ? ' moon-tab-active' : ''),
            });
            btn.addEventListener('click', () => {
                this.activeTab = t.id;
                this.display();
            });
        }

        const body = containerEl.createDiv({ cls: 'moon-tab-content' });
        switch (this.activeTab) {
            case 'general': this.renderGeneral(body); break;
            case 'birth':   this.renderBirth(body); break;
            case 'planets': this.renderPlanets(body); break;
            case 'aspects': this.renderAspects(body); break;
        }
    }

    /* ── General ── */
    private renderGeneral(c: HTMLElement) {
        new Setting(c)
            .setName('Server URL')
            .setDesc('URL to the Swiss Ephemeris server (no trailing slash).')
            .addText(text => text
                .setPlaceholder('http://localhost:3000')
                .setValue(this.plugin.settings.serverUrl)
                .onChange(async (value) => {
                    this.plugin.settings.serverUrl = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('Timezone')
            .setDesc('IANA timezone used to interpret "now" for sky calculations. Defaults to your system timezone.')
            .addText(text => text
                .setPlaceholder('America/New_York')
                .setValue(this.plugin.settings.timezone)
                .onChange(async (value) => {
                    this.plugin.settings.timezone = value.trim() || DEFAULT_SETTINGS.timezone;
                    await this.plugin.saveSettings();
                }))
            .addExtraButton(btn => btn
                .setIcon('reset')
                .setTooltip('Detect from system')
                .onClick(async () => {
                    this.plugin.settings.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(c)
            .setName('Use natal chart for transits')
            .setDesc('When on, aspect commands return transits to your natal chart (planets in the sky now → your birth planets) instead of sky-to-sky aspects. Requires a configured birth chart.')
            .addToggle(t => t
                .setValue(this.plugin.settings.useNatalChart)
                .onChange(async (v) => {
                    this.plugin.settings.useNatalChart = v;
                    await this.plugin.saveSettings();
                }));

        const testWrap = c.createDiv({ cls: 'moon-test-wrap' });
        new Setting(testWrap)
            .setName('Test server connection')
            .setDesc('Pings /test on the configured server.')
            .addButton(btn => btn
                .setButtonText('Test')
                .setCta()
                .onClick(async () => {
                    btn.setDisabled(true).setButtonText('Testing…');
                    try {
                        const base = this.plugin.settings.serverUrl.replace(/\/+$/, '');
                        const res = await requestUrl({ url: `${base}/test`, throw: false });
                        if (res.status >= 200 && res.status < 300) {
                            new Notice(`Server OK: ${res.json?.status ?? 'reachable'}`);
                        } else {
                            new Notice(`Server returned ${res.status}`);
                        }
                    } catch (err: any) {
                        new Notice(`Connection failed: ${err?.message ?? err}`);
                    } finally {
                        btn.setDisabled(false).setButtonText('Test');
                    }
                }));
    }

    /* ── Birth Chart ── */
    private renderBirth(c: HTMLElement) {
        const intro = c.createEl('p', { cls: 'moon-tab-intro' });
        intro.setText('Your birth data is sent to your local Swiss Ephemeris server when computing natal charts and transits-to-natal. It never leaves your machine.');

        const b = this.plugin.settings.birth;

        // Date — native HTML date input
        const dateSetting = new Setting(c)
            .setName('Birth date')
            .setDesc('Used for the natal chart.');
        const dateInput = dateSetting.controlEl.createEl('input', { type: 'date' }) as HTMLInputElement;
        dateInput.value = b.date || '';
        dateInput.addEventListener('change', async () => {
            this.plugin.settings.birth.date = dateInput.value;
            await this.plugin.saveSettings();
        });

        // Time — native HTML time input
        const timeSetting = new Setting(c)
            .setName('Birth time')
            .setDesc('Local time at the place of birth (24-hour, HH:mm). Accuracy matters most for the Ascendant / houses.');
        const timeInput = timeSetting.controlEl.createEl('input', { type: 'time' }) as HTMLInputElement;
        timeInput.value = b.time || '12:00';
        timeInput.step = '60';
        timeInput.addEventListener('change', async () => {
            this.plugin.settings.birth.time = timeInput.value;
            await this.plugin.saveSettings();
        });

        // Location search (Nominatim / OpenStreetMap)
        const locWrap = c.createDiv({ cls: 'moon-loc-wrap' });
        new Setting(locWrap)
            .setName('Location')
            .setDesc('Type a city or address, then pick a result. Latitude, longitude, and timezone are filled automatically.')
            .addText(text => {
                text.setPlaceholder('e.g. Asheville, NC')
                    .setValue(b.locationName)
                    .onChange((value) => {
                        // Debounced geocode
                        if (this.locationSearchTimer) window.clearTimeout(this.locationSearchTimer);
                        const query = value.trim();
                        if (query.length < 3) {
                            results.empty();
                            return;
                        }
                        this.locationSearchTimer = window.setTimeout(() => this.searchLocations(query, results), 400);
                    });
                return text;
            });

        const results = locWrap.createDiv({ cls: 'moon-loc-results' });

        // Manual lat/lng/timezone fields (in case you want to enter them directly)
        new Setting(c)
            .setName('Latitude')
            .setDesc('Decimal degrees, north positive.')
            .addText(text => text
                .setPlaceholder('35.5951')
                .setValue(Number.isFinite(b.latitude) ? String(b.latitude) : '')
                .onChange(async (value) => {
                    const n = parseFloat(value);
                    if (Number.isFinite(n)) {
                        this.plugin.settings.birth.latitude = n;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(c)
            .setName('Longitude')
            .setDesc('Decimal degrees, east positive.')
            .addText(text => text
                .setPlaceholder('-82.5515')
                .setValue(Number.isFinite(b.longitude) ? String(b.longitude) : '')
                .onChange(async (value) => {
                    const n = parseFloat(value);
                    if (Number.isFinite(n)) {
                        this.plugin.settings.birth.longitude = n;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(c)
            .setName('Birth timezone')
            .setDesc('IANA timezone of the birth location (e.g. America/New_York). Auto-filled by location search.')
            .addText(text => text
                .setPlaceholder('America/New_York')
                .setValue(b.timezone)
                .onChange(async (value) => {
                    this.plugin.settings.birth.timezone = value.trim();
                    await this.plugin.saveSettings();
                }));

        // Preview / clear actions
        const actions = c.createDiv({ cls: 'moon-birth-actions' });
        new Setting(actions)
            .addButton(btn => btn
                .setButtonText('Preview natal chart')
                .setCta()
                .onClick(async () => {
                    btn.setDisabled(true).setButtonText('Computing…');
                    try {
                        const chart = await this.plugin.getNatalChart();
                        const lines = chart.planets.map(p =>
                            `${this.plugin.getPlanetGlyph(p.name)} ${p.name}: ${p.sign} ${p.degreeInSign}˚${p.isRetrograde ? ' ℞' : ''}`);
                        if (chart.ascendant) {
                            lines.unshift(`ASC: ${chart.ascendant.sign} ${chart.ascendant.degreeInSign}˚`);
                        }
                        if (chart.midheaven) {
                            lines.push(`MC: ${chart.midheaven.sign} ${chart.midheaven.degreeInSign}˚`);
                        }
                        new Notice(lines.join('\n'), 12000);
                    } catch (err: any) {
                        new Notice(`Preview failed: ${err?.message ?? err}`, 8000);
                    } finally {
                        btn.setDisabled(false).setButtonText('Preview natal chart');
                    }
                }))
            .addButton(btn => btn
                .setButtonText('Clear birth chart')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.birth = { ...DEFAULT_SETTINGS.birth };
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }

    private async searchLocations(query: string, container: HTMLElement) {
        container.empty();
        const loading = container.createDiv({ cls: 'moon-loc-loading', text: 'Searching…' });
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
            const res = await requestUrl({
                url,
                headers: { 'User-Agent': 'obsidian-moon-plugin/1.1 (https://github.com/PoweredbyPugs/moon-phase)' },
                throw: false,
            });
            loading.remove();
            if (res.status < 200 || res.status >= 300) {
                container.createDiv({ cls: 'moon-loc-error', text: `Geocoding failed: HTTP ${res.status}` });
                return;
            }
            const items: NominatimResult[] = res.json;
            if (!items || items.length === 0) {
                container.createDiv({ cls: 'moon-loc-empty', text: 'No results.' });
                return;
            }
            for (const item of items) {
                const row = container.createDiv({ cls: 'moon-loc-row' });
                row.createSpan({ text: item.display_name });
                row.addEventListener('click', async () => {
                    const lat = parseFloat(item.lat);
                    const lon = parseFloat(item.lon);
                    this.plugin.settings.birth.locationName = item.display_name;
                    this.plugin.settings.birth.latitude = lat;
                    this.plugin.settings.birth.longitude = lon;
                    // Best-effort timezone from coordinates via the server
                    try {
                        const base = this.plugin.settings.serverUrl.replace(/\/+$/, '');
                        const tzRes = await requestUrl({
                            url: `${base}/timezone-at?lat=${lat}&lon=${lon}`,
                            throw: false,
                        });
                        if (tzRes.status >= 200 && tzRes.status < 300 && tzRes.json?.timezone) {
                            this.plugin.settings.birth.timezone = tzRes.json.timezone;
                        }
                    } catch { /* leave timezone alone if lookup fails */ }
                    await this.plugin.saveSettings();
                    this.display();
                });
            }
        } catch (err: any) {
            loading.remove();
            container.createDiv({ cls: 'moon-loc-error', text: `Geocoding failed: ${err?.message ?? err}` });
        }
    }

    /* ── Planets ── */
    private renderPlanets(c: HTMLElement) {
        c.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Toggle which planets are included in position lists and aspect calculations.',
        });

        for (const planet of PLANETS) {
            new Setting(c)
                .setName(`${this.plugin.getPlanetGlyph(planet)} ${planet}`)
                .addToggle(t => t
                    .setValue(this.plugin.settings.planets[planet])
                    .onChange(async (v) => {
                        this.plugin.settings.planets[planet] = v;
                        await this.plugin.saveSettings();
                    }));
        }
    }

    /* ── Aspects ── */
    private renderAspects(c: HTMLElement) {
        c.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Toggle aspect visibility, and adjust the orb of influence (in degrees). Bigger orb = more aspects reported, looser fit.',
        });

        for (const aspect of ASPECTS) {
            const wrap = c.createDiv({ cls: 'moon-aspect-row' });
            new Setting(wrap)
                .setName(`${ASPECT_SYMBOLS[aspect]} ${aspect}`)
                .addToggle(t => t
                    .setValue(this.plugin.settings.aspects[aspect])
                    .onChange(async (v) => {
                        this.plugin.settings.aspects[aspect] = v;
                        await this.plugin.saveSettings();
                    }))
                .addSlider(slider => slider
                    .setLimits(0.5, 12, 0.5)
                    .setValue(this.plugin.settings.orbs[aspect] ?? DEFAULT_ORBS[aspect])
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.orbs[aspect] = v;
                        await this.plugin.saveSettings();
                    }))
                .addExtraButton(btn => btn
                    .setIcon('reset')
                    .setTooltip('Reset orb to default')
                    .onClick(async () => {
                        this.plugin.settings.orbs[aspect] = DEFAULT_ORBS[aspect];
                        await this.plugin.saveSettings();
                        this.display();
                    }));
        }
    }
}
