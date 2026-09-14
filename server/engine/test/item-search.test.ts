import { expect, test } from 'bun:test';
import { createItemSearch } from '../src/engine/market/ItemSearch';

const names = ['Rune scimitar', 'Mithril scimitar', 'Adamant platebody', 'Blue dragonhide body', 'Dragon dagger(p)', 'Rune sword', 'Rune 2h sword', 'Oak logs', 'Lobster', 'Rune', 'Rune arrow', 'Rune scimitar'];
const search = createItemSearch(names.map((name, id) => ({ name, id: id + 1 })));
test('ranks exact, phrase and fuzzy matches with deterministic ties', () => {
    expect(search('Rune')[0].name).toBe('Rune');
    expect(search('rune scmitar').map(i => i.id)).toEqual([1, 12]);
    expect(search('runesword')[0].name).toBe('Rune sword');
    expect(search('rune nonexistent')).toEqual([]);
    expect(search('zx')).toEqual([]);
});
test('expands common equipment, material and food aliases', () => {
    for (const [query, name] of [
        ['rscim', 'Rune scimitar'],
        ['addy pl8', 'Adamant platebody'],
        ['mith scim', 'Mithril scimitar'],
        ['blue d hide body', 'Blue dragonhide body'],
        ['dds', 'Dragon dagger(p)'],
        ['r2h', 'Rune 2h sword'],
        ['lobbies', 'Lobster'],
        ['ÓAK LOG', 'Oak logs']
    ])
        expect(search(query)[0]?.name).toBe(name);
});
test('sorts matching results by name in both directions and preserves supplied item eligibility', () => {
    const matches = search('rune', 'name');
    expect(matches.map(i => i.name)).toEqual(matches.map(i => i.name).sort((a, b) => a.localeCompare(b, 'en')));
    const reverse = search('rune', 'name-desc');
    expect(reverse.map(i => i.name)).toEqual([...matches.map(i => i.name)].reverse());
    expect(search('')).toHaveLength(names.length);
    expect(createItemSearch([{ id: 1, name: 'Logs' }])('rscim')).toEqual([]);
});
