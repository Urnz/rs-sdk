import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const adminDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(adminDir, '../../..');
export const botsDir = join(repoRoot, 'bots');
export const playerSavesDir = join(repoRoot, 'server', 'engine', 'data', 'players', 'main');
export const webclientDir = join(repoRoot, 'server', 'webclient');
export const adminPublicDir = join(adminDir, 'public');
export const adminLocalDir = join(repoRoot, '.local', 'admin');
export const adminLogsDir = join(adminLocalDir, 'logs');
export const adminSkillLogsDir = join(adminLocalDir, 'skill-logs');
export const adminTrashDir = join(adminLocalDir, 'trash');
export const activeSkillsDir = join(adminLocalDir, 'active-skills');
export const auditLogPath = join(adminLocalDir, 'audit.jsonl');
export const economyLogPath = join(adminLocalDir, 'economy.jsonl');
export const experimentsDir = join(adminLocalDir, 'experiments');
