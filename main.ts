import {
    App, Editor, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl,
} from 'obsidian';

import {
    ASPECTS, AspectName, ASPECT_SYMBOLS,
    AspectsResponse, ChartsListResponse, CycleResponse, GenerateChartBody, MoonData,
    MoonPluginSettings, NatalTransitsResponse, PlanetName, PlanetsResponse,
    PLANETS, SkyAspect,
} from './src/types';

import {
    buildCycleQuery, buildGenerateChartBody, enabledAspectNames, enabledPlanetNames,
    filterNatalTransits, filterSkyAspects, formatPlanetLine, formatSkyAspectLine,
    joinUrl, migrateSettings, moonPhaseEmoji, natalTransitQuery,
    normalizeBaseUrl, planetGlyph,
} from './src/pure';

import {
    calculateKi, calculatePersonalCycle, formatKiReport,
} from './src/techniques/ki';
import { castHexagram, formatCast } from './src/techniques/hexagram';

import {
    KnowledgeBackend, NullKnowledgeBackend, formatChunks,
} from './src/knowledge/backend';
import { Neo4jKnowledgeBackend } from './src/knowledge/neo4j';
import { parsePlacement } from './src/knowledge/parse';

import { LLMProvider, NullLLMProvider } from './src/synthesis/provider';
import { OpenAIProvider } from './src/synthesis/providers/openai';
import { AnthropicProvider } from './src/synthesis/providers/anthropic';
import {
    synthesizeChartReading, synthesizeDiscover, synthesizePlacement,
} from './src/synthesis/synthesize';
import { saveMemoryRecord } from './src/synthesis/memory';

/* ──────────────────────────────────────────────────────────────────────── *
 * Plugin
 * ──────────────────────────────────────────────────────────────────────── */

