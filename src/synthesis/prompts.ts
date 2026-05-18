/* Prompt templates — inspired by Stella's prompt set, condensed for the
 * obsidian-moon use-case (single-call synthesis, no tool use). */

import { KnowledgeChunk } from '../knowledge/backend';
import { LLMMessage } from './provider';

const SYSTEM_PROMPT_BASE = `You are an astrology interpretation assistant working inside an Obsidian note.
You receive: (a) structured chart/transit data computed from the Swiss Ephemeris,
and (b) retrieved chunks from a curated knowledge graph of astrological texts.

Your job is to write a grounded, specific interpretation in the voice of an
experienced astrologer. Quote or paraphrase the knowledge chunks when they're
relevant, but synthesize — don't just list. If the chart data and knowledge
disagree, prefer the chart data. Stay in Markdown. Be concise.`;

function knowledgeBlock(chunks: KnowledgeChunk[]): string {
    if (!chunks || chunks.length === 0) {
        return '_(No retrieved knowledge — write from general principles.)_';
    }
    return chunks.map((c, i) => {
        const tag = [c.author, c.sourceTitle, c.layer].filter(Boolean).join(' · ');
        return `### Source ${i + 1} — ${tag || 'unattributed'}\n${c.text}`;
    }).join('\n\n');
}

/* Build a "chart reading" prompt: rich narrative for a saved chart. */
export function chartReadingMessages(opts: {
    chartName: string;
    chart: unknown;            // serialized natal chart JSON from /chart/:name
    knowledge: KnowledgeChunk[];
    extraInstructions?: string;
}): LLMMessage[] {
    const chartJson = JSON.stringify(opts.chart, null, 2);
    return [
        { role: 'system', content: SYSTEM_PROMPT_BASE },
        {
            role: 'user',
            content: `# Chart Reading Request

Write a focused natal chart reading for **${opts.chartName}**.

## Chart data (Swiss Ephemeris)
\`\`\`json
${chartJson.length > 6000 ? chartJson.slice(0, 6000) + '\n... (truncated)' : chartJson}
\`\`\`

## Retrieved knowledge
${knowledgeBlock(opts.knowledge)}

## What to write
- Open with the chart's overall feel (Sun, Moon, Ascendant — sect-aware if available).
- Then the standout features: tight aspects, angular planets, the chart ruler, the lord of the year if present, the final dispositor.
- Close with one thing to watch this season (use the transit data if present).
- No bullet-only output — write in paragraphs, with H2 section headers.${opts.extraInstructions ? `\n\n${opts.extraInstructions}` : ''}`,
        },
    ];
}

/* Build a "discover patterns" prompt: cross-technique pattern surfacer. */
export function discoverPatternsMessages(opts: {
    chartName: string;
    chart: unknown;
    transits?: unknown;
    knowledge: KnowledgeChunk[];
}): LLMMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT_BASE },
        {
            role: 'user',
            content: `# Discover Patterns

Find non-obvious convergences across the chart and current transits for **${opts.chartName}**.

## Chart
\`\`\`json
${JSON.stringify(opts.chart, null, 2).slice(0, 5000)}
\`\`\`

${opts.transits ? `## Current transits\n\`\`\`json\n${JSON.stringify(opts.transits, null, 2).slice(0, 4000)}\n\`\`\`\n` : ''}

## Retrieved knowledge
${knowledgeBlock(opts.knowledge)}

## What to surface
- Convergences: multiple techniques pointing at the same theme (e.g. transit Saturn squaring a midpoint that also contains the lord of the year).
- Activations: where today's sky lights up a tight or angular natal aspect.
- Quiet themes: places nothing is happening that you'd expect to be active.
- Be specific. Cite the planets and degrees you're talking about.`,
        },
    ];
}

/* Build a placement-interpretation prompt. */
export function interpretPlacementMessages(opts: {
    placement: string;       // e.g. "Mars Capricorn 15˚"
    parsedSummary?: string;  // human-readable summary of what was parsed
    knowledge: KnowledgeChunk[];
}): LLMMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT_BASE },
        {
            role: 'user',
            content: `# Interpret Placement

Write a focused interpretation of: **${opts.placement}**
${opts.parsedSummary ? `_Parsed: ${opts.parsedSummary}_` : ''}

## Retrieved knowledge
${knowledgeBlock(opts.knowledge)}

## What to write
- A short paragraph capturing the core meaning, grounded in the sources above.
- A second paragraph on shadow/challenge or expression at its best.
- One concrete question this placement asks of the native.`,
        },
    ];
}
