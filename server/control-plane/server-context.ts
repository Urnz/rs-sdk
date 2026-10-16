import { IdentityError } from './identity-store.js';

export const serverContextHeader = 'x-control-server-id';
export function validServerContext(id: string | null): id is string {
    return !!id && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}
export function pageServerContext(url: URL) {
    const values = url.searchParams.getAll('serverId');
    if (values.length !== 1 || !validServerContext(values[0]!)) throw new IdentityError(400, 'SERVER_CONTEXT_REQUIRED', 'Válassz szervert a Saját szervereim oldalon.');
    return values[0]!;
}
export function requestServerContext(req: Request) {
    const id = req.headers.get(serverContextHeader);
    if (!validServerContext(id)) throw new IdentityError(400, 'SERVER_CONTEXT_REQUIRED', 'Minden admin API-kéréshez egyértelmű szerverkontextus szükséges.');
    const values = new URL(req.url).searchParams.getAll('serverId');
    if (values.length && (values.length !== 1 || values[0] !== id)) throw new IdentityError(409, 'SERVER_CONTEXT_MISMATCH', 'A kérés szerverkontextusa eltér a kiválasztott szervertől.');
    return id;
}
