// Empaqueta y FIRMA el instalador NSIS, el helper y el MSIX con el certificado autofirmado de LyricIsland
// (creado con tools/make-codesign-cert.ps1 en Cert:\CurrentUser\My). Usa signtool y makeappx del Windows SDK.
// El Subject del certificado va en build/codesign.local.json ({ "subject": "CN=…, O=…" }, no se sube al repositorio)
// o en la variable LYRICISLAND_CERT_SUBJECT.
// Uso: pnpm dist:signed
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL = join(import.meta.dirname, '..', 'build', 'codesign.local.json');
const PUBLISHER = // debe coincidir EXACTO con el Subject del certificado
  process.env.LYRICISLAND_CERT_SUBJECT ?? (existsSync(LOCAL) ? JSON.parse(readFileSync(LOCAL, 'utf8')).subject : 'CN=LyricIsland');
const SUBJECT_CN = /CN=([^,]+)/.exec(PUBLISHER)?.[1]?.trim() ?? 'LyricIsland';

function windowsKit() {
  const base = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).filter((d) => /^10\.\d/.test(d)).sort().reverse();
  for (const v of versions) {
    const dir = join(base, v, 'x64');
    if (existsSync(join(dir, 'signtool.exe')) && existsSync(join(dir, 'makeappx.exe'))) return dir;
  }
  return null;
}

const kit = windowsKit();
if (!kit) {
  console.error('Falta el Windows SDK (signtool + makeappx).');
  process.exit(1);
}
const certCheck = spawnSync(
  'powershell',
  ['-NoProfile', '-Command', `@(Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert | Where-Object { $_.Subject -eq '${PUBLISHER}' -and $_.NotAfter -gt (Get-Date) }).Count`],
  { encoding: 'utf8' },
);
if (Number(certCheck.stdout.trim()) < 1) {
  console.error('No hay certificado de firma. Ejecutá: powershell -ExecutionPolicy Bypass -File tools/make-codesign-cert.ps1');
  process.exit(1);
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, SIGNTOOL_PATH: join(kit, 'signtool.exe'), ELECTRON_BUILDER_WINDOWS_KITS_PATH: kit },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('pnpm', ['exec', 'electron-vite', 'build']);
run('pnpm', [
  'exec',
  'electron-builder',
  '--win',
  'nsis',
  'appx',
  '--publish',
  'never',
  `-c.win.signtoolOptions.certificateSubjectName="${SUBJECT_CN}"`,
  `-c.win.signtoolOptions.publisherName="${SUBJECT_CN}"`,
  `-c.appx.publisher="${PUBLISHER}"`,
]);
console.log('Firmado. Para que una PC confíe en él: tools/trust-codesign-cert.ps1 (como administrador).');
