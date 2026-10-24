import configuration from '../config/native-tool-work.json' with {type:'json'};
import repairDefinitions from '../config/item-repair-policies.json' with {type:'json'};
import workflowDefinitions from '../config/production-workflows.json' with {type:'json'};
import { validateItemRepairPolicyCatalog } from '../item-lifecycle/repair-policy.js';
import { nativeToolCatalog, nativeToolDigest } from '../item-lifecycle/native-tool.js';
import { validateProductionWorkflowCatalog } from './catalog-definition.js';
export const nativeRepairPolicies=validateItemRepairPolicyCatalog(repairDefinitions,nativeToolCatalog);
export const nativeRepairPolicy=nativeRepairPolicies.policies.find(policy=>policy.policyId===configuration.repair.policyId)!;
export const nativeSmeltRecipe=validateProductionWorkflowCatalog(workflowDefinitions).recipes.find(recipe=>
    recipe.recipeId===configuration.smelt.recipeId&&recipe.version===configuration.smelt.recipeVersion)!;
if(configuration.schemaVersion!==1||configuration.smelt.durationTicks!==3||!nativeRepairPolicy||!nativeSmeltRecipe
    ||nativeRepairPolicy.lifecycleTypeId!=='bronze-pickaxe'||nativeRepairPolicy.facility?.capabilityId!=='work-surface'
    ||JSON.stringify(nativeRepairPolicy.materials)!==JSON.stringify([{itemId:2349,quantity:1}])
    ||JSON.stringify(nativeSmeltRecipe.inputs)!==JSON.stringify([{itemId:436,quantity:1},{itemId:438,quantity:1}])
    ||JSON.stringify(nativeSmeltRecipe.outputs)!==JSON.stringify([{itemId:2349,quantity:1}]))throw new Error('Unsupported native tool work policy');
for(const source of [configuration.smelt.source,configuration.repair.source]){
    if(!source.debugName||![source.x,source.z].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=16383)
        ||!Number.isInteger(source.level)||source.level<0||source.level>3)throw new Error('Invalid native tool work location');
}
export const nativeToolWorkPolicy={...configuration,digest:nativeToolDigest({configuration,repair:nativeRepairPolicies.digest,smelt:nativeSmeltRecipe})};
export const TOOL_WORK_SKILLS={smelt:{id:'procedure.metallurgy.smelt-bronze',version:'1.0.0'},
    repair:{id:'procedure.tools.repair-bronze-pickaxe',version:'1.0.0'}} as const;
