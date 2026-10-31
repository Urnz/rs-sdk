import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {inspectCommonFounderBaseline} from './founder-baseline.js';
import {check,fixtureDefinitionDigest,loadIntegrationFixture,validateIntegrationFixture,type IntegrationFixture} from '../society-integration/fixture.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';

/** New definition, never an in-place extension of a previously applied 1.3 world.
 * The existing bootstrap applies its one genesis through the normal audited adapter.
 */
export async function commonFounderStageFixture(root:string,input:IntegrationFixture):Promise<IntegrationFixture>{
    const source=validateIntegrationFixture(input),canonical=loadIntegrationFixture(join(root,'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json'));
    check(source.version==='1.3.0'&&source.digest===canonical.digest,'Common founder stage requires the unchanged original travel fixture');
    const spec=await inspectCommonFounderBaseline(root,source),packed=spec.housing.packedSiteProposal;
    check(spec.definitionComplete&&packed&&spec.procedures.every(p=>p.reviewed&&p.candidateDefinitionDigest===p.reviewed.definitionDigest),
        'Founder stage requires exact verified shared procedures and actual packed beds');
    const utility=spec.procedures.slice(source.skills.length);
    const body:IntegrationFixture={...structuredClone(source),version:'1.4.0',
        founderBaseline:{protocol:'si-c07-common-founder-stage-v1',sourceFixtureDigest:source.digest,specificationDigest:spec.digest,
            packedBedsDigest:digest(packed),beds:structuredClone(packed.proposedBeds)},
        skills:spec.procedures.map(p=>({id:p.id,version:p.version,definitionDigest:p.reviewed!.definitionDigest})),
        avatars:spec.founders.map(({requiredKnownSkills:_required,...a})=>({...a,
            knownSkills:[...a.knownSkills,...a.agentId===source.kitchen.courierAgentId?utility.map(p=>p.id):[]]})),
        housing:{...source.housing,maximumConcurrentTenants:3}};
    body.digest=fixtureDefinitionDigest(body);return validateIntegrationFixture(body);
}

/** Source-stage file is immutable evidence; it does not grant live-run authority. */
export function readFounderStageReceipt(root:string){
    const result=JSON.parse(readFileSync(join(root,'.local/simulation/founder-baseline-setup.json'),'utf8')),{digest:hash,...body}=result;
    check(result.protocol==='si-c07-common-founder-native-setup-v1'&&digest(body)===hash,'Founder native setup receipt differs');
    return result;
}
