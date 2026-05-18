import { describe, it, expect } from 'vitest';
import { parsePlacement } from '../knowledge/parse';
import { formatChunks, NullKnowledgeBackend } from '../knowledge/backend';

describe('parsePlacement', () => {
    it('parses planet + sign by name', () => {
        const r = parsePlacement('Mars Capricorn 15˚');
        expect(r.planet).toBe('mars');
        expect(r.sign).toBe('capricorn');
        expect(r.matched).toContain('mars');
        expect(r.matched).toContain('capricorn');
    });

    it('parses planet + sign by glyph', () => {
        const r = parsePlacement('♂ ♑ — exalted');
        expect(r.planet).toBe('mars');
        expect(r.sign).toBe('capricorn');
    });

    it('parses aspect by name and glyph', () => {
        const r1 = parsePlacement('Venus conjunct Pluto');
        expect(r1.aspect).toBe('conjunction');
        const r2 = parsePlacement('Sun ☍ Moon');
        expect(r2.aspect).toBe('opposition');
    });

    it('parses house numbers when "house" is explicit', () => {
        const r1 = parsePlacement('Mars in the 8th house');
        expect(r1.house).toBe(8);
        const r2 = parsePlacement('house 12');
        expect(r2.house).toBe(12);
    });

    it('does NOT mistake a degree number for a house', () => {
        const r = parsePlacement('Mars at 15˚ Capricorn');
        expect(r.house).toBeUndefined();
    });

    it('falls back to free-text query when nothing structural matches', () => {
        const r = parsePlacement('saturn return at 29');
        // Saturn matches planet — but the rest stays as a query
        expect(r.planet).toBe('saturn');
        expect(r.query.length).toBeGreaterThan(0);
    });

    it('handles totally unstructured text', () => {
        const r = parsePlacement('what does my third quarter mean');
        expect(r.matched).toEqual([]);
        expect(r.query).toBe('what does my third quarter mean');
    });

    it('handles empty input', () => {
        const r = parsePlacement('');
        expect(r.query).toBe('');
        expect(r.matched).toEqual([]);
    });
});

describe('formatChunks', () => {
    it('returns a friendly message when no results', () => {
        expect(formatChunks([], 'venus')).toBe('No knowledge results for "venus".');
    });

    it('renders multiple chunks with metadata header', () => {
        const out = formatChunks([
            {
                text: 'Venus in Gemini blends grace with curiosity.',
                author: 'Forrest',
                sourceTitle: 'The Inner Sky',
                layer: 'psychological',
                trustTier: 1,
            },
            {
                text: 'Venus in Gemini is fluent in many languages of love.',
                author: 'Brennan',
                sourceTitle: 'Hellenistic Astrology',
                layer: 'technical',
                trustTier: 1,
            },
        ], 'Venus Gemini');
        expect(out).toContain('# Knowledge search: "Venus Gemini"');
        expect(out).toContain('*Forrest*');
        expect(out).toContain('_The Inner Sky_');
        expect(out).toContain('psychological');
        expect(out).toContain('tier 1');
        expect(out).toContain('Venus in Gemini blends grace');
    });

    it('truncates long chunks with an ellipsis', () => {
        const longText = 'x'.repeat(2000);
        const out = formatChunks([{ text: longText }], 'q');
        expect(out).toContain('…');
        expect(out.length).toBeLessThan(2000);
    });
});

describe('NullKnowledgeBackend', () => {
    it('reports not configured', () => {
        const b = new NullKnowledgeBackend();
        expect(b.isConfigured()).toBe(false);
    });
    it('returns empty results', async () => {
        const b = new NullKnowledgeBackend();
        expect(await b.search()).toEqual([]);
        const stats = await b.stats();
        expect(stats.interpretationCount).toBe(0);
        expect(stats.backend).toBe('off');
    });
});
