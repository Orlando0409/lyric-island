// Genera los fixtures compartidos (shared/fixtures) de forma determinista.
// Todas las letras son INVENTADAS para no redistribuir letras con derechos de autor.
// Uso: node tools/make-fixtures.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'fixtures');
const out = (rel, data) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};

// PRNG determinista (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ts = (ms, digits = 2) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = ms % 1000;
  const frac = digits === 0 ? '' : '.' + String(digits === 1 ? Math.floor(f / 100) : digits === 2 ? Math.floor(f / 10) : f).padStart(digits, '0');
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${frac}`;
};

// ---------------------------------------------------------------- LRC escritos a mano (casos de la tabla 8.3)
const handmade = {
  'basic.lrc': `[ar:Los Fixtures]
[ti:Isla de Luz]
[al:Pruebas Unitarias]
[length:03:30]

[00:12.34]Se enciende la isla sobre la ciudad
[00:16.10]Cada palabra brilla en su lugar
[00:20.00]Y la canción no deja de girar
[00:25.50]Seguimos el compás hasta el final
`,
  'all-cases.lrc': `[ar:Los Fixtures]
[ti:Todos los Casos]
[al:Pruebas Unitarias]
[length:05:54]
[offset:+150]

[00:12.34]Primera línea de prueba
[00:16.10]Segunda línea, con coma
[00:20.00][01:45.00]Línea repetida en dos momentos
[00:25.5]Fracción de un dígito
[00:30.123]Fracción de tres dígitos
[00:35]Sin fracción
[00:40.00]

[00:50.00]<00:50.00>Palabra <00:50.60>por <00:51.00>palabra
`,
  'bom-crlf.lrc': '﻿[ti:Con BOM]\r\n[00:01.00]Línea con BOM\r\n[00:03.00]Y saltos CRLF\r\n',
  'offset-negative.lrc': `[offset:-300]
[00:05.00]Desfase negativo
[00:09.00]La letra llega tarde
`,
  'offset-positive.lrc': `[offset:+500]
[00:05.00]Desfase positivo
[00:09.00]La letra llega antes
`,
  'unsorted.lrc': `[00:30.00]Tercera
[00:10.00]Primera
[00:20.00]Segunda
`,
  'long-minutes.lrc': `[00:10.00]Inicio de una pista larga
[75:10.00]Más de setenta y cinco minutos
[75:20.50]Final de la sesión
`,
  'invalid-tags.lrc': `[ab:cd]Etiqueta inválida
[00:99.00]Segundos imposibles
[00:05.00]Línea válida
texto suelto sin marca
[00:08.00]Otra válida
`,
  'empty.lrc': '',
  'only-meta.lrc': `[ar:Nadie]
[ti:Sin líneas]
`,
  'garbage.lrc': '\u0000\u0001\u0002PK\u0003\u0004ÿþ[[[]]]<<>>\n\u0007\u0008[00:xx.yy]\n',
  'enhanced.lrc': `[00:01.00]<00:01.00>Cada <00:01.50>palabra <00:02.20>tiene <00:02.80>su <00:03.00>tiempo<00:03.60>
[00:05.00]<00:05.00>Sin <00:05.40>marca <00:05.90>final
[00:09.00]Línea normal después
`,
  'cjk-japanese.lrc': `[00:02.00]夜空に光る島
[00:06.00]言葉が流れていく
[00:10.00]ひとつずつ、歌おう。
`,
  'cjk-chinese.lrc': `[00:01.00]海上的小岛在发光
[00:05.00]每一个字都在跳舞
`,
  'korean.lrc': `[00:01.00]밤하늘 위의 작은 섬
[00:05.00]노래가 계속 흐른다
`,
  'rtl-arabic.lrc': `[00:01.00]جزيرة صغيرة في الليل
[00:05.00]الكلمات تلمع ببطء
`,
  'rtl-hebrew.lrc': `[00:01.00]אי קטן בלילה
[00:05.00]המילים זורחות לאט
`,
  'emoji.lrc': `[00:01.00]La isla brilla ✨ y suena 🎵
[00:04.00]👨‍👩‍👧 familia de emojis
`,
  'long-line.lrc': `[00:01.00]${'una línea muy larga que no cabe en la isla y necesita marquee '.repeat(4).trim()}
[00:20.00]corta
`,
  'interludes.lrc': `[00:08.00]Empieza tarde, hay intro
