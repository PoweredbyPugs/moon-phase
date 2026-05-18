/* Synthesis orchestrator — combines knowledge retrieval, chart/transit data,
 * and an LLM call to produce grounded markdown readings. */

import { KnowledgeBackend } from '../knowledge/backend';
import { parsePlacement } from '../knowledge/parse';
import { LLMProvider, LLMMessage } from './provider';
import {
    chartReadingMessages, discoverPatternsMessages, interpretPlacementMessages,
} from './prompts';

export interface SynthesisDeps {
    knowledge: KnowledgeBackend;
    llm: LLMProvider;
    model: string;
    maxTokens?: number;
    temperature?: number;
    knowledgeLimit?: number;
}

async function runLLM(deps: SynthesisDeps, messages: LLMMessage[]): Promise<string> {
    return deps.llm.complete({
        model: deps.model,
        messages,
        maxTokens: deps.maxTokens,
        temperature: deps.temperature,
    });
}

export async function synthesizeChartReading(deps: SynthesisDeps, opts: {
    chartName: string;
    chart: unknown;
    extraInstructions?: string;
}): Promise<string> {
    // Pull a broad set of knowledge chunks anchored to the chart's planets/signs.
    // We use the chart JSON as the search query — Neo4j full-text will match
    // any planet/sign tokens it contains. Limit to keep token use modest.
    const knowledge = deps.knowledge.isConfigured()
        ? await deps.knowledge.search({
            query: `natal chart ${opts.chartName}`,
            limit: deps.knowledgeLimit ?? 8,
        })
        : [];
    const messages = chartReadingMessages({ ...opts, knowledge });
    return runLLM(deps, messages);
}

export async function synthesizeDiscover(deps: SynthesisDeps, opts: {
    chartName: string;
    chart: unknown;
    transits?: unknown;
}): Promise<string> {
    const knowledge = deps.knowledge.isConfigured()
        ? await deps.knowledge.search({
            query: 'transit aspect convergence pattern',
            limit: deps.knowledgeLimit ?? 6,
        })
        : [];
    return runLLM(deps, discoverPatternsMessages({ ...opts, knowledge }));
}

export async function synthesizePlacement(deps: SynthesisDeps, placementText: string): Promise<string> {
    const parsed = parsePlacement(placementText);
    const knowledge = deps.knowledge.isConfigured()
        ? await deps.knowledge.search({
            query: parsed.query || parsed.matched.join(' ') || placementText,
            planet: parsed.planet,
            sign: parsed.sign,
            house: parsed.house,
            aspect: parsed.aspect,
            limit: deps.knowledgeLimit ?? 5,
        })
        : [];
    return runLLM(deps, interpretPlacementMessages({
        placement: placementText,
        parsedSummary: parsed.matched.length ? parsed.matched.join(', ') : undefined,
        knowledge,
    }));
}
