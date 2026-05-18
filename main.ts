import {
    App, Editor, FuzzySuggestModal, Modal, Notice, Plugin, PluginSettingTab, Setting,
    TFolder, requestUrl,
} from 'obsidian';

import {
    ASPECTS, AspectName, ASPECT_SYMBOLS,
    AspectsResponse, ChartsListResponse, CustomCommand, CycleResponse, GenerateChartBody, HEXAGRAM_SOURCE,
    MoonData, MoonPluginSettings, NatalTransitsResponse, PlanetName, PlanetsResponse,
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
import {
    castHexagram, dayHexagram, formatCast, getHexagram, hexagramLineQuery,
    HexagramCast, HexagramInfo, HexagramLine, manualHexagram,
} from './src/techniques/hexagram';

import {
    KnowledgeBackend, NullKnowledgeBackend, formatChunks,
} from './src/knowledge/backend';
import { Neo4jKnowledgeBackend } from './src/knowledge/neo4j';
import { parsePlacement } from './src/knowledge/parse';

import { LLMProvider, NullLLMProvider } from './src/synthesis/provider';
import { PROVIDERS, ProviderId, RegistryLLMProvider } from './src/synthesis/registry';
import {
    synthesizeChartReading, synthesizeDiscover, synthesizePlacement,
} from './src/synthesis/synthesize';
import { saveMemoryRecord } from './src/synthesis/memory';

/* ──────────────────────────────────────────────────────────────────────── *
 * Plugin
 * ──────────────────────────────────────────────────────────────────────── */

/* Runtime registry of commands — populated by regCmd() during onload.
 * Powers the Commands settings tab and the custom-command runner. */
interface RegisteredCommand {
    id: string;
    name: string;
    group: string;
    runner: (editor: Editor) => string | Promise<string>;
    registered: boolean;
}

export default class MoonPlugin extends Plugin {
    settings!: MoonPluginSettings;
    knowledge: KnowledgeBackend = new NullKnowledgeBackend();
    llm: LLMProvider = new NullLLMProvider();
    commandRegistry: RegisteredCommand[] = [];

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
        getDayHexagram: this.getDayHexagram.bind(this),
        lookupHexagram: this.lookupHexagram.bind(this),
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
        this.addToggleable('current-moon-phase', 'Current Moon Phase', 'Moon',
            (editor) => { this.getCurrentMoonPhase().then(s => editor.replaceSelection(s)); });

        this.addToggleable('current-moon-degree', 'Current Moon Degree', 'Moon',
            (editor) => { this.getCurrentMoonDegree().then(s => editor.replaceSelection(s)); });

        this.addToggleable('weekly-phase', 'Weekly Phase', 'Moon',
            (editor) => { this.getWeeklyPhase().then(s => editor.replaceSelection(s)); });

        /* ── Planet positions ── */
        this.addToggleable('planetary-positions', 'All Planetary Positions', 'Planets', (editor) => {
            this.getPlanetaryData().then(data => {
                editor.replaceSelection(data.planets.map(formatPlanetLine).join('\n'));
            }).catch(err => this.handleError(editor, 'planetary data', err));
        });

        for (const planetName of PLANETS) {
            this.addToggleable(`${planetName.toLowerCase()}-position`, `${planetName} Position`, 'Planets',
                (editor) => {
                    this.getPlanetaryData().then(data => {
                        const planet = data.planets.find(p => p.name === planetName);
                        editor.replaceSelection(planet
                            ? formatPlanetLine(planet)
                            : `Error: ${planetName} data not found`);
                    }).catch(err => this.handleError(editor, `${planetName} data`, err));
                });
        }

        /* ── Aspects (natal-aware when a chart is selected) ── */
        this.addToggleable('all-aspects', 'All Current Aspects', 'Aspects', (editor) => {
            this.getEffectiveAspects().then(aspects => {
                if (aspects.length === 0) {
                    editor.replaceSelection('No significant aspects currently.');
                    return;
                }
                editor.replaceSelection(aspects.map(formatSkyAspectLine).join('\n'));
            }).catch(err => this.handleError(editor, 'aspects data', err));
        });

        for (const planetName of PLANETS) {
            this.addToggleable(`${planetName.toLowerCase()}-aspects`, `${planetName} Aspects`, 'Aspects',
                (editor) => {
                    this.getEffectiveAspects().then(aspects => {
                        const relevant = aspects.filter(a =>
                            a.planet1 === planetName || a.planet2 === planetName);
                        if (relevant.length === 0) {
                            editor.replaceSelection(`No significant aspects for ${planetName} currently.`);
                            return;
                        }
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
                });
        }

        for (const aspectName of ['Conjunction', 'Opposition', 'Trine', 'Square', 'Sextile'] as AspectName[]) {
            this.addToggleable(`${aspectName.toLowerCase()}-aspects`, `${aspectName} Aspects`, 'Aspects',
                (editor) => {
                    this.getEffectiveAspects().then(aspects => {
                        const relevant = aspects.filter(a => a.aspectName === aspectName);
                        if (relevant.length === 0) {
                            editor.replaceSelection(`No ${aspectName} aspects currently.`);
                            return;
                        }
                        editor.replaceSelection(relevant.map(formatSkyAspectLine).join('\n'));
                    }).catch(err => this.handleError(editor, `${aspectName} aspects`, err));
                });
        }

        /* ── Techniques (pure-TS + Helios-backed) ── */

        this.addToggleable('cast-hexagram', 'Cast Hexagram (insert at cursor)', 'Oracle', (editor) => {
            if (!this.settings.techniques.hexagram) {
                new Notice('Enable "Hexagram" in the Techniques settings tab first.'); return;
            }
            this.getDailyHexagram().then(text => editor.replaceSelection(text))
                .catch(err => this.handleError(editor, 'hexagram', err));
        });

        this.addToggleable('open-hexagram-modal', 'Hexagram Oracle (modal — cast / manual / day)', 'Oracle', (editor) => {
            if (!this.settings.techniques.hexagram) {
                new Notice('Enable "Hexagram" in the Techniques settings tab first.'); return;
            }
            new HexagramModal(this.app, this, editor).open();
        });

        this.addToggleable('todays-ki', "Today's 9 Star Ki", 'Techniques', (editor) => {
            if (!this.settings.techniques.ki) {
                new Notice('Enable "Ki" in the Techniques settings tab first.'); return;
            }
            editor.replaceSelection(this.getTodaysKi());
        });

        this.addToggleable('natal-ki', 'Natal 9 Star Ki (selected chart / birth date)', 'Techniques', (editor) => {
            if (!this.settings.techniques.ki) {
                new Notice('Enable "Ki" in the Techniques settings tab first.'); return;
            }
            this.getNatalKi().then(text => editor.replaceSelection(text))
                .catch(err => this.handleError(editor, 'natal Ki', err));
        });

        this.addToggleable('midpoint-transits', 'Midpoint Transits (selected chart)', 'Techniques', (editor) => {
            if (!this.settings.techniques.midpoints) {
                new Notice('Enable "Midpoints" in the Techniques settings tab first.'); return;
            }
            this.getMidpointTransits().then(text => editor.replaceSelection(text))
                .catch(err => this.handleError(editor, 'midpoint transits', err));
        });

        this.addToggleable('next-eclipse', 'Next Eclipse', 'Techniques', (editor) => {
            if (!this.settings.techniques.eclipses) {
                new Notice('Enable "Eclipses" in the Techniques settings tab first.'); return;
            }
            this.getNextEclipse().then(text => editor.replaceSelection(text))
                .catch(err => this.handleError(editor, 'next eclipse', err));
        });

        this.addToggleable('dashas', 'Vimshottari Dashas (selected chart)', 'Techniques', (editor) => {
            if (!this.settings.techniques.dashas) {
                new Notice('Enable "Dashas" in the Techniques settings tab first.'); return;
            }
            this.getDashas().then(text => editor.replaceSelection(text))
                .catch(err => this.handleError(editor, 'dashas', err));
        });

        this.addToggleable('plot-cycle', 'Plot Planetary Cycle (modal)', 'Cycles', (editor) => {
            new CycleModal(this.app, this, editor).open();
        });

        /* ── Knowledge layer ── */

        this.addToggleable('knowledge-search', 'Knowledge Search', 'Knowledge', (editor) => {
            if (!this.knowledge.isConfigured()) {
                new Notice('Configure a knowledge backend in settings first.'); return;
            }
            new KnowledgeSearchModal(this.app, this, editor).open();
        });

        this.addToggleable('interpret-selection', 'Interpret Selected Placement (knowledge only)', 'Knowledge', (editor) => {
            const selection = editor.getSelection().trim() || editor.getLine(editor.getCursor().line).trim();
            if (!selection) {
                new Notice('Select a placement first (e.g. "Mars Capricorn 15˚" or "♂ ♑").'); return;
            }
            this.interpretPlacement(selection)
                .then(text => editor.replaceSelection(text))
                .catch(err => this.handleError(editor, 'interpretation', err));
        });

        /* ── Synthesis (LLM-grounded readings) ── */

        this.addToggleable('chart-reading', 'Insert Chart Reading (LLM)', 'Synthesis', (editor) => {
            if (!this.settings.defaultChart) {
                new Notice('Pick a default chart in Natal Chart settings first.'); return;
            }
            if (!this.llm.isConfigured()) {
                new Notice('Configure an LLM provider in the LLM settings tab first.'); return;
            }
            const file = this.app.workspace.getActiveFile();
            this.chartReading(this.settings.defaultChart, file?.path)
                .then(text => editor.replaceSelection(text))
                .catch(err => this.handleError(editor, 'chart reading', err));
        });

        this.addToggleable('discover-patterns', 'Discover Patterns for Default Chart (LLM)', 'Synthesis', (editor) => {
            if (!this.settings.defaultChart) {
                new Notice('Pick a default chart in Natal Chart settings first.'); return;
            }
            if (!this.llm.isConfigured()) {
                new Notice('Configure an LLM provider in the LLM settings tab first.'); return;
            }
            const file = this.app.workspace.getActiveFile();
            this.discoverPatterns(this.settings.defaultChart, file?.path)
                .then(text => editor.replaceSelection(text))
                .catch(err => this.handleError(editor, 'discover', err));
        });

        this.addToggleable('interpret-selection-llm', 'Interpret Selected Placement (LLM + knowledge)', 'Synthesis', (editor) => {
            const selection = editor.getSelection().trim() || editor.getLine(editor.getCursor().line).trim();
            if (!selection) {
                new Notice('Select a placement first.'); return;
            }
            if (!this.llm.isConfigured()) {
                new Notice('Configure an LLM provider in the LLM settings tab first.'); return;
            }
            const file = this.app.workspace.getActiveFile();
            this.interpretPlacementLLM(selection, file?.path)
                .then(text => editor.replaceSelection(text))
                .catch(err => this.handleError(editor, 'LLM interpretation', err));
        });

        this.addToggleable('cycle-crossings-default', 'Cycle Crossings to Default Chart (next 6 months)', 'Cycles', (editor) => {
            if (!this.settings.defaultChart) {
                new Notice('Pick a default chart in Natal Chart settings first.'); return;
            }
            new CycleModal(this.app, this, editor, { quickCrossings: true }).open();
        });

        // Custom composite commands defined by the user
        this.registerCustomCommands();
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
        if (ls.provider === 'off') {
            this.llm = new NullLLMProvider();
            return;
        }
        const def = PROVIDERS[ls.provider as Exclude<ProviderId, 'off'>];
        const creds = ls.providers[ls.provider] ?? { apiKey: '', baseUrl: def.defaultBaseUrl, model: '' };
        this.llm = new RegistryLLMProvider(def, creds);
    }

    /** Register a built-in command via this helper instead of `this.addCommand`
     * directly. Tracks the command in `commandRegistry` so the Commands tab
     * can list it; respects `settings.disabledCommands` to skip registration
     * for ones the user has turned off (takes effect on next reload). */
    private addToggleable(id: string, name: string, group: string,
                          editorCallback: (editor: Editor) => void) {
        const disabled = this.settings.disabledCommands.includes(id);
        this.commandRegistry.push({
            id, name, group, registered: !disabled,
            runner: (editor: Editor) => { editorCallback(editor); return ''; },
        });
        if (disabled) return;
        this.addCommand({ id, name, editorCallback });
    }

    /** Register all user-defined custom commands at load time.
     * A custom command runs its steps in sequence via the standard Obsidian
     * command dispatch — each step inserts its own text at the cursor.
     * Optional chartOverride temporarily swaps `settings.defaultChart` for
     * the duration of the step. */
    private registerCustomCommands() {
        for (const cmd of this.settings.customCommands) {
            const id = `custom-${cmd.id}`;
            this.addCommand({
                id,
                name: `${cmd.name} (custom)`,
                editorCallback: async (editor: Editor) => {
                    const savedDefault = this.settings.defaultChart;
                    try {
                        for (const step of cmd.steps) {
                            if (step.chartOverride) this.settings.defaultChart = step.chartOverride;
                            else this.settings.defaultChart = savedDefault;
                            const entry = this.commandRegistry.find(c => c.id === step.commandId);
                            if (!entry || !entry.registered) {
                                editor.replaceSelection(`_(skipped: ${step.commandId} not available)_\n\n`);
                                continue;
                            }
                            await Promise.resolve(entry.runner(editor));
                            // The runner already inserted at cursor via editor.replaceSelection;
                            // insert a separator before the next step
                            const sep = cmd.separator || '\n\n';
                            if (sep) editor.replaceSelection(sep);
                        }
                    } finally {
                        this.settings.defaultChart = savedDefault;
                    }
                },
            });
        }
    }

    /** Rebuild the knowledge backend from current settings. Called after
     * settings change. Closes the old backend if any. */
    rebuildKnowledgeBackend() {
        const previous = this.knowledge;
        const ks = this.settings.knowledge;
        if (ks.backend === 'neo4j' && ks.neo4jHttpUri && ks.neo4jUser && ks.neo4jPassword) {
            this.knowledge = new Neo4jKnowledgeBackend({
                httpUri: ks.neo4jHttpUri,
                database: ks.neo4jDatabase,
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

    /** Cast a hexagram. The cast itself is pure-TS RNG (always deterministic
     * structure). When a knowledge backend is configured, the formatted output
     * also includes the configured hexagram source's interpretation chunks
     * (defaults to "Gnostic Book of Changes" by James DeKorne / Michael Servetus). */
    async getDailyHexagram(): Promise<string> {
        const cast = castHexagram();
        const base = formatCast(cast);
        if (!this.knowledge.isConfigured() || !HEXAGRAM_SOURCE) {
            return base;
        }
        try {
            const sourceTitle = HEXAGRAM_SOURCE;
            const primary = await this.lookupHexagramText(cast.primary.number, cast.primary.name, sourceTitle);
            const relating = cast.relating
                ? await this.lookupHexagramText(cast.relating.number, cast.relating.name, sourceTitle)
                : null;
            const sections: string[] = [base];
            if (primary) {
                sections.push('', `## From ${sourceTitle} — Hexagram ${cast.primary.number}`, '', primary);
            }
            if (relating) {
                sections.push('', `## From ${sourceTitle} — Relating: Hexagram ${cast.relating!.number}`, '', relating);
            }
            return sections.join('\n');
        } catch (err) {
            console.warn('obsidian-moon: hexagram knowledge lookup failed', err);
            return base;
        }
    }

    /** Pure-TS: derive the day's hexagram using the configured day method. */
    getDayHexagram(date: Date = new Date()): HexagramCast {
        return dayHexagram(date, this.settings.oracle.dayMethod);
    }

    /** Knowledge graph lookup for a specific hexagram (and optional line),
     * scoped to the configured oracle source. */
    async lookupHexagram(number: number, line?: number): Promise<string> {
        if (!this.knowledge.isConfigured()) return '';
        const info = getHexagram(number);
        const sourceTitle = HEXAGRAM_SOURCE;
        const chunks = await this.knowledge.search({
            query: hexagramLineQuery(number, info.name, line),
            tradition: 'iching',
            limit: line ? 2 : 3,
            ...({ sourceTitle } as any),
        });
        return chunks.map(c => {
            const t = c.text.length > 1500 ? c.text.slice(0, 1500) + '…' : c.text;
            return t;
        }).join('\n\n---\n\n');
    }

    /** Internal: pull the configured source's text for a specific hexagram. */
    private async lookupHexagramText(number: number, name: string, sourceTitle: string): Promise<string> {
        // Fulltext query — wraps in quotes for the Lucene parser used by Neo4j's index
        const query = `"Hexagram ${number}" OR "${name}"`;
        const chunks = await this.knowledge.search({
            query,
            tradition: 'iching',
            limit: 3,
            // Threaded through the typed-any escape hatch — Neo4jKnowledgeBackend reads this
            ...({ sourceTitle } as any),
        });
        if (chunks.length === 0) return '';
        return chunks.map(c => {
            const truncated = c.text.length > 1200 ? c.text.slice(0, 1200) + '…' : c.text;
            return truncated;
        }).join('\n\n---\n\n');
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
        const creds = this.settings.llm.providers[this.settings.llm.provider];
        return {
            knowledge: this.knowledge,
            llm: this.llm,
            model: creds?.model ?? '',
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

type TabId = 'general' | 'chart' | 'planets' | 'aspects' | 'techniques' | 'oracle' | 'knowledge' | 'llm' | 'commands';

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
            { id: 'oracle', label: 'Oracle' },
            { id: 'knowledge', label: 'Knowledge' },
            { id: 'llm', label: 'LLM' },
            { id: 'commands', label: 'Commands' },
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
            case 'oracle':     this.renderOracle(body); break;
            case 'knowledge':  this.renderKnowledge(body); break;
            case 'llm':        this.renderLLM(body); break;
            case 'commands':   this.renderCommands(body); break;
        }
    }

    /* ── General ── */
    private renderGeneral(c: HTMLElement) {
        /* ── Server callout (top of General) ── */
        const callout = c.createDiv({ cls: 'moon-callout' });
        const inner = callout.createDiv();
        inner.createEl('strong', { text: 'Required: a running Astrology Server' });
        const p = callout.createEl('p');
        p.innerHTML =
            'Obsidian Moon is a thin client. All ephemeris + chart math happens on a small Node service — <a href="https://github.com/PoweredbyPugs/Astrology-Server" target="_blank">PoweredbyPugs/Astrology-Server</a>. Clone, <code>docker compose up -d --build</code>, then point the Server URL below at it.';
        const calloutBtn = callout.createEl('a', {
            text: '↗ Open Astrology Server on GitHub',
            cls: 'moon-callout-btn',
            attr: { href: 'https://github.com/PoweredbyPugs/Astrology-Server', target: '_blank' },
        });
        calloutBtn.addEventListener('click', (e) => { e.stopPropagation(); });

        new Setting(c)
            .setName('Server URL')
            .setDesc('Where the Astrology Server is reachable (e.g. http://baratie:3000 on the tailnet, or http://localhost:3000 locally).')
            .addText(text => text
                .setPlaceholder('http://localhost:3000')
                .setValue(this.plugin.settings.serverUrl)
                .onChange(async (value) => {
                    this.plugin.settings.serverUrl = normalizeBaseUrl(value);
                    await this.plugin.saveSettings();
                }))
            .addExtraButton(btn => btn
                .setIcon('github')
                .setTooltip('Open Astrology Server on GitHub')
                .onClick(() => window.open('https://github.com/PoweredbyPugs/Astrology-Server', '_blank')));

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
            .setDesc('Current transits aspecting natal midpoints (90-degree dial / cosmobiology).')
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
            .setDesc('Solar and lunar eclipses, with sign + degree.')
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
            .setDesc('Vedic Vimshottari dasha periods for a saved chart, derived from the natal Moon\'s nakshatra.')
            .addToggle(t => t
                .setValue(this.plugin.settings.techniques.dashas)
                .onChange(async (v) => {
                    this.plugin.settings.techniques.dashas = v;
                    await this.plugin.saveSettings();
                }));
    }

    /* ── Oracle ── */
    private renderOracle(c: HTMLElement) {
        c.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Divination tools. Currently I Ching via the Hexagram Oracle modal; Tarot is on the roadmap. Interpretations are pulled from the configured source in your knowledge graph (default: the Gnostic Book of Changes by James DeKorne / Michael Servetus — public-domain at jamesdekorne.com).',
        });

        c.createEl('h3', { text: 'I Ching' });

        const sourceCallout = c.createEl('p', { cls: 'moon-tab-intro' });
        sourceCallout.innerHTML =
            `Interpretations come from <strong>The Gnostic Book of Changes</strong> by James DeKorne (Michael Servetus, public-domain — <a href="https://www.jamesdekorne.com/GBCh/GBC.htm" target="_blank">jamesdekorne.com</a>). The corpus must already be ingested into your knowledge graph for line-by-line drill-down to work.`;

        new Setting(c)
            .setName('"From the day" method')
            .setDesc('How the modal derives a hexagram for "From the day". Plum Blossom uses year+month+day for the trigrams and year+month+day+hour for the changing line (always 1 changing line). YMD hash is a stable daily hexagram with no changing lines.')
            .addDropdown(dd => {
                dd.addOption('plum-blossom', 'Plum Blossom (year+month+day+hour)');
                dd.addOption('ymd-hash', 'YMD hash (stable daily, no changing line)');
                dd.setValue(this.plugin.settings.oracle.dayMethod);
                dd.onChange(async (v) => {
                    this.plugin.settings.oracle.dayMethod = v as any;
                    await this.plugin.saveSettings();
                });
            });

        this.addFolderSetting(c, 'Journal folder',
            'Vault folder where oracle casts are saved when you click "Save to journal" in the modal.',
            this.plugin.settings.oracle.journalFolder,
            async (v) => { this.plugin.settings.oracle.journalFolder = v; await this.plugin.saveSettings(); });

        new Setting(c)
            .setName('Autosave every cast')
            .setDesc('When on, every cast from the modal is silently saved to the journal folder. When off, you have to click "Save to journal" explicitly.')
            .addToggle(t => t
                .setValue(this.plugin.settings.oracle.autosaveCasts)
                .onChange(async (v) => {
                    this.plugin.settings.oracle.autosaveCasts = v;
                    await this.plugin.saveSettings();
                }));

        const tarotHint = c.createEl('p', { cls: 'moon-tab-intro' });
        tarotHint.style.marginTop = '20px';
        tarotHint.style.borderTop = '1px solid var(--background-modifier-border)';
        tarotHint.style.paddingTop = '14px';
        tarotHint.innerHTML = '<strong>Tarot</strong> — on the roadmap. Will land in this tab when ready.';
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
                .setName('Neo4j HTTP URI')
                .setDesc('Neo4j HTTP endpoint (e.g. http://localhost:7474). The plugin talks Cypher over Neo4j\'s transactional HTTP API — no native driver dependency.')
                .addText(t => t
                    .setPlaceholder('http://localhost:7474')
                    .setValue(this.plugin.settings.knowledge.neo4jHttpUri)
                    .onChange(async (v) => {
                        this.plugin.settings.knowledge.neo4jHttpUri = v.trim();
                        await this.plugin.saveSettings();
                        this.plugin.rebuildKnowledgeBackend();
                    }));

            new Setting(c)
                .setName('Database')
                .setDesc('Neo4j database name (default: neo4j).')
                .addText(t => t
                    .setPlaceholder('neo4j')
                    .setValue(this.plugin.settings.knowledge.neo4jDatabase)
                    .onChange(async (v) => {
                        this.plugin.settings.knowledge.neo4jDatabase = v.trim() || 'neo4j';
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
            text: 'LLM provider for synthesis commands (Insert Chart Reading, Discover Patterns, Interpret with LLM, modal-mode LLM-synthesized hexagram readings). The plugin calls the provider directly using your credentials. Per-provider creds are kept separate so switching doesn\'t blow them away.',
        });

        new Setting(c)
            .setName('Provider')
            .addDropdown(dd => {
                dd.addOption('off', 'Off');
                for (const def of Object.values(PROVIDERS)) {
                    dd.addOption(def.id, def.label);
                }
                dd.setValue(this.plugin.settings.llm.provider);
                dd.onChange(async (v) => {
                    this.plugin.settings.llm.provider = v as any;
                    await this.plugin.saveSettings();
                    this.plugin.rebuildLLMProvider();
                    this.display();
                });
            });

        const providerId = this.plugin.settings.llm.provider;
        if (providerId === 'off') return;

        const def = PROVIDERS[providerId as Exclude<ProviderId, 'off'>];
        const creds = this.plugin.settings.llm.providers[providerId]
            ?? { apiKey: '', baseUrl: def.defaultBaseUrl, model: '' };
        // Ensure the slot exists in settings so onChange writes land somewhere
        this.plugin.settings.llm.providers[providerId] = creds;

        new Setting(c)
            .setName('Base URL')
            .setDesc(`Default: ${def.defaultBaseUrl}. Override only if you're using a proxy or a self-hosted variant.`)
            .addText(t => t
                .setPlaceholder(def.defaultBaseUrl)
                .setValue(creds.baseUrl)
                .onChange(async (v) => {
                    creds.baseUrl = v.trim();
                    await this.plugin.saveSettings();
                    this.plugin.rebuildLLMProvider();
                }));

        new Setting(c)
            .setName(providerId === 'openclaw' ? 'Agent (model field)' : 'Model')
            .setDesc(providerId === 'openclaw'
                ? 'OpenClaw routes to an agent via the OpenAI-compatible model field. e.g. openclaw/default, openclaw/main, openclaw/<agent-id>.'
                : 'Provider-specific model identifier. e.g. gpt-4o-mini, claude-sonnet-4-6, anthropic/claude-sonnet-4.5, gemini-2.5-pro, llama3.1:8b.')
            .addText(t => t
                .setPlaceholder(def.id === 'openclaw' ? 'openclaw/default' : 'model id')
                .setValue(creds.model)
                .onChange(async (v) => {
                    creds.model = v.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(c)
            .setName('API key')
            .setDesc(def.needsKey
                ? 'Required. Stored in plain text in data.json — keep that file out of git.'
                : 'Optional for this provider (local gateway). Set only if your deployment requires Bearer auth.')
            .addText(t => {
                t.inputEl.type = 'password';
                t.setPlaceholder(def.needsKey ? 'required' : 'optional')
                    .setValue(creds.apiKey)
                    .onChange(async (v) => {
                        creds.apiKey = v;
                        await this.plugin.saveSettings();
                        this.plugin.rebuildLLMProvider();
                    });
            });

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
        this.addFolderSetting(c, 'Memory folder',
            'Vault folder where generated readings are saved with frontmatter for Dataview. Leave empty to disable memory.',
            this.plugin.settings.llm.memoryFolder,
            async (v) => { this.plugin.settings.llm.memoryFolder = v; await this.plugin.saveSettings(); });
    }

    /* ── Commands ── */
    private renderCommands(c: HTMLElement) {
        c.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'All commands that Obsidian Moon registers. Disable any you do not want cluttering the palette — takes effect after reloading the plugin. Below, build "custom commands" that combine existing ones in sequence (e.g. Today\'s Moon + Today\'s Ki + Cast Hexagram, all inserted at the cursor with a separator between).',
        });

        /* ── Built-in commands grouped by category ── */
        const grouped = new Map<string, RegisteredCommand[]>();
        for (const cmd of this.plugin.commandRegistry) {
            const list = grouped.get(cmd.group) ?? [];
            list.push(cmd);
            grouped.set(cmd.group, list);
        }

        for (const [group, cmds] of grouped) {
            c.createEl('h3', { text: group });
            for (const cmd of cmds) {
                new Setting(c)
                    .setName(cmd.name)
                    .setDesc(`id: ${cmd.id}`)
                    .addToggle(t => t
                        .setValue(cmd.registered)
                        .onChange(async (v) => {
                            const list = this.plugin.settings.disabledCommands;
                            const i = list.indexOf(cmd.id);
                            if (v && i >= 0) list.splice(i, 1);
                            else if (!v && i < 0) list.push(cmd.id);
                            await this.plugin.saveSettings();
                            // Update the in-memory flag so the UI stays in sync;
                            // actual register/unregister requires a plugin reload.
                            cmd.registered = v;
                            new Notice(`${v ? 'Enabled' : 'Disabled'} "${cmd.name}". Reload the plugin to take effect.`);
                        }));
            }
        }

        /* ── Custom composite commands ── */
        c.createEl('h3', { text: 'Custom commands' });
        c.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Each custom command runs the listed steps in sequence. Each step inserts its output at the cursor; a separator goes between steps. Chart Override lets a step run against a chart other than your default (useful for relationship-style commands that pull from multiple charts).',
        });

        const customList = c.createDiv({ cls: 'moon-custom-cmd-list' });
        const renderCustom = () => {
            customList.empty();
            const list = this.plugin.settings.customCommands;
            if (list.length === 0) {
                customList.createEl('p', {
                    cls: 'moon-tab-intro',
                    text: 'No custom commands yet. Click "Add custom command" below.',
                });
            }
            list.forEach((cmd, idx) => this.renderCustomCommandCard(customList, cmd, idx, renderCustom));
        };
        renderCustom();

        new Setting(c).addButton(b => b
            .setButtonText('+ Add custom command')
            .setCta()
            .onClick(async () => {
                const newCmd: CustomCommand = {
                    id: `cmd-${Date.now().toString(36)}`,
                    name: 'New custom command',
                    separator: '\n\n',
                    steps: [],
                };
                this.plugin.settings.customCommands.push(newCmd);
                await this.plugin.saveSettings();
                renderCustom();
            }));
    }

    private renderCustomCommandCard(parent: HTMLElement, cmd: CustomCommand, idx: number, rerender: () => void) {
        const card = parent.createDiv({ cls: 'moon-custom-cmd-card' });

        const header = card.createDiv({ cls: 'moon-custom-cmd-header' });
        const nameInput = header.createEl('input', { type: 'text', value: cmd.name }) as HTMLInputElement;
        nameInput.placeholder = 'Custom command name';
        nameInput.addEventListener('change', async () => {
            cmd.name = nameInput.value.trim() || 'Custom command';
            await this.plugin.saveSettings();
        });
        const delBtn = header.createEl('button', { text: '×', cls: 'moon-custom-cmd-delete' });
        delBtn.title = 'Delete this custom command';
        delBtn.addEventListener('click', async () => {
            this.plugin.settings.customCommands.splice(idx, 1);
            await this.plugin.saveSettings();
            rerender();
        });

        new Setting(card)
            .setName('Separator between steps')
            .setDesc('Inserted at the cursor between each step. Use \\n\\n for a blank line.')
            .addText(t => t
                .setPlaceholder('\\n\\n')
                .setValue(cmd.separator.replace(/\n/g, '\\n'))
                .onChange(async (v) => {
                    cmd.separator = v.replace(/\\n/g, '\n');
                    await this.plugin.saveSettings();
                }));

        const stepsWrap = card.createDiv({ cls: 'moon-custom-cmd-steps' });
        cmd.steps.forEach((step, i) => {
            const stepCard = stepsWrap.createDiv({ cls: 'moon-custom-cmd-step' });
            new Setting(stepCard)
                .setName(`Step ${i + 1}`)
                .addDropdown(dd => {
                    dd.addOption('', '— pick a command —');
                    for (const r of this.plugin.commandRegistry) {
                        dd.addOption(r.id, `${r.group}: ${r.name}`);
                    }
                    dd.setValue(step.commandId);
                    dd.onChange(async (v) => { step.commandId = v; await this.plugin.saveSettings(); });
                })
                .addDropdown(dd => {
                    dd.addOption('', 'Use default chart');
                    for (const cName of this.plugin.settings.trackedCharts) dd.addOption(cName, `→ ${cName}`);
                    dd.setValue(step.chartOverride ?? '');
                    dd.onChange(async (v) => {
                        step.chartOverride = v || undefined;
                        await this.plugin.saveSettings();
                    });
                })
                .addExtraButton(b => b.setIcon('cross').setTooltip('Remove step').onClick(async () => {
                    cmd.steps.splice(i, 1);
                    await this.plugin.saveSettings();
                    rerender();
                }));
        });

        new Setting(card).addButton(b => b
            .setButtonText('+ Add step')
            .onClick(async () => {
                cmd.steps.push({ commandId: '' });
                await this.plugin.saveSettings();
                rerender();
            }));

        card.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Registered as command id "custom-' + cmd.id + '". Reload the plugin after editing for changes to appear in the command palette.',
        });
    }

    /* Folder-text-with-browse helper used by the Oracle and LLM tabs. */
    private addFolderSetting(parent: HTMLElement, name: string, desc: string,
                              currentValue: string, onSet: (v: string) => Promise<void>): Setting {
        return new Setting(parent)
            .setName(name)
            .setDesc(desc)
            .addText(t => t
                .setPlaceholder('vault/path')
                .setValue(currentValue)
                .onChange(v => { void onSet(v.trim()); }))
            .addExtraButton(btn => btn
                .setIcon('folder')
                .setTooltip('Browse vault folders')
                .onClick(() => {
                    new FolderPickerModal(this.plugin.app, async (path) => {
                        await onSet(path);
                        this.display();
                    }).open();
                }));
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

/* ──────────────────────────────────────────────────────────────────────── *
 * Hexagram Oracle modal — Cast / Manual / Day, with line-by-line drill-down
 * sourced from the configured oracle (default: Gnostic Book of Changes)
 * ──────────────────────────────────────────────────────────────────────── */

type HexagramMode = 'cast' | 'manual' | 'day';

class HexagramModal extends Modal {
    plugin: MoonPlugin;
    editor: Editor;
    private mode: HexagramMode = 'cast';
    private question = '';
    private cast: HexagramCast | null = null;
    private manualNumber = 1;
    private manualLines: number[] = [];
    private bodyEl: HTMLDivElement | null = null;
    private lineCache: Map<string, string> = new Map();

    constructor(app: App, plugin: MoonPlugin, editor: Editor) {
        super(app);
        this.plugin = plugin;
        this.editor = editor;
        this.modalEl.addClass('moon-hexagram-modal');
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Hexagram Oracle' });

        /* ── Question (optional) ── */
        const questionWrap = contentEl.createDiv({ cls: 'moon-hex-question' });
        questionWrap.createEl('label', { text: 'Question (optional)' });
        const q = questionWrap.createEl('input', {
            type: 'text',
            placeholder: 'What is the moment about?',
        }) as HTMLInputElement;
        q.addEventListener('input', () => { this.question = q.value; });

        /* ── Mode toggle ── */
        const modeRow = contentEl.createDiv({ cls: 'moon-hex-mode-row' });
        const modes: Array<{ id: HexagramMode; label: string }> = [
            { id: 'cast', label: 'Cast' },
            { id: 'manual', label: 'Manual' },
            { id: 'day', label: 'From the day' },
        ];
        for (const m of modes) {
            const btn = modeRow.createEl('button', {
                text: m.label,
                cls: 'moon-hex-mode' + (this.mode === m.id ? ' moon-hex-mode-active' : ''),
            });
            btn.addEventListener('click', () => {
                this.mode = m.id;
                this.cast = null;
                this.renderBody();
            });
        }

        this.bodyEl = contentEl.createDiv({ cls: 'moon-hex-body' });
        this.renderBody();

        /* ── Footer ── */
        const footer = contentEl.createDiv({ cls: 'moon-hex-footer' });
        footer.createEl('button', { text: 'Recast', cls: 'moon-hex-btn' })
            .addEventListener('click', () => { this.cast = null; this.renderBody(); });

        const insertWrap = footer.createDiv({ cls: 'moon-hex-insert-wrap' });
        const formatSel = insertWrap.createEl('select', { cls: 'dropdown' }) as HTMLSelectElement;
        for (const [v, t] of [
            ['compact', 'Compact'],
            ['full', 'Full reading'],
            ['llm', 'LLM-synthesized'],
        ]) {
            formatSel.createEl('option', { value: v, text: t });
        }
        const insertBtn = insertWrap.createEl('button', { text: 'Insert', cls: 'mod-cta' });
        insertBtn.addEventListener('click', () => this.insert(formatSel.value as 'compact' | 'full' | 'llm', insertBtn));

        const saveBtn = footer.createEl('button', { text: 'Save to journal', cls: 'moon-hex-btn' });
        saveBtn.addEventListener('click', () => this.saveToJournal(saveBtn));

        footer.createEl('button', { text: 'Close', cls: 'moon-hex-btn' }).addEventListener('click', () => this.close());
    }

    onClose() { this.contentEl.empty(); }

    /* ── Body render: cast-mode generation + always-rendered cast view ── */
    private renderBody() {
        if (!this.bodyEl) return;
        this.bodyEl.empty();
        this.lineCache.clear();

        if (this.mode === 'cast') {
            if (!this.cast) this.cast = castHexagram();
        } else if (this.mode === 'day') {
            if (!this.cast) this.cast = this.plugin.getDayHexagram();
        } else if (this.mode === 'manual') {
            this.renderManualPicker();
            return;
        }

        this.renderCast();
        if (this.plugin.settings.oracle.autosaveCasts && this.cast) {
            void this.saveToJournal(null).catch(() => { /* ignore */ });
        }
    }

    private renderManualPicker() {
        const wrap = this.bodyEl!.createDiv({ cls: 'moon-hex-manual' });
        wrap.createEl('p', {
            cls: 'moon-tab-intro',
            text: 'Pick a hexagram by number (1–64) and optional changing lines.',
        });

        new Setting(wrap)
            .setName('Hexagram number')
            .addText(t => t
                .setPlaceholder('1–64')
                .setValue(String(this.manualNumber))
                .onChange(v => {
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n) && n >= 1 && n <= 64) this.manualNumber = n;
                }));

        new Setting(wrap)
            .setName('Changing lines (comma-separated, 1–6)')
            .addText(t => t
                .setPlaceholder('e.g. 1,3,5')
                .setValue(this.manualLines.join(','))
                .onChange(v => {
                    this.manualLines = v.split(',')
                        .map(s => parseInt(s.trim(), 10))
                        .filter(n => n >= 1 && n <= 6);
                }));

        new Setting(wrap).addButton(b => b
            .setButtonText('Build hexagram')
            .setCta()
            .onClick(() => {
                try {
                    this.cast = manualHexagram(this.manualNumber, this.manualLines);
                    this.bodyEl!.empty();
                    this.renderCast();
                } catch (err: any) {
                    new Notice(`Couldn't build: ${err?.message ?? err}`, 6000);
                }
            }));
    }

    private renderCast() {
        if (!this.cast || !this.bodyEl) return;
        const cast = this.cast;

        /* ── Visual hexagram + header ── */
        const head = this.bodyEl.createDiv({ cls: 'moon-hex-head' });
        const figure = head.createDiv({ cls: 'moon-hex-figure' });
        this.renderHexagramVisual(figure, cast.lines);

        const info = head.createDiv({ cls: 'moon-hex-info' });
        info.createEl('h3', {
            text: `Hexagram ${cast.primary.number} · ${cast.primary.name}`,
            cls: 'moon-hex-name',
        });
        info.createEl('p', {
            text: `${cast.primary.chinese} · ${cast.primary.upper} above, ${cast.primary.lower} below`,
            cls: 'moon-hex-meta',
        });
        info.createEl('p', { text: cast.primary.judgment, cls: 'moon-hex-judgment' });
        if (cast.changingLines.length > 0) {
            info.createEl('p', {
                text: `Changing lines: ${cast.changingLines.join(', ')}`,
                cls: 'moon-hex-changing',
            });
        }

        /* ── Per-line drill-down ── */
        const linesEl = this.bodyEl.createDiv({ cls: 'moon-hex-lines' });
        linesEl.createEl('h4', { text: 'Lines (click to expand)' });
        for (let lineNum = 1; lineNum <= 6; lineNum++) {
            this.renderLineRow(linesEl, cast.primary, lineNum, cast.changingLines.includes(lineNum));
        }

        /* ── Full DeKorne entry (collapsible) ── */
        const fullSection = this.bodyEl.createEl('details', { cls: 'moon-hex-full' });
        fullSection.createEl('summary', {
            text: `Full ${HEXAGRAM_SOURCE} entry`,
        });
        const fullBody = fullSection.createDiv({ cls: 'moon-hex-full-body', text: 'Loading…' });
        fullSection.addEventListener('toggle', () => {
            if (fullSection.open && fullBody.textContent === 'Loading…') {
                this.plugin.lookupHexagram(cast.primary.number)
                    .then(text => { fullBody.empty(); fullBody.createEl('pre', { text: text || '(no chunks found)' }); })
                    .catch(err => { fullBody.empty(); fullBody.createEl('p', { text: `Lookup failed: ${err?.message ?? err}` }); });
            }
        });

        /* ── Relating hexagram ── */
        if (cast.relating) {
            const rel = this.bodyEl.createEl('details', { cls: 'moon-hex-relating' });
            rel.createEl('summary', {
                text: `Changing into: Hexagram ${cast.relating.number} · ${cast.relating.name}`,
            });
            const relBody = rel.createDiv({ cls: 'moon-hex-relating-body' });
            relBody.createEl('p', {
                text: `${cast.relating.chinese} · ${cast.relating.upper} above, ${cast.relating.lower} below`,
                cls: 'moon-hex-meta',
            });
            relBody.createEl('p', { text: cast.relating.judgment, cls: 'moon-hex-judgment' });

            const relText = relBody.createDiv({ text: 'Loading…' });
            rel.addEventListener('toggle', () => {
                if (rel.open && relText.textContent === 'Loading…') {
                    this.plugin.lookupHexagram(cast.relating!.number)
                        .then(text => { relText.empty(); relText.createEl('pre', { text: text || '(no chunks found)' }); })
                        .catch(err => { relText.empty(); relText.createEl('p', { text: `Lookup failed: ${err?.message ?? err}` }); });
                }
            });
        }
    }

    private renderHexagramVisual(parent: HTMLDivElement, lines: HexagramLine[]) {
        // Top to bottom (so line 6 renders first)
        for (let i = 5; i >= 0; i--) {
            const l = lines[i];
            const lineEl = parent.createDiv({ cls: 'moon-hex-line' });
            if (l.yin) {
                lineEl.addClass('moon-hex-line-yin');
                lineEl.createSpan({ cls: 'moon-hex-half' });
                if (l.changing) lineEl.createSpan({ cls: 'moon-hex-x', text: '×' });
                else lineEl.createSpan({ cls: 'moon-hex-gap' });
                lineEl.createSpan({ cls: 'moon-hex-half' });
            } else {
                lineEl.addClass('moon-hex-line-yang');
                const span = lineEl.createSpan({ cls: 'moon-hex-solid' });
                if (l.changing) span.createSpan({ cls: 'moon-hex-o', text: '○' });
            }
        }
    }

    private renderLineRow(parent: HTMLElement, info: HexagramInfo, lineNum: number, isChanging: boolean) {
        const details = parent.createEl('details', { cls: 'moon-hex-line-row' });
        if (isChanging) details.addClass('moon-hex-line-changing');
        const summary = details.createEl('summary');
        summary.setText(`Line ${lineNum}${isChanging ? ' · changing' : ''}`);
        const body = details.createDiv({ cls: 'moon-hex-line-body', text: 'Loading…' });
        details.addEventListener('toggle', () => {
            if (!details.open || body.textContent !== 'Loading…') return;
            const cacheKey = `${info.number}-${lineNum}`;
            if (this.lineCache.has(cacheKey)) {
                body.empty();
                body.createEl('pre', { text: this.lineCache.get(cacheKey)! });
                return;
            }
            this.plugin.lookupHexagram(info.number, lineNum).then(text => {
                body.empty();
                if (text) {
                    this.lineCache.set(cacheKey, text);
                    body.createEl('pre', { text });
                } else {
                    body.createEl('p', {
                        text: `(No chunks found for Hexagram ${info.number}, Line ${lineNum}. Try the "Full entry" section above.)`,
                        cls: 'moon-tab-intro',
                    });
                }
            }).catch(err => {
                body.empty();
                body.createEl('p', { text: `Lookup failed: ${err?.message ?? err}` });
            });
        });
    }

    /* ── Insert: compact / full / LLM ── */
    private async insert(format: 'compact' | 'full' | 'llm', btn: HTMLButtonElement) {
        if (!this.cast) { new Notice('Nothing cast yet.'); return; }
        btn.disabled = true;
        btn.setText('Working…');
        try {
            let text = '';
            if (format === 'compact') {
                text = formatCast(this.cast);
            } else if (format === 'full') {
                text = await this.buildFullReading();
            } else {
                text = await this.buildLLMReading();
            }
            if (this.question.trim()) {
                text = `**Question:** ${this.question.trim()}\n\n${text}`;
            }
            this.editor.replaceSelection(text);
            this.close();
        } catch (err: any) {
            new Notice(`Insert failed: ${err?.message ?? err}`, 8000);
            btn.disabled = false;
            btn.setText('Insert');
        }
    }

    private async buildFullReading(): Promise<string> {
        if (!this.cast) return '';
        const sections: string[] = [formatCast(this.cast)];
        if (this.plugin.knowledge.isConfigured()) {
            const source = HEXAGRAM_SOURCE;
            // Primary hexagram full text + each changing line's text
            const primaryFull = await this.plugin.lookupHexagram(this.cast.primary.number);
            if (primaryFull) {
                sections.push('', `## ${source} — Hexagram ${this.cast.primary.number}`, '', primaryFull);
            }
            for (const ln of this.cast.changingLines) {
                const lineText = await this.plugin.lookupHexagram(this.cast.primary.number, ln);
                if (lineText) {
                    sections.push('', `### Line ${ln}`, '', lineText);
                }
            }
            if (this.cast.relating) {
                const relText = await this.plugin.lookupHexagram(this.cast.relating.number);
                if (relText) {
                    sections.push('', `## ${source} — Relating: Hexagram ${this.cast.relating.number}`, '', relText);
                }
            }
        }
        return sections.join('\n');
    }

    private async buildLLMReading(): Promise<string> {
        if (!this.cast) return '';
        if (!this.plugin.llm.isConfigured()) {
            new Notice('LLM not configured — falling back to full reading.', 5000);
            return this.buildFullReading();
        }
        const compact = formatCast(this.cast);
        const knowledge = await this.gatherCastKnowledge();
        const systemPrompt = `You are interpreting an I Ching cast. The user has cast a hexagram. Their question (if any), the cast, and source-grounded interpretation chunks are provided. Write a focused 2-4 paragraph reading that answers the question through the lens of the cast, drawing on the sources for grounding without quoting them at length.`;
        const userMsg = `## Question
${this.question.trim() || '_(no specific question)_'}

## Cast
${compact}

## Source material
${knowledge || '_(no chunks retrieved)_'}`;
        const creds = this.plugin.settings.llm.providers[this.plugin.settings.llm.provider];
        return this.plugin.llm.complete({
            model: creds?.model ?? '',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMsg },
            ],
            maxTokens: this.plugin.settings.llm.maxTokens,
            temperature: this.plugin.settings.llm.temperature,
        });
    }

    private async gatherCastKnowledge(): Promise<string> {
        if (!this.cast || !this.plugin.knowledge.isConfigured()) return '';
        const parts: string[] = [];
        const primary = await this.plugin.lookupHexagram(this.cast.primary.number);
        if (primary) parts.push(`### Hexagram ${this.cast.primary.number}\n${primary}`);
        for (const ln of this.cast.changingLines) {
            const t = await this.plugin.lookupHexagram(this.cast.primary.number, ln);
            if (t) parts.push(`### Line ${ln}\n${t}`);
        }
        if (this.cast.relating) {
            const rel = await this.plugin.lookupHexagram(this.cast.relating.number);
            if (rel) parts.push(`### Changing into ${this.cast.relating.number}\n${rel}`);
        }
        return parts.join('\n\n');
    }

    private async saveToJournal(btn: HTMLButtonElement | null) {
        if (!this.cast) { new Notice('Nothing cast yet.'); return; }
        const folder = this.plugin.settings.oracle.journalFolder;
        if (!folder) { new Notice('Set an oracle journal folder in Oracle settings first.'); return; }
        if (btn) { btn.disabled = true; btn.setText('Saving…'); }
        try {
            const ts = new Date().toISOString();
            const slug = `hex-${this.cast.primary.number}-${this.cast.relating ? `to-${this.cast.relating.number}` : 'stable'}`;
            await saveMemoryRecord(this.app, folder, {
                chart: 'oracle',
                kind: 'interpret-placement',
                timestamp: ts,
                placement: `Hexagram ${this.cast.primary.number} (${this.mode} mode)`,
                notes: this.question.trim() || undefined,
                body: `${this.question.trim() ? `**Question:** ${this.question.trim()}\n\n` : ''}${formatCast(this.cast)}`,
            });
            if (btn) { new Notice('Saved to journal.'); btn.disabled = false; btn.setText('Save to journal'); }
        } catch (err: any) {
            new Notice(`Save failed: ${err?.message ?? err}`, 8000);
            if (btn) { btn.disabled = false; btn.setText('Save to journal'); }
        }
    }
}

/* ──────────────────────────────────────────────────────────────────────── *
 * FolderPickerModal — FuzzySuggestModal over all vault folders
 * ──────────────────────────────────────────────────────────────────────── */

class FolderPickerModal extends FuzzySuggestModal<string> {
    constructor(app: App, private onPick: (path: string) => void | Promise<void>) {
        super(app);
        this.setPlaceholder('Pick a folder…');
    }

    getItems(): string[] {
        const folders: string[] = ['/'];
        const walk = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    folders.push(child.path);
                    walk(child);
                }
            }
        };
        walk(this.app.vault.getRoot());
        return folders;
    }

    getItemText(item: string): string {
        return item;
    }

    onChooseItem(item: string): void {
        void this.onPick(item === '/' ? '' : item);
    }
}
