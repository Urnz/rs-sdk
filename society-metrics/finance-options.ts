import { join,resolve,basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { nativeIntegrationOptions } from './integration-sources.js';
import type { FinanceBoundaryPaths,NativeFinanceOptions } from './finance-sources.js';
/** CLI/backend configuration only; request parameters and uploaded JSON cannot choose source paths. */
export function nativeFinanceOptions(workspace:string,openingDirectory:string,closingDirectory:string):NativeFinanceOptions {
    const configuration=JSON.parse(readFileSync(join(workspace,'config/native-finance.json'),'utf8'));
    if(configuration.schemaVersion!==1)throw new Error('Unsupported native finance configuration');
    const select=(directory:string)=>{const root=resolve(directory),paths:FinanceBoundaryPaths={checkpointPath:join(root,'checkpoint.sqlite'),
        businessPath:join(root,'business.sqlite'),treasuryPath:join(root,'treasury.sqlite'),clockPath:join(root,'clock.sqlite'),needsPath:join(root,'needs.sqlite'),
        bankingPath:join(root,'banking.sqlite'),contractsPath:join(root,'contracts.sqlite'),tradePath:join(root,'trades.sqlite')};
        return{id:basename(root),paths};};
    return{native:nativeIntegrationOptions(workspace),opening:select(openingDirectory),closing:select(closingDirectory),
        basket:configuration.basket,maxPriceAgeSimulationMs:configuration.maxPriceAgeSimulationMs};
}
