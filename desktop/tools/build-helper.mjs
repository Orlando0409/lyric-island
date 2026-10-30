// Publica el helper C# en resources/helper. Intenta Native AOT y, si falta el linker de C++,
// cae a self-contained + trimmed + single-file.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const project = join(import.meta.dirname, '..', '..', 'desktop-helper', 'LyricIsland.MediaHelper');
const out = join(import.meta.dirname, '..', 'resources', 'helper');
const base = ['publish', project, '-c', 'Release', '-r', 'win-x64', '-o', out, '-nologo'];
const run = (extra) => spawnSync('dotnet', [...base, ...extra], { stdio: 'inherit', shell: process.platform === 'win32' }).status;

if (run([]) === 0) {
  console.log('helper: Native AOT OK');
} else {
  console.warn('helper: Native AOT no disponible → self-contained + trimmed');
  const status = run(['-p:PublishAot=false', '-p:SelfContained=true', '-p:PublishTrimmed=true', '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true']);
  process.exit(status ?? 1);
}
