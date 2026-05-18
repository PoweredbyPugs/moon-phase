/* 9 Star Ki — basic year / month / third calculation.
 *
 * Ported from Stella's ki.py (PoweredbyPugs/Stella-mcp). Lookup tables
 * preserved verbatim so output matches the reference implementation.
 * Verified against the canonical fixture: 1986-05-01 → 5.9.1. */

export interface KiResult {
    date: string;       // ISO YYYY-MM-DD
    yearKi: number;
    monthKi: number;
    thirdKi: number;
    sequence: string;   // "Y.M.T"
    year: KiTrigram;
    month: KiTrigram;
    third: KiTrigram;
}

export interface KiTrigram {
    number: number;
    name: string;
    trigram: string;     // unicode
    chinese: string;
    element: string;
}

export interface KiCycleResult {
    date: string;
    natalYearKi: number;
    globalYear: number;
    globalMonth: number;
    personalYear: number;
    personalMonth: number;
    personalYearInfo: KiTrigram;
    personalMonthInfo: KiTrigram;
}

const KI_TRIGRAMS_DATA: Record<number, Omit<KiTrigram, 'number'>> = {
    1: { name: 'Water',    trigram: '☵', chinese: 'Kan',     element: 'Water' },
    2: { name: 'Earth',    trigram: '☷', chinese: 'Kun',     element: 'Earth' },
    3: { name: 'Thunder',  trigram: '☳', chinese: 'Zhen',    element: 'Wood' },
    4: { name: 'Wind',     trigram: '☴', chinese: 'Xun',     element: 'Wood' },
    5: { name: 'Center',   trigram: '☯', chinese: 'Tai Chi', element: 'Earth' },
    6: { name: 'Heaven',   trigram: '☰', chinese: 'Qian',    element: 'Metal' },
    7: { name: 'Lake',     trigram: '☱', chinese: 'Dui',     element: 'Metal' },
    8: { name: 'Mountain', trigram: '☶', chinese: 'Gen',     element: 'Earth' },
    9: { name: 'Fire',     trigram: '☲', chinese: 'Li',      element: 'Fire' },
};

export function kiTrigram(n: number): KiTrigram {
    return { number: n, ...KI_TRIGRAMS_DATA[n] };
}

/* Year table: Ki number → list of years that map to it. Ki year boundary
 * is February 4 (Lichun); dates Jan 1 – Feb 3 belong to the previous Ki year. */
const YEAR_TABLE: Record<number, number[]> = {
    1: [1909, 1918, 1927, 1936, 1945, 1954, 1963, 1972, 1981, 1990, 1999, 2008, 2017, 2026, 2035, 2044],
    2: [1908, 1917, 1926, 1935, 1944, 1953, 1962, 1971, 1980, 1989, 1998, 2007, 2016, 2025, 2034, 2043],
    3: [1907, 1916, 1925, 1934, 1943, 1952, 1961, 1970, 1979, 1988, 1997, 2006, 2015, 2024, 2033, 2042],
    4: [1906, 1915, 1924, 1933, 1942, 1951, 1960, 1969, 1978, 1987, 1996, 2005, 2014, 2023, 2032, 2041],
    5: [1905, 1914, 1923, 1932, 1941, 1950, 1959, 1968, 1977, 1986, 1995, 2004, 2013, 2022, 2031, 2040],
    6: [1904, 1913, 1922, 1931, 1940, 1949, 1958, 1967, 1976, 1985, 1994, 2003, 2012, 2021, 2030, 2039],
    7: [1903, 1912, 1921, 1930, 1939, 1948, 1957, 1966, 1975, 1984, 1993, 2002, 2011, 2020, 2029, 2038],
    8: [1902, 1911, 1920, 1929, 1938, 1947, 1956, 1965, 1974, 1983, 1992, 2001, 2010, 2019, 2028, 2037],
    9: [1901, 1910, 1919, 1928, 1937, 1946, 1955, 1964, 1973, 1982, 1991, 2000, 2009, 2018, 2027, 2036],
};

const YEAR_TO_KI: Record<number, number> = {};
for (const [ki, years] of Object.entries(YEAR_TABLE)) {
    for (const y of years) YEAR_TO_KI[y] = Number(ki);
}

/* Month table: 12 ranges across the Ki year (Feb 4 → Feb 3 next year).
 * Each entry stores values[1..9] = three-digit code Y.M.T for that Ki year. */
type MonthRange = {
    start: [number, number];   // [month, day]
    end: [number, number];
    values: number[];           // length 9, indexed by yearKi-1
};

