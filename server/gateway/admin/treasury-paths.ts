import {dirname,join} from 'node:path';
import {agentStateDbPath,institutionTreasuryDbPath} from './paths.js';
export function institutionTreasuryPathFor(path=agentStateDbPath):string{
    return path===agentStateDbPath?institutionTreasuryDbPath:join(dirname(path),'institution-treasury.sqlite');
}
