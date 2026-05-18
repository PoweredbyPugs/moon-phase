/* I Ching cast — three-coin method, canonical King Wen hexagram data.
 *
 * Each coin: heads = 3, tails = 2. Sum of three coins → line value:
 *   6 = old yin (changing)
 *   7 = young yang (stable)
 *   8 = young yin (stable)
 *   9 = old yang (changing)
 *
 * Lines are read bottom → top. If any old lines (6 or 9) appear, they
 * change to their opposite to produce a relating hexagram. */

export interface HexagramLine {
    value: 6 | 7 | 8 | 9;
    yin: boolean;       // resolved yin/yang
    changing: boolean;  // 6 or 9
}

export interface HexagramInfo {
    number: number;
    name: string;            // Wilhelm / Baynes English
    chinese: string;         // pinyin
    upper: string;           // upper trigram name
    lower: string;           // lower trigram name
    judgment: string;        // single-line summary of the Judgment
}

export interface HexagramCast {
    lines: HexagramLine[];               // index 0 = line 1 (bottom)
    primary: HexagramInfo;
    relating: HexagramInfo | null;       // null if no changing lines
    changingLines: number[];             // 1-indexed positions, bottom-up
}

/* King Wen sequence — canonical names + one-line judgment summaries
 * lifted from public-domain Wilhelm/Baynes phrasings (and tightened). */
