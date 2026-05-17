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
    }

    onunload() {
        try { delete (window as any).MoonPhasePlugin; } catch { /* ignore */ }
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
        if (!name) throw new Error('No saved chart selected — pick one in Moon Phase settings.');
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

type TabId = 'general' | 'chart' | 'planets' | 'aspects';

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
        containerEl.createEl('h2', { text: 'Moon Phase Settings' });

        const tabs: Array<{ id: TabId; label: string }> = [
            { id: 'general', label: 'General' },
            { id: 'chart', label: 'Natal Chart' },
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
            case 'chart':   this.renderChart(body); break;
            case 'planets': this.renderPlanets(body); break;
            case 'aspects': this.renderAspects(body); break;
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
}
