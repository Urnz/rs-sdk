import { resolve,join } from 'node:path';
import { parseArgs } from 'node:util';
import { reportNativeOutcomes } from '../society-metrics/native-outcomes.js';
import { nativeIntegrationOptions } from '../society-metrics/integration-sources.js';

const {values:v}=parseArgs({options:{workspace:{type:'string'},world:{type:'string'},checkpoint:{type:'string'},from:{type:'string'},to:{type:'string'},
    'clock-id':{type:'string'},'clock-profile-digest':{type:'string'},actor:{type:'string',multiple:true},observer:{type:'string',multiple:true},
    'wall-from':{type:'string'},'wall-to':{type:'string'}}});
if(!v.workspace||!v.world||!v.checkpoint)throw new Error('Explicit --workspace, --world and --checkpoint required');
if(!!v['wall-from']!==!!v['wall-to'])throw new Error('Both independent provider wall boundaries required');
if(v.observer?.some(id=>!v.actor?.includes(id)))throw new Error('Observer must belong to selected actor export');
const workspace=resolve(v.workspace),native=nativeIntegrationOptions(workspace);
console.log(JSON.stringify(reportNativeOutcomes({fromSimulationTime:v.from??'',toSimulationTime:v.to??'',clockId:v['clock-id']??'',
    clockProfileDigest:v['clock-profile-digest']??'',actorAgentIds:v.actor??[]},{...native,workspace,worldId:v.world,
    checkpointPath:resolve(v.checkpoint),agentPath:join(workspace,'.local/agent-state/agents.sqlite'),tradePath:join(workspace,'server/engine/data/mods/trade-evidence.sqlite'),
    auditPath:join(workspace,'.local/admin/llm-audit.jsonl'),queuePath:join(workspace,'.local/admin/inference-queue.sqlite'),
    wallWindow:v['wall-from']?{from:v['wall-from'],to:v['wall-to']!}:undefined,
    allowedActorAgentIds:v.actor??[],allowedObserverAgentIds:v.observer??[]}),null,2));
