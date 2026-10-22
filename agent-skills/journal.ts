import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { SkillRunResult } from './types';

export class FileSkillRunJournal {
    private readonly root: string;

    constructor(root: string) {
        this.root = resolve(root);
    }

    async start(admission: { runId: string; username: string; skill: SkillRunResult['skill']; checksum: string;
        parameters: NonNullable<SkillRunResult['parameters']>; parametersDigest: string }): Promise<boolean> {
        if (!/^[0-9a-f-]{36}$/i.test(admission.runId)) throw new Error('Invalid skill run ID');
        await mkdir(this.root, { recursive: true });
        const destination = resolve(this.root, `${admission.runId}.admission.json`);
        const text = JSON.stringify({ schemaVersion: 1, ...admission });
        try { await writeFile(destination, text, { encoding: 'utf8', flag: 'wx' }); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        if (await readFile(destination, 'utf8') !== text) throw new Error('Skill run admission parameters/version differ');
        return false;
    }

    async load(runId: string): Promise<SkillRunResult | null> {
        if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error('Invalid skill run ID');
        try { const result = JSON.parse(await readFile(resolve(this.root, `${runId}.json`), 'utf8')) as SkillRunResult;
            if (result.runId !== runId) throw new Error('Skill result identity differs'); return result;
        } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    }

    async save(result: SkillRunResult): Promise<string> {
        if (!/^[0-9a-f-]{36}$/i.test(result.runId)) throw new Error('Invalid skill run ID');
        await mkdir(this.root, { recursive: true });
        const destination = resolve(this.root, `${result.runId}.json`);
        if (!destination.startsWith(`${this.root}${sep}`)) throw new Error('Run path escapes journal root');
        await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        return destination;
    }
}
