import * as ts from 'typescript';
import { createHash } from 'node:crypto';

export interface SurfaceEvidence { id: string; file: string; kind: 'backend' | 'guard' | 'frontend'; text: string }
export interface Capability {
    id: string; title: string; area: string; route: string;
    backend: string[]; frontend: string[];
    methods: string[]; access: string; prerequisites: string; state: string; result: string; error: string;
    coverage: 'available' | 'missing' | 'infrastructure';
    roles: string[];
    operations: { method: string; path: string }[];
    entry: { page: string; selector: string; label: string } | null;
    gap: string | null;
}
export interface CapabilityMatrix {
    schemaVersion: number; version: string; reviewedAt: string;
    evidence: SurfaceEvidence[]; capabilities: Capability[];
    transports: { evidence: string; reason: string }[];
}

/** Independent source inventory. No handler, database or game worker is imported. */
export function discoverCapabilityEvidence(files: Record<string, string>): SurfaceEvidence[] {
    const result = new Map<string, SurfaceEvidence>();
    for (const [file, source] of Object.entries(files)) {
        const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        const printer = ts.createPrinter({ removeComments: true });
        function add(kind: SurfaceEvidence['kind'], node: ts.Node) {
            const text = printer.printNode(ts.EmitHint.Unspecified, node, tree).trim();
            const id = createHash('sha256').update(`${file}|${kind}|${text}`).digest('hex').slice(0, 24);
            result.set(id, { id, file, kind, text });
        }
        function visit(node: ts.Node) {
            if (!file.endsWith('.js')) {
                if (ts.isStringLiteral(node) && /^\/api\/(admin|control-plane)\/.+[^/]$/.test(node.text)) add('backend', node);
                if (ts.isRegularExpressionLiteral(node) && /api\\\/.*(admin|control-plane)/.test(node.text)) add('backend', node);
                if (ts.isIfStatement(node) && /\breq\.method\b/.test(node.expression.getText(tree))) add('guard', node.expression);
            } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
                && ['api', 'fetch', 'request', 'accountApi', 'lifecycleApi', 'observationApi', 'mutate'].includes(node.expression.text)) {
                // Capture method selection, URL templates and wrapper calls; ignore bodies/content.
                const argument = node.arguments[0];
                if (argument) {
                    let method: ts.Expression | undefined;
                    const options = node.arguments[1];
                    if (options && ts.isObjectLiteralExpression(options)) {
                        const property = options.properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText(tree) === 'method');
                        if (property && ts.isPropertyAssignment(property)) method = property.initializer;
                    }
                    const signature = ts.factory.createArrayLiteralExpression([ts.factory.createStringLiteral(node.expression.text), argument,
                        method ?? (node.expression.text === 'accountApi' ? node.arguments[2] ?? ts.factory.createStringLiteral(node.arguments[1] ? 'POST' : 'GET')
                            : ts.factory.createStringLiteral(node.expression.text === 'mutate' ? 'POST' : 'GET'))]);
                    add('frontend', signature);
                }
            }
            ts.forEachChild(node, visit);
        }
        visit(tree);
    }
    return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function frontendRequest(text: string) {
    const tree = ts.createSourceFile('request.js', text, ts.ScriptTarget.Latest, true);
    const statement = tree.statements[0];
    if (!statement || !ts.isExpressionStatement(statement) || !ts.isArrayLiteralExpression(statement.expression)) return null;
    const [client, argument, method] = statement.expression.elements;
    if (!client || !argument || !method || !ts.isStringLiteral(client) || !ts.isStringLiteral(method)) return null;
    const pathOf = (value: ts.Expression): string | null => {
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
        if (ts.isTemplateExpression(value)) return value.head.text + value.templateSpans.map(span => ':id' + span.literal.text).join('');
        if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const prefix = pathOf(value.left); return prefix === null ? null : prefix + ':id';
        }
        return null;
    };
    let path = pathOf(argument); if (path === null) return null;
    if (client.text === 'accountApi') path = '/api/control-plane/' + path;
    if (['lifecycleApi', 'mutate'].includes(client.text)) path = '/api/control-plane/servers' + path;
    return { method: method.text, path: path.split('?')[0]! };
}

