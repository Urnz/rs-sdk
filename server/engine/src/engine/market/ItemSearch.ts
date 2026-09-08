export type MarketSort = 'relevance' | 'name' | 'name-desc';
export const MARKET_SORTS: readonly MarketSort[] = ['relevance', 'name', 'name-desc'];

// Query vocabulary only: aliases do not create alternate items or change IDs.
const PHRASES: Record<string, string> = {
    rscim: 'rune scimitar',
    dscim: 'dragon scimitar',
    dlong: 'dragon longsword',
    r2h: 'rune 2h sword',
    dds: 'dragon dagger poison',
    ddp: 'dragon dagger poison',
    dhide: 'dragonhide',
    'd hide': 'dragonhide',
    'dragon hide': 'dragonhide',
    'two handed': '2h',
    'two hand': '2h',
    'full helmet': 'full helm'
};
const SYNONYMS: Record<string, string[]> = {
    addy: ['adamant'],
    adamantite: ['adamant'],
    mith: ['mithril'],
    scim: ['scimitar'],
    pick: ['pickaxe'],
    picks: ['pickaxe'],
    hatchet: ['axe'],
    hatchets: ['axe'],
    axes: ['axe'],
    helm: ['helmet'],
    helmet: ['helm'],
    helms: ['helm'],
    pl8: ['platebody'],
    body: ['platebody', 'chainbody'],
    legs: ['platelegs'],
    armor: ['armour', 'platebody', 'chainbody', 'platelegs', 'plateskirt'],
    armour: ['armor', 'platebody', 'chainbody', 'platelegs', 'plateskirt'],
    dhide: ['dragonhide'],
    pot: ['potion'],
    pots: ['potion'],
    arrows: ['arrow'],
    runes: ['rune'],
    logs: ['log'],
    log: ['logs'],
    lobs: ['lobster'],
    lobbies: ['lobster'],
    poison: ['p', 'poisoned']
};
export function normalizeSearch(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}
/** Bounded Damerau-Levenshtein distance, including adjacent-key transpositions. */
function distance(a: string, b: string, limit: number): number {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let prior = Array.from({ length: b.length + 1 }, (_, i) => i),
        before = prior;
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(row[j - 1] + 1, prior[j] + 1, prior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
        }
        if (Math.min(...row) > limit) return limit + 1;
        before = prior;
        prior = row;
    }
    return prior[b.length];
}
function wordScore(term: string, word: string): number {
    if (term === word) return 0;
    if (word.startsWith(term)) return 2;
    if (term.length >= 3 && word.includes(term)) return 5;
    if (term.length < 4) return Infinity;
    const limit = term.length >= 7 ? 2 : 1;
    const edits = distance(term, word, limit);
    return edits <= limit ? 10 + edits * 4 : Infinity;
}
/** Build once per item-cache reload. Search is deterministic and never changes eligibility. */
export function createItemSearch<T extends { id: number; name: string }>(items: readonly T[]) {
    const records = items.map(item => {
        const name = normalizeSearch(item.name);
        return { item, name, compact: name.replace(/ /g, ''), words: name.split(' ') };
    });
    return (input = '', sort: MarketSort = 'relevance'): T[] => {
        const original = normalizeSearch(input.slice(0, 80));
        let query = original;
        for (const [alias, expansion] of Object.entries(PHRASES)) {
            query = query.replace(new RegExp(`(^| )${alias}(?= |$)`, 'g'), (_match, prefix) => prefix + expansion);
        }
        const terms = query
            .split(' ')
            .filter(Boolean)
            .map(term => [term, ...(SYNONYMS[term] ?? [])]);
        const ranked = records.flatMap(record => {
            if (!query) return [{ ...record, score: 0 }];
            if (record.name === original) return [{ ...record, score: 0 }];
            if (record.name === query || record.compact === original.replace(/ /g, '')) return [{ ...record, score: 1 }];
            let score = 0;
            for (const alternatives of terms) {
                let best = Infinity;
                for (let i = 0; i < alternatives.length; i++) for (const word of record.words) best = Math.min(best, wordScore(alternatives[i], word) + (i ? 1 : 0));
                if (!Number.isFinite(best)) return [];
                score += best;
            }
            score += 20;
            if (record.name.startsWith(query)) score = 4;
            else if (record.name.includes(query)) score = 8;
            return [{ ...record, score }];
        });
        return ranked
            .sort((a, b) => {
                if (sort === 'relevance' && a.score !== b.score) return a.score - b.score;
                const name = a.item.name.localeCompare(b.item.name, 'en');
                return (sort === 'name-desc' ? -name : name) || a.item.id - b.item.id;
            })
            .map(r => r.item);
    };
}
