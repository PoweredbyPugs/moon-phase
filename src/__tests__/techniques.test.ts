import { describe, it, expect } from 'vitest';
import {
    calculateKi, calculateKiAll, calculateKiYear, calculatePersonalCycle,
    formatKiReport, kiTrigram,
} from '../techniques/ki';
import {
    allHexagramBindings, castHexagram, castLine, dayHexagram, formatCast, getHexagram,
    hexagramLineQuery, hexagramNumberFromBits, manualHexagram, renderHexagram,
} from '../techniques/hexagram';

/* ── Ki ── */

describe('Ki: calculateKiYear', () => {
    it('handles the Lichun (Feb 4) boundary', () => {
        // Feb 3 belongs to PREVIOUS Ki year
        expect(calculateKiYear(1986, 2, 3)).toBe(calculateKiYear(1985, 6, 1));
        // Feb 4 starts the new Ki year
        expect(calculateKiYear(1986, 2, 4)).toBe(calculateKiYear(1986, 6, 1));
    });
    it('matches known year-Ki values', () => {
        // 1986 → year Ki 5 (per Stella's YEAR_TABLE)
        expect(calculateKiYear(1986, 5, 1)).toBe(5);
        // 2026 → year Ki 1 (per Stella's YEAR_TABLE)
        expect(calculateKiYear(2026, 6, 1)).toBe(1);
    });
    it('extrapolates outside table', () => {
        // Cycle is 9 years; 2026 = 1, so 2035 should also be 1
        expect(calculateKiYear(2035, 6, 1)).toBe(1);
    });
});

describe('Ki: calculateKi canonical fixture', () => {
    it('1986-05-01 → 5.9.1 (Stella reference)', () => {
        const result = calculateKi(new Date(1986, 4, 1));  // May 1, 1986
        expect(result.sequence).toBe('5.9.1');
        expect(result.yearKi).toBe(5);
        expect(result.monthKi).toBe(9);
        expect(result.thirdKi).toBe(1);
    });
    it('attaches trigram info', () => {
        const result = calculateKi(new Date(1986, 4, 1));
        expect(result.year.name).toBe('Center');
        expect(result.year.trigram).toBe('☯');
        expect(result.month.name).toBe('Fire');
        expect(result.third.name).toBe('Water');
    });
});

describe('Ki: calculateKiAll edge cases', () => {
    it('handles the Dec→Jan month-range wraparound', () => {
        // Dec 31 and Jan 3 both fall in the Dec 7 – Jan 4 range
        const [, m1] = calculateKiAll(2025, 12, 31);
        const [, m2] = calculateKiAll(2026, 1, 3);
        expect(typeof m1).toBe('number');
        expect(typeof m2).toBe('number');
    });
});

describe('Ki: calculatePersonalCycle', () => {
    it('produces values 1-9 for both personal year and month', () => {
        const cycle = calculatePersonalCycle(5, new Date(2026, 5, 17));
        expect(cycle.personalYear).toBeGreaterThanOrEqual(1);
        expect(cycle.personalYear).toBeLessThanOrEqual(9);
        expect(cycle.personalMonth).toBeGreaterThanOrEqual(1);
        expect(cycle.personalMonth).toBeLessThanOrEqual(9);
    });
});

describe('Ki: kiTrigram + formatKiReport', () => {
    it('returns a trigram for each Ki number 1-9', () => {
        for (let n = 1; n <= 9; n++) {
            const t = kiTrigram(n);
            expect(t.number).toBe(n);
            expect(t.trigram).toMatch(/[☰☱☲☳☴☵☶☷☯]/);
        }
    });
    it('formats a multi-line report', () => {
        const ki = calculateKi(new Date(1986, 4, 1));
        const report = formatKiReport(ki);
        expect(report).toContain('# 9 Star Ki for 1986-05-01');
        expect(report).toContain('5.9.1');
        expect(report).toContain('Center');
    });
});

