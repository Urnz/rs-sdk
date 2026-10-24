import { readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentStateStore } from '../agent-state/store.js';
import { SkillRegistry } from '../agent-skills/registry.js';
import { loadFacilityCapabilityCatalog } from '../facility-capability/catalog.js';
import { authorizeFacilityCapability } from '../facility-capability/authorization.js';
import { loadDefaultBusinessRoleCatalog, resolveBusinessRole, businessRoleHasPermission } from '../business-roles/index.js';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { nativeToolDigest, type NativeToolOwner } from '../item-lifecycle/native-tool.js';
import { nativeToolWorkPolicy, TOOL_WORK_SKILLS } from './native-tool-work-policy.js';
import type { NativeToolWorkKind,ToolWorkAccess } from './native-tool-work.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { readToolWorkInvocation } from './native-tool-work-invocation.js';
import { toolTrialAuthorization } from '../agent-skills/tool-trials.js';
import { resolveSkillParameters } from '../agent-skills/validation.js';
export interface NativeToolWorkSources {workspace:string;agentsPath:string;businessPath:string;propertyPath:string;skillDirectory?:string}
/** Live readonly permissions and learned exact procedures, never a posted competence/facility receipt. */
export class NativeToolWorkAccessSource {
    constructor(readonly options:NativeToolWorkSources){}
    authorize(owner:NativeToolOwner,kind:NativeToolWorkKind,businessId:string|null,clock:SimulationClockObservation,
        invocation?:{operationId:string;contextDigest:string}):ToolWorkAccess{
        const agents=new AgentStateStore(this.options.agentsPath,undefined,true);
        try{
            const identity=agents.getIdentity(owner.actorId),member=agents.getPopulationMember(owner.actorId),profile=agents.getControlProfile(owner.actorId);
            if(!identity||identity.playerUsername!==owner.username||!member||member.status!=='active'||member.characterLifecycle.status!=='active'
                ||profile?.role!=='player'||profile.subjectKind!=='player'||profile.subjectId!==owner.username
                ||clock.clockId!==member.simulationClock.clockId||clock.profileDigest!==member.simulationClock.profileDigest
                ||nativeToolDigest({agentId:member.agentId,createdAt:member.characterLifecycle.createdAt,origin:member.characterLifecycle.origin,
                    createdAtSimulationTime:member.characterLifecycle.createdAtSimulationTime,sourceResultId:member.sourceResultId,
                    sourceResultDigest:member.sourceResultDigest,worldProfile:member.worldProfile,lifecyclePolicy:member.lifecyclePolicy,
                    simulationClock:member.simulationClock})!==owner.lifecycleId)throw new Error('Native tool access requires exact active population control');
            let reference:{id:string;version:string}=TOOL_WORK_SKILLS[kind],trialRunId:string|undefined;
            let trial:ReturnType<typeof readToolWorkInvocation>|undefined;
            if(invocation&&existsSync(join(this.options.workspace,'.local/agent-skills/tool-operations',`${invocation.operationId}.json`))){
                const source=readToolWorkInvocation(this.options.workspace,invocation.operationId),request=source.request;
                if(nativeToolDigest(request)!==invocation.contextDigest||Object.entries(owner).some(([key,value])=>source.owner[key as keyof NativeToolOwner]!==value)
                    ||request.operation!==(kind==='smelt'?'tool-smelt-bronze':'tool-repair')
                    ||(kind==='repair'&&request.args.businessId!==businessId))throw new Error('Tool invocation actor/context differs');
                if(request.context.skill.id===reference.id&&request.context.skill.version==='0.1.0'){
                    reference=request.context.skill;trialRunId=request.context.runId;trial=source;
                }
            }
            const known=agents.listSkillKnowledge(owner.actorId).find(row=>row.skill.id===reference.id&&row.skill.version===reference.version);
            const filename=`${reference.id}@${reference.version}.skill.json`,root=join(this.options.workspace,'.local/agent-skills');
            const local=[join(root,'private',owner.actorId,filename),join(root,'shared',filename)].find(path=>existsSync(path));
            const path=this.options.skillDirectory?join(this.options.skillDirectory,filename):local??join(this.options.workspace,'agent-skills/catalog',filename);
            const registered=new SkillRegistry().register(JSON.parse(readFileSync(path,'utf8')),{trusted:true});
            if(registered.definition.sharing.visibility==='private'&&registered.definition.sharing.ownerAgentId!==owner.actorId)
                throw new Error('Native tool work requires learned verified exact procedure');
            if(trial){
                const marker=JSON.parse(readFileSync(join(this.options.workspace,'.local/admin/active-skills',`${owner.username}.json`),'utf8'));
                const admission=JSON.parse(readFileSync(join(this.options.workspace,'.local/agent-skills/runs',`${trialRunId}.admission.json`),'utf8'));
                const grant=toolTrialAuthorization(registered.definition),request=trial.request;
                if(!grant||marker.username.toLowerCase()!==owner.username||marker.runId!==trialRunId||marker.skillId!==reference.id||marker.version!==reference.version
                    ||!Number.isFinite(Date.parse(marker.heartbeatAt))||Date.now()-Date.parse(marker.heartbeatAt)>15000||Date.parse(marker.heartbeatAt)-Date.now()>1000
                    ||marker.nativeToolTrial?.checksum!==registered.checksum||nativeToolDigest(marker.nativeToolTrial?.runtimeAuthorization)!==nativeToolDigest(grant)
                    ||admission.schemaVersion!==1||admission.runId!==trialRunId||admission.username!==owner.username||admission.checksum!==registered.checksum
                    ||admission.skill.id!==reference.id||admission.skill.version!==reference.version||admission.parametersDigest!==request.context.parametersDigest
                    ||nativeToolDigest(Object.entries(resolveSkillParameters(registered.definition,admission.parameters)).sort(([a],[b])=>a.localeCompare(b)))!==request.context.parametersDigest
                    ||request.context.stepId!==registered.definition.steps[1]!.id
                    ||kind==='repair'&&admission.parameters['business-id']!==businessId)throw new Error('Native tool draft lacks an active exact acknowledged trial');
            }else if(!known||known.status==='blocked'||registered.definition.status!=='verified')throw new Error('Native tool work requires learned verified exact procedure');
            const skill={...reference,checksum:registered.checksum};
            if(kind==='smelt')return{skill,trialRunId,digest:nativeToolDigest({kind,actor:owner.actorId,skill,trialRunId}),facility:null};
            if(!businessId)throw new Error('Repair workshop Business is required');
            const business=new OwnedDatabase(this.options.businessPath,{readonly:true,strict:true});let properties:OwnedDatabase|undefined;
            try{
                properties=new OwnedDatabase(this.options.propertyPath,{readonly:true,strict:true});
                const row=business.query<{owner_agent_id:string;property_id:string;status:string},[string]>(
                    'SELECT owner_agent_id,property_id,status FROM business WHERE business_id=?').get(businessId);
                if(!row||row.status!=='active')throw new Error('Repair Business is inactive');
                const facilities=loadFacilityCapabilityCatalog(join(this.options.workspace,'config/facility-capabilities.json'));
                const facility=facilities.facilities.find(f=>f.facilityId===nativeToolWorkPolicy.repair.facilityId);
                if(!facility||row.property_id!==facility.propertyId||(facility.businessId!==null&&facility.businessId!==businessId))throw new Error('Repair facility/Business property differs');
                const employment=business.query<{employment_id:string;role_definition_id:string;revision:number},[string,string]>(
                    "SELECT employment_id,role_definition_id,revision FROM business_employment WHERE business_id=? AND worker_agent_id=? AND status='active'").get(businessId,owner.actorId);
                if(row.owner_agent_id!==owner.actorId&&(!employment||!businessRoleHasPermission(resolveBusinessRole(loadDefaultBusinessRoleCatalog(),employment.role_definition_id),'inventory','receive')))
                    throw new Error('Repair worker lacks current Business permission');
                const property=properties.query<{status:string;owner_kind:string;owner_id:string;version:number},[string]>(
                    'SELECT status,owner_kind,owner_id,version FROM property_state WHERE property_id=?').get(facility.propertyId);
                const businessOwner=agents.getIdentity(row.owner_agent_id);
                if(!property||property.status!=='owned'||!(property.owner_kind==='business'&&property.owner_id===businessId
                    ||property.owner_kind==='player'&&property.owner_id===businessOwner?.playerUsername))throw new Error('Workshop access has no current native Property ownership');
                const digest=nativeToolDigest({kind,actor:owner.actorId,skill,businessId,owner:row.owner_agent_id,property,
                    employment:row.owner_agent_id===owner.actorId?null:employment,facilityDigest:facilities.digest});
                const grant={grantId:`grant:${digest}`,kind:row.owner_agent_id===owner.actorId?'explicit' as const:'employment' as const,
                    subjectAgentId:owner.actorId,facilityId:facility.facilityId,capabilityId:'work-surface',validFrom:clock.simulationTime,
                    validUntil:null,status:'active' as const,sourceEvidenceId:`authority:${digest}`};
                const authorization=authorizeFacilityCapability(facilities,{subjectAgentId:owner.actorId,facilityId:facility.facilityId,
                    capabilityId:'work-surface',at:clock.simulationTime},[grant],candidate=>candidate.grantId===grant.grantId);
                return{skill,trialRunId,digest,facility:{providerId:facility.facilityId,grantId:authorization.grantId,sourceEvidenceDigest:digest}};
            }finally{business.close(true);properties?.close(true);}
        }finally{agents.close();}
    }
}
