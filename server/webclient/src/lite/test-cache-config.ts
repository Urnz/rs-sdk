import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Test-only cache source: our local emulator, never the upstream public demo. */
export const LITE_TEST_ORIGIN = process.env.LITE_TEST_ORIGIN ?? 'http://localhost:8888';
export const LITE_TEST_CACHE = process.env.LITE_TEST_CACHE ?? join(tmpdir(), 'rs-sdk-local-lite-test-cache');
