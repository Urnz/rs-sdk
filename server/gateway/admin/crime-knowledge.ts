import { existsSync } from 'node:fs';

import { CrimeCaseStore, type WitnessSuspectDescription } from '../../../crime-cases/index.js';
import { projectObserverReintegrationDescriptors,ReintegrationEvidenceStore,ReintegrationStateStore,
    type ReintegrationDescriptor } from '../../../crime-reintegration/index.js';
import { ThievingProcedureStore } from '../../../thieving-procedures/store.js';

export interface CrimeKnowledgePaths { thieving: string; cases: string;reintegrationEvidence?:string;reintegrationState?:string;
    worldProfileId?:string }
export interface CrimeKnowledgeSnapshot {
    byViewer: ReadonlyMap<string, readonly WitnessSuspectDescription[]>;
    reformsByViewer:ReadonlyMap<string,readonly ReintegrationDescriptor[]>;
    unavailable: boolean;
}

/** Optional local-only source. A missing or invalid ledger can never synthesize social knowledge. */
export function loadCrimeKnowledge(paths: CrimeKnowledgePaths, viewerAgentIds: readonly string[]): CrimeKnowledgeSnapshot {
    const byViewer = new Map<string, WitnessSuspectDescription[]>(),reformsByViewer=new Map<string,ReintegrationDescriptor[]>();
    let unavailable=false;
    let thieving: ThievingProcedureStore | null = null;
    let cases: CrimeCaseStore | null = null;
    if(existsSync(paths.thieving)||existsSync(paths.cases)){if(!existsSync(paths.thieving)||!existsSync(paths.cases))unavailable=true;
        else try{thieving=new ThievingProcedureStore(paths.thieving);cases=new CrimeCaseStore(paths.cases,thieving);
            for(const description of cases.listWitnessSuspectDescriptionsForViewers(viewerAgentIds)){const list=byViewer.get(
                description.viewerAgentId)??[];list.push(description);byViewer.set(description.viewerAgentId,list)}}catch{unavailable=true}
        finally{cases?.close();thieving?.close()}}
    const evidencePath=paths.reintegrationEvidence,statePath=paths.reintegrationState;
    const evidenceExists=Boolean(evidencePath&&existsSync(evidencePath)),stateExists=Boolean(statePath&&existsSync(statePath));
    if(evidenceExists||stateExists){if(!evidencePath||!statePath||!evidenceExists||!stateExists)unavailable=true;
        else{let evidence:ReintegrationEvidenceStore|null=null,state:ReintegrationStateStore|null=null;
            try{evidence=new ReintegrationEvidenceStore(evidencePath);state=new ReintegrationStateStore(statePath);
                if(!evidence.verifyAuditChain()||!state.verifyAuditChain())throw new Error('Reintegration audit chain is invalid');
                for(const viewer of viewerAgentIds){const values=projectObserverReintegrationDescriptors(evidence,state,viewer,
                    paths.worldProfileId??'local-world');if(values.length)reformsByViewer.set(viewer,values)}}catch{unavailable=true}
            finally{state?.close();evidence?.close()}}}
    return{byViewer,reformsByViewer,unavailable}
}
