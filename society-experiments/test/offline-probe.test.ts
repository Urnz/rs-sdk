import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Mock OS discovery only. The production script remains the executed decision maker, with no live process changes.
function probe(setup: string) {
    const script = resolve(import.meta.dir, '../../scripts/assert-society-offline.ps1').replaceAll("'", "''");
    const command = `function Get-NetTCPConnection { @() }
function Get-CimInstance { @() }
function Test-Path { $false }
${setup}
& '${script}' -Root 'C:\\society-probe' -CallerPid 987654`;
    return Bun.spawnSync(['pwsh', '-NoProfile', '-Command', command], { stdout: 'pipe', stderr: 'pipe' });
}
test('offline probe accepts no writers and excludes its calling process', () => {
    expect(probe('').exitCode).toBe(0);
    expect(probe("function Get-CimInstance { @([pscustomobject]@{ProcessId=987654;Name='bun.exe';CommandLine='C:\\society-probe\\writer.ts'}) }").exitCode).toBe(0);
});
test('offline probe refuses a local listener and a known writer even with a relative command', () => {
    const listener = probe('function Get-NetTCPConnection { @([pscustomobject]@{LocalPort=7780}) }');
    expect(listener.exitCode).not.toBe(0); expect(listener.stderr.toString()).toContain('listener');
    const writer = probe("function Get-CimInstance { @([pscustomobject]@{ProcessId=123;Name='bun.exe';CommandLine='bun server/gateway/gateway.ts'}) }");
    expect(writer.exitCode).not.toBe(0); expect(writer.stderr.toString()).toContain('writer');
    const managed = probe("function Get-CimInstance { @([pscustomobject]@{ProcessId=123;Name='bun.exe';CommandLine='bun server/control-plane/managed-worker.ts'}) }");
    expect(managed.exitCode).not.toBe(0); expect(managed.stderr.toString()).toContain('writer');
});
test('offline probe fails closed when OS discovery fails', () => {
    const result = probe("function Get-CimInstance { throw 'discovery unavailable' }");
    expect(result.exitCode).not.toBe(0); expect(result.stderr.toString()).toContain('discovery unavailable');
});
