import { expect, test } from 'bun:test';
import { resolveCrimeReportIntakePaths } from './crime-report-paths.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('default report paths remain production paths and request-like traversal is rejected', () => {
    const paths = resolveCrimeReportIntakePaths(undefined, 'C:/Projects/OSRS/rs-sdk');
    expect(paths.thieving.replaceAll('\\', '/')).toEndWith('/.local/crime/thieving-procedures.sqlite');
    expect(paths.cases.replaceAll('\\', '/')).toEndWith('/.local/crime/cases.sqlite');
    for (const id of ['', '..', '../other', 'C:/secret', 'bundle\r\nheader'])
        expect(() => resolveCrimeReportIntakePaths(id)).toThrow('Invalid crime report acceptance bundle ID');
    expect(() => resolveCrimeReportIntakePaths('missing-bundle')).toThrow();
});
test('a directory junction cannot redirect acceptance writes outside the bundle root', () => {
    const root = mkdtempSync(join(tmpdir(), 'crime-http-junction-'));
    try {
        const base = join(root, '.local/phase22-live'), outside = join(root, 'outside');
        mkdirSync(base, { recursive: true }); mkdirSync(outside);
        symlinkSync(outside, join(base, 'escaping-bundle'), 'junction');
        expect(() => resolveCrimeReportIntakePaths('escaping-bundle', root)).toThrow('escapes');
    } finally { rmSync(root, { recursive: true, force: true }); }
});
test('accepted bundle redirects only notice ledgers, retaining the real engine journal and policy', () => {
    const root = mkdtempSync(join(tmpdir(), 'crime-http-paths-'));
    const id = 'pickpocket-test', directory = join(root, '.local/phase22-live', id);
    try {
        mkdirSync(directory, { recursive: true });
        for (const name of ['agents.sqlite', 'procedures.sqlite', 'cases.sqlite', 'witness.sqlite'])
            writeFileSync(join(directory, name), 'fixture');
        const save = (passed: boolean, restartVerified: boolean, bundleId = id) => writeFileSync(join(directory, 'acceptance.json'),
            JSON.stringify({ schemaVersion: 1, bundleId, passed, restartVerified }));
        for (const [passed, restarted] of [[false, true], [true, false]]) {
            save(passed!, restarted!);
            expect(() => resolveCrimeReportIntakePaths(id, root)).toThrow('restart-verified');
        }
        save(true, true, 'different-bundle');
        expect(() => resolveCrimeReportIntakePaths(id, root)).toThrow('restart-verified');
        save(true, true);
        const isolated = resolveCrimeReportIntakePaths(id, root), normal = resolveCrimeReportIntakePaths(undefined, root);
        expect(isolated.cases).toBe(join(directory, 'cases.sqlite'));
        expect(isolated.playerReports).toBe(join(directory, 'player-reports.sqlite'));
        expect(isolated.engineEvidence).toBe(normal.engineEvidence);
        expect(isolated.witnessPolicy).toBe(normal.witnessPolicy);
        rmSync(join(directory, 'witness.sqlite'));
        expect(() => resolveCrimeReportIntakePaths(id, root)).toThrow('source is missing');
    } finally { rmSync(root, { recursive: true, force: true }); }
});