/* ── Hexagram ── */

describe('Hexagram: King Wen lookup integrity', () => {
    it('returns all 64 hexagrams by number', () => {
        for (let n = 1; n <= 64; n++) {
            const h = getHexagram(n);
            expect(h.number).toBe(n);
            expect(h.name.length).toBeGreaterThan(0);
            expect(h.judgment.length).toBeGreaterThan(0);
        }
    });

    it('every binary pattern maps to a unique hexagram (no collisions)', () => {
        const bindings = allHexagramBindings();
        expect(bindings.length).toBe(64);                          // 64 patterns
        const nums = new Set(bindings.map(b => b.number));
        expect(nums.size).toBe(64);                                // each unique
        // and every pattern is a valid 6-bit binary
        for (const b of bindings) expect(b.bits).toMatch(/^[01]{6}$/);
    });

    it('hexagramNumberFromBits round-trips known fixtures', () => {
        expect(hexagramNumberFromBits('111111')).toBe(1);   // Heaven/Heaven
        expect(hexagramNumberFromBits('000000')).toBe(2);   // Earth/Earth
        expect(hexagramNumberFromBits('111000')).toBe(11);  // Peace: Earth above, Heaven below
        expect(hexagramNumberFromBits('000111')).toBe(12);  // Standstill: Heaven above, Earth below
    });
});

describe('Hexagram: castLine', () => {
    it('returns one of 6,7,8,9 with correct yin/changing flags', () => {
        const result = castLine(() => 0.5);
        expect([6, 7, 8, 9]).toContain(result.value);
        if (result.value === 6 || result.value === 8) expect(result.yin).toBe(true);
        if (result.value === 7 || result.value === 9) expect(result.yin).toBe(false);
        if (result.value === 6 || result.value === 9) expect(result.changing).toBe(true);
        if (result.value === 7 || result.value === 8) expect(result.changing).toBe(false);
    });

    it('produces 6 with rng < 0.5 always (all tails → 2+2+2 = 6, changing yin)', () => {
        const result = castLine(() => 0.1);
        expect(result.value).toBe(6);
        expect(result.yin).toBe(true);
        expect(result.changing).toBe(true);
    });

    it('produces 9 with rng >= 0.5 always (all heads → 3+3+3 = 9, changing yang)', () => {
        const result = castLine(() => 0.9);
        expect(result.value).toBe(9);
        expect(result.yin).toBe(false);
        expect(result.changing).toBe(true);
    });
});

describe('Hexagram: castHexagram', () => {
    it('all-yin (rng 0.1) → Hexagram 2 (Earth) with relating Hexagram 1 (Heaven)', () => {
        const cast = castHexagram(() => 0.1);   // all 6s → all changing yin
        expect(cast.primary.number).toBe(2);
        expect(cast.primary.name).toBe('The Receptive');
        expect(cast.changingLines).toEqual([1, 2, 3, 4, 5, 6]);
        expect(cast.relating?.number).toBe(1);
        expect(cast.relating?.name).toBe('The Creative');
    });

    it('all-yang (rng 0.9) → Hexagram 1 (Heaven) with relating Hexagram 2 (Earth)', () => {
        const cast = castHexagram(() => 0.9);   // all 9s → all changing yang
        expect(cast.primary.number).toBe(1);
        expect(cast.relating?.number).toBe(2);
    });

    it('no changing lines → relating is null', () => {
        // Force stable yang (sum = 7): coin returns mix of 2s and 3s. Use a script:
        // 7 = either (2+2+3) or (2+3+2) or (3+2+2). We need *not all heads* and *not all tails*.
        let calls = 0;
        const rng = () => {
            calls++;
            // 18 coin tosses (6 lines x 3): alternate heads/tails so each line sums to 7 or 8
            return calls % 2 === 1 ? 0.9 : 0.1;
        };
        const cast = castHexagram(rng);
        expect(cast.changingLines).toEqual([]);
        expect(cast.relating).toBeNull();
    });
});

