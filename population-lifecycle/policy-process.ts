import {randomUUID} from 'node:crypto';
/** Shared only inside one process: startup, policy mutations and native frames use the same identity. */
export const policyProcessSessionId=randomUUID();
