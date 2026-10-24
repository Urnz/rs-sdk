import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { AgentStateStore } from '../agent-state/store.js';
import type { CharacterAttributeCreation } from './binding-store.js';

/** Explicit operator import; the input contains full validated profiles/policies and creation evidence. */
export function bindCharacterAttributesCli(args: string[]): void {
    const { values } = parseArgs({ args, options: {
        'agents-db': { type: 'string' }, 'agent-id': { type: 'string' }, input: { type: 'string' }
    }, strict: true });
    if (!values['agents-db'] || !values['agent-id'] || !values.input)
        throw new Error('Usage: bun character-attributes/bind-cli.ts --agents-db PATH --agent-id ID --input CREATION.json');
    const creation = JSON.parse(readFileSync(resolve(values.input), 'utf8')) as CharacterAttributeCreation;
    if (!existsSync(resolve(values['agents-db']))) throw new Error('Agent database does not exist');
    const agents = new AgentStateStore(resolve(values['agents-db']));
    try {
        const binding = agents.bindCharacterAttributes(values['agent-id'], creation);
        console.info(JSON.stringify({ actorId: binding.actorId, lifecycleId: binding.lifecycleId,
            bindingDigest: binding.digest, attributeProfileDigest: binding.attributes.digest,
            potentialPolicyDigest: binding.potentialPolicy.digest, capPolicyDigest: binding.capPolicy.digest }));
    } finally { agents.close(); }
}

if (import.meta.main) bindCharacterAttributesCli(process.argv.slice(2));
