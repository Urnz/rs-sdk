import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CharacterAttributeStore, createPopulationAttributes } from '../binding-store.js';
import { attributeMember, attributeCreation } from './binding-fixture.js';

const directories: string[] = [];
const databases: Database[] = [];
function open(path = ':memory:') { const db = new Database(path); databases.push(db); return db; }
afterEach(() => {
    for (const db of databases.splice(0)) { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); }
    for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('legacy lookup is read-only and explicit import is immutable across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'attribute-binding-')); directories.push(dir);
    const path = join(dir, 'attributes.sqlite'), db = open(path), store = new CharacterAttributeStore(db), member = attributeMember();
    expect(store.get(member)).toBeNull();
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
    const input = attributeCreation(member, 0), binding = store.bind(member, input);
    expect(store.bind(member, input)).toEqual(binding);
    expect(() => store.bind(member, attributeCreation(member, 10))).toThrow('immutable');
    const reopened = new CharacterAttributeStore(open(path));
    expect(reopened.get(member)).toEqual(binding);
    expect(() => db.run('DELETE FROM character_attribute_binding')).toThrow('immutable');
    expect(() => db.run("UPDATE character_attribute_binding SET payload='{}'")).toThrow('immutable');
    expect(reopened.get({ ...member, sourceResultDigest: 'e'.repeat(64) })).toBeNull();
    expect(() => store.bind({ ...member, agentId: 'bob' }, input)).toThrow('another lifecycle');
    expect(() => store.bind({ ...member, status: 'reset' }, input)).toThrow('not active');
});

test('generated creation freezes seeded budget/allocation and exact policy versions', () => {
    const member = attributeMember(), creation = createPopulationAttributes(member);
    expect(createPopulationAttributes(member)).toEqual(creation);
    expect(creation.attributes.source.origin).toBe('genesis-lottery');
    const store = new CharacterAttributeStore(open()), binding = store.bind(member, creation);
    expect(binding.capPolicy).toMatchObject({ policyId: 'attribute-hard-cap', version: '1.0.0' });
    expect(binding.potential.policy.digest).toBe(binding.potentialPolicy.digest);
    expect(() => store.bind(member, { ...creation, potentialPolicy: { ...creation.potentialPolicy, digest: 'f'.repeat(64) } })).toThrow('digest mismatch');
});

test('binding rolls back with its owner transaction without changing unrelated tables', () => {
    const db = open(), store = new CharacterAttributeStore(db), member = attributeMember();
    db.run('CREATE TABLE legacy(value TEXT)'); db.run("INSERT INTO legacy VALUES('preserved')");
    expect(() => db.transaction(() => { store.bind(member, attributeCreation(member, 5)); throw new Error('checkpoint failed'); }).immediate()).toThrow('checkpoint failed');
    expect(store.get(member)).toBeNull();
    expect(db.query('SELECT * FROM legacy').all()).toEqual([{ value: 'preserved' }]);
});
