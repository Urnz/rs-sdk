import { JusticeExecutionStore, recoverJusticeExecutions } from '../../../crime-cases/justice-execution.js';
import { requestEnginePlayerCustody } from './player-custody.js';
import { requestEnginePlayerEscrow } from './player-escrow.js';
import { crimeJusticeExecutionsDbPath } from './paths.js';

/** Gateway restart/periodic recovery for frozen, already-authorized justice decisions. */
export async function recoverReadyJusticeExecutions(options: {
    journalPath?: string;
    escrower?: typeof requestEnginePlayerEscrow;
    custodian?: typeof requestEnginePlayerCustody;
} = {}) {
    const journal = new JusticeExecutionStore(options.journalPath ?? crimeJusticeExecutionsDbPath);
    try { return await recoverJusticeExecutions({journal,escrower:options.escrower??requestEnginePlayerEscrow,
        custodian:options.custodian??requestEnginePlayerCustody}); }
    finally { journal.close(); }
}
