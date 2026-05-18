import { describe, it, expect } from 'vitest';
import {
    chartReadingMessages, discoverPatternsMessages, interpretPlacementMessages,
} from '../synthesis/prompts';
import { NullLLMProvider } from '../synthesis/provider';

describe('chartReadingMessages', () => {
    it('builds a system + user pair', () => {
        const msgs = chartReadingMessages({
            chartName: 'chris',
            chart: { planets: [{ name: 'Sun', sign: 'Taurus' }] },
            knowledge: [],
        });
        expect(msgs).toHaveLength(2);
        expect(msgs[0].role).toBe('system');
        expect(msgs[1].role).toBe('user');
        expect(msgs[1].content).toContain('chris');
        expect(msgs[1].content).toContain('Taurus');
    });

    it('embeds retrieved knowledge sources', () => {
        const msgs = chartReadingMessages({
            chartName: 'chris',
            chart: {},
            knowledge: [
                { text: 'Sun in Taurus loves slow growth.', author: 'Forrest' },
                { text: 'Taurus is fixed earth.', sourceTitle: 'Tradition' },
            ],
        });
        const userContent = msgs[1].content;
        expect(userContent).toContain('Source 1');
        expect(userContent).toContain('Forrest');
        expect(userContent).toContain('Source 2');
        expect(userContent).toContain('Tradition');
    });

    it('falls back gracefully when knowledge is empty', () => {
        const msgs = chartReadingMessages({ chartName: 'x', chart: {}, knowledge: [] });
        expect(msgs[1].content).toContain('No retrieved knowledge');
    });
});

describe('discoverPatternsMessages', () => {
    it('includes transit data when provided', () => {
        const msgs = discoverPatternsMessages({
            chartName: 'chris',
            chart: { planets: [] },
            transits: { transits: [{ aspect: 'square' }] },
            knowledge: [],
        });
        expect(msgs[1].content).toContain('Current transits');
        expect(msgs[1].content).toContain('square');
    });

    it('omits transit section when no transits passed', () => {
        const msgs = discoverPatternsMessages({
            chartName: 'x', chart: {}, knowledge: [],
        });
        expect(msgs[1].content).not.toContain('## Current transits');
    });
});

describe('interpretPlacementMessages', () => {
    it('shows parsed summary when given', () => {
        const msgs = interpretPlacementMessages({
            placement: 'Mars Capricorn 15˚',
            parsedSummary: 'mars, capricorn',
            knowledge: [],
        });
        expect(msgs[1].content).toContain('Parsed: mars, capricorn');
    });
});

describe('NullLLMProvider', () => {
    it('reports not configured', () => {
        const p = new NullLLMProvider();
        expect(p.isConfigured()).toBe(false);
    });
    it('returns a stub message instead of throwing', async () => {
        const p = new NullLLMProvider();
        const result = await p.complete({ model: 'x', messages: [] });
        expect(result).toContain('LLM not configured');
    });
});
