import { extname, join } from 'node:path';
import { adminPublicDir } from './paths.js';
const contentTypes: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

/** Shared static shell; importing this module opens no runtime database and starts no game loop. */
export async function serveAdminAsset(url: URL, worldMapOrigin: string): Promise<Response | null> {
    if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return null;
    if (url.pathname === '/admin') return Response.redirect(new URL('/admin/', url), 308);
    const relative = url.pathname === '/admin/' ? 'index.html' : url.pathname.slice('/admin/'.length);
    if (!/^[a-zA-Z0-9._-]+$/.test(relative)) return new Response('Not found', { status: 404 });
    const path = join(adminPublicDir, relative), file = Bun.file(path);
    if (!await file.exists()) return new Response('Not found', { status: 404 });
    const type = contentTypes[extname(path)] ?? 'text/html; charset=utf-8';
    return new Response(file, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${worldMapOrigin}; frame-ancestors 'none'` } });
}