export default class MoonPlugin extends Plugin {
    settings!: MoonPluginSettings;
    knowledge: KnowledgeBackend = new NullKnowledgeBackend();
    llm: LLMProvider = new NullLLMProvider();

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
        getCycle: this.getCycle.bind(this),
        searchKnowledge: this.searchKnowledge.bind(this),
        interpretPlacement: this.interpretPlacement.bind(this),
        // Synthesis
        chartReading: this.chartReading.bind(this),
        discoverPatterns: this.discoverPatterns.bind(this),
        interpretPlacementLLM: this.interpretPlacementLLM.bind(this),
    };

    async onload() {
        await this.loadSettings();
        this.rebuildKnowledgeBackend();
        this.rebuildLLMProvider();

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

        this.addCommand({
            id: 'plot-cycle',
            name: 'Plot Planetary Cycle (modal)',
            editorCallback: (editor: Editor) => {
                new CycleModal(this.app, this, editor).open();
            },
        });

        /* ── Knowledge layer ── */

        this.addCommand({
            id: 'knowledge-search',
            name: 'Knowledge Search',
            editorCallback: (editor: Editor) => {
                if (!this.knowledge.isConfigured()) {
                    new Notice('Configure a knowledge backend in settings first.');
                    return;
                }
                new KnowledgeSearchModal(this.app, this, editor).open();
            },
        });

        this.addCommand({
            id: 'interpret-selection',
            name: 'Interpret Selected Placement (knowledge only)',
            editorCallback: (editor: Editor) => {
                const selection = editor.getSelection().trim() || editor.getLine(editor.getCursor().line).trim();
                if (!selection) {
                    new Notice('Select a placement first (e.g. "Mars Capricorn 15˚" or "♂ ♑").');
                    return;
                }
                this.interpretPlacement(selection)
                    .then(text => editor.replaceSelection(text))
                    .catch(err => this.handleError(editor, 'interpretation', err));
            },
        });

        /* ── Synthesis (LLM-grounded readings) ── */

        this.addCommand({
            id: 'chart-reading',
            name: 'Insert Chart Reading (LLM)',
            editorCallback: (editor: Editor) => {
                if (!this.settings.defaultChart) {
                    new Notice('Pick a default chart in Natal Chart settings first.');
                    return;
                }
                if (!this.llm.isConfigured()) {
                    new Notice('Configure an LLM provider in the LLM settings tab first.');
                    return;
                }
                const file = this.app.workspace.getActiveFile();
                this.chartReading(this.settings.defaultChart, file?.path)
                    .then(text => editor.replaceSelection(text))
                    .catch(err => this.handleError(editor, 'chart reading', err));
            },
        });

        this.addCommand({
            id: 'discover-patterns',
            name: 'Discover Patterns for Default Chart (LLM)',
            editorCallback: (editor: Editor) => {
                if (!this.settings.defaultChart) {
                    new Notice('Pick a default chart in Natal Chart settings first.');
                    return;
                }
                if (!this.llm.isConfigured()) {
                    new Notice('Configure an LLM provider in the LLM settings tab first.');
                    return;
                }
                const file = this.app.workspace.getActiveFile();
                this.discoverPatterns(this.settings.defaultChart, file?.path)
                    .then(text => editor.replaceSelection(text))
                    .catch(err => this.handleError(editor, 'discover', err));
            },
        });

        this.addCommand({
            id: 'interpret-selection-llm',
            name: 'Interpret Selected Placement (LLM + knowledge)',
            editorCallback: (editor: Editor) => {
                const selection = editor.getSelection().trim() || editor.getLine(editor.getCursor().line).trim();
                if (!selection) {
                    new Notice('Select a placement first.');
                    return;
                }
                if (!this.llm.isConfigured()) {
                    new Notice('Configure an LLM provider in the LLM settings tab first.');
                    return;
                }
                const file = this.app.workspace.getActiveFile();
                this.interpretPlacementLLM(selection, file?.path)
                    .then(text => editor.replaceSelection(text))
                    .catch(err => this.handleError(editor, 'LLM interpretation', err));
            },
        });

        this.addCommand({
            id: 'cycle-crossings-default',
            name: 'Cycle Crossings to Default Chart (next 6 months)',
            editorCallback: (editor: Editor) => {
                if (!this.settings.defaultChart) {
                    new Notice('Pick a default chart in Natal Chart settings first.');
                    return;
                }
                new CycleModal(this.app, this, editor, { quickCrossings: true }).open();
            },
        });
    }

    onunload() {
        try {
            delete (window as any).ObsidianMoon;
            delete (window as any).MoonPhasePlugin;
        } catch { /* ignore */ }
        // Close the knowledge backend (e.g. neo4j driver) in the background;
        // we intentionally don't await it during plugin teardown.
        void this.knowledge.close().catch(() => { /* ignore */ });
    }

    /** Rebuild the LLM provider from current settings. */
    rebuildLLMProvider() {
        const ls = this.settings.llm;
        switch (ls.provider) {
            case 'openai':
                this.llm = new OpenAIProvider({ baseUrl: ls.openaiBaseUrl, apiKey: ls.openaiApiKey });
                break;
            case 'ollama':
                this.llm = new OpenAIProvider({ baseUrl: ls.ollamaBaseUrl, apiKey: '' });
                break;
            case 'anthropic':
                this.llm = new AnthropicProvider({ baseUrl: ls.anthropicBaseUrl, apiKey: ls.anthropicApiKey });
                break;
            default:
                this.llm = new NullLLMProvider();
        }
    }

    /** Rebuild the knowledge backend from current settings. Called after
     * settings change. Closes the old backend if any. */
    rebuildKnowledgeBackend() {
        const previous = this.knowledge;
        const ks = this.settings.knowledge;
        if (ks.backend === 'neo4j' && ks.neo4jUri && ks.neo4jUser && ks.neo4jPassword) {
            this.knowledge = new Neo4jKnowledgeBackend({
                uri: ks.neo4jUri,
                user: ks.neo4jUser,
                password: ks.neo4jPassword,
                indexName: ks.neo4jIndexName,
            });
        } else {
            this.knowledge = new NullKnowledgeBackend();
        }
        if (previous && previous !== this.knowledge) {
            void previous.close().catch(() => { /* ignore */ });
        }
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
        const name = (chartName ?? this.settings.defaultChart).trim();
        if (!name) throw new Error('No saved chart selected — pick one in Obsidian Moon settings.');
        const qs = natalTransitQuery(this.settings);
        return this.req<NatalTransitsResponse>(`/transits/${encodeURIComponent(name)}/now${qs}`);
    }

    async getNatalChart(chartName?: string): Promise<unknown> {
        const name = (chartName ?? this.settings.defaultChart).trim();
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
        if (this.settings.useNatalChart && this.settings.defaultChart) {
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
        const name = (chartName ?? this.settings.defaultChart).trim();
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
        const data = await this.req<{ eclipses?: Array<{ date: string; time?: string; type: string; sign?: string; degreeInSign?: string }> }>(
            `/eclipses?start=${startIso}&end=${endIso}`);
        const first = data?.eclipses?.[0];
        if (!first) return `No eclipses in the next ${this.settings.eclipseLookaheadMonths} months.`;
        const where = first.sign && first.degreeInSign ? ` at ${first.degreeInSign}˚ ${first.sign}` : '';
        const when = first.time ? `${first.date} ${first.time}` : first.date;
        return `Next eclipse: ${first.type} on ${when}${where}.`;
    }

    /* ── Knowledge ── */

    /** Free-text knowledge search across the configured backend. */
    async searchKnowledge(opts: {
        query: string; planet?: string; sign?: string; house?: number;
        aspect?: string; layer?: string; tradition?: string; author?: string;
        trustTier?: number; limit?: number;
    }): Promise<string> {
        if (!this.knowledge.isConfigured()) {
            return 'Knowledge backend not configured — set one up in the Knowledge settings tab.';
        }
        const limit = opts.limit ?? this.settings.knowledge.defaultResultLimit;
        const chunks = await this.knowledge.search({ ...opts, limit });
        return formatChunks(chunks, opts.query);
    }

    /** Parse a free-text placement (e.g. "Mars Capricorn 15˚") and search
     * the knowledge graph for interpretations matching the structural parts. */
    async interpretPlacement(text: string): Promise<string> {
        if (!this.knowledge.isConfigured()) {
            return 'Knowledge backend not configured — set one up in the Knowledge settings tab.';
        }
        const parsed = parsePlacement(text);
        if (!parsed.query && parsed.matched.length === 0) {
            return `Couldn't parse anything from "${text}".`;
        }
        const chunks = await this.knowledge.search({
            query: parsed.query || parsed.matched.join(' '),
            planet: parsed.planet,
            sign: parsed.sign,
            house: parsed.house,
            aspect: parsed.aspect,
            limit: this.settings.knowledge.defaultResultLimit,
        });
        const header = `Interpretation for **${text.trim()}** ` +
            `(parsed: ${parsed.matched.join(', ') || 'free-text'})`;
        return `${header}\n\n${formatChunks(chunks, text).split('\n').slice(1).join('\n')}`;
    }

    /* ── Synthesis (LLM + knowledge) ── */

    private synthDeps() {
        return {
            knowledge: this.knowledge,
            llm: this.llm,
            model: this.settings.llm.model,
            maxTokens: this.settings.llm.maxTokens,
            temperature: this.settings.llm.temperature,
            knowledgeLimit: this.settings.llm.knowledgeLimit,
        };
    }

    async chartReading(chartName?: string, sourceNote?: string): Promise<string> {
        const name = (chartName ?? this.settings.defaultChart).trim();
        if (!name) throw new Error('No chart selected.');
        const chart = await this.getNatalChart(name);
        const body = await synthesizeChartReading(this.synthDeps(), { chartName: name, chart });
        await this.saveMemory({ chart: name, kind: 'chart-reading', sourceNote, body });
        return body;
    }

    async discoverPatterns(chartName?: string, sourceNote?: string): Promise<string> {
        const name = (chartName ?? this.settings.defaultChart).trim();
        if (!name) throw new Error('No chart selected.');
        const [chart, transits] = await Promise.all([
            this.getNatalChart(name),
            this.getNatalTransits(name).catch(() => null),
        ]);
        const body = await synthesizeDiscover(this.synthDeps(), {
            chartName: name, chart, transits: transits ?? undefined,
        });
        await this.saveMemory({ chart: name, kind: 'discover', sourceNote, body });
        return body;
    }

    async interpretPlacementLLM(placement: string, sourceNote?: string): Promise<string> {
        const body = await synthesizePlacement(this.synthDeps(), placement);
        await this.saveMemory({
            chart: this.settings.defaultChart,
            kind: 'interpret-placement',
            sourceNote,
            placement,
            body,
        });
        return body;
    }

    private async saveMemory(record: Omit<Parameters<typeof saveMemoryRecord>[2], 'timestamp'>): Promise<void> {
        if (!this.settings.llm.memoryFolder) return;
        try {
            await saveMemoryRecord(this.app, this.settings.llm.memoryFolder, {
                ...record,
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            console.warn('obsidian-moon: failed to save memory record', err);
        }
    }

    /** Helios: planet cycle timeline + optional natal-chart crossings.
     * Returns the raw CycleResponse so callers can render it however they want
     * (markdown summary, frontmatter, future animated chart view, etc.). */
    async getCycle(opts: {
        planet: string;
        start: string;
        end: string;
        interval?: 'hourly' | '6h' | 'daily' | 'weekly';
        natalCharts?: string[];   // defaults to trackedCharts
        natalPoints?: string[];
        aspects?: string[];
        orb?: number;
    }): Promise<CycleResponse> {
        const charts = opts.natalCharts ?? this.settings.trackedCharts;
        const { planet, query } = buildCycleQuery({
            ...opts,
            natalCharts: charts,
            interval: opts.interval ?? this.settings.cycleInterval,
            orb: opts.orb ?? this.settings.cycleOrb,
        });
        return this.req<CycleResponse>(`/cycle/${encodeURIComponent(planet)}?${query}`);
    }

    /** Helios: Vimshottari dasha periods for a saved chart. */
    async getDashas(chartName?: string, levels = 2): Promise<string> {
        const name = (chartName ?? this.settings.defaultChart).trim();
        if (!name) throw new Error('Pick a saved chart in Natal Chart settings first.');
        const data = await this.req<{ dashas?: Array<{ planet: string; start: string; end: string; sub?: any[] }> }>(
            `/dashas/${encodeURIComponent(name)}?levels=${levels}`);
        const rows = data?.dashas ?? [];
        if (rows.length === 0) return `No dasha data for ${name}.`;
        return [`# Vimshottari dashas for ${name}`, '', ...rows.map(r =>
            `- **${r.planet}** ${r.start} → ${r.end}`)].join('\n');
    }

    private async fetchChartBirthDate(): Promise<string> {
        if (!this.settings.defaultChart) return '';
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

type TabId = 'general' | 'chart' | 'planets' | 'aspects' | 'techniques' | 'knowledge' | 'llm';

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
            { id: 'knowledge', label: 'Knowledge' },
            { id: 'llm', label: 'LLM' },
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
            case 'knowledge':  this.renderKnowledge(body); break;
            case 'llm':        this.renderLLM(body); break;
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
            text: 'Track one or more natal charts saved on your Sweph server. The "default" chart is used when a command needs a single chart (Preview transits, Dashas, etc.). All tracked charts are used for cycle-crossings and bulk transit queries.',
        });

        // ── Tracked-charts list ──
        new Setting(c)
            .setName('Tracked charts')
            .setDesc(this.plugin.settings.trackedCharts.length === 0
                ? 'No charts tracked yet. Pick from the dropdown below.'
                : this.plugin.settings.trackedCharts.map(n =>
                    n === this.plugin.settings.defaultChart ? `★ ${n}` : n,
                ).join(' · '));

        for (const name of this.plugin.settings.trackedCharts) {
            const isDefault = name === this.plugin.settings.defaultChart;
            const row = new Setting(c)
                .setName(`${isDefault ? '★ ' : ''}${name}`)
                .setDesc(isDefault ? 'Default chart for single-chart commands.' : '');
            if (!isDefault) {
                row.addButton(b => b.setButtonText('Set default').onClick(async () => {
                    this.plugin.settings.defaultChart = name;
                    await this.plugin.saveSettings();
                    this.display();
                }));
            }
            row.addButton(b => b.setButtonText('Remove').setWarning().onClick(async () => {
                this.plugin.settings.trackedCharts = this.plugin.settings.trackedCharts.filter(n => n !== name);
                if (this.plugin.settings.defaultChart === name) {
                    this.plugin.settings.defaultChart = this.plugin.settings.trackedCharts[0] ?? '';
                }
                await this.plugin.saveSettings();
                this.display();
            }));
        }

        // ── Add new tracked chart ──
        const pickerSetting = new Setting(c)
            .setName('Add a chart')
            .setDesc('Charts saved on the server via /generate-chart.');

        const dropdown = pickerSetting.controlEl.createEl('select', { cls: 'dropdown' }) as HTMLSelectElement;
        const addBtn = pickerSetting.controlEl.createEl('button', { text: 'Add' });
        const refreshBtn = pickerSetting.controlEl.createEl('button', { text: 'Refresh' });
        refreshBtn.addEventListener('click', async () => {
            this.cachedCharts = null;
            await this.populateChartDropdown(dropdown);
        });
        addBtn.addEventListener('click', async () => {
            const choice = dropdown.value;
            if (!choice) return;
            if (this.plugin.settings.trackedCharts.includes(choice)) {
                new Notice(`Already tracking ${choice}`);
                return;
            }
            this.plugin.settings.trackedCharts.push(choice);
            if (!this.plugin.settings.defaultChart) {
                this.plugin.settings.defaultChart = choice;
            }
            await this.plugin.saveSettings();
            this.display();
        });
        this.populateChartDropdown(dropdown);

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
                    if (!this.plugin.settings.defaultChart) {
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
                        if (!this.plugin.settings.trackedCharts.includes(body.name)) {
                            this.plugin.settings.trackedCharts.push(body.name);
                        }
                        if (!this.plugin.settings.defaultChart) {
                            this.plugin.settings.defaultChart = body.name;
                        }
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
        const current = this.plugin.settings.defaultChart;
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

    /* ── Knowledge ── */
    private renderKnowledge(c: HTMLElement) {
        c.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Connect to a knowledge graph of astrological interpretations. Currently supports Neo4j with the schema produced by the Stella ingest pipeline (Interpretation nodes with a full-text index). When connected, "Knowledge Search" and "Interpret Selected Placement" commands return grounded snippets from the corpus.',
        });

        new Setting(c)
            .setName('Backend')
            .setDesc('Where to look up interpretations. "Off" disables knowledge commands.')
            .addDropdown(dd => {
                dd.addOption('off', 'Off');
                dd.addOption('neo4j', 'Neo4j');
                dd.setValue(this.plugin.settings.knowledge.backend);
                dd.onChange(async (v) => {
                    this.plugin.settings.knowledge.backend = v as any;
                    await this.plugin.saveSettings();
                    this.plugin.rebuildKnowledgeBackend();
                    this.display();
                });
            });

        if (this.plugin.settings.knowledge.backend === 'neo4j') {
            new Setting(c)
                .setName('Neo4j URI')
                .setDesc('Bolt connection string (e.g. bolt://localhost:7687).')
                .addText(t => t
                    .setPlaceholder('bolt://localhost:7687')
                    .setValue(this.plugin.settings.knowledge.neo4jUri)
                    .onChange(async (v) => {
                        this.plugin.settings.knowledge.neo4jUri = v.trim();
                        await this.plugin.saveSettings();
                        this.plugin.rebuildKnowledgeBackend();
                    }));

            new Setting(c)
                .setName('Username')
                .addText(t => t
                    .setPlaceholder('neo4j')
                    .setValue(this.plugin.settings.knowledge.neo4jUser)
                    .onChange(async (v) => {
                        this.plugin.settings.knowledge.neo4jUser = v.trim();
                        await this.plugin.saveSettings();
                        this.plugin.rebuildKnowledgeBackend();
                    }));

            new Setting(c)
                .setName('Password')
                .setDesc('Stored in plain text in data.json. Use a read-only Neo4j account when possible.')
                .addText(t => {
                    t.inputEl.type = 'password';
                    t.setValue(this.plugin.settings.knowledge.neo4jPassword)
                        .onChange(async (v) => {
                            this.plugin.settings.knowledge.neo4jPassword = v;
                            await this.plugin.saveSettings();
                            this.plugin.rebuildKnowledgeBackend();
                        });
                });

            new Setting(c)
                .setName('Full-text index name')
                .setDesc('Neo4j full-text index on Interpretation.text. Defaults to "interpretation_text" (matches Stella ingest).')
                .addText(t => t
                    .setPlaceholder('interpretation_text')
                    .setValue(this.plugin.settings.knowledge.neo4jIndexName)
                    .onChange(async (v) => {
                        this.plugin.settings.knowledge.neo4jIndexName = v.trim() || 'interpretation_text';
                        await this.plugin.saveSettings();
                        this.plugin.rebuildKnowledgeBackend();
                    }));

            new Setting(c)
                .setName('Default result limit')
                .setDesc('How many chunks to return per Knowledge Search.')
                .addSlider(s => s
                    .setLimits(1, 20, 1)
                    .setValue(this.plugin.settings.knowledge.defaultResultLimit)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.knowledge.defaultResultLimit = v;
                        await this.plugin.saveSettings();
                    }));

            new Setting(c)
                .setName('Test connection')
                .setDesc('Run a stats query to confirm the backend is reachable.')
                .addButton(btn => btn
                    .setButtonText('Test')
                    .setCta()
                    .onClick(async () => {
                        btn.setDisabled(true).setButtonText('Testing…');
                        try {
                            const stats = await this.plugin.knowledge.stats();
                            new Notice(
                                `Connected: ${stats.interpretationCount} interpretation nodes, ${stats.authorCount ?? '?'} authors.`,
                            );
                        } catch (err: any) {
                            new Notice(`Connection failed: ${err?.message ?? err}`, 8000);
                        } finally {
                            btn.setDisabled(false).setButtonText('Test');
                        }
                    }));
        }
    }

    /* ── LLM ── */
    private renderLLM(c: HTMLElement) {
        c.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Pick an LLM provider for the synthesis commands (Insert Chart Reading, Discover Patterns, Interpret with LLM). The plugin uses your provider directly — Obsidian Moon never sees your API keys. Generated readings are also saved to a vault folder so you can refer back to them.',
        });

        new Setting(c)
            .setName('Provider')
            .addDropdown(dd => {
                dd.addOption('off', 'Off');
                dd.addOption('openai', 'OpenAI (or OpenAI-compatible)');
                dd.addOption('anthropic', 'Anthropic Claude');
                dd.addOption('ollama', 'Ollama (local)');
                dd.setValue(this.plugin.settings.llm.provider);
                dd.onChange(async (v) => {
                    this.plugin.settings.llm.provider = v as any;
                    await this.plugin.saveSettings();
                    this.plugin.rebuildLLMProvider();
                    this.display();
                });
            });

        const provider = this.plugin.settings.llm.provider;

        new Setting(c)
            .setName('Model')
            .setDesc('Model name as the provider expects it (e.g. gpt-4o-mini, claude-sonnet-4-6, llama3.1:8b).')
            .addText(t => t
                .setPlaceholder('claude-sonnet-4-6')
                .setValue(this.plugin.settings.llm.model)
                .onChange(async (v) => {
                    this.plugin.settings.llm.model = v.trim();
                    await this.plugin.saveSettings();
                }));

        if (provider === 'openai') {
            new Setting(c).setName('OpenAI base URL').addText(t => t
                .setPlaceholder('https://api.openai.com')
                .setValue(this.plugin.settings.llm.openaiBaseUrl)
                .onChange(async (v) => {
                    this.plugin.settings.llm.openaiBaseUrl = v.trim();
                    await this.plugin.saveSettings();
                    this.plugin.rebuildLLMProvider();
                }));
            new Setting(c).setName('OpenAI API key').addText(t => {
                t.inputEl.type = 'password';
                t.setValue(this.plugin.settings.llm.openaiApiKey).onChange(async (v) => {
                    this.plugin.settings.llm.openaiApiKey = v;
                    await this.plugin.saveSettings();
                    this.plugin.rebuildLLMProvider();
                });
            });
        } else if (provider === 'anthropic') {
            new Setting(c).setName('Anthropic base URL').addText(t => t
                .setPlaceholder('https://api.anthropic.com')
                .setValue(this.plugin.settings.llm.anthropicBaseUrl)
                .onChange(async (v) => {
                    this.plugin.settings.llm.anthropicBaseUrl = v.trim();
                    await this.plugin.saveSettings();
                    this.plugin.rebuildLLMProvider();
                }));
            new Setting(c).setName('Anthropic API key').addText(t => {
                t.inputEl.type = 'password';
                t.setValue(this.plugin.settings.llm.anthropicApiKey).onChange(async (v) => {
                    this.plugin.settings.llm.anthropicApiKey = v;
                    await this.plugin.saveSettings();
                    this.plugin.rebuildLLMProvider();
                });
            });
        } else if (provider === 'ollama') {
            new Setting(c).setName('Ollama base URL').setDesc('Local Ollama server, OpenAI-compatible API.')
                .addText(t => t
                    .setPlaceholder('http://localhost:11434')
                    .setValue(this.plugin.settings.llm.ollamaBaseUrl)
                    .onChange(async (v) => {
                        this.plugin.settings.llm.ollamaBaseUrl = v.trim();
                        await this.plugin.saveSettings();
                        this.plugin.rebuildLLMProvider();
                    }));
        }

        if (provider !== 'off') {
            new Setting(c).setName('Max tokens').addSlider(s => s
                .setLimits(256, 4096, 64)
                .setValue(this.plugin.settings.llm.maxTokens)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.llm.maxTokens = v;
                    await this.plugin.saveSettings();
                }));
            new Setting(c).setName('Temperature').addSlider(s => s
                .setLimits(0, 1.5, 0.05)
                .setValue(this.plugin.settings.llm.temperature)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.llm.temperature = v;
                    await this.plugin.saveSettings();
                }));
            new Setting(c).setName('Knowledge chunks per synthesis')
                .setDesc('How many knowledge graph chunks to retrieve and inline as context for each LLM call.')
                .addSlider(s => s
                    .setLimits(0, 20, 1)
                    .setValue(this.plugin.settings.llm.knowledgeLimit)
                    .setDynamicTooltip()
                    .onChange(async (v) => {
                        this.plugin.settings.llm.knowledgeLimit = v;
                        await this.plugin.saveSettings();
                    }));
            new Setting(c).setName('Memory folder')
                .setDesc('Vault folder where generated readings are saved (with frontmatter for Dataview). Leave empty to disable memory.')
                .addText(t => t
                    .setPlaceholder('ObsidianMoon/memory')
                    .setValue(this.plugin.settings.llm.memoryFolder)
                    .onChange(async (v) => {
                        this.plugin.settings.llm.memoryFolder = v.trim();
                        await this.plugin.saveSettings();
                    }));
        }
    }
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Cycle modal — picker for planet + date range, then render the response
 * ──────────────────────────────────────────────────────────────────────── */

