import { describe,expect,test } from 'bun:test';
import { decideFencingParticipation,loadDefaultFencingMarketPolicy,projectFencingMarket,
    type FencingCandidateSnapshot,type FencingOpportunity } from '../index.js';

const opportunity=(profit=20):FencingOpportunity=>({opportunityId:'stolen-pickaxe-offer',sellerAgentId:'thief',itemId:1265,
    quantity:1,assetId:'pickaxe-1',provenanceDigest:'c'.repeat(64),storageUnits:1,acquisitionCostGp:40,
    expectedResaleGp:40+10+profit,estimatedRiskCostGp:10,
    requiredCapabilities:['trade.appraise'],sourceEvidenceDigest:'a'.repeat(64)});
const candidate=(overrides:Partial<FencingCandidateSnapshot>={}):FencingCandidateSnapshot=>({candidateId:'buyer',kind:'agent',
    operatorAgentId:'buyer',lifecycleStatus:'active',availableGp:100,storageAvailableUnits:2,capabilities:['trade.appraise'],
    relationships:[{counterpartyAgentId:'thief',familiarity:60,trust:30}],sourceEvidenceDigest:'b'.repeat(64),...overrides});

describe('emergent fencing participation',()=>{
    test('uses finite capital, storage, capability and relationship snapshots without a Fence role',()=>{
        expect(decideFencingParticipation(loadDefaultFencingMarketPolicy(),candidate(),opportunity())).toMatchObject({
            participate:true,reason:'eligible-profitable',expectedProfitGp:20,committedCapitalGp:40});
        expect(decideFencingParticipation(loadDefaultFencingMarketPolicy(),candidate({availableGp:39}),opportunity()))
            .toMatchObject({participate:false,reason:'insufficient-funds',committedCapitalGp:0});
        expect(decideFencingParticipation(loadDefaultFencingMarketPolicy(),candidate({storageAvailableUnits:0}),opportunity()))
            .toMatchObject({participate:false,reason:'insufficient-storage'});
    });
    test.each(['deceased','imprisoned','insolvent','inactive'] as const)('removes %s candidates from supply',status=>{
        expect(projectFencingMarket(loadDefaultFencingMarketPolicy(),[candidate({lifecycleStatus:status})],opportunity()))
            .toEqual({opportunityId:'stolen-pickaxe-offer',availability:'unavailable',participants:[]})});
    test('allows profit to attract existing capable entrants but never creates a fallback service',()=>{
        const policy=loadDefaultFencingMarketPolicy(),marginal=candidate({candidateId:'marginal-buyer'});
        expect(projectFencingMarket(policy,[marginal],opportunity(4)).availability).toBe('unavailable');
        expect(projectFencingMarket(policy,[marginal],opportunity(25))).toMatchObject({availability:'available',
            participants:[{candidateId:'marginal-buyer'}]});expect(projectFencingMarket(policy,[],opportunity()).availability).toBe('unavailable')});
    test('requires learned counterparties and ordinary capabilities',()=>{
        const policy=loadDefaultFencingMarketPolicy();expect(decideFencingParticipation(policy,candidate({relationships:[]}),opportunity()))
            .toMatchObject({reason:'no-relationship'});expect(decideFencingParticipation(policy,candidate({capabilities:[]}),opportunity()))
            .toMatchObject({reason:'missing-capability'})});
});
