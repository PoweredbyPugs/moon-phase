/* Parse free-text astrological placements into KnowledgeSearchOptions.
 *
 * Recognizes:
 *   - Planet names ("Sun", "Mars", "Pluto") and glyphs (☉ ☽ ☿ ♀ ♂ ♃ ♄ ♅ ♆ ♇)
 *   - Sign names ("Aries" through "Pisces") and glyphs
 *   - House numbers ("3rd house", "house 11", "H7")
 *   - Aspect names ("conjunction", "square", "trine"...) and glyphs (☌ ☍ △ □ ⚹)
 *
 * Returns a KnowledgeSearchOptions struct with whatever it managed to pull
 * out, plus a `query` string of the unparsed remainder. */

import { KnowledgeSearchOptions } from './backend';

const PLANET_NAMES = ['sun','moon','mercury','venus','mars','jupiter','saturn','uranus','neptune','pluto'];
const PLANET_GLYPHS_TO_NAME: Record<string, string> = {
    '☉': 'sun', '☽': 'moon', '☿': 'mercury', '♀': 'venus', '♂': 'mars',
    '♃': 'jupiter', '♄': 'saturn', '♅': 'uranus', '♆': 'neptune', '♇': 'pluto',
};

const SIGN_NAMES = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
const SIGN_GLYPHS_TO_NAME: Record<string, string> = {
    '♈': 'aries', '♉': 'taurus', '♊': 'gemini', '♋': 'cancer',
    '♌': 'leo', '♍': 'virgo', '♎': 'libra', '♏': 'scorpio',
    '♐': 'sagittarius', '♑': 'capricorn', '♒': 'aquarius', '♓': 'pisces',
};

/* Aspect names + their common verb/short forms. The pattern is regex-friendly
 * (the leading form is what's actually returned; alternations are accepted
 * inputs that get normalized to it). */
const ASPECT_ALIASES: Array<{ canonical: string; pattern: RegExp }> = [
    { canonical: 'conjunction',     pattern: /\b(conjunction|conjunct)\b/i },
    { canonical: 'opposition',      pattern: /\b(opposition|opposed|oppose)\b/i },
    { canonical: 'trine',           pattern: /\b(trines?|trined)\b/i },
    { canonical: 'square',          pattern: /\b(squares?|squared)\b/i },
    { canonical: 'sextile',         pattern: /\b(sextiles?|sextiled)\b/i },
    { canonical: 'quincunx',        pattern: /\b(quincunx|inconjunct)\b/i },
    { canonical: 'semisextile',     pattern: /\b(semi[-\s]?sextile)\b/i },
    { canonical: 'semisquare',      pattern: /\b(semi[-\s]?square)\b/i },
    { canonical: 'sesquiquadrate',  pattern: /\b(sesquiquadrate|sesquisquare)\b/i },
    { canonical: 'quintile',        pattern: /\b(quintiles?)\b/i },
];
const ASPECT_GLYPHS_TO_NAME: Record<string, string> = {
    '☌': 'conjunction', '☍': 'opposition', '△': 'trine', '□': 'square', '⚹': 'sextile',
    '⚻': 'quincunx', '⚺': 'semisextile', '⚼': 'semisquare', '⚿': 'sesquiquadrate',
};

export interface ParsedPlacement extends KnowledgeSearchOptions {
    matched: string[];   // tokens we identified
    remainder: string;   // text the parser didn't consume
}

export function parsePlacement(text: string): ParsedPlacement {
    if (!text) return { query: '', matched: [], remainder: '' };

    const original = text;
    const lower = text.toLowerCase();
    const out: ParsedPlacement = { query: '', matched: [], remainder: '' };
    let consumed = lower;

    // 1) Planet by glyph
    for (const [glyph, name] of Object.entries(PLANET_GLYPHS_TO_NAME)) {
        if (original.includes(glyph)) {
            out.planet = name;
            out.matched.push(name);
            consumed = consumed.replace(glyph, ' ');
            break;
        }
    }
    // 2) Planet by name
    if (!out.planet) {
        for (const name of PLANET_NAMES) {
            const re = new RegExp(`\\b${name}\\b`, 'i');
            if (re.test(consumed)) {
                out.planet = name;
                out.matched.push(name);
                consumed = consumed.replace(re, ' ');
                break;
            }
        }
    }

    // 3) Sign by glyph or name
    for (const [glyph, name] of Object.entries(SIGN_GLYPHS_TO_NAME)) {
        if (original.includes(glyph)) {
            out.sign = name;
            out.matched.push(name);
            consumed = consumed.replace(glyph, ' ');
            break;
        }
    }
    if (!out.sign) {
        for (const name of SIGN_NAMES) {
            const re = new RegExp(`\\b${name}\\b`, 'i');
            if (re.test(consumed)) {
                out.sign = name;
                out.matched.push(name);
                consumed = consumed.replace(re, ' ');
                break;
            }
        }
    }

    // 4) Aspect by glyph or name
    for (const [glyph, name] of Object.entries(ASPECT_GLYPHS_TO_NAME)) {
        if (original.includes(glyph)) {
            out.aspect = name;
            out.matched.push(name);
            consumed = consumed.replace(glyph, ' ');
            break;
        }
    }
    if (!out.aspect) {
        for (const alias of ASPECT_ALIASES) {
            if (alias.pattern.test(consumed)) {
                out.aspect = alias.canonical;
                out.matched.push(alias.canonical);
                consumed = consumed.replace(alias.pattern, ' ');
                break;
            }
        }
    }

    // 5) House: "3rd house", "house 11", "H7", "11th"
    const houseMatch = consumed.match(/\b(?:h\s*|house\s+)?(\d{1,2})(?:st|nd|rd|th)?\s*(?:house)?\b/i);
    if (houseMatch) {
        const n = parseInt(houseMatch[1], 10);
        if (n >= 1 && n <= 12) {
            // Avoid swallowing degree numbers — only accept if the context contains "house" or H
            if (/house|\bh\d/i.test(consumed)) {
                out.house = n;
                out.matched.push(`house ${n}`);
                consumed = consumed.replace(houseMatch[0], ' ');
            }
        }
    }

    out.remainder = consumed.replace(/\s+/g, ' ').trim();
    // If parser found nothing structural, use the whole input as a free-text query
    out.query = out.matched.length === 0
        ? original.trim()
        : (out.remainder || out.matched.join(' '));
    return out;
}
