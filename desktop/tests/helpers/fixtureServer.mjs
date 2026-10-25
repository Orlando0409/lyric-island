// LRCLIB falso servido desde shared/fixtures/lrclib-responses (integración, E2E y `pnpm dev:fake`).
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

export const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'shared', 'fixtures');

const fixtures = readdirSync(join(FIXTURES, 'lrclib-responses'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURES, 'lrclib-responses', f), 'utf8')));

export function resolveFixture(url) {
  const u = new URL(url, 'http://fixture');
  const path = u.pathname.replace(/^\/api/, '');
  const params = Object.fromEntries(u.searchParams);
  let route;
  if (path === '/get') route = 'get';
  else if (path === '/search') route = 'search';
  else if (path.startsWith('/get/')) {
    route = 'get-id';
    params.id = path.slice(5);
  } else return { status: 404, body: '{}' };
  const hit = fixtures.find((f) => f.route === route && Object.entries(f.match).every(([k, v]) => params[k] === v));
  if (!hit) return { status: route === 'search' ? 200 : 404, body: route === 'search' ? '[]' : '{"code":404}' };
  return { status: hit.status, body: hit.rawBody ?? JSON.stringify(hit.body) };
}

export function startFixtureServer(port = 0) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const r = resolveFixture(req.url ?? '/');
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(r.body);
    });
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, baseUrl: `http://127.0.0.1:${p}/api` });
    });
  });
}
