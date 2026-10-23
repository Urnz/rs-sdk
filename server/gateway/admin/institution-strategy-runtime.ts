import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { stateDigest } from '../../../agent-state/state-objectives.js';
import type { InstitutionStrategyRun } from '../../../agent-state/institution-strategy.js';
import { buildCoreIdentity } from '../../../agent-state/context.js';
import type { LlmPlanResult, LlmPlanningInput } from '../../../llm-runtime/types.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import { loadDefaultBusinessStockPolicyCatalog } from '../../../business-stock-policy/policy.js';
import { loadDefaultBusinessWorkPolicyCatalog } from '../../../business-work/work.js';
import { loadDefaultBusinessRoleCatalog } from '../../../business-roles/index.js';
import { businessManagerPathFor, inspectBusinessForAgent, applyBusinessPolicyChoiceForAgent } from './business-agent-port.js';
import { BusinessManagerStore } from './business-manager.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import { createAdminBusinessWorkRequest, institutionTreasuryPathFor } from './agent-state.js';
import { useBusinessWork, type BusinessWorkRuntimeOptions } from './business-work-runtime.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import { loadInstitutionStrategyPolicy, institutionGrantDigest, type InstitutionPolicyOption } from './institution-strategy-policy.js';
import type { ReplanOutcome } from './replan-coordinator.js';
import { repoRoot } from './paths.js';

export interface InstitutionStrategyOptions {
    agentPath: string; policyPath?: string; requiredLeaseOwner?: string; maxLlmCostMicros: number;
    workOptions?: BusinessWorkRuntimeOptions;
    plan(input: LlmPlanningInput): Promise<LlmPlanResult>;
}
const uuid = (value: string) => { const h=createHash('sha256').update(value).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };

