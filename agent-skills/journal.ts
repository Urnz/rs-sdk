import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { SkillRunResult } from './types';

export class FileSkillRunJournal {
    private readonly root: string;

    constructor(root: string) {
        this.root = resolve(root);
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
