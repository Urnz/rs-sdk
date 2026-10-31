import {validateIntegrationFixture,fixtureDefinitionDigest,type IntegrationFixture} from '../society-integration/fixture.js';

/** Separate trial input; the original C07 founder candidate is never changed or adopted from this world. */
export function founderProcedureTrialFixture(input:IntegrationFixture):IntegrationFixture{
    const fixture=validateIntegrationFixture(input);
    if(fixture.version!=='1.3.0'||fixture.survival?.mode!=='accelerated-test')throw Error('Founder procedure trials require the accelerated native-site travel fixture');
    const subject=fixture.avatars.find(a=>a.agentId===fixture.kitchen.courierAgentId)!;
    if(subject.tools.length)throw Error('Founder trial subject already has an unreviewed tool allocation');
    subject.position={x:3280,z:3365,level:0};
    subject.tools=[{itemId:1265,count:1},{itemId:2347,count:1},{itemId:436,count:2}];
    fixture.digest=fixtureDefinitionDigest(fixture);
    return validateIntegrationFixture(fixture);
}