[00:11.00]
[00:25.00]Vuelve la voz tras el solo
[00:28.00]Un verso corto
[00:45.00]Hueco largo sin línea vacía
`,
  'duplicate-times.lrc': `[00:05.00]Mismo instante A
[00:05.00]Mismo instante B
[00:09.00]Después
`,
  'colon-fraction.lrc': `[00:05:50]Fracción con dos puntos
[00:08:25]Formato alternativo
`,
  'single-word.lrc': `[00:03.00]Hola
[00:06.00]Adiós
`,
  'punctuation.lrc': `[00:02.00]Uno, dos, tres. Cuatro, cinco.
[00:08.00]Fin.
`,
  'spaces-tabs.lrc': `   [00:01.00]   Espacios alrededor
\t[00:04.00]\tCon tabulador\t
`,
  'unknown-meta.lrc': `[xx:desconocida]
[re:Editor X]
[ve:1.0]
[by:Alguien]
[au:Autor]
[#:comentario]
[00:01.00]Una línea
`,
  'last-line-short.lrc': `[00:01.00]Corta
[00:03.00]Al
`,
};
for (const [name, text] of Object.entries(handmade)) out(`lrc/${name}`, text);

// ---------------------------------------------------------------- LRC sintéticos (más volumen y variedad)
const bank = {
  es: ['la', 'isla', 'brilla', 'sobre', 'el', 'mar', 'canto', 'luz', 'noche', 'camino', 'corazón', 'ritmo', 'despacio', 'contigo', 'siempre', 'viento', 'calle', 'mañana', 'sueño', 'fuego', 'silencio', 'volver'],
  en: ['the', 'island', 'glows', 'over', 'city', 'lights', 'we', 'sing', 'along', 'tonight', 'slowly', 'falling', 'into', 'rhythm', 'again', 'forever', 'echo', 'river', 'golden', 'hours'],
};
const synthetic = [];
for (let i = 0; i < 22; i++) {
  const r = rng(1000 + i);
  const lang = i % 2 === 0 ? 'es' : 'en';
  const words = bank[lang];
  const digits = [2, 2, 3, 1, 0][i % 5];
  const nLines = 12 + Math.floor(r() * 18);
  let t = 2000 + Math.floor(r() * 15000);
  const lines = [`[ar:Artista Sintético ${i}]`, `[ti:Canción ${i}]`, `[length:0${3 + (i % 3)}:00]`];
  if (i % 7 === 3) lines.push(`[offset:${i % 2 ? '-' : '+'}${100 + i * 10}]`);
  for (let k = 0; k < nLines; k++) {
    const len = 2 + Math.floor(r() * 8);
    const text = Array.from({ length: len }, () => words[Math.floor(r() * words.length)]).join(' ');
    const punct = r() < 0.2 ? ',' : r() < 0.1 ? '.' : '';
    const empty = r() < 0.06;
    lines.push(`[${ts(t, digits)}]${empty ? '' : text.charAt(0).toUpperCase() + text.slice(1) + punct}`);
    t += 1500 + Math.floor(r() * 4500) + (r() < 0.08 ? 9000 : 0);
  }
  const name = `synthetic-${String(i).padStart(2, '0')}.lrc`;
  synthetic.push(name);
  out(`lrc/${name}`, lines.join('\n') + '\n');
}

// ---------------------------------------------------------------- Respuestas de LRCLIB grabadas (sintéticas)
const songLrc = (title) =>
  [`[00:04.00]${title}: la primera línea`, '[00:08.50]La isla cambia de color', '[00:13.00]Cada palabra se rellena', '[00:17.20]Y la siguiente espera abajo', '[00:21.00]', '[00:29.00]Vuelve el estribillo inventado', '[00:33.40]Hasta que termina la prueba'].join('\n');
const record = (id, trackName, artistName, albumName, duration, extra = {}) => ({
  id,
  name: trackName,
  trackName,
  artistName,
  albumName,
  duration,
  instrumental: false,
  plainLyrics: songLrc(trackName).replace(/\[[^\]]+\]/g, ''),
  syncedLyrics: songLrc(trackName),
  ...extra,
});
const wordsYaml = readFileSync(join(root, 'lyricsfile', 'basic-words.yaml'), 'utf8');
const responses = [
  { file: 'get-isla-de-luz.json', route: 'get', match: { track_name: 'Isla de Luz', artist_name: 'Los Fixtures' }, status: 200, body: record(1001, 'Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 210) },
  { file: 'get-ruta-norte.json', route: 'get', match: { track_name: 'Ruta Norte', artist_name: 'Banda Mock' }, status: 200, body: record(1002, 'Ruta Norte', 'Banda Mock', 'Kilómetro Cero', 185) },
  { file: 'get-plain-only.json', route: 'get', match: { track_name: 'Solo Texto', artist_name: 'Los Fixtures' }, status: 200, body: record(1003, 'Solo Texto', 'Los Fixtures', null, 200, { syncedLyrics: null }) },
  { file: 'get-instrumental.json', route: 'get', match: { track_name: 'Interludio Azul', artist_name: 'Cuarteto Stub' }, status: 200, body: record(1004, 'Interludio Azul', 'Cuarteto Stub', 'Sin Voz', 240, { instrumental: true, plainLyrics: null, syncedLyrics: null }) },
  { file: 'get-404.json', route: 'get', match: { track_name: 'No Existe', artist_name: 'Nadie' }, status: 404, body: { code: 404, name: 'TrackNotFound', message: 'Failed to find specified track' } },
  { file: 'get-429.json', route: 'get', match: { track_name: 'Muy Rápido', artist_name: 'Los Fixtures' }, status: 429, body: { code: 429, message: 'Too many requests' } },
  { file: 'get-500.json', route: 'get', match: { track_name: 'Servidor Roto', artist_name: 'Los Fixtures' }, status: 500, body: { code: 500, message: 'Internal error' } },
  { file: 'get-malformed.json', route: 'get', match: { track_name: 'JSON Roto', artist_name: 'Los Fixtures' }, status: 200, rawBody: '{"id": 12, "trackName": "JSON Roto", ' },
  { file: 'get-remastered-404.json', route: 'get', match: { track_name: 'Canción Vieja - Remastered 2011', artist_name: 'Banda Mock' }, status: 404, body: { code: 404 } },
  { file: 'get-remastered-normalized.json', route: 'get', match: { track_name: 'Canción Vieja', artist_name: 'Banda Mock' }, status: 200, body: record(1005, 'Canción Vieja', 'Banda Mock', 'Archivo', 199) },
  { file: 'get-feat-404.json', route: 'get', match: { track_name: 'Juntos (feat. Invitada)', artist_name: 'Banda Mock, Invitada' }, status: 404, body: { code: 404 } },
  { file: 'get-feat-normalized.json', route: 'get', match: { track_name: 'Juntos', artist_name: 'Banda Mock' }, status: 200, body: record(1006, 'Juntos', 'Banda Mock', 'Kilómetro Cero', 222) },
  { file: 'get-cjk.json', route: 'get', match: { track_name: '夜空の島', artist_name: 'テスト' }, status: 200, body: record(1007, '夜空の島', 'テスト', null, 180) },
  { file: 'get-unicode.json', route: 'get', match: { track_name: 'Corazón Áspero', artist_name: 'Ñandú' }, status: 200, body: record(1008, 'Corazón Áspero', 'Ñandú', 'Tildes', 190) },
  { file: 'search-live-only.json', route: 'search', match: { track_name: 'Escondida' }, status: 200, body: [record(2001, 'Escondida - Live', 'Banda Mock', 'En Vivo', 260), record(2002, 'Escondida', 'Banda Mock', 'Estudio', 201)] },
  { file: 'search-empty.json', route: 'search', match: { track_name: 'No Existe' }, status: 200, body: [] },
  { file: 'search-wrong-artist.json', route: 'search', match: { track_name: 'Lluvia' }, status: 200, body: [record(2003, 'Lluvia', 'Otro Artista Totalmente Distinto', null, 300)] },
  { file: 'search-duration-penalty.json', route: 'search', match: { track_name: 'Larga Versión' }, status: 200, body: [record(2004, 'Larga Versión', 'Los Fixtures', null, 420)] },
  { file: 'search-best-of-many.json', route: 'search', match: { track_name: 'Faro' }, status: 200, body: [record(2005, 'Faro (Remix)', 'DJ Prueba', null, 250), record(2006, 'Faro', 'Los Fixtures', 'Costa', 205, { syncedLyrics: null }), record(2007, 'Faro', 'Los Fixtures', 'Costa', 204)] },
  { file: 'search-malformed-items.json', route: 'search', match: { track_name: 'Basura' }, status: 200, body: [null, 7, { id: 'x' }, { trackName: 'sin id' }, record(2008, 'Basura', 'Los Fixtures', null, 100)] },
  { file: 'get-by-id.json', route: 'get-id', match: { id: '2007' }, status: 200, body: record(2007, 'Faro', 'Los Fixtures', 'Costa', 204) },
  // Tiempos por palabra (lyricsfile + hasWordSync): /get directo, y una canción cuya versión con palabras solo aparece en /search.
  { file: 'get-wordsync.json', route: 'get', match: { track_name: 'Palabra Exacta', artist_name: 'Los Fixtures' }, status: 200, body: record(3001, 'Palabra Exacta', 'Los Fixtures', 'Pruebas Unitarias', 40, { hasWordSync: true, lyricsfile: wordsYaml }) },
  { file: 'get-doble-version.json', route: 'get', match: { track_name: 'Doble Versión', artist_name: 'Banda Mock' }, status: 200, body: record(3002, 'Doble Versión', 'Banda Mock', 'Kilómetro Cero', 40) },
  {
    file: 'search-doble-version.json',
    route: 'search',
    match: { track_name: 'Doble Versión' },
    status: 200,
    body: [
      record(3004, 'Doble Versión', 'Banda Mock', 'Kilómetro Cero', 46, { hasWordSync: true, lyricsfile: wordsYaml }),
      record(3003, 'Doble Versión', 'Banda Mock', 'Kilómetro Cero', 41, { hasWordSync: true, lyricsfile: wordsYaml }),
      record(3002, 'Doble Versión', 'Banda Mock', 'Kilómetro Cero', 40),
    ],
  },
  // Canción en japonés (letra inventada) para ver el romaji en la isla.
  { file: 'get-japanese.json', route: 'get', match: { track_name: '星の歌', artist_name: 'テストバンド' }, status: 200, body: record(4001, '星の歌', 'テストバンド', 'テスト', 40, { syncedLyrics: ['[00:02.00]夜空に光る島を見ていた', '[00:07.00]君は「さよなら」と言った', '[00:12.00]ずっと待っていたんだ', '[00:17.00]明日も歌おう'].join('\n'), plainLyrics: null }) },
  { file: 'search-youtube.json', route: 'search', match: { track_name: 'Marea Alta' }, status: 200, body: [record(2009, 'Marea Alta', 'Banda Mock', null, 230)] },
];
for (const r of responses) out(`lrclib-responses/${r.file}`, JSON.stringify(r, null, 2) + '\n');

// ---------------------------------------------------------------- Sesiones grabadas (NDJSON: {"at": ms desde el inicio, "msg": ...})
const T0 = 1761340000000;
const track = (title, artist, album, durationMs, app = 'Spotify.exe', artworkFile = null) => ({
  v: 1,
  type: 'track',
  sourceAppId: app,
  title,
  artist,
  album,
  durationMs,
  artworkHash: null,
  ...(artworkFile ? { artworkFile } : {}),
});
const tl = (at, positionMs, status = 'playing', rate = 1) => ({ at, msg: { v: 1, type: 'timeline', positionMs, updatedAtMs: T0 + at, rate: status === 'playing' ? rate : 0, status } });
const ev = (at, msg) => ({ at, msg });
const sessions = {
  'normal-play.ndjson': [ev(0, { v: 1, type: 'hello', helperVersion: '0.1.0', os: '10.0.22631' }), ev(10, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 210000)), tl(20, 0), tl(15000, 14980)],
  'pause-resume.ndjson': [ev(0, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 210000)), tl(0, 0), tl(9000, 9000, 'paused'), tl(21000, 9000, 'playing')],
  'seek-forward.ndjson': [ev(0, track('Ruta Norte', 'Banda Mock', 'Kilómetro Cero', 185000)), tl(0, 0), tl(5000, 30000)],
  'seek-backward.ndjson': [ev(0, track('Ruta Norte', 'Banda Mock', 'Kilómetro Cero', 185000)), tl(0, 40000), tl(5000, 10000)],
  'repeat-one.ndjson': [ev(0, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 40000)), tl(0, 30000), tl(10000, 0)],
  'track-change.ndjson': [ev(0, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 210000)), tl(0, 0), ev(12000, track('Ruta Norte', 'Banda Mock', 'Kilómetro Cero', 185000)), tl(12000, 0)],
  'rate-1.5.ndjson': [ev(0, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 210000)), tl(0, 0, 'playing', 1.5)],
  'drift-small.ndjson': [ev(0, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 210000)), tl(0, 0), tl(10000, 10120)],
  'cleared.ndjson': [ev(0, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 210000)), tl(0, 0), ev(8000, { v: 1, type: 'cleared' })],
  'fullscreen.ndjson': [ev(0, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 210000)), tl(0, 0), ev(5000, { v: 1, type: 'fullscreen', active: true }), ev(9000, { v: 1, type: 'fullscreen', active: false })],
  'instrumental.ndjson': [ev(0, track('Interludio Azul', 'Cuarteto Stub', 'Sin Voz', 240000)), tl(0, 0)],
  'browser-youtube.ndjson': [ev(0, track('Banda Mock - Marea Alta', 'Banda Mock', null, 230000, 'chrome.exe')), tl(0, 0)],
  'stale-updated-at.ndjson': [ev(0, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 210000)), { at: 0, msg: { v: 1, type: 'timeline', positionMs: 5000, updatedAtMs: T0 + 60000, rate: 1, status: 'playing' } }],
  'e2e.ndjson': [
    ev(0, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 40000, 'Spotify.exe', 'artwork/art-012-gradient.png')),
    tl(10, 3500),
    tl(7000, 10490, 'paused'),
    tl(9000, 10490, 'playing'),
    ev(13000, { v: 1, type: 'fullscreen', active: true }),
    ev(14500, { v: 1, type: 'fullscreen', active: false }),
    ev(16000, { v: 1, type: 'cleared' }),
  ],
  'japanese.ndjson': [ev(0, track('星の歌', 'テストバンド', 'テスト', 40000, 'Spotify.exe', 'artwork/art-021-split.png')), tl(10, 2500)],
  'demo-loop.ndjson': [ev(0, { v: 1, type: 'hello', helperVersion: 'fake', os: 'fake' }), ev(50, track('Isla de Luz', 'Los Fixtures', 'Pruebas Unitarias', 40000, 'Spotify.exe', 'artwork/art-012-gradient.png')), tl(60, 0), tl(16000, 16000, 'paused'), tl(19000, 16000, 'playing'), ev(30000, track('Ruta Norte', 'Banda Mock', 'Kilómetro Cero', 40000, 'Spotify.exe', 'artwork/art-003-blobs.png')), tl(30010, 0)],
};
for (const [name, evs] of Object.entries(sessions)) out(`sessions/${name}`, evs.map((e) => JSON.stringify(e)).join('\n') + '\n');

// ---------------------------------------------------------------- Carátulas sintéticas (200 PNG de 64×64)
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const kinds = ['solid', 'split', 'gradient', 'blobs', 'noise', 'near-white', 'near-black', 'mono', 'checker', 'stripes'];
const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
for (let i = 0; i < 200; i++) {
  const r = rng(5000 + i);
  const col = () => [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)];
  const a = col();
  const b = col();
  const c = col();
  const kind = kinds[i % kinds.length];
  const pix = {
    solid: () => a,
    split: (x) => (x < 32 ? a : b),
    gradient: (x, y) => a.map((v, k) => clamp8(v + ((b[k] - v) * (x + y)) / 126)),
    blobs: (x, y) => ((x - 20) ** 2 + (y - 20) ** 2 < 200 ? b : (x - 44) ** 2 + (y - 40) ** 2 < 150 ? c : a),
    noise: () => [a, b, c][Math.floor(r() * 3)],
    'near-white': (x) => [clamp8(245 + (x % 10)), clamp8(245 + (x % 7)), 250],
    'near-black': (x) => [clamp8(x % 8), clamp8(x % 5), 6],
    mono: (x, y) => {
      const g = clamp8((x + y) * 2);
      return [g, g, g];
    },
    checker: (x, y) => (((x >> 3) + (y >> 3)) % 2 ? a : b),
    stripes: (x, y) => [a, b, c][Math.floor(y / 8) % 3],
  }[kind];
  out(`artwork/art-${String(i).padStart(3, '0')}-${kind}.png`, png(64, 64, pix));
}

console.log(`fixtures: ${Object.keys(handmade).length + synthetic.length} lrc, ${responses.length} lrclib, ${Object.keys(sessions).length} sesiones, 200 carátulas`);