const HEXAGRAMS: Record<number, Omit<HexagramInfo, 'number'>> = {
    1: { name: 'The Creative', chinese: 'Qian', upper: 'Heaven', lower: 'Heaven', judgment: 'Sublime success through perseverance.' },
    2: { name: 'The Receptive', chinese: 'Kun', upper: 'Earth', lower: 'Earth', judgment: 'Sublime success; receptive devotion brings reward.' },
    3: { name: 'Difficulty at the Beginning', chinese: 'Zhun', upper: 'Water', lower: 'Thunder', judgment: 'It furthers one to appoint helpers; do not act alone.' },
    4: { name: 'Youthful Folly', chinese: 'Meng', upper: 'Mountain', lower: 'Water', judgment: 'The youth must seek the master; the master does not chase.' },
    5: { name: 'Waiting', chinese: 'Xu', upper: 'Water', lower: 'Heaven', judgment: 'Wait sincerely; crossing the great water furthers.' },
    6: { name: 'Conflict', chinese: 'Song', upper: 'Heaven', lower: 'Water', judgment: 'Halfway brings good fortune; carrying it through, misfortune.' },
    7: { name: 'The Army', chinese: 'Shi', upper: 'Earth', lower: 'Water', judgment: 'The army needs a strong leader; perseverance brings reward.' },
    8: { name: 'Holding Together', chinese: 'Bi', upper: 'Water', lower: 'Earth', judgment: 'Union sought now brings good fortune; latecomers, misfortune.' },
    9: { name: 'Small Taming Power', chinese: 'Xiao Chu', upper: 'Wind', lower: 'Heaven', judgment: 'Dense clouds, no rain; the small holds back the great.' },
    10: { name: 'Treading', chinese: 'Lu', upper: 'Heaven', lower: 'Lake', judgment: 'Treading on the tiger\'s tail; it does not bite.' },
    11: { name: 'Peace', chinese: 'Tai', upper: 'Earth', lower: 'Heaven', judgment: 'The small departs, the great approaches.' },
    12: { name: 'Standstill', chinese: 'Pi', upper: 'Heaven', lower: 'Earth', judgment: 'Evil people do not further the perseverance of the superior.' },
    13: { name: 'Fellowship with Others', chinese: 'Tong Ren', upper: 'Heaven', lower: 'Fire', judgment: 'Fellowship in the open; crossing the great water furthers.' },
    14: { name: 'Great Possession', chinese: 'Da You', upper: 'Fire', lower: 'Heaven', judgment: 'Supreme success; modesty preserves the great.' },
    15: { name: 'Modesty', chinese: 'Qian', upper: 'Earth', lower: 'Mountain', judgment: 'The superior person carries things through; success.' },
    16: { name: 'Enthusiasm', chinese: 'Yu', upper: 'Thunder', lower: 'Earth', judgment: 'It furthers to install helpers and to set armies marching.' },
    17: { name: 'Following', chinese: 'Sui', upper: 'Lake', lower: 'Thunder', judgment: 'Supreme success; perseverance brings reward.' },
    18: { name: 'Work on the Decayed', chinese: 'Gu', upper: 'Mountain', lower: 'Wind', judgment: 'Crossing the great water furthers; three days before, three days after.' },
    19: { name: 'Approach', chinese: 'Lin', upper: 'Earth', lower: 'Lake', judgment: 'Supreme success; in the eighth month, misfortune.' },
    20: { name: 'Contemplation', chinese: 'Guan', upper: 'Wind', lower: 'Earth', judgment: 'The ablution has been made; the offering not yet brought.' },
    21: { name: 'Biting Through', chinese: 'Shi He', upper: 'Fire', lower: 'Thunder', judgment: 'Success; it is favorable to let justice be administered.' },
    22: { name: 'Grace', chinese: 'Bi', upper: 'Mountain', lower: 'Fire', judgment: 'Small success in small matters.' },
    23: { name: 'Splitting Apart', chinese: 'Bo', upper: 'Mountain', lower: 'Earth', judgment: 'It does not further to go anywhere.' },
    24: { name: 'Return', chinese: 'Fu', upper: 'Earth', lower: 'Thunder', judgment: 'Friends come without blame; the way returns on the seventh day.' },
    25: { name: 'Innocence', chinese: 'Wu Wang', upper: 'Heaven', lower: 'Thunder', judgment: 'If the act is not right, misfortune; nowhere furthers.' },
    26: { name: 'Great Taming Power', chinese: 'Da Chu', upper: 'Mountain', lower: 'Heaven', judgment: 'Perseverance furthers; crossing the great water furthers.' },
    27: { name: 'Nourishment', chinese: 'Yi', upper: 'Mountain', lower: 'Thunder', judgment: 'Pay heed to what gives nourishment, and what one seeks to fill the mouth.' },
    28: { name: 'Preponderance of the Great', chinese: 'Da Guo', upper: 'Lake', lower: 'Wind', judgment: 'The ridgepole sags; success in undertakings.' },
    29: { name: 'The Abysmal', chinese: 'Kan', upper: 'Water', lower: 'Water', judgment: 'If sincere, success in the heart; actions bring esteem.' },
    30: { name: 'The Clinging', chinese: 'Li', upper: 'Fire', lower: 'Fire', judgment: 'Perseverance furthers; caring for the cow brings good fortune.' },
    31: { name: 'Influence', chinese: 'Xian', upper: 'Lake', lower: 'Mountain', judgment: 'Success; perseverance furthers. Taking a maiden brings good fortune.' },
    32: { name: 'Duration', chinese: 'Heng', upper: 'Thunder', lower: 'Wind', judgment: 'Success without blame; perseverance furthers a goal.' },
    33: { name: 'Retreat', chinese: 'Dun', upper: 'Heaven', lower: 'Mountain', judgment: 'Success in small matters; perseverance furthers.' },
    34: { name: 'The Power of the Great', chinese: 'Da Zhuang', upper: 'Thunder', lower: 'Heaven', judgment: 'Perseverance furthers.' },
    35: { name: 'Progress', chinese: 'Jin', upper: 'Fire', lower: 'Earth', judgment: 'The powerful prince receives horses in abundance.' },
    36: { name: 'Darkening of the Light', chinese: 'Ming Yi', upper: 'Earth', lower: 'Fire', judgment: 'In adversity, perseverance furthers.' },
    37: { name: 'The Family', chinese: 'Jia Ren', upper: 'Wind', lower: 'Fire', judgment: 'The perseverance of the woman furthers.' },
    38: { name: 'Opposition', chinese: 'Kui', upper: 'Fire', lower: 'Lake', judgment: 'In small matters, good fortune.' },
    39: { name: 'Obstruction', chinese: 'Jian', upper: 'Water', lower: 'Mountain', judgment: 'The southwest furthers; seeing the great person furthers.' },
    40: { name: 'Deliverance', chinese: 'Xie', upper: 'Thunder', lower: 'Water', judgment: 'The southwest furthers; if there is no place to go, return brings fortune.' },
    41: { name: 'Decrease', chinese: 'Sun', upper: 'Mountain', lower: 'Lake', judgment: 'If sincere, supreme good fortune without blame.' },
    42: { name: 'Increase', chinese: 'Yi', upper: 'Wind', lower: 'Thunder', judgment: 'It furthers to undertake something; crossing the great water furthers.' },
    43: { name: 'Breakthrough', chinese: 'Guai', upper: 'Lake', lower: 'Heaven', judgment: 'A resolute announcement at court; there is danger.' },
    44: { name: 'Coming to Meet', chinese: 'Gou', upper: 'Heaven', lower: 'Wind', judgment: 'The maiden is powerful; do not marry such a maiden.' },
    45: { name: 'Gathering Together', chinese: 'Cui', upper: 'Lake', lower: 'Earth', judgment: 'The king approaches his temple; seeing the great person furthers.' },
    46: { name: 'Pushing Upward', chinese: 'Sheng', upper: 'Earth', lower: 'Wind', judgment: 'Supreme success; departure toward the south brings fortune.' },
    47: { name: 'Oppression', chinese: 'Kun', upper: 'Lake', lower: 'Water', judgment: 'Success; for the great person, good fortune without blame.' },
    48: { name: 'The Well', chinese: 'Jing', upper: 'Water', lower: 'Wind', judgment: 'The town may change; the well does not change.' },
    49: { name: 'Revolution', chinese: 'Ge', upper: 'Lake', lower: 'Fire', judgment: 'On your own day, you are believed; supreme success; perseverance furthers.' },
    50: { name: 'The Caldron', chinese: 'Ding', upper: 'Fire', lower: 'Wind', judgment: 'Supreme good fortune; success.' },
    51: { name: 'The Arousing', chinese: 'Zhen', upper: 'Thunder', lower: 'Thunder', judgment: 'Shock terrifies for a hundred miles; the offerer does not drop the sacrificial spoon.' },
    52: { name: 'Keeping Still', chinese: 'Gen', upper: 'Mountain', lower: 'Mountain', judgment: 'Keeping the back still; not perceiving the body.' },
    53: { name: 'Development', chinese: 'Jian', upper: 'Wind', lower: 'Mountain', judgment: 'The maiden is given in marriage; good fortune; perseverance furthers.' },
    54: { name: 'The Marrying Maiden', chinese: 'Gui Mei', upper: 'Thunder', lower: 'Lake', judgment: 'Undertakings bring misfortune; nothing that would further.' },
    55: { name: 'Abundance', chinese: 'Feng', upper: 'Thunder', lower: 'Fire', judgment: 'The king attains abundance; be not sad. Be like the sun at midday.' },
    56: { name: 'The Wanderer', chinese: 'Lu', upper: 'Fire', lower: 'Mountain', judgment: 'Success in small things; perseverance brings fortune to the wanderer.' },
    57: { name: 'The Gentle', chinese: 'Xun', upper: 'Wind', lower: 'Wind', judgment: 'Success through what is small; seeing the great person furthers.' },
    58: { name: 'The Joyous', chinese: 'Dui', upper: 'Lake', lower: 'Lake', judgment: 'Success; perseverance is favorable.' },
    59: { name: 'Dispersion', chinese: 'Huan', upper: 'Wind', lower: 'Water', judgment: 'The king approaches his temple; crossing the great water furthers.' },
    60: { name: 'Limitation', chinese: 'Jie', upper: 'Water', lower: 'Lake', judgment: 'Galling limitation must not be persevered in.' },
    61: { name: 'Inner Truth', chinese: 'Zhong Fu', upper: 'Wind', lower: 'Lake', judgment: 'Pigs and fishes; crossing the great water furthers.' },
    62: { name: 'Preponderance of the Small', chinese: 'Xiao Guo', upper: 'Thunder', lower: 'Mountain', judgment: 'Small things may be done; great things should not be done.' },
    63: { name: 'After Completion', chinese: 'Ji Ji', upper: 'Water', lower: 'Fire', judgment: 'Success in small matters; perseverance furthers; in the beginning, fortune; at the end, disorder.' },
    64: { name: 'Before Completion', chinese: 'Wei Ji', upper: 'Fire', lower: 'Water', judgment: 'Success; the little fox is almost across when his tail gets wet.' },
};

