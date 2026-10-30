import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {loadIntegrationFixture} from '../society-integration/fixture.js';
import {inspectCommonFounderBaseline} from '../society-experiments/founder-baseline.js';
const {values}=parseArgs({options:{root:{type:'string'},fixture:{type:'string'}}}),root=resolve(values.root??resolve(import.meta.dir,'..'));
const fixture=loadIntegrationFixture(resolve(values.fixture??join(root,'config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json'))),
    report=await inspectCommonFounderBaseline(root,fixture);
console.log(JSON.stringify(report,null,2));process.exitCode=report.definitionComplete?0:2;