describe('Hexagram: renderHexagram + formatCast', () => {
    it('renders 6 lines top-to-bottom', () => {
        const cast = castHexagram(() => 0.9);
        const render = renderHexagram(cast.lines);
        expect(render.split('\n')).toHaveLength(6);
    });

    it('formatCast includes primary, judgment, changing-into section', () => {
        const cast = castHexagram(() => 0.1);
        const text = formatCast(cast);
        expect(text).toContain('Hexagram 2');
        expect(text).toContain('The Receptive');
        expect(text).toContain('Changing into 1');
        expect(text).toContain('The Creative');
    });
});

/* ── Day hexagram + manual hexagram + line query ── */

describe('manualHexagram', () => {
    it('returns the requested hexagram with no changing lines by default', () => {
        const h = manualHexagram(11);
        expect(h.primary.number).toBe(11);
        expect(h.primary.name).toBe('Peace');
        expect(h.changingLines).toEqual([]);
        expect(h.relating).toBeNull();
    });

    it('honors changing-line input and computes the relating hexagram', () => {
        const h = manualHexagram(1, [1]);   // Heaven with line 1 changing → Wind below Heaven = 44
        expect(h.primary.number).toBe(1);
        expect(h.changingLines).toEqual([1]);
        expect(h.relating?.number).toBe(44);
    });

    it('filters out-of-range line numbers', () => {
        const h = manualHexagram(2, [0, 7, 3]);
        expect(h.changingLines).toEqual([3]);
    });

    it('throws for invalid hexagram numbers', () => {
        expect(() => manualHexagram(0)).toThrow();
        expect(() => manualHexagram(65)).toThrow();
    });
});

describe('dayHexagram', () => {
    it('is deterministic for the same date+hour (plum-blossom)', () => {
        const d = new Date(2026, 4, 17, 22, 0);   // 2026-05-17 22:00
        const a = dayHexagram(d, 'plum-blossom');
        const b = dayHexagram(d, 'plum-blossom');
        expect(a.primary.number).toBe(b.primary.number);
        expect(a.changingLines).toEqual(b.changingLines);
    });

    it('plum-blossom yields exactly one changing line', () => {
        const d = new Date(2026, 4, 17, 22, 0);
        const h = dayHexagram(d, 'plum-blossom');
        expect(h.changingLines).toHaveLength(1);
        expect(h.relating).not.toBeNull();
    });

    it('ymd-hash yields no changing lines (stable across the day)', () => {
        const morning = new Date(2026, 4, 17, 6, 0);
        const night = new Date(2026, 4, 17, 23, 0);
        const a = dayHexagram(morning, 'ymd-hash');
        const b = dayHexagram(night, 'ymd-hash');
        expect(a.primary.number).toBe(b.primary.number);
        expect(a.changingLines).toEqual([]);
        expect(b.changingLines).toEqual([]);
    });

    it('returns a valid hexagram (1..64) for arbitrary dates', () => {
        for (const date of [
            new Date(1970, 0, 1, 0, 0),
            new Date(1986, 4, 1, 14, 35),
            new Date(2030, 11, 31, 23, 59),
        ]) {
            const h = dayHexagram(date);
            expect(h.primary.number).toBeGreaterThanOrEqual(1);
            expect(h.primary.number).toBeLessThanOrEqual(64);
        }
    });
});

describe('hexagramLineQuery', () => {
    it('builds a hexagram-only query when no line specified', () => {
        const q = hexagramLineQuery(17, 'Following');
        expect(q).toContain('Hexagram 17');
        expect(q).toContain('Following');
        expect(q).not.toContain('Line-');
    });
    it('adds a line-N clause when a line is specified', () => {
        const q = hexagramLineQuery(17, 'Following', 3);
        expect(q).toContain('Hexagram 17');
        expect(q).toContain('Line-3');
        expect(q).toContain('Line 3');
    });
});
