// Genera los íconos (cápsula "isla" con degradado) sin dependencias: resources/tray.png y build/icon.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) raw.set(pixel(x + 0.5, y + 0.5), y * (width * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Cápsula centrada en un lienzo de width × height (la cápsula se dimensiona con el lado menor). */
function icon(width, height = width) {
  const size = Math.min(width, height);
  const h = size * 0.46;
  const w = size * 0.92;
  const r = h / 2;
  const cx = width / 2;
  const cy = height / 2;
  return png(width, height, (x, y) => {
    // distancia con signo a una cápsula (rectángulo redondeado)
    const qx = Math.abs(x - cx) - (w / 2 - r);
    const qy = Math.abs(y - cy) - (h / 2 - r);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    const a = Math.max(0, Math.min(1, 0.5 - d));
    const t = (x - (cx - w / 2)) / w;
    let [R, G, B] = [Math.round(88 + 120 * t), Math.round(54 + 30 * t), Math.round(180 - 40 * t)];
    // tres barras de ecualizador blancas a la derecha
    const bar = Math.floor((x - (cx + w * 0.18)) / (size * 0.07));
    const inBar = bar >= 0 && bar < 3 && ((x - (cx + w * 0.18)) % (size * 0.07)) < size * 0.045;
    const barH = [0.5, 0.8, 0.35][bar] * h * 0.6;
    if (inBar && Math.abs(y - cy) < barH / 2) [R, G, B] = [255, 255, 255];
    // punto (carátula) a la izquierda
    if (Math.hypot(x - (cx - w * 0.28), y - cy) < h * 0.28) [R, G, B] = [255, 255, 255];
    return [R, G, B, Math.round(a * 255)];
  });
}

const root = join(import.meta.dirname, '..');
mkdirSync(join(root, 'resources'), { recursive: true });
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'resources', 'tray.png'), icon(32));
writeFileSync(join(root, 'build', 'icon.png'), icon(256));
// Logos del paquete MSIX (electron-builder los toma de build/appx).
mkdirSync(join(root, 'build', 'appx'), { recursive: true });
for (const [name, w, h] of [
  ['StoreLogo.png', 50, 50],
  ['Square44x44Logo.png', 44, 44],
  ['Square150x150Logo.png', 150, 150],
  ['Wide310x150Logo.png', 310, 150],
  ['LargeTile.png', 310, 310],
  ['SmallTile.png', 71, 71],
]) {
  writeFileSync(join(root, 'build', 'appx', name), icon(w, h));
}
console.log('íconos generados');
