import { createItemSearch, type MarketSort } from './ItemSearch.js';
import ObjType from '#/cache/config/ObjType.js';
function eligible(item: ObjType | undefined): item is ObjType {
    return !!item?.name && item.tradeable && item.dummyitem === 0 && item.certtemplate === -1 && item.id !== ObjType.getId('coins');
}
export function marketItem(id: number): ObjType {
    const item = ObjType.get(id);
    if (!eligible(item)) throw new Error('This item cannot be traded on the Grand Exchange.');
    return item;
}
export function canonicalItem(id: number): number {
    const item = ObjType.get(id);
    return marketItem(item?.certtemplate !== -1 ? (item?.certlink ?? -1) : id).id;
}
let source: ObjType[] | undefined;
let items: { id: number; name: string; basePrice: number }[] = [];
let notes = new Map<number, number>();
let search = createItemSearch(items);
function refresh() {
    if (source === ObjType.configs) return;
    source = ObjType.configs;
    notes = new Map();
    for (const item of source) if (item.certtemplate !== -1) notes.set(item.certlink, item.id);
    items = source
        .filter(eligible)
        .map(o => ({ id: o.id, name: o.name!, basePrice: o.cost }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
    search = createItemSearch(items);
}
export function noteFor(id: number): number {
    refresh();
    return notes.get(id) ?? id;
}
export function catalog(query = '', sort: MarketSort = 'relevance') {
    refresh();
    return search(query, sort);
}
