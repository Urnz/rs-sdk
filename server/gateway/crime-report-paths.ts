import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { repoRoot } from './admin/paths.js';
import type { CrimeReportIntakePaths } from './crime-report-intake.js';

/** Operator-only isolation for live acceptance. Never selected by HTTP request fields. */
export function resolveCrimeReportIntakePaths(bundleId?: string, root = repoRoot): Required<CrimeReportIntakePaths> {
    const standard = { agents: join(root, '.local/agent-state/agents.sqlite'),
        thieving: join(root, '.local/crime/thieving-procedures.sqlite'), cases: join(root, '.local/crime/cases.sqlite'),
        reports: join(root, '.local/crime/reports.sqlite'), playerReports: join(root, '.local/crime/player-reports.sqlite'),
        engineEvidence: join(root, 'server/engine/data/mods/thieving-engine-evidence.sqlite'),
        witnessDecisions: join(root, '.local/crime/witness-decisions.sqlite'),
        recognition: join(root, '.local/crime/witness-recognition.sqlite'),
        engineRecognition: process.env.THIEVING_WITNESS_INSPECTION_DB || join(root, 'server/engine/data/mods/witness-inspections.sqlite'),
        caseEvidence: join(root, '.local/crime/evidence.sqlite'),
        witnessPolicy: join(root, 'config/thieving-witness-attention.json') };
    if (bundleId === undefined) return standard;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{1,100}$/.test(bundleId)) throw new Error('Invalid crime report acceptance bundle ID');
    const base = realpathSync(join(root, '.local/phase22-live'));
    const directory = realpathSync(join(base, bundleId));
    const inside = (path: string, parent = base) => { const rel = relative(parent, realpathSync(path));
        return rel !== '' && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel); };
    if (!inside(directory)) throw new Error('Acceptance bundle escapes the local acceptance directory');
    for (const name of ['acceptance.json', 'agents.sqlite', 'procedures.sqlite', 'cases.sqlite', 'witness.sqlite'])
        if (!existsSync(join(directory, name)) || !inside(join(directory, name), directory))
            throw new Error('Acceptance bundle source is missing or outside the acceptance directory');
    for (const name of ['reports.sqlite', 'player-reports.sqlite', 'recognition.sqlite', 'evidence.sqlite'])
        if (existsSync(join(directory, name)) && !inside(join(directory, name), directory)) throw new Error('Acceptance report path escapes');
    const acceptance = JSON.parse(readFileSync(join(directory, 'acceptance.json'), 'utf8'));
    if (acceptance.schemaVersion !== 1 || acceptance.bundleId !== bundleId || acceptance.passed !== true
        || acceptance.restartVerified !== true) throw new Error('Accepted, restart-verified live bundle required');
    return { ...standard, agents: join(directory, 'agents.sqlite'), thieving: join(directory, 'procedures.sqlite'),
        cases: join(directory, 'cases.sqlite'), reports: join(directory, 'reports.sqlite'),
        playerReports: join(directory, 'player-reports.sqlite'), witnessDecisions: join(directory, 'witness.sqlite'),
        recognition: join(directory, 'recognition.sqlite'), caseEvidence: join(directory, 'evidence.sqlite') };
}