/* Trigram → 3-char binary string (bottom-up: line1 + line2 + line3, '1' = yang, '0' = yin). */
const TRIGRAM_BITS: Record<string, string> = {
    Heaven:   '111',  Earth:    '000',
    Lake:     '110',  Mountain: '001',
    Fire:     '101',  Water:    '010',
    Thunder:  '100',  Wind:     '011',
};

/* King Wen lookup is derived from each hexagram's declared upper/lower trigrams
 * (lower = lines 1-3, upper = lines 4-6). Single source of truth: HEXAGRAMS. */
const KING_WEN: Record<string, number> = {};
for (const [numStr, h] of Object.entries(HEXAGRAMS)) {
    const lower = TRIGRAM_BITS[h.lower];
    const upper = TRIGRAM_BITS[h.upper];
    if (!lower || !upper) throw new Error(`Unknown trigram for hex ${numStr}`);
    KING_WEN[lower + upper] = Number(numStr);
}

export function getHexagram(num: number): HexagramInfo {
    const h = HEXAGRAMS[num];
    if (!h) throw new Error(`Unknown hexagram ${num}`);
    return { number: num, ...h };
}

/* Cast a single line via three-coin toss. rng() should return [0,1). */
export function castLine(rng: () => number = Math.random): HexagramLine {
    const coin = () => (rng() < 0.5 ? 2 : 3);
    const sum = coin() + coin() + coin();   // 6..9
    return {
        value: sum as 6 | 7 | 8 | 9,
        yin: sum === 6 || sum === 8,
        changing: sum === 6 || sum === 9,
    };
}