function compatiblePaths(left: string, right: string) {
    const parts = left.split('/'), other = right.split('/');
    return parts.length === other.length && parts.every((part, index) => part.startsWith(':') || other[index]!.startsWith(':') || part === other[index]);
}

export function auditCapabilityMatrix(matrix: CapabilityMatrix, actual: SurfaceEvidence[]) {
    const problems: string[] = [];
    if (matrix.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(matrix.version)) problems.push('Unsupported matrix version');
    const known = new Map(matrix.evidence.map(item => [item.id, item]));
    const discovered = new Map(actual.map(item => [item.id, item]));
    if (known.size !== matrix.evidence.length) problems.push('Duplicate evidence');
    for (const item of actual) if (!known.has(item.id)) problems.push(`Unregistered ${item.kind}: ${item.file}: ${item.text}`);
    for (const item of actual) if (known.has(item.id) && JSON.stringify(known.get(item.id)) !== JSON.stringify(item)) problems.push(`Altered evidence: ${item.id}`);
    for (const item of matrix.evidence) if (!discovered.has(item.id)) problems.push(`Stale evidence: ${item.file}: ${item.text}`);
    const backend = new Set<string>(), frontend = new Set<string>(), ids = new Set<string>(), operations = new Set<string>();
    for (const transport of matrix.transports) {
        if (known.get(transport.evidence)?.kind !== 'frontend' || !transport.reason.trim()) problems.push(`Invalid transport: ${transport.evidence}`);
        frontend.add(transport.evidence);
    }
    for (const capability of matrix.capabilities) {
        if (ids.has(capability.id)) problems.push(`Duplicate capability: ${capability.id}`); ids.add(capability.id);
        for (const field of ['title', 'area', 'route', 'access', 'prerequisites', 'state', 'result', 'error'] as const)
            if (!capability[field]?.trim()) problems.push(`Missing ${field}: ${capability.id}`);
        if (!capability.backend.length || !capability.methods.length) problems.push(`No backend operation: ${capability.id}`);
        if (!capability.roles.length || capability.methods.some(method => !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))) problems.push(`Invalid permission/method: ${capability.id}`);
        if (!capability.operations.length) problems.push(`Missing operation variants: ${capability.id}`);
        for (const operation of capability.operations) {
            const key = `${operation.method} ${operation.path}`;
            if (operations.has(key) || !capability.methods.includes(operation.method) || !/^\/api\/(admin|control-plane)\//.test(operation.path)) problems.push(`Invalid/duplicate operation: ${key}`);
            operations.add(key);
        }
        for (const [list, kind, covered] of [[capability.backend, 'backend', backend], [capability.frontend, 'frontend', frontend]] as const)
            for (const id of list) {
                if (known.get(id)?.kind !== kind) problems.push(`Invalid ${kind} reference: ${capability.id}: ${id}`);
                covered.add(id);
            }
        if (capability.coverage === 'available' && (!capability.entry || !capability.frontend.length)) problems.push(`Unsupported UI claim: ${capability.id}`);
        if (capability.coverage !== 'available' && !capability.gap?.trim()) problems.push(`Unexplained gap: ${capability.id}`);
        if (capability.coverage === 'missing' && capability.entry) problems.push(`Missing UI has an execution entry: ${capability.id}`);
        for (const id of capability.frontend) {
            const request = frontendRequest(known.get(id)?.text ?? '');
            if (!request || !capability.operations.some(operation => operation.method === request.method && compatiblePaths(operation.path, request.path)))
                problems.push(`Frontend/backend mismatch: ${capability.id}: ${id}`);
        }
    }
    for (const item of actual) {
        if (item.kind === 'backend' && !backend.has(item.id)) problems.push(`Orphan backend: ${item.text}`);
        if (item.kind === 'frontend' && !frontend.has(item.id)) problems.push(`Orphan frontend: ${item.file}: ${item.text}`);
    }
    return { problems, gaps: matrix.capabilities.filter(item => item.coverage === 'missing').map(item => item.id) };
}
