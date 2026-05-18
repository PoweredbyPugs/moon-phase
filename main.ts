import {
    App, Editor, Notice, Plugin, PluginSettingTab, Setting, requestUrl,
} from 'obsidian';

import {
    ASPECTS, AspectName, ASPECT_SYMBOLS,
    AspectsResponse, ChartsListResponse, GenerateChartBody, MoonData,
    MoonPluginSettings, NatalTransitsResponse, PlanetName, PlanetsResponse,
    PLANETS, SkyAspect,
} from './src/types';

import {
    buildGenerateChartBody, enabledAspectNames, enabledPlanetNames,
    filterNatalTransits, filterSkyAspects, formatPlanetLine, formatSkyAspectLine,
    joinUrl, migrateSettings, moonPhaseEmoji, natalTransitQuery,
    normalizeBaseUrl, planetGlyph,
} from './src/pure';

import {
    calculateKi, calculatePersonalCycle, formatKiReport,
} from './src/techniques/ki';
import { castHexagram, formatCast } from './src/techniques/hexagram';

/* ──────────────────────────────────────────────────────────────────────── *
 * Plugin
 * ──────────────────────────────────────────────────────────────────────── */

export default class MoonPlugin extends Plugin {
    settings!: MoonPluginSettings;

    public api = {
        getMoonData: this.getMoonData.bind(this),
        getMoonPhaseEmoji: moonPhaseEmoji,
        getPlanetGlyph: planetGlyph,
        getCurrentMoonPhase: this.getCurrentMoonPhase.bind(this),
        getCurrentMoonDegree: this.getCurrentMoonDegree.bind(this),
        getWeeklyPhase: this.getWeeklyPhase.bind(this),
        getWeeklyMajorPhase: this.getWeeklyMajorPhase.bind(this),
        getPlanetaryData: this.getPlanetaryData.bind(this),
        getAspectsData: this.getAspectsData.bind(this),
        getNatalTransits: this.getNatalTransits.bind(this),
        getNatalChart: this.getNatalChart.bind(this),
        listSavedCharts: this.listSavedCharts.bind(this),
        // Techniques
        getTodaysKi: this.getTodaysKi.bind(this),
        getNatalKi: this.getNatalKi.bind(this),
        getDailyHexagram: this.getDailyHexagram.bind(this),
        getMidpointTransits: this.getMidpointTransits.bind(this),
        getNextEclipse: this.getNextEclipse.bind(this),
        getDashas: this.getDashas.bind(this),
    };

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new MoonSettingTab(this.app, this));

        // Expose for Templater. ObsidianMoon is the new canonical name;
        // MoonPhasePlugin is kept as an alias so existing snippets keep working.
        (window as any).ObsidianMoon = this.api;
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
                    editor.replaceSelection(data.planets.map(formatPlanetLine).join('\n'));
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
                        editor.replaceSelection(planet
                            ? formatPlanetLine(planet)
                            : `Error: ${planetName} data not found`);
                    }).catch(err => this.handleError(editor, `${planetName} data`, err));
                },
            });
        }

        /* ── Aspects (natal-aware when a chart is selected) ── */
        this.addCommand({
            id: 'all-aspects',
            name: 'All Current Aspects',
            editorCallback: (editor: Editor) => {
                this.getEffectiveAspects().then(aspects => {
                    if (aspects.length === 0) {
                        editor.replaceSelection('No significant aspects currently.');
                        return;
                    }
                    editor.replaceSelection(aspects.map(formatSkyAspectLine).join('\n'));
                }).catch(err => this.handleError(editor, 'aspects data', err));
            },
        });

        for (const planetName of PLANETS) {
            this.addCommand({
                id: `${planetName.toLowerCase()}-aspects`,
                name: `${planetName} Aspects`,
                editorCallback: (editor: Editor) => {
                    this.getEffectiveAspects().then(aspects => {
                        const relevant = aspects.filter(a =>
                            a.planet1 === planetName || a.planet2 === planetName);
                        if (relevant.length === 0) {
                            editor.replaceSelection(`No significant aspects for ${planetName} currently.`);
                            return;
                        }
                        // Move the asked-for planet to the left for readability
                        const out = relevant.map(a => {
                            if (a.planet1 === planetName) return formatSkyAspectLine(a);
                            return formatSkyAspectLine({
                                ...a,
                                planet1: a.planet2,
                                planet2: a.planet1,
                                planet1Sign: a.planet2Sign,
                                planet2Sign: a.planet1Sign,
                                planet1Retrograde: a.planet2Retrograde,
                                planet2Retrograde: a.planet1Retrograde,
                            });
                        }).join('\n');
                        editor.replaceSelection(out);
                    }).catch(err => this.handleError(editor, `${planetName} aspects`, err));
                },
            });
        }

        for (const aspectName of ['Conjunction', 'Opposition', 'Trine', 'Square', 'Sextile'] as AspectName[]) {
            this.addCommand({
                id: `${aspectName.toLowerCase()}-aspects`,
                name: `${aspectName} Aspects`,
                editorCallback: (editor: Editor) => {
                    this.getEffectiveAspects().then(aspects => {
                        const relevant = aspects.filter(a => a.aspectName === aspectName);
                        if (relevant.length === 0) {
                            editor.replaceSelection(`No ${aspectName} aspects currently.`);
                            return;
                        }
                        editor.replaceSelection(relevant.map(formatSkyAspectLine).join('\n'));
                    }).catch(err => this.handleError(editor, `${aspectName} aspects`, err));
                },
            });
        }

        /* ── Techniques (pure-TS + Helios-backed) ── */

        this.addCommand({
            id: 'cast-hexagram',
            name: 'Cast Hexagram',
            editorCallback: (editor: Editor) => {
                if (!this.settings.techniques.hexagram) {
                    new Notice('Enable "Hexagram" in the Techniques settings tab first.');
                    return;
                }
                editor.replaceSelection(this.getDailyHexagram());
            },
        });

        this.addCommand({
            id: 'todays-ki',
            name: "Today's 9 Star Ki",
            editorCallback: (editor: Editor) => {
                if (!this.settings.techniques.ki) {
                    new Notice('Enable "Ki" in the Techniques settings tab first.');
                    return;
                }
                editor.replaceSelection(this.getTodaysKi());
            },
        });

        this.addCommand({
            id: 'natal-ki',
            name: 'Natal 9 Star Ki (selected chart / birth date)',
            editorCallback: (editor: Editor) => {
                if (!this.settings.techniques.ki) {
                    new Notice('Enable "Ki" in the Techniques settings tab first.');
                    return;
                }
                this.getNatalKi().then(text => editor.replaceSelection(text))
                    .catch(err => this.handleError(editor, 'natal Ki', err));
            },
        });

        this.addCommand({
            id: 'midpoint-transits',
            name: 'Midpoint Transits (selected chart)',
            editorCallback: (editor: Editor) => {
                if (!this.settings.techniques.midpoints) {
                    new Notice('Enable "Midpoints" in the Techniques settings tab first.');
                    return;
                }
                this.getMidpointTransits().then(text => editor.replaceSelection(text))
                    .catch(err => this.handleError(editor, 'midpoint transits', err));
            },
        });

        this.addCommand({
            id: 'next-eclipse',
            name: 'Next Eclipse',
            editorCallback: (editor: Editor) => {
                if (!this.settings.techniques.eclipses) {
                    new Notice('Enable "Eclipses" in the Techniques settings tab first.');
                    return;
                }
                this.getNextEclipse().then(text => editor.replaceSelection(text))
                    .catch(err => this.handleError(editor, 'next eclipse', err));
            },
        });

        this.addCommand({
            id: 'dashas',
            name: 'Vimshottari Dashas (selected chart)',
            editorCallback: (editor: Editor) => {
                if (!this.settings.techniques.dashas) {
                    new Notice('Enable "Dashas" in the Techniques settings tab first.');
                    return;
                }
                this.getDashas().then(text => editor.replaceSelection(text))
                    .catch(err => this.handleError(editor, 'dashas', err));
            },
        });
    }

    onunload() {
        try {
            delete (window as any).ObsidianMoon;
            delete (window as any).MoonPhasePlugin;
        } catch { /* ignore */ }
    }

    /* ── Settings IO ── */
    async loadSettings() {
        this.settings = migrateSettings(await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /* ── HTTP via requestUrl (no CORS preflight from app:// origin) ── */
    private async req<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
        const url = joinUrl(this.settings.serverUrl, path);
        const res = await requestUrl({
            url,
            method: opts?.method ?? 'GET',
            contentType: opts?.body ? 'application/json' : undefined,
            body: opts?.body ? JSON.stringify(opts.body) : undefined,
            throw: false,
        });
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`HTTP ${res.status} from ${url}: ${(res.text ?? '').slice(0, 200)}`);
        }
        return res.json as T;
    }

    /* ── Data fetchers (real baratie endpoints) ── */
    async getMoonData(): Promise<MoonData> {
        return this.req<MoonData>('/moon-now');
    }

    async getPlanetaryData(): Promise<PlanetsResponse> {
        const data = await this.req<PlanetsResponse>('/planets-now');
        return {
            ...data,
            planets: data.planets.filter(p => this.settings.planets[p.name as PlanetName]),
        };
    }

    async getAspectsData(): Promise<AspectsResponse> {
        const data = await this.req<AspectsResponse>('/aspects-now');
        return { ...data, aspects: filterSkyAspects(data.aspects, this.settings) };
    }

    async getNatalTransits(chartName?: string): Promise<NatalTransitsResponse> {
        const name = (chartName ?? this.settings.selectedChart).trim();
        if (!name) throw new Error('No saved chart selected — pick one in Obsidian Moon settings.');
        const qs = natalTransitQuery(this.settings);
        return this.req<NatalTransitsResponse>(`/transits/${encodeURIComponent(name)}/now${qs}`);
    }

    async getNatalChart(chartName?: string): Promise<unknown> {
        const name = (chartName ?? this.settings.selectedChart).trim();
        if (!name) throw new Error('No saved chart selected.');
        return this.req<unknown>(`/chart/${encodeURIComponent(name)}`);
    }

    async listSavedCharts(): Promise<string[]> {
        const data = await this.req<ChartsListResponse>('/charts');
        return Array.isArray(data?.charts) ? data.charts : [];
    }

    async generateChart(body: GenerateChartBody): Promise<unknown> {
        return this.req<unknown>('/generate-chart', { method: 'POST', body });
    }

    /* Routes through whichever mode is active. */
    private async getEffectiveAspects(): Promise<SkyAspect[]> {
        if (this.settings.useNatalChart && this.settings.selectedChart) {
            const data = await this.getNatalTransits();
            return filterNatalTransits(data.transits, this.settings);
        }
        return (await this.getAspectsData()).aspects;
    }

    /* ── Techniques ── */

    /** Pure-TS: today's 9 Star Ki sequence. */
    getTodaysKi(): string {
        return formatKiReport(calculateKi(new Date()));
    }

    /** Pure-TS: natal Ki + personal cycle for the day. Uses settings.birthDate
     * (falls back to fetching the selected chart's birth date from Helios). */
    async getNatalKi(): Promise<string> {
        const birthIso = this.settings.birthDate || await this.fetchChartBirthDate();
        if (!birthIso) {
            throw new Error('Set Birth Date in settings, or pick a saved chart that has one.');
        }
        const [y, m, d] = birthIso.split('-').map(Number);
        const birth = new Date(y, m - 1, d);
        const natal = calculateKi(birth);
        const cycle = calculatePersonalCycle(natal.yearKi, new Date());
        return [
            `# Natal 9 Star Ki — born ${birthIso}`,
            '',
            `**Natal sequence:** ${natal.sequence}`,
            `**Today's personal cycle:** year ${cycle.personalYear} ${cycle.personalYearInfo.trigram} ${cycle.personalYearInfo.name}, month ${cycle.personalMonth} ${cycle.personalMonthInfo.trigram} ${cycle.personalMonthInfo.name}`,
            '',
            formatKiReport(natal),
        ].join('\n');
    }

    /** Pure-TS: cast a hexagram. */
    getDailyHexagram(): string {
        return formatCast(castHexagram());
    }

    /** Helios: midpoint transits to a saved chart. */
    async getMidpointTransits(chartName?: string): Promise<string> {
        const name = (chartName ?? this.settings.selectedChart).trim();
        if (!name) throw new Error('Pick a saved chart in Natal Chart settings first.');
        const data = await this.req<{ midpointTransits?: Array<{ midpoint: string; transit: string; aspect: string; orb: string }> }>(
            `/midpoint-transits/${encodeURIComponent(name)}?orb=${this.settings.midpointOrb}`);
        const rows = data?.midpointTransits ?? [];
        if (rows.length === 0) return `No midpoint transits within ${this.settings.midpointOrb}° for ${name}.`;
        return [`# Midpoint transits to ${name}`, '', ...rows.map(r =>
            `- ${r.transit} ${r.aspect} ${r.midpoint} (orb ${r.orb}°)`)].join('\n');
    }

    /** Helios: next eclipse within the configured lookahead window. */
    async getNextEclipse(): Promise<string> {
        const start = new Date();
        const end = new Date();
        end.setMonth(end.getMonth() + this.settings.eclipseLookaheadMonths);
        const startIso = start.toISOString().slice(0, 10);
        const endIso = end.toISOString().slice(0, 10);
        const data = await this.req<{ eclipses?: Array<{ date: string; type: string; sign?: string; degree?: string }> }>(
            `/eclipses?start=${startIso}&end=${endIso}`);
        const first = data?.eclipses?.[0];
        if (!first) return `No eclipses in the next ${this.settings.eclipseLookaheadMonths} months.`;
        const where = first.sign && first.degree ? ` at ${first.degree}˚ ${first.sign}` : '';
        return `Next eclipse: ${first.type} on ${first.date}${where}.`;
    }

    /** Helios: Vimshottari dasha periods for a saved chart. */
    async getDashas(chartName?: string, levels = 2): Promise<string> {
        const name = (chartName ?? this.settings.selectedChart).trim();
        if (!name) throw new Error('Pick a saved chart in Natal Chart settings first.');
        const data = await this.req<{ dashas?: Array<{ planet: string; start: string; end: string; sub?: any[] }> }>(
            `/dashas/${encodeURIComponent(name)}?levels=${levels}`);
        const rows = data?.dashas ?? [];
        if (rows.length === 0) return `No dasha data for ${name}.`;
        return [`# Vimshottari dashas for ${name}`, '', ...rows.map(r =>
            `- **${r.planet}** ${r.start} → ${r.end}`)].join('\n');
    }

    private async fetchChartBirthDate(): Promise<string> {
        if (!this.settings.selectedChart) return '';
        try {
            const chart = await this.getNatalChart() as any;
            return chart?.birthData?.date ?? '';
        } catch { return ''; }
    }

    async getWeeklyMajorPhase(): Promise<{ date: string; moonPhase: string; moonSign: string } | null> {
        try {
            const data = await this.req<{ date?: string; moonPhase?: string; moonSign?: string }>(
                '/weekly-major-phase');
            if (data?.moonPhase) {
                return { date: data.date ?? '', moonPhase: data.moonPhase, moonSign: data.moonSign ?? '' };
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
            return `${moonPhaseEmoji(m.moonPhase)} ${m.moonSign}`;
        } catch { return 'Error fetching moon data'; }
    }

    async getCurrentMoonDegree(): Promise<string> {
        try {
            const m = await this.getMoonData();
            return `${moonPhaseEmoji(m.moonPhase)} ${m.moonSign} ${m.degreeInSign}˚`;
        } catch { return 'Error fetching moon data'; }
    }

    async getWeeklyPhase(): Promise<string> {
        const phase = await this.getWeeklyMajorPhase();
        if (!phase) return 'No major moon phase this week.';
        return `${moonPhaseEmoji(phase.moonPhase)} ${phase.moonSign}`;
    }

    private handleError(editor: Editor, what: string, err: unknown) {
        console.error(`Error fetching ${what}:`, err);
        editor.replaceSelection(`Error fetching ${what}. Check console for details.`);
    }
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Settings UI — tabbed, follows the Periodic Ritual pattern
 * ──────────────────────────────────────────────────────────────────────── */

type TabId = 'general' | 'chart' | 'planets' | 'aspects' | 'techniques';

interface NominatimResult {
    display_name: string;
    lat: string;
    lon: string;
}

class MoonSettingTab extends PluginSettingTab {
    plugin: MoonPlugin;
    private activeTab: TabId = 'general';
    private locationSearchTimer: number | null = null;
    private cachedCharts: string[] | null = null;
    private chartDraft = {
        name: '',
        date: '',
        time: '12:00',
        locationName: '',
        latitude: NaN,
        longitude: NaN,
        timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    };

    constructor(app: App, plugin: MoonPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Obsidian Moon' });

        const tabs: Array<{ id: TabId; label: string }> = [
            { id: 'general', label: 'General' },
            { id: 'chart', label: 'Natal Chart' },
            { id: 'planets', label: 'Planets' },
            { id: 'aspects', label: 'Aspects' },
            { id: 'techniques', label: 'Techniques' },
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
            case 'general':    this.renderGeneral(body); break;
            case 'chart':      this.renderChart(body); break;
            case 'planets':    this.renderPlanets(body); break;
            case 'aspects':    this.renderAspects(body); break;
            case 'techniques': this.renderTechniques(body); break;
        }
    }

    /* ── General ── */
    private renderGeneral(c: HTMLElement) {
        new Setting(c)
            .setName('Server URL')
            .setDesc('URL to your Sweph Astrological API server (e.g. http://baratie:3000).')
            .addText(text => text
                .setPlaceholder('http://localhost:3000')
                .setValue(this.plugin.settings.serverUrl)
                .onChange(async (value) => {
                    this.plugin.settings.serverUrl = normalizeBaseUrl(value);
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
                        const res = await requestUrl({
                            url: joinUrl(this.plugin.settings.serverUrl, '/test'),
                            throw: false,
                        });
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

    /* ── Natal Chart ── */
    private renderChart(c: HTMLElement) {
        c.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Pick one of the natal charts saved on your Sweph server. When "Use natal chart for transits" is on, the aspect commands return transits to that chart instead of plain sky-to-sky aspects.',
        });

        // ── Saved-chart picker ──
        const pickerSetting = new Setting(c)
            .setName('Saved chart')
            .setDesc('Charts saved on the server via /generate-chart.');

        const dropdown = pickerSetting.controlEl.createEl('select', { cls: 'dropdown' }) as HTMLSelectElement;
        const refreshBtn = pickerSetting.controlEl.createEl('button', { text: 'Refresh' });
        refreshBtn.addEventListener('click', async () => {
            this.cachedCharts = null;
            await this.populateChartDropdown(dropdown);
        });

        // Initial populate
        this.populateChartDropdown(dropdown);
        dropdown.addEventListener('change', async () => {
            this.plugin.settings.selectedChart = dropdown.value;
            await this.plugin.saveSettings();
        });

        new Setting(c)
            .setName('Use natal chart for transits')
            .setDesc('When on, the aspect commands return transits aspecting the saved chart\'s planets (via /transits/:name/now).')
            .addToggle(t => t
                .setValue(this.plugin.settings.useNatalChart)
                .onChange(async (v) => {
                    this.plugin.settings.useNatalChart = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('Major aspects only')
            .setDesc('Sends ?major=true to /transits/:name/now. Conjunction / Opposition / Trine / Square / Sextile only.')
            .addToggle(t => t
                .setValue(this.plugin.settings.majorOnly)
                .onChange(async (v) => {
                    this.plugin.settings.majorOnly = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('Natal orb (degrees)')
            .setDesc('Tightness of natal transit aspects. The server applies this to /transits/:name/now.')
            .addSlider(s => s
                .setLimits(1, 12, 0.5)
                .setValue(this.plugin.settings.natalOrb)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.natalOrb = v;
                    await this.plugin.saveSettings();
                }));

        // ── Quick preview ──
        new Setting(c)
            .addButton(btn => btn
                .setButtonText('Preview transits')
                .setCta()
                .onClick(async () => {
                    if (!this.plugin.settings.selectedChart) {
                        new Notice('Pick a saved chart first.');
                        return;
                    }
                    btn.setDisabled(true).setButtonText('Loading…');
                    try {
                        const data = await this.plugin.getNatalTransits();
                        const lines = filterNatalTransits(data.transits, this.plugin.settings)
                            .slice(0, 10)
                            .map(formatSkyAspectLine);
                        new Notice(`Top transits for ${data.name}:\n${lines.join('\n')}`, 12000);
                    } catch (err: any) {
                        new Notice(`Preview failed: ${err?.message ?? err}`, 8000);
                    } finally {
                        btn.setDisabled(false).setButtonText('Preview transits');
                    }
                }));

        // ── Create-new-chart form ──
        c.createEl('h3', { text: 'Create a new chart' });
        c.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Fill in birth details and save the chart to your Sweph server. Once saved, it appears in the dropdown above.',
        });

        new Setting(c)
            .setName('Chart name')
            .setDesc('A short identifier, e.g. your first name. Used as the URL slug.')
            .addText(t => t
                .setPlaceholder('chris')
                .setValue(this.chartDraft.name)
                .onChange(v => { this.chartDraft.name = v.trim(); }));

        const dateSetting = new Setting(c).setName('Birth date');
        const dateInput = dateSetting.controlEl.createEl('input', { type: 'date' }) as HTMLInputElement;
        dateInput.value = this.chartDraft.date;
        dateInput.addEventListener('change', () => { this.chartDraft.date = dateInput.value; });

        const timeSetting = new Setting(c)
            .setName('Birth time')
            .setDesc('Local time at the birth location (24h). Accuracy matters most for the Ascendant / houses.');
        const timeInput = timeSetting.controlEl.createEl('input', { type: 'time' }) as HTMLInputElement;
        timeInput.value = this.chartDraft.time;
        timeInput.step = '60';
        timeInput.addEventListener('change', () => { this.chartDraft.time = timeInput.value; });

        // Location search (Nominatim / OpenStreetMap)
        const locWrap = c.createDiv({ cls: 'moon-loc-wrap' });
        new Setting(locWrap)
            .setName('Location')
            .setDesc('Type a city, then pick a result to auto-fill latitude / longitude.')
            .addText(text => {
                text.setPlaceholder('e.g. Orlando, FL')
                    .setValue(this.chartDraft.locationName)
                    .onChange((value) => {
                        if (this.locationSearchTimer) window.clearTimeout(this.locationSearchTimer);
                        const query = value.trim();
                        if (query.length < 3) { results.empty(); return; }
                        this.locationSearchTimer = window.setTimeout(
                            () => this.searchLocations(query, results), 400);
                    });
                return text;
            });
        const results = locWrap.createDiv({ cls: 'moon-loc-results' });

        new Setting(c)
            .setName('Latitude')
            .setDesc('Decimal degrees, north positive.')
            .addText(t => t
                .setPlaceholder('28.5383')
                .setValue(Number.isFinite(this.chartDraft.latitude) ? String(this.chartDraft.latitude) : '')
                .onChange(v => { this.chartDraft.latitude = parseFloat(v); }));

        new Setting(c)
            .setName('Longitude')
            .setDesc('Decimal degrees, east positive.')
            .addText(t => t
                .setPlaceholder('-81.3792')
                .setValue(Number.isFinite(this.chartDraft.longitude) ? String(this.chartDraft.longitude) : '')
                .onChange(v => { this.chartDraft.longitude = parseFloat(v); }));

        new Setting(c)
            .setName('Birth timezone')
            .setDesc('IANA timezone of the birth location (e.g. America/New_York).')
            .addText(t => t
                .setPlaceholder('America/New_York')
                .setValue(this.chartDraft.timezone)
                .onChange(v => { this.chartDraft.timezone = v.trim(); }));

        new Setting(c)
            .addButton(btn => btn
                .setButtonText('Save chart')
                .setCta()
                .onClick(async () => {
                    btn.setDisabled(true).setButtonText('Saving…');
                    try {
                        const body = buildGenerateChartBody({
                            name: this.chartDraft.name,
                            date: this.chartDraft.date,
                            time: this.chartDraft.time,
                            latitude: this.chartDraft.latitude,
                            longitude: this.chartDraft.longitude,
                            timezone: this.chartDraft.timezone,
                            save: true,
                        });
                        await this.plugin.generateChart(body);
                        new Notice(`Saved chart "${body.name}"`);
                        this.plugin.settings.selectedChart = body.name;
                        await this.plugin.saveSettings();
                        this.cachedCharts = null;
                        this.display();
                    } catch (err: any) {
                        new Notice(`Save failed: ${err?.message ?? err}`, 8000);
                    } finally {
                        btn.setDisabled(false).setButtonText('Save chart');
                    }
                }));
    }

    private async populateChartDropdown(dropdown: HTMLSelectElement) {
        const current = this.plugin.settings.selectedChart;
        dropdown.empty();
        dropdown.createEl('option', { text: '— None (sky-to-sky aspects) —', value: '' });

        try {
            if (!this.cachedCharts) this.cachedCharts = await this.plugin.listSavedCharts();
            for (const name of this.cachedCharts) {
                dropdown.createEl('option', { text: name, value: name });
            }
            dropdown.value = current && this.cachedCharts.includes(current) ? current : '';
        } catch (err: any) {
            const opt = dropdown.createEl('option', {
                text: `(couldn't load charts: ${err?.message ?? err})`,
                value: '',
            });
            opt.disabled = true;
        }
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
                row.addEventListener('click', () => {
                    this.chartDraft.locationName = item.display_name;
                    this.chartDraft.latitude = parseFloat(item.lat);
                    this.chartDraft.longitude = parseFloat(item.lon);
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
            text: 'Toggle which planets appear in position lists and aspect calculations.',
        });
        for (const planet of PLANETS) {
            new Setting(c)
                .setName(`${planetGlyph(planet)} ${planet}`)
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
            text: 'Toggle which aspect types appear in aspect commands. (Orb for sky-to-sky aspects comes from the server; orb for natal transits is set on the Natal Chart tab.)',
        });
        for (const aspect of ASPECTS) {
            new Setting(c)
                .setName(`${ASPECT_SYMBOLS[aspect]} ${aspect}`)
                .addToggle(t => t
                    .setValue(this.plugin.settings.aspects[aspect])
                    .onChange(async (v) => {
                        this.plugin.settings.aspects[aspect] = v;
                        await this.plugin.saveSettings();
                    }));
        }
    }

    /* ── Techniques ── */
    private renderTechniques(c: HTMLElement) {
        c.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Toggle additional astrological / divinatory techniques. Disabled techniques are hidden from the command palette. Ki and Hexagram run entirely client-side; midpoints / eclipses / dashas hit the Sweph server.',
        });

        new Setting(c)
            .setName('9 Star Ki')
            .setDesc('Today\'s Ki cascade (year/month/third) and natal Ki personal-cycle commands. Pure-TS, no server call.')
            .addToggle(t => t
                .setValue(this.plugin.settings.techniques.ki)
                .onChange(async (v) => {
                    this.plugin.settings.techniques.ki = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('Birth date for natal Ki')
            .setDesc('YYYY-MM-DD. Only used when no saved chart is selected. Optional.')
            .addText(t => t
                .setPlaceholder('1986-05-01')
                .setValue(this.plugin.settings.birthDate)
                .onChange(async (v) => {
                    this.plugin.settings.birthDate = v.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('I Ching Hexagram')
            .setDesc('Three-coin cast → primary hexagram + relating hexagram (if changing lines). Pure-TS.')
            .addToggle(t => t
                .setValue(this.plugin.settings.techniques.hexagram)
                .onChange(async (v) => {
                    this.plugin.settings.techniques.hexagram = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('Midpoints')
            .setDesc('Current transits aspecting natal midpoints. Requires Sweph-server endpoint /midpoint-transits/:name.')
            .addToggle(t => t
                .setValue(this.plugin.settings.techniques.midpoints)
                .onChange(async (v) => {
                    this.plugin.settings.techniques.midpoints = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('Midpoint orb (degrees)')
            .setDesc('Tightness of midpoint-transit aspects. Sent as ?orb=N.')
            .addSlider(s => s
                .setLimits(0.5, 5, 0.5)
                .setValue(this.plugin.settings.midpointOrb)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.midpointOrb = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('Eclipses')
            .setDesc('"Next Eclipse" command. Requires Sweph-server endpoint /eclipses.')
            .addToggle(t => t
                .setValue(this.plugin.settings.techniques.eclipses)
                .onChange(async (v) => {
                    this.plugin.settings.techniques.eclipses = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('Eclipse lookahead (months)')
            .setDesc('How far ahead "Next Eclipse" searches.')
            .addSlider(s => s
                .setLimits(1, 24, 1)
                .setValue(this.plugin.settings.eclipseLookaheadMonths)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.eclipseLookaheadMonths = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('Vimshottari Dashas')
            .setDesc('Vedic dasha periods for a saved chart. Requires Sweph-server endpoint /dashas/:name.')
            .addToggle(t => t
                .setValue(this.plugin.settings.techniques.dashas)
                .onChange(async (v) => {
                    this.plugin.settings.techniques.dashas = v;
                    await this.plugin.saveSettings();
                }));
    }
}