/* Build a primary hexagram number from six lines (bottom-up). */
function hexagramNumberFromLines(lines: HexagramLine[], useChangedLines = false): number {
    const bits = lines.map(l => {
        const yin = useChangedLines && l.changing ? !l.yin : l.yin;
        return yin ? '0' : '1';
    }).join('');
    return hexagramNumberFromBits(bits);
}

/* Exposed for testing: 6-char bottom-up binary string → King Wen number. */
export function hexagramNumberFromBits(bits: string): number {
    const num = KING_WEN[bits];
    if (!num) throw new Error(`No hexagram for binary ${bits}`);
    return num;
}

/* Exposed for testing: every binary pattern → its hexagram number. */
export function allHexagramBindings(): Array<{ bits: string; number: number }> {
    return Object.entries(KING_WEN).map(([bits, number]) => ({ bits, number }));
}

export function castHexagram(rng: () => number = Math.random): HexagramCast {
    const lines = Array.from({ length: 6 }, () => castLine(rng));
    const primaryNum = hexagramNumberFromLines(lines, false);
    const changingLines = lines.map((l, i) => l.changing ? i + 1 : 0).filter(n => n > 0);
    const relating = changingLines.length > 0
        ? getHexagram(hexagramNumberFromLines(lines, true))
        : null;
    return { lines, primary: getHexagram(primaryNum), relating, changingLines };
}

const LINE_GLYPHS = {
    yangStable: '━━━━━━━',
    yinStable:  '━━   ━━',
    yangChange: '━━━○━━━',
    yinChange:  '━━ x ━━',
};

export function renderHexagram(lines: HexagramLine[]): string {
    // Top line first (read top → bottom), with changing markers
    return [...lines].reverse().map(l => {
        if (l.value === 9) return LINE_GLYPHS.yangChange;
        if (l.value === 6) return LINE_GLYPHS.yinChange;
        if (l.value === 7) return LINE_GLYPHS.yangStable;
        return LINE_GLYPHS.yinStable;
    }).join('\n');
}

/* ── Day-hexagram derivation ──────────────────────────────────────────── *
 * Plum Blossom (梅花易数) variant adapted for the Gregorian calendar.
 *
 *   Upper trigram = ((year + month + day) mod 8) + 1
 *   Lower trigram = ((year + month + day + hour) mod 8) + 1
 *   Changing line = ((year + month + day + hour) mod 6) + 1
 *
 * The +1 avoids zero (trigram numbering 1..8 = Heaven, Lake, Fire, Thunder,
 * Wind, Water, Mountain, Earth — King Wen / Bagua order). One changing line
 * is always implied by the time, which matches Plum Blossom's tradition that
 * every reading has motion.
 *
 * `ymd-hash` is the same idea but without an hour input, using a deterministic
 * mix of year/month/day for a "daily hexagram" that's stable across the day
 * and changing-line free. */

export type DayMethod = 'plum-blossom' | 'ymd-hash';

/* Plum Blossom uses the bagua numbering 1..8 in this order: */
const BAGUA_ORDER = ['Heaven', 'Lake', 'Fire', 'Thunder', 'Wind', 'Water', 'Mountain', 'Earth'] as const;

