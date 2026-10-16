import { describe, expect, test } from 'bun:test';

import { BotSDK } from '../index.js';

describe('authenticated witness-report SDK client', () => {
    test('lists only typed observations for the authenticated avatar without credentials in the URL', async () => {
        const observations: Awaited<ReturnType<BotSDK['listWitnessObservations']>> = [{ eventId: 'event-1', observationId: 'observation-1', caseId: 'case-1',
            sourceCaseEventId: 'discovery-1', procedureKind: 'pickpocket',
            occurredAt: '2030-01-01T10:00:00.000Z', facts: ['A person was noticed pickpocketing an NPC.'],
            observerKind: 'player-only' }];
        const observed: unknown[] = [];
        const server = Bun.serve({ port: 0, fetch(req) {
            const url = new URL(req.url);
            observed.push({ method: req.method, path: url.pathname, search: url.search,
                auth: req.headers.get('authorization') });
            return Response.json({ observations });
        } });
        try {
            const sdk = new BotSDK({ botUsername: 'witness1', password: 'private-pass',
                gatewayUrl: `ws://localhost:${server.port}/gateway?password=do-not-forward`, autoLaunchBrowser: false });
            expect(await sdk.listWitnessObservations()).toEqual(observations);
            expect(observed).toEqual([{ method: 'GET', path: '/crime/observations/witness1', search: '',
                auth: 'Bearer private-pass' }]);
        } finally { server.stop(true); }
    });

    test('observation listing rejects malformed responses, server failures and missing passwords', async () => {
        let status = 409;
        const server = Bun.serve({ port: 0, fetch() { return status === 409
            ? Response.json({ error: 'Witness observations could not be verified' }, { status })
            : Response.json({ observations: [{ eventId: 'event-1' }] }); } });
        try {
            const config = { botUsername: 'witness1', gatewayUrl: server.url.origin, autoLaunchBrowser: false };
            const sdk = new BotSDK({ ...config, password: 'private-pass' });
            await expect(sdk.listWitnessObservations()).rejects.toThrow('could not be verified');
            status = 200;
            await expect(sdk.listWitnessObservations()).rejects.toThrow('invalid witness observations');
            await expect(new BotSDK(config).listWitnessObservations()).rejects.toThrow('require a player password');
        } finally { server.stop(true); }
    });

    test('recognition sends only a selected visible slot and event through bearer authentication', async () => {
        const commandId = '00000000-0000-4000-8000-000000000001';
        const receipt = { recognitionId: commandId, observationId: 'recognition:1',
            caseId: 'case-1', sourceCaseEventId: 'discovery-1' };
        const observed: unknown[] = [];
        const server = Bun.serve({ port: 0, async fetch(req) {
            const url = new URL(req.url);
            observed.push({ path: url.pathname, search: url.search, auth: req.headers.get('authorization'), body: await req.json() });
            return Response.json({ recognition: receipt });
        } });
        try {
            const sdk = new BotSDK({ botUsername: 'witness1', password: 'private-pass',
                gatewayUrl: `ws://localhost:${server.port}/gateway?password=do-not-forward`, autoLaunchBrowser: false });
            expect(await sdk.recognizeWitness('event-1', 42, commandId)).toEqual(receipt);
            expect(observed).toEqual([{ path: '/crime/recognize/witness1', search: '', auth: 'Bearer private-pass',
                body: { commandId, eventId: 'event-1', targetPlayerSlot: 42 } }]);
            await expect(sdk.recognizeWitness('../event', 42, commandId)).rejects.toThrow('invalid');
            await expect(sdk.recognizeWitness('event-1', -1, commandId)).rejects.toThrow('invalid');
            await expect(sdk.recognizeWitness('event-1', 42, 'bad-command')).rejects.toThrow('invalid');
            expect(observed).toHaveLength(1);
        } finally { server.stop(true); }
    });

    test('recognition refuses malformed or rejected receipts and missing player password', async () => {
        let status = 409;
        const server = Bun.serve({ port: 0, fetch() { return Response.json(status === 409
            ? { error: 'Recognition rejected' } : { recognition: { recognitionId: 'only-one-field' } }, { status }); } });
        try {
            const config = { botUsername: 'witness1', gatewayUrl: server.url.origin, autoLaunchBrowser: false };
            const sdk = new BotSDK({ ...config, password: 'private-pass' });
            await expect(sdk.recognizeWitness('event-1', 42)).rejects.toThrow('rejected');
            status = 200;
            await expect(sdk.recognizeWitness('event-1', 42)).rejects.toThrow('invalid witness recognition receipt');
            await expect(new BotSDK(config).recognizeWitness('event-1', 42)).rejects.toThrow('requires a player password');
        } finally { server.stop(true); }
    });

    test('uses bearer authentication and a bounded typed request without leaking credentials into the URL', async () => {
        const observed: Array<{ pathname: string; search: string; auth: string | null;
            body: unknown; method: string }> = [];
        const server = Bun.serve({ port: 0, async fetch(req) {
            const url = new URL(req.url);
            observed.push({ pathname: url.pathname, search: url.search,
                auth: req.headers.get('authorization'), body: await req.json(), method: req.method });
            return Response.json({ report: { reportId: 'report-123' } });
        } });
        try {
            const sdk = new BotSDK({ botUsername: 'witness1', password: 'private-pass',
                gatewayUrl: `ws://localhost:${server.port}/gateway?password=do-not-forward`,
                autoLaunchBrowser: false });
            expect(await sdk.fileWitnessReport('case-1', 'discovery-1')).toBe('report-123');
            expect(observed).toEqual([{ pathname: '/crime/report/witness1', search: '',
                auth: 'Bearer private-pass', body: { caseId: 'case-1', sourceCaseEventId: 'discovery-1' },
                method: 'POST' }]);
            await expect(sdk.fileWitnessReport('../other', 'discovery-1')).rejects.toThrow('invalid');
        } finally { server.stop(true); }
    });

    test('rejects server failure or a malformed receipt and never sends without a password', async () => {
        let status = 409;
        const server = Bun.serve({ port: 0, fetch() {
            return status === 409 ? Response.json({ error: 'Witness report could not be verified' },
                { status }) : Response.json({ report: { reportId: 123 } });
        } });
        try {
            const config = { botUsername: 'witness1', gatewayUrl: server.url.origin,
                autoLaunchBrowser: false };
            const sdk = new BotSDK({ ...config, password: 'private-pass' });
            await expect(sdk.fileWitnessReport('case-1', 'discovery-1'))
                .rejects.toThrow('could not be verified');
            status = 200;
            await expect(sdk.fileWitnessReport('case-1', 'discovery-1'))
                .rejects.toThrow('invalid witness report receipt');
            const missingPassword = new BotSDK(config);
            await expect(missingPassword.fileWitnessReport('case-1', 'discovery-1'))
                .rejects.toThrow('requires a player password');
        } finally { server.stop(true); }
    });
});