/** No scheduler and no avatar commands: this runs only inside the existing leased replan admission. */
export async function runInstitutionStrategy(agentId: string, event: LlmReplanEvent, options: InstitutionStrategyOptions): Promise<ReplanOutcome> {
    const use = <T>(fn: (s: AgentStateStore)=>T): T => { const s=new AgentStateStore(options.agentPath); try{return fn(s);}finally{s.close();} };
    // A supervisor wakeup after a crash resumes the original durable outbox,
    // rather than reserving another decision or stranding it behind a new event id.
    if (event.agentId!==agentId) return {runId:event.eventId,status:'rejected',reason:'Institution event identity collision'};
    const pending=use(s=>s.pendingInstitutionStrategy(agentId));
    if (!use(s=>s.getInstitutionStrategy(event.eventId)) && pending)
        event={...event,eventId:pending.request.eventId,sourceKey:pending.request.sourceKey};
    const result = (status: string, reason: string, run?: InstitutionStrategyRun): ReplanOutcome => ({runId:event.eventId,status,reason,
        decision:{kind:'institution-policy',eventId:event.eventId,businessId:run?.request.businessId,
            optionId:run?.plan?.decision?.kind==='choose-alternative' ? run.plan.decision.optionId : null}});
    let run = use(s=>s.getInstitutionStrategy(event.eventId));
    try {
        if (event.agentId!==agentId || run && (run.request.agentId!==agentId || run.request.sourceKey!==event.sourceKey))
            throw new Error('Institution event identity collision');
        if (run?.status==='applied') return result('completed',run.reason,run);
        if (run?.status==='waiting') return result('waiting',run.reason,run);
        if (run?.status==='inferring') return result('bounded-wait','Institution inference outcome is uncertain; reconciliation required.',run);
        const read = () => {
            const grant=loadInstitutionStrategyPolicy(options.policyPath ?? join(repoRoot,'config/institution-strategy.json')).grants.find(g=>g.agentId===agentId);
            const profile=use(s=>s.getControlProfile(agentId)), enrollment=use(s=>s.getAutonomyEnrollment(agentId));
            if (!grant || !profile || profile.role!=='institution' || profile.subjectKind!=='business' || profile.avatarPlayerUsername
                || profile.subjectId!==grant.businessId || enrollment?.policyId!==grant.policyId || enrollment.policyVersion!==grant.policyVersion)
                throw new Error('Exact Business institution grant/enrollment required');
            const business=inspectBusinessForAgent(agentId,options.agentPath);
            if (business.status!=='active') throw new Error('Business subject is inactive');
            const manager=new BusinessManagerStore(businessManagerPathFor(options.agentPath));
            let inventory; try{inventory=manager.listInventory(business.businessId);}finally{manager.close();}
            const treasury=new InstitutionTreasuryStore(institutionTreasuryPathFor(options.agentPath));
            let account; try{account=treasury.get('business',business.businessId);}finally{treasury.close();}
            const db=new OwnedDatabase(businessManagerPathFor(options.agentPath),{readonly:true,strict:true});
            let orders: Record<string,unknown>[]=[];
            try { if(db.query("SELECT 1 FROM sqlite_master WHERE name='business_work_order'").get()) orders=db.query(
                'SELECT work_order_id,worker_agent_id,status,wage_status,scheduled_end FROM business_work_order WHERE business_id=?1 ORDER BY created_at DESC LIMIT 100')
                .all(business.businessId) as Record<string,unknown>[]; }finally{db.close(true);}
            const context={business,inventory,treasury:account,orders};
            return {grant,profile,business,context,contextDigest:stateDigest(context)};
        };
        const state=read(), policyDigest=institutionGrantDigest(state.grant);
        const cost = (o: InstitutionPolicyOption) => {
            const employment=o.work ? state.business.employments.find(e=>e.employmentId===o.work!.employmentId && e.status==='active') : null;
            if (o.work && !employment) throw new Error('Institution work employment is unavailable');
            return employment?.wageGp ?? 0;
        };
        const validate = (o: InstitutionPolicyOption, recovery: boolean) => {
            const amount=cost(o);
            if (amount>state.grant.maxGpPerDecision || amount>state.grant.maxGpPerDay || amount>state.profile.dailyOperationalBudgetGp
                || o.maxRewardGp>state.grant.maxGpPerDecision || o.maxRewardGp>state.profile.dailyOperationalBudgetGp || amount>o.maxRewardGp)
                throw new Error('Institution option exceeds reward/operational grant');
            const base=loadDefaultBusinessStockPolicyCatalog(), roles=loadDefaultBusinessRoleCatalog();
            for(const p of o.stockPolicies) if (!base.policies.some(b=>b.businessId===state.business.businessId && b.itemId===p.itemId && b.policyId===p.policyId)
                || [...p.procurement.verifiedSkills,...p.sales.verifiedSkills].some(s=>!roles.verifiedSkillKeys.includes(`${s.id}@${s.version}`)))
                throw new Error('Institution stock policy subject or verified skill differs');
            if (o.work) {
                const catalog=options.workOptions?.catalog ?? loadDefaultBusinessWorkPolicyCatalog(), p=catalog.policies.find(p=>p.policyId===o.work!.policyId);
                const e=state.business.employments.find(e=>e.employmentId===o.work!.employmentId)!;
                if (!p || p.businessId!==state.business.businessId || p.roleDefinitionId!==e.roleDefinitionId
                    || o.work.durationMinutes<p.minimumMinutes || o.work.durationMinutes>p.maximumMinutes
                    || o.preferredSkills.length && !o.preferredSkills.some(s=>s.id===p.requiredSkill.id && s.version===p.requiredSkill.version))
                    throw new Error('Institution exact work policy/role differs');
                if (!recovery && state.context.orders.some(r=>r.worker_agent_id===e.workerAgentId && ['scheduled','running'].includes(String(r.status))))
                    throw new Error('Institution employee already has pending work');
                if (!recovery && (state.context.treasury?.availableGp ?? 0)<amount) throw new Error('Institution treasury is insufficient');
            }
            return amount;
        };
        if (!run) {
            const feasible=state.grant.options.flatMap(o=>{try{return [{optionId:o.optionId,description:o.objective,costGp:validate(o,false),
                policy:{mode:o.mode,maxRewardGp:o.maxRewardGp,stockPolicies:o.stockPolicies,work:o.work}}];}catch{return [];}});
            if (!feasible.length) return result('input-required','No feasible grant-bounded Business policy/work option.');
            const snapshot=use(s=>s.getSnapshot(agentId))!;
            const anchor={goalId:`business.${state.business.businessId}`.slice(0,64),title:'Operate the exact Business within its grant',description:state.business.summary};
            const input:LlmPlanningInput={agentId,mode:'choose-business-policy',goal:anchor,
                goalHierarchy:[{...anchor,parentGoalId:null,horizon:'current',priority:50}],allowedSkills:[],businessAlternatives:feasible,
                trustedContext:`${buildCoreIdentity(snapshot,2000)}\nOwn Business observation: ${JSON.stringify(state.context)}`.slice(0,12000),
                untrustedText:[event.summary.slice(0,1000)],runId:event.eventId};
            const now=new Date().toISOString();
            run=use(s=>s.prepareInstitutionStrategy({eventId:event.eventId,sourceKey:event.sourceKey,agentId,businessId:state.business.businessId,
                profileRevision:state.profile.revision,policyId:state.grant.policyId,policyVersion:state.grant.policyVersion,
                grantDigest:policyDigest,contextDigest:state.contextDigest,observedAt:now,input},options.maxLlmCostMicros,options.requiredLeaseOwner));
        }
        if (run.request.grantDigest!==policyDigest) throw new Error('Institution grant changed since preparation');
        use(s=>s.assertInstitutionStrategyAuthority(run!.request,options.requiredLeaseOwner));
        if (run.status==='prepared') {
            if (run.request.contextDigest!==state.contextDigest) throw new Error('Institution prepared observation changed');
            if (!use(s=>s.claimInstitutionInference(event.eventId))) return result('bounded-wait','Institution inference already claimed.',run);
            const plan=await options.plan(run.request.input);
            run=use(s=>s.finishInstitutionInference(event.eventId,plan));
            if (run.status==='waiting') return result(plan.status==='failed' ? 'failed':plan.status,run.reason,run);
            if (run.status==='inferring') return result('bounded-wait','Institution inference outcome is uncertain; reconciliation required.',run);
        }
        // Re-read after the asynchronous provider; grants, employment, budget and lease can be revoked meanwhile.
        const fresh=read();
        if (institutionGrantDigest(fresh.grant)!==run.request.grantDigest) throw new Error('Institution grant changed during inference');
        if (run.status==='decided' && fresh.contextDigest!==run.request.contextDigest) throw new Error('Institution Business observation changed during inference');
        const chosen=run.plan?.decision?.kind==='choose-alternative' ? fresh.grant.options.find(o=>o.optionId===(run!.plan!.decision as {optionId:string}).optionId) : null;
        if (!chosen) throw new Error('Institution selected option is unavailable');
        const amount=validate(chosen,run.status==='applying');
        use(s=>s.beginInstitutionApplication(event.eventId,amount,fresh.grant.maxGpPerDay,options.requiredLeaseOwner));
        applyBusinessPolicyChoiceForAgent(agentId,fresh.grant,chosen.optionId,event.eventId,uuid(`institution:${event.eventId}`),
            run.request.grantDigest,stateDigest([run.request,chosen]),options.agentPath,run.request.observedAt);
        if (chosen.work) {
            const work=chosen.work, workId=`institution.${stateDigest([agentId,event.eventId]).slice(0,48)}`;
            use(s=>s.assertInstitutionStrategyAuthority(run!.request,options.requiredLeaseOwner));
            useBusinessWork(options.agentPath,options.workOptions ?? {},s=>{
                if(!s.get(workId)) s.createWorkOrder(workId,work.policyId,work.employmentId,run!.request.observedAt,
                    new Date(Date.parse(run!.request.observedAt)+work.durationMinutes*60000).toISOString(),run!.request.observedAt);
            });
            createAdminBusinessWorkRequest(workId,agentId,work.parameters,work.target,options.agentPath,options.workOptions ?? {});
        }
        use(s=>s.settleInstitutionStrategy(event.eventId,'applied','Institution policy applied; physical work remains a typed player request.'));
        run=use(s=>s.getInstitutionStrategy(event.eventId))!;
        return result('completed',run.reason,run);
    } catch(error) {
        const reason=error instanceof Error ? error.message:String(error);
        const current=use(s=>s.getInstitutionStrategy(event.eventId));
        // Applying is an idempotent outbox. Uncertain inference is never sent again.
        if (current && ['prepared','decided'].includes(current.status)) use(s=>s.settleInstitutionStrategy(event.eventId,'waiting',reason));
        return result('bounded-wait',reason,current ?? undefined);
    }
}
