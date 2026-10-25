// LRCLIB falso a partir de shared/fixtures/lrclib-responses (para integración y E2E).
import type { HttpGet } from '../../src/core/lyricsRepo';
import { resolveFixture } from './fixtureServer.mjs';

export { FIXTURES, resolveFixture, startFixtureServer } from './fixtureServer.mjs';

/** HttpGet que responde desde los fixtures y registra las URLs pedidas. */
export function fixtureHttp(log: string[] = []): HttpGet {
  return async (url) => {
    log.push(url);
    const r = resolveFixture(url);
    return { status: r.status, json: async () => JSON.parse(r.body) };
  };
}
