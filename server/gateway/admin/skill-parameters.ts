import type { SkillDefinition } from '../../../agent-skills/types.js';

export function validateAdminSkillParameters(
    definition: SkillDefinition,
    input: unknown
): Record<string, string | number | boolean> {
    if (input === null || input === undefined) input = {};
    if (typeof input !== 'object' || Array.isArray(input)) throw new Error('A skill paraméterei csak név–érték párok lehetnek.');
    const values = input as Record<string, unknown>;
    const unknown = Object.keys(values).filter(name => !(name in definition.parameters));
    if (unknown.length > 0) throw new Error(`Ismeretlen skill paraméter: ${unknown.join(', ')}`);

    const result: Record<string, string | number | boolean> = {};
    for (const [name, parameter] of Object.entries(definition.parameters)) {
        const supplied = values[name];
        const value = supplied ?? parameter.default;
        if (value === undefined) {
            if (parameter.required) throw new Error(`Hiányzó kötelező skill paraméter: ${name}`);
            continue;
        }
        if (parameter.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
            throw new Error(`${name}: szám szükséges.`);
        }
        if (parameter.type === 'string' && (typeof value !== 'string' || value.trim().length === 0 || value.length > 200)) {
            throw new Error(`${name}: 1–200 karakteres szöveg szükséges.`);
        }
        if (parameter.type === 'boolean' && typeof value !== 'boolean') {
            throw new Error(`${name}: logikai érték szükséges.`);
        }
        if (typeof value === 'number' && parameter.minimum !== undefined && value < parameter.minimum) {
            throw new Error(`${name}: legalább ${parameter.minimum} szükséges.`);
        }
        if (typeof value === 'number' && parameter.maximum !== undefined && value > parameter.maximum) {
            throw new Error(`${name}: legfeljebb ${parameter.maximum} lehet.`);
        }
        if (parameter.enum && !parameter.enum.some(option => Object.is(option, value))) {
            throw new Error(`${name}: az érték nincs az engedélyezett listában.`);
        }
        result[name] = value as string | number | boolean;
    }
    return result;
}
