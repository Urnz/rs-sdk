export interface DependencyQuery {
    from: string; to: string; basis: 'wall' | 'simulation'; clockId?: string; clockProfileDigest?: string;
}
export interface DependencyOptions { enginePath: string; productionPath: string; agentPath: string; clockPath: string }
export interface GraphNode {
    id: string; kind: 'agent' | 'actor-reference' | 'business' | 'player' | 'product' | 'event' | 'wip-lot'; label: string;
    metadata: Record<string, unknown>;
}
export interface GraphEdge {
    id: string; from: string; to: string; relation: 'supplied' | 'received' | 'product-type' | 'production-business'
        | 'production-run-actor' | 'produced-wip' | 'consumed-wip'; itemId: number | null; quantity: number | null;
    unit: 'item-units' | 'gp' | null; evidenceId: string;
}
export interface GraphEvidence { id: string; channel: 'engine-trade' | 'business-production'; recordId: string; digest: string;
    wallTime: string; simulationTime: string | null; nativeSequence: number; selected: boolean; issues: string[] }
