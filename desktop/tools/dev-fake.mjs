// Desarrollo sin .NET ni Spotify: helper falso (sesión grabada) + LRCLIB falso local.
// Uso: pnpm dev:fake [ruta/a/sesion.ndjson]
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { startFixtureServer } from '../tests/helpers/fixtureServer.mjs';

const session = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', 'shared', 'fixtures', 'sessions', 'demo-loop.ndjson'));
const { server, baseUrl } = await startFixtureServer();
console.log(`LRCLIB falso en ${baseUrl} · sesión ${session}`);
const mode = process.env.LYRICISLAND_PREVIEW === '1' ? 'preview' : 'dev';
const child = spawn('pnpm', ['exec', 'electron-vite', mode], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, LYRICISLAND_FAKE_HELPER: session, LYRICISLAND_LRCLIB_BASE: baseUrl },
});
child.on('exit', (code) => {
  server.close();
  process.exit(code ?? 0);
});
