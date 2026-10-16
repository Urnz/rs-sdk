import { FineCollectionSettlementStore, recoverFineCollections } from '../../../crime-cases/fine-collection-settlement.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import { requestEnginePlayerEscrow } from './player-escrow.js';
import { crimeFineSettlementsDbPath, institutionTreasuryDbPath } from './paths.js';

/** Gateway restart/periodic recovery for already-authorized fine plans. */
export async function recoverReadyFineCollectionSettlements(options: {
    journalPath?: string;
    treasuryPath?: string;
    escrower?: typeof requestEnginePlayerEscrow;
} = {}) {
    const journal = new FineCollectionSettlementStore(options.journalPath ?? crimeFineSettlementsDbPath);
    const treasury = new InstitutionTreasuryStore(options.treasuryPath ?? institutionTreasuryDbPath);
    try {
        return await recoverFineCollections({ journal, treasury,
            escrower: options.escrower ?? requestEnginePlayerEscrow });
    } finally { treasury.close(); journal.close(); }
}
