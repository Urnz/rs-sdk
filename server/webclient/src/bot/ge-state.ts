import type { GEState } from '../../../../sdk/ge-types.js';
interface Component {
    clientCode: number;
    text: string | null;
    children: number[] | null;
}
/** Reads an atomic server snapshot, never reconstructs offers from labels or cached inventory icons. */
export function collectGEState(list: Component[], root: number): GEState | null {
    if (root < 0) return null;
    const scan = (id: number, depth = 0): GEState | null => {
        const c = list[id];
        if (!c || depth > 12) return null;
        if (c.clientCode === 30403) {
            try {
                const s = JSON.parse(c.text ?? '') as GEState;
                return s.isOpen === true &&
                    Number.isSafeInteger(s.session) &&
                    Number.isSafeInteger(s.revision) &&
                    Number.isSafeInteger(s.actionRevision) &&
                    Array.isArray(s.offers) &&
                    s.controls
                    ? s
                    : null;
            } catch {
                return null;
            }
        }
        for (const child of c.children ?? []) {
            const state = scan(child, depth + 1);
            if (state) return state;
        }
        return null;
    };
    return scan(root);
}
