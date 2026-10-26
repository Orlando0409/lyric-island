// Paquete MSIX para subir a la Microsoft Store (Partner Center). La Store lo firma: aquí va SIN firmar, con la
// identidad que Partner Center asignó al reservar el nombre (Administración de productos → Identidad del producto).
// Esos datos van en build/store-identity.json (no son secretos; ver build/store-identity.example.json).
// Uso: pnpm dist:store
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const IDENTITY_FILE = join(ROOT, 'build', 'store-identity.json');

if (!existsSync(IDENTITY_FILE)) {
  console.error(
    'Falta build/store-identity.json. En Partner Center → tu app → Administración de productos → Identidad del producto,\n' +
      'copiá Package/Identity/Name, Package/Identity/Publisher y Package/Properties/PublisherDisplayName\n' +
      '(formato en build/store-identity.example.json).',
  );
  process.exit(1);
}
const id = JSON.parse(readFileSync(IDENTITY_FILE, 'utf8'));
for (const k of ['identityName', 'publisher', 'publisherDisplayName']) {
  if (typeof id[k] !== 'string' || id[k].trim() === '' || id[k].includes('0000-0000')) {
    console.error(`build/store-identity.json: falta "${k}" (o sigue con el valor de ejemplo).`);
    process.exit(1);
  }
}
if (!/^CN=[0-9A-F-]{36}$/i.test(id.publisher)) console.warn(`Aviso: el publisher de la Store suele ser "CN=<GUID>"; se usa "${id.publisher}".`);

function windowsKit() {
  const base = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).filter((d) => /^10\.\d/.test(d)).sort().reverse();
  for (const v of versions) {
    const dir = join(base, v, 'x64');
    if (existsSync(join(dir, 'makeappx.exe'))) return dir;
  }
  return null;
}
const kit = windowsKit();
if (!kit) {
  console.error('Falta el Windows SDK (makeappx).');
  process.exit(1);
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: ROOT, env: { ...process.env, ELECTRON_BUILDER_WINDOWS_KITS_PATH: kit } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const q = (v) => `"${String(v).replace(/"/g, '\\"')}"`;
run('pnpm', ['exec', 'electron-vite', 'build']);
run('pnpm', [
  'exec',
  'electron-builder',
  '--win',
  'appx',
  '--publish',
  'never',
  `-c.appx.identityName=${q(id.identityName)}`,
  `-c.appx.publisher=${q(id.publisher)}`,
  `-c.appx.publisherDisplayName=${q(id.publisherDisplayName)}`,
  // Sin certificado configurado no se firma: la Store firma el paquete al publicarlo.
  `-c.appx.artifactName=${q('${productName}-${version}-store.${ext}')}`,
]);
const out = readdirSync(join(ROOT, 'dist')).find((f) => f.endsWith('-store.appx'));
if (out) {
  const msix = out.replace(/\.appx$/, '.msix');
  renameSync(join(ROOT, 'dist', out), join(ROOT, 'dist', msix));
  console.log(`Listo para Partner Center: dist/${msix}`);
}