class CycleModal extends Modal {
    plugin: MoonPlugin;
    editor: Editor;
    private planet = 'venus';
    private start: string;
    private end: string;
    private interval: 'hourly' | '6h' | 'daily' | 'weekly';
    private quickCrossings: boolean;

    constructor(app: App, plugin: MoonPlugin, editor: Editor, opts?: { quickCrossings?: boolean }) {
        super(app);
        this.plugin = plugin;
        this.editor = editor;
        this.quickCrossings = !!opts?.quickCrossings;

        const today = new Date();
        const end = new Date();
        end.setMonth(end.getMonth() + (plugin.settings.cycleLookaheadMonths ?? 6));
        this.start = isoDate(today);
        this.end = isoDate(end);
        this.interval = plugin.settings.cycleInterval ?? 'daily';
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Plot Planetary Cycle' });

        new Setting(contentEl).setName('Planet').addDropdown(dd => {
            for (const p of ['sun','moon','mercury','venus','mars','jupiter','saturn','uranus','neptune','pluto']) {
                dd.addOption(p, p.charAt(0).toUpperCase() + p.slice(1));
            }
            dd.setValue(this.planet);
            dd.onChange(v => { this.planet = v; });
        });

        const startSetting = new Setting(contentEl).setName('Start date');
        const startInput = startSetting.controlEl.createEl('input', { type: 'date' }) as HTMLInputElement;
        startInput.value = this.start;
        startInput.addEventListener('change', () => { this.start = startInput.value; });

        const endSetting = new Setting(contentEl).setName('End date');
        const endInput = endSetting.controlEl.createEl('input', { type: 'date' }) as HTMLInputElement;
        endInput.value = this.end;
        endInput.addEventListener('change', () => { this.end = endInput.value; });

        new Setting(contentEl).setName('Sample interval').addDropdown(dd => {
            for (const i of ['hourly', '6h', 'daily', 'weekly']) dd.addOption(i, i);
            dd.setValue(this.interval);
            dd.onChange(v => { this.interval = v as any; });
        });

        const tracked = this.plugin.settings.trackedCharts ?? [];
        if (tracked.length > 0) {
            contentEl.createEl('p', {
                text: `Crossings will be checked against ${tracked.length} tracked chart${tracked.length > 1 ? 's' : ''}: ${tracked.join(', ')}.`,
                cls: 'moon-tab-intro',
            });
        } else {
            contentEl.createEl('p', {
                text: 'No tracked charts configured — output will be timeline only (no natal crossings).',
                cls: 'moon-tab-intro',
            });
        }

        const btnRow = contentEl.createDiv({ cls: 'moon-modal-btn-row' });
        const runBtn = btnRow.createEl('button', { text: 'Plot cycle', cls: 'mod-cta' });
        runBtn.addEventListener('click', async () => {
            runBtn.disabled = true;
            runBtn.setText('Computing…');
            try {
                const data = await this.plugin.getCycle({
                    planet: this.planet,
                    start: this.start,
                    end: this.end,
                    interval: this.interval,
                });
                this.editor.replaceSelection(formatCycleResponse(data, this.quickCrossings));
                this.close();
            } catch (err: any) {
                new Notice(`Cycle failed: ${err?.message ?? err}`, 8000);
                runBtn.disabled = false;
                runBtn.setText('Plot cycle');
            }
        });
        btnRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}

function isoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatCycleResponse(data: CycleResponse, eventsOnly: boolean): string {
    const lines: string[] = [];
    lines.push(`# ${data.planet} cycle — ${data.start} → ${data.end}`);
    lines.push('');
    if (data.cyclePeriodDays) {
        lines.push(`*${data.planet} tropical period: ~${data.cyclePeriodDays.toFixed(1)} days. Interval: ${data.interval} (${data.pointCount} samples).*`);
        lines.push('');
    }
    if (data.natalEventCount > 0) {
        lines.push(`## Aspect crossings (${data.natalEventCount})`);
        lines.push('');
        lines.push('| Date | Aspect | Natal point | Chart | Orb |');
        lines.push('|---|---|---|---|---|');
        for (const e of data.natalEvents) {
            const exact = e.isExact ? ' ⭐' : '';
            lines.push(`| ${e.transitDate}${exact} | ${e.aspect} | ${e.natalPoint} | ${e.chart} | ${e.orb}° |`);
        }
        lines.push('');
    }
    if (!eventsOnly && data.timeline.length > 0) {
        // Trim a giant timeline to a digestible sample
        const step = Math.max(1, Math.floor(data.timeline.length / 50));
        lines.push(`## Timeline sample (every ${step}${step > 1 ? '×' : ''} ${data.interval})`);
        lines.push('');
        lines.push('| Date | Sign | Degree | Retro |');
        lines.push('|---|---|---|---|');
        for (let i = 0; i < data.timeline.length; i += step) {
            const t = data.timeline[i];
            lines.push(`| ${t.date} | ${t.sign} | ${t.degreeInSign}° | ${t.isRetrograde ? '℞' : ''} |`);
        }
    }
    return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Knowledge search modal
 * ──────────────────────────────────────────────────────────────────────── */

class KnowledgeSearchModal extends Modal {
    plugin: MoonPlugin;
    editor: Editor;
    private query = '';

    constructor(app: App, plugin: MoonPlugin, editor: Editor) {
        super(app);
        this.plugin = plugin;
        this.editor = editor;
        const selection = editor.getSelection().trim();
        if (selection) this.query = selection;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Knowledge Search' });
        contentEl.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Free-text query against your astrology knowledge graph. Pulls grounded interpretations from the configured backend.',
        });

        const input = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'e.g. Saturn return, Mars in 12th house, Venus conjunct Pluto',
        }) as HTMLInputElement;
        input.style.width = '100%';
        input.style.padding = '8px';
        input.style.marginBottom = '12px';
        input.value = this.query;
        input.focus();
        input.addEventListener('input', () => { this.query = input.value; });

        const btnRow = contentEl.createDiv({ cls: 'moon-modal-btn-row' });
        const runBtn = btnRow.createEl('button', { text: 'Insert results', cls: 'mod-cta' });
        const runQuery = async () => {
            if (!this.query.trim()) return;
            runBtn.disabled = true;
            runBtn.setText('Searching…');
            try {
                const text = await this.plugin.searchKnowledge({ query: this.query });
                this.editor.replaceSelection(text);
                this.close();
            } catch (err: any) {
                new Notice(`Search failed: ${err?.message ?? err}`, 8000);
                runBtn.disabled = false;
                runBtn.setText('Insert results');
            }
        };
        runBtn.addEventListener('click', runQuery);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runQuery(); });
        btnRow.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    }

    onClose() { this.contentEl.empty(); }
}
