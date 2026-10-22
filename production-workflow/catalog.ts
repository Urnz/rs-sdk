import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductionWorkflowCatalog } from './types.js';
import { validateProductionWorkflowCatalog } from './catalog-definition.js';
export { productionWorkflowCatalogDigest, validateProductionWorkflowCatalog } from './catalog-definition.js';
export function loadProductionWorkflowCatalog(path: string): ProductionWorkflowCatalog {
    return validateProductionWorkflowCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
export function loadDefaultProductionWorkflowCatalog(): ProductionWorkflowCatalog {
    return loadProductionWorkflowCatalog(join(import.meta.dir, '..', 'config', 'production-workflows.json'));
}
