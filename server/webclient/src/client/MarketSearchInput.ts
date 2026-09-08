// rs-sdk native GE search. Codes live in grand_exchange.if; component IDs stay pack-owned.
export const SEARCH_FIELD = 30400;
export const SEARCH_CLEAR = 30401;
export const SEARCH_ACK = 30402;
export const RESULT_BUTTON = 30410;
export const RESULT_ICON = 30440;
export const SEARCH_PLACEHOLDER = 'Type a name or alias...';
export interface SearchComponent {
    id: number;
    clientCode: number;
    type: number;
    hide: boolean;
    children: number[] | null;
    text: string | null;
    linkObjType?: (number[] | Int32Array | Uint16Array) | null;
}
export function visibleSearchComponent(list: SearchComponent[], root: number, code: number): SearchComponent | undefined {
    const visit = (id: number, depth: number): SearchComponent | undefined => {
        const c = list[id];
        if (!c || depth > 12 || (c.type === 0 && c.hide)) return;
        if (c.clientCode === code) return c;
        for (const child of c.children ?? []) {
            const found = visit(child, depth + 1);
            if (found) return found;
        }
    };
    return visit(root, 0);
}
export function displayedSearchItem(list: SearchComponent[], root: number, id: number): { query: string; item: number } | undefined {
    const c = list[id];
    if (!c) return;
    const index = c.clientCode - RESULT_BUTTON;
    if (index < 0 || index >= 12 || !visibleSearchComponent(list, root, SEARCH_FIELD)) return;
    const icon = visibleSearchComponent(list, root, RESULT_ICON + index);
    const item = (icon?.linkObjType?.[0] ?? 0) - 1;
    const ack = visibleSearchComponent(list, root, SEARCH_ACK);
    if (item > 0 && ack) return { query: ack.text ?? '', item };
}
/** Poll-driven debounce means closing/logging out leaves no timer that can send later. */
export class MarketSearchInput {
    private field: SearchComponent | undefined;
    private list: SearchComponent[] = [];
    private root = -1;
    private query = '';
    private dirty = false;
    private changed = 0;
    constructor(
        private readonly send: (query: string, item: number) => void,
        private readonly close: () => void
    ) {}
    sync(list: SearchComponent[], root: number, disabled = false, now = Date.now()) {
        const field = disabled ? undefined : visibleSearchComponent(list, root, SEARCH_FIELD);
        if (!field) {
            this.field = undefined;
            this.dirty = false;
            this.root = -1;
            return;
        }
        this.list = list;
        this.root = root;
        if (!this.field) {
            const receipt = visibleSearchComponent(list, root, SEARCH_ACK);
            this.query = receipt?.text ?? (field.text === SEARCH_PLACEHOLDER ? '' : (field.text ?? ''));
            this.dirty = false;
        }
        this.field = field;
        if (this.dirty && now - this.changed >= 180) this.flush();
        this.paint();
    }
    private paint() {
        if (this.field) this.field.text = this.query ? (this.query.length > 32 ? '...' + this.query.slice(-32) : this.query) + '*' : SEARCH_PLACEHOLDER;
    }
    private flush() {
        if (this.field && this.dirty) {
            this.send(this.query, 0);
            this.dirty = false;
        }
    }
    /** Explicit bot search shares the keyboard's query, receipt and selection state. */
    setQuery(query: string): boolean {
        if (!this.field || !/^[a-zA-Z0-9 '()*-]{0,48}$/.test(query)) return false;
        this.query = query;
        this.dirty = true;
        this.flush();
        this.paint();
        return true;
    }
    key(key: number, now = Date.now()): boolean {
        if (!this.field) return false;
        if (key === 27) {
            this.close();
            this.field = undefined;
            this.dirty = false;
            return true;
        }
        if (key === 10 || key === 13) {
            this.flush();
            return true;
        }
        let next = this.query;
        if (key === 8 || key === 127) next = next.slice(0, -1);
        else if (key >= 32 && key <= 126 && /^[a-zA-Z0-9 '()*-]$/.test(String.fromCharCode(key)) && next.length < 48) next += String.fromCharCode(key);
        if (next !== this.query) {
            this.query = next;
            this.dirty = true;
            this.changed = now;
            this.paint();
        }
        // Typing into the search must never leak into public chat.
        return true;
    }
    click(id: number): boolean {
        if (!this.field) return false;
        const code = this.list[id]?.clientCode;
        if (code === SEARCH_FIELD) return true;
        if (code === SEARCH_CLEAR) {
            this.query = '';
            this.dirty = true;
            this.flush();
            this.paint();
            return true;
        }
        const selected = displayedSearchItem(this.list, this.root, id);
        if (code >= RESULT_BUTTON && code < RESULT_BUTTON + 12) {
            this.flush();
            if (selected && selected.query === this.query) this.send(selected.query, selected.item);
            return true;
        }
        this.flush();
        return false;
    }
}
