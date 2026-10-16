import { IdentityStore, identityPath } from './identity-store.js';

// Deliberately no password argument/environment fallback: credentials arrive over stdin only.
let store: IdentityStore | undefined;
try {
    const input = await Bun.stdin.text();
    if (Buffer.byteLength(input) > 8192) throw new Error();
    const data = JSON.parse(input) as { username: unknown; password: unknown };
    store = new IdentityStore(identityPath());
    await store.createAccount(data.username, data.password);
    console.log('Az első tulajdonosi fiók elkészült. Jelentkezz be az adminfelületen.');
}
catch { console.error('A fiók nem hozható létre. Ellenőrizd a név/jelszó szabályait; az első fiók csak egyszer hozható létre.'); process.exitCode = 1; }
finally { store?.close(); }
