import type { PropertyView } from './PropertyRuntime.js';

const numberFormat = new Intl.NumberFormat('en-GB');

export function formatPropertyRegisterLines(properties: PropertyView[]): string[] {
    const lines = [
        '@bla@Registered properties and their current ownership',
        ''
    ];

    for (const property of properties) {
        const owner = property.state.owner
            ? `${property.state.owner.kind} ${property.state.owner.id}`
            : 'Available';
        const colour = property.state.owner ? '@red@' : '@gre@';
        lines.push(
            `@dre@${property.displayName}`,
            `@bla@${property.location.region} - ${property.type}`,
            `@bla@Price: ${numberFormat.format(property.purchasePrice)} coins`,
            `${colour}Owner: ${owner}`,
            ''
        );
    }

    return lines.slice(0, 50);
}