function trigramByBagua(num: number): string {
    return BAGUA_ORDER[((num - 1) % 8 + 8) % 8];
}

function castFromTrigrams(upper: string, lower: string, changingLines: number[]): HexagramCast {
    // Build the 6-line array, bottom-up: lower trigram (lines 1-3) + upper (4-6)
    const trigramBits: Record<string, string> = {
        Heaven: '111', Lake: '110', Fire: '101', Thunder: '100',
        Wind: '011', Water: '010', Mountain: '001', Earth: '000',
    };
    const lower3 = trigramBits[lower].split('');
    const upper3 = trigramBits[upper].split('');
    const allBits = [...lower3, ...upper3];   // bottom-up

    const lines: HexagramLine[] = allBits.map((bit, idx) => {
        const lineNum = idx + 1;   // 1-indexed bottom-up
        const yin = bit === '0';
        const changing = changingLines.includes(lineNum);
        let value: 6 | 7 | 8 | 9;
        if (yin && changing) value = 6;
        else if (yin) value = 8;
        else if (changing) value = 9;
        else value = 7;
        return { value, yin, changing };
    });

    const primaryNum = hexagramNumberFromBits(allBits.map(b => b).join(''));
    const primary = getHexagram(primaryNum);
    const relating = changingLines.length > 0
        ? getHexagram(hexagramNumberFromBits(
            lines.map(l => (l.changing ? (l.yin ? '1' : '0') : (l.yin ? '0' : '1'))).join(''),
        ))
        : null;

    return { lines, primary, relating, changingLines: [...changingLines].sort((a, b) => a - b) };
}

export function dayHexagram(d: Date, method: DayMethod = 'plum-blossom'): HexagramCast {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const hour = d.getHours();

    if (method === 'ymd-hash') {
        const seed = y * 372 + m * 31 + day;
        const upperNum = ((seed) % 8) + 1;
        const lowerNum = ((seed * 7 + 3) % 8) + 1;
        return castFromTrigrams(trigramByBagua(upperNum), trigramByBagua(lowerNum), []);
    }

    // Plum Blossom
    const upperNum = ((y + m + day) % 8) + 1;
    const lowerNum = ((y + m + day + hour) % 8) + 1;
    const changingLine = ((y + m + day + hour) % 6) + 1;   // 1..6
    return castFromTrigrams(trigramByBagua(upperNum), trigramByBagua(lowerNum), [changingLine]);
}

/* Manual: build a cast from a known hexagram number + optional changing lines. */
export function manualHexagram(num: number, changingLines: number[] = []): HexagramCast {
    if (num < 1 || num > 64) throw new Error(`Hexagram number must be 1..64 (got ${num})`);
    // Reverse-lookup binary from the registry
    const entry = Object.entries(HEXAGRAMS).find(([k]) => Number(k) === num);
    if (!entry) throw new Error(`Hexagram ${num} not defined`);
    const info = entry[1];
    return castFromTrigrams(info.upper, info.lower, changingLines.filter(n => n >= 1 && n <= 6));
}

/* Builds the fulltext query string for line-N drill-down lookups against
 * Neo4j's interpretation_text index. Public so the modal can preview it. */
export function hexagramLineQuery(hexagramNumber: number, hexagramName: string, line?: number): string {
    const base = `"Hexagram ${hexagramNumber}" OR "${hexagramName}"`;
    if (!Number.isFinite(line)) return base;
    return `(${base}) AND ("Line-${line}" OR "Line ${line}")`;
}

export function formatCast(cast: HexagramCast): string {
    const lines = [
        `# Hexagram ${cast.primary.number}: ${cast.primary.name} (${cast.primary.chinese})`,
        `*${cast.primary.upper} above, ${cast.primary.lower} below*`,
        '',
        '```',
        renderHexagram(cast.lines),
        '```',
        '',
        `**Judgment:** ${cast.primary.judgment}`,
    ];
    if (cast.relating) {
        lines.push(
            '',
            `## Changing into ${cast.relating.number}: ${cast.relating.name} (${cast.relating.chinese})`,
            `Changing lines: ${cast.changingLines.join(', ')}`,
            `**Relating judgment:** ${cast.relating.judgment}`);
    }
    return lines.join('\n');
}