const MONTH_TABLE: MonthRange[] = [
    { start: [2, 4],   end: [3, 5],   values: [187, 225, 353, 481, 528, 656, 784, 822, 959] },
    { start: [3, 6],   end: [4, 4],   values: [178, 216, 344, 472, 519, 647, 775, 813, 941] },
    { start: [4, 5],   end: [5, 4],   values: [169, 297, 335, 463, 591, 638, 766, 894, 932] },
    { start: [5, 5],   end: [6, 5],   values: [151, 288, 326, 454, 582, 629, 757, 885, 923] },
    { start: [6, 6],   end: [7, 6],   values: [142, 279, 317, 445, 573, 611, 748, 876, 914] },
    { start: [7, 7],   end: [8, 6],   values: [133, 261, 398, 436, 564, 692, 739, 867, 995] },
    { start: [8, 7],   end: [9, 7],   values: [124, 252, 389, 427, 555, 683, 721, 858, 986] },
    { start: [9, 8],   end: [10, 7],  values: [115, 243, 371, 418, 546, 674, 712, 849, 977] },
    { start: [10, 8],  end: [11, 6],  values: [196, 234, 362, 499, 537, 665, 793, 831, 968] },
    { start: [11, 7],  end: [12, 6],  values: [187, 225, 353, 481, 528, 656, 784, 822, 959] },
    { start: [12, 7],  end: [1, 4],   values: [178, 216, 344, 472, 519, 647, 775, 813, 941] },
    { start: [1, 5],   end: [2, 3],   values: [169, 297, 335, 463, 591, 638, 766, 894, 932] },
];

/* Flying Star sequence. The Lo Shu palace ordering used for personal-cycle math. */
const FLYING_SEQUENCE = [5, 6, 7, 8, 9, 1, 2, 3, 4];
const NUM_TO_IDX: Record<number, number> = {};
FLYING_SEQUENCE.forEach((n, i) => { NUM_TO_IDX[n] = i; });

function dateInRange(month: number, day: number, start: [number, number], end: [number, number]): boolean {
    const dateVal = month * 100 + day;
    const startVal = start[0] * 100 + start[1];
    const endVal = end[0] * 100 + end[1];
    return startVal <= endVal
        ? (dateVal >= startVal && dateVal <= endVal)
        : (dateVal >= startVal || dateVal <= endVal);   // year-wrap range (Dec-Jan)
}

export function calculateKiYear(year: number, month: number, day: number): number {
    let effectiveYear = year;
    if (month < 2 || (month === 2 && day < 4)) effectiveYear = year - 1;
    if (YEAR_TO_KI[effectiveYear] !== undefined) return YEAR_TO_KI[effectiveYear];
    // Outside table: 9-year cycle, 2026 = Ki 1
    const offset = ((effectiveYear - 2026) % 9 + 9) % 9;
    const ki = 1 - offset;
    return ki <= 0 ? ki + 9 : ki;
}

export function calculateKiAll(year: number, month: number, day: number): [number, number, number] {
    const yearKi = calculateKiYear(year, month, day);
    for (const r of MONTH_TABLE) {
        if (dateInRange(month, day, r.start, r.end)) {
            const value = r.values[yearKi - 1];
            const s = String(value);
            // value is Y.M.T encoded as 3 digits; if first digit is the year Ki, parse the rest.
            const monthKi = Number(s[1]);
            const thirdKi = Number(s[2]);
            return [yearKi, monthKi, thirdKi];
        }
    }
    return [yearKi, 0, 0];
}

export function calculateKi(d: Date): KiResult {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const [yearKi, monthKi, thirdKi] = calculateKiAll(y, m, day);
    return {
        date: isoDate(d),
        yearKi, monthKi, thirdKi,
        sequence: `${yearKi}.${monthKi}.${thirdKi}`,
        year: kiTrigram(yearKi),
        month: kiTrigram(monthKi),
        third: kiTrigram(thirdKi),
    };
}

export function calculatePersonalCycle(natalYearKi: number, target: Date): KiCycleResult {
    const global = calculateKi(target);
    const shiftYear = -NUM_TO_IDX[global.yearKi];
    const personalYear = FLYING_SEQUENCE[((NUM_TO_IDX[natalYearKi] + shiftYear) % 9 + 9) % 9];

    const shiftMonth = -NUM_TO_IDX[global.monthKi];
    const personalMonth = FLYING_SEQUENCE[((NUM_TO_IDX[natalYearKi] + shiftMonth) % 9 + 9) % 9];

    return {
        date: isoDate(target),
        natalYearKi,
        globalYear: global.yearKi,
        globalMonth: global.monthKi,
        personalYear,
        personalMonth,
        personalYearInfo: kiTrigram(personalYear),
        personalMonthInfo: kiTrigram(personalMonth),
    };
}

export function formatKiReport(ki: KiResult): string {
    const line = (n: number, kt: KiTrigram, label: string) =>
        `**${label}: ${n} ${kt.trigram} ${kt.name}** (${kt.chinese}) — ${kt.element}`;
    return [
        `# 9 Star Ki for ${ki.date}`,
        '',
        `**Ki Sequence:** ${ki.sequence}`,
        '',
        line(ki.yearKi, ki.year, 'Year Ki'),
        line(ki.monthKi, ki.month, 'Month Ki'),
        line(ki.thirdKi, ki.third, 'Third Ki'),
    ].join('\n');
}

function isoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
