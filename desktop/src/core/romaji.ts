// Romaji (Hepburn) para letras en japonés. Puro: el análisis morfológico (lecturas de los kanji) lo hace
// kuromoji en cada plataforma y llega aquí como tokens. Puerto 1:1 en android/core (Romaji.kt).
import type { LyricLine, LyricsDocument } from './types';

/** Token de un analizador morfológico (kuromoji, diccionario IPADIC). */
export interface JaToken {
  surface: string;
  /** Lectura en katakana; null si el analizador no la conoce (latín, números, desconocidas). */
  reading: string | null;
  /** Categoría gramatical (品詞) y su primera subdivisión (品詞細分類1). */
  pos: string;
  posDetail: string;
}

const MONO: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
};

const DI: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo', りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  // katakana extendido (préstamos)
  しぇ: 'she', じぇ: 'je', ちぇ: 'che', いぇ: 'ye',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', ふゅ: 'fyu',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du', てゅ: 'tyu', でゅ: 'dyu',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
};

const PUNCT: Record<string, string> = {
  '、': ',', '。': '.', '！': '!', '？': '?', '「': '"', '」': '"', '『': '"', '』': '"', '（': '(', '）': ')',
  '・': ' ', '　': ' ', '～': '~', '〜': '~', '…': '...', '，': ',', '．': '.', '：': ':', '；': ';',
};

const isKana = (cp: number) => (cp >= 0x3041 && cp <= 0x3096) || (cp >= 0x30a1 && cp <= 0x30fa) || cp === 0x30fc;
const isHan = (cp: number) => (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || cp === 0x3005;

export function containsKana(text: string): boolean {
  for (const ch of text) if (isKana(ch.codePointAt(0)!)) return true;
  return false;
}

export function containsJapanese(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isKana(cp) || isHan(cp)) return true;
  }
  return false;
}

/** Katakana → hiragana (la ー se conserva). */
function toHiragana(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += cp >= 0x30a1 && cp <= 0x30f6 ? String.fromCodePoint(cp - 0x60) : ch;
  }
  return out;
}

const VOWELS = 'aeiou';

/** Kana (hiragana o katakana) → romaji Hepburn. Lo que no es kana pasa tal cual (puntuación japonesa → ASCII). */
export function kanaToRomaji(kana: string): string {
  const chars = [...toHiragana(kana)];
  let out = '';
  let geminate = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === 'っ') {
      geminate = true;
      continue;
    }
    if (c === 'ー') {
      const last = out.at(-1);
      if (last && VOWELS.includes(last)) out += last;
      continue;
    }
    let syl: string | undefined;
    const pair = c + (chars[i + 1] ?? '');
    if (DI[pair]) {
      syl = DI[pair];
      i++;
    } else syl = MONO[c];
    if (syl === undefined) {
      geminate = false;
      out += PUNCT[c] ?? c;
      continue;
    }
    if (geminate) {
      out += syl.startsWith('ch') ? 't' : VOWELS.includes(syl[0]) ? '' : syl[0];
      geminate = false;
    }
    out += syl;
  }
  return out;
}

/** Tokens que se pegan a la palabra anterior (auxiliares, sufijos, て/で/ば conjuntivos). */
function attachesToPrevious(t: JaToken): boolean {
  if (t.pos === '助動詞') return true;
  if (t.posDetail === '非自立' || t.posDetail === '接尾') return true;
  return t.pos === '助詞' && t.posDetail === '接続助詞' && (t.surface === 'て' || t.surface === 'で' || t.surface === 'ば');
}

/** Partículas que en Hepburn se escriben como se pronuncian. */
const PARTICLES: Record<string, string> = { は: 'wa', へ: 'e', を: 'o' };
const OPENING = new Set(['「', '『', '（', '(']);
const CLOSING = new Set(['」', '』', '）', ')', '、', '。', '！', '？', '!', '?', ',', '.', '…', '～', '〜', '：', '；', '，', '．']);

interface Group {
  kana: string;
  japanese: boolean;
  particle: string | null;
  opening: boolean;
  closing: boolean;
  /** Fin (exclusivo) del grupo en el texto original. */
  srcEnd: number;
}

export interface AlignedRomaji {
  romaji: string;
  /** Pares planos [finEnOriginal, finEnRomaji, …], crecientes: qué parte del romaji corresponde a qué parte del original. */
  marks: number[];
}

/** Tokens de una línea → romaji legible, con espacios entre palabras, alineado con el texto original. */
export function alignRomaji(text: string, tokens: JaToken[]): AlignedRomaji {
  const groups: Group[] = [];
  let cursor = 0;
  for (const t of tokens) {
    const at = text.indexOf(t.surface, cursor);
    cursor = at >= 0 ? at + t.surface.length : Math.min(text.length, cursor + t.surface.length);
    if (t.surface.trim().length === 0) continue;
    const japanese = containsJapanese(t.surface);
    const reading = t.reading && t.reading !== '*' ? t.reading : null;
    const kana = japanese ? (reading ?? t.surface) : t.surface;
    const particle = t.pos === '助詞' && PARTICLES[t.surface] ? PARTICLES[t.surface] : null;
    const opening = OPENING.has(t.surface);
    const closing = CLOSING.has(t.surface);
    const prev = groups.at(-1);
    if (prev && !particle && !opening && !closing && !prev.opening && !prev.closing && prev.japanese === japanese && attachesToPrevious(t)) {
      prev.kana += kana;
      prev.srcEnd = cursor;
      continue;
    }
    groups.push({ kana, japanese, particle, opening, closing, srcEnd: cursor });
  }
  let out = '';
  const marks: number[] = [];
  let prev: Group | null = null;
  for (const g of groups) {
    const piece = (g.particle ?? kanaToRomaji(g.kana)).replace(/\s+/g, ' ').trim();
    if (piece.length === 0) continue;
    const space = out.length > 0 && !g.closing && !(prev?.opening ?? false);
    out += (space ? ' ' : '') + piece;
    marks.push(g.srcEnd, out.length);
    prev = g;
  }
  return { romaji: out, marks };
}

export function tokensToRomaji(tokens: JaToken[]): string {
  return alignRomaji(tokens.map((t) => t.surface).join(''), tokens).romaji;
}

/** Caracteres del texto original ya cantados según la palabra actual y su avance. */
export function sungChars(line: Pick<LyricLine, 'text' | 'words'>, wordIndex: number, wordProgress: number): number {
  if (wordIndex < 0 || line.words.length === 0) return 0;
  if (wordIndex >= line.words.length) return line.text.length;
  let n = 0;
  for (let i = 0; i < wordIndex; i++) n += line.words[i].text.length;
  n += line.words[wordIndex].text.trimEnd().length * Math.min(1, Math.max(0, wordProgress));
  return Math.min(line.text.length, n);
}

/**
 * Relleno (0..1) del romaji que acompaña a la letra original: avanza al mismo punto que lo ya cantado
 * del original (a la mitad de 光る, a la mitad de "hikaru"), interpolando entre las marcas de alineación.
 */
export function romajiFill(line: Pick<LyricLine, 'text' | 'words' | 'romaji' | 'romajiMarks'>, wordIndex: number, wordProgress: number): number {
  const total = line.romaji?.length ?? 0;
  if (total === 0 || line.text.length === 0) return 0;
  const s = sungChars(line, wordIndex, wordProgress);
  const marks = line.romajiMarks ?? [];
  let s0 = 0;
  let o0 = 0;
  for (let i = 0; i + 1 < marks.length; i += 2) {
    const s1 = marks[i];
    const o1 = marks[i + 1];
    if (s <= s1) return (s1 > s0 ? o0 + ((s - s0) / (s1 - s0)) * (o1 - o0) : o1) / total;
    s0 = s1;
    o0 = o1;
  }
  const s1 = line.text.length;
  return (s1 > s0 ? o0 + ((s - s0) / (s1 - s0)) * (total - o0) : total) / total;
}

/** Una canción se trata como japonesa si al menos el 30 % de sus líneas con CJK tienen kana (así no se romaniza chino). */
export function isJapaneseLyrics(lines: Pick<LyricLine, 'text'>[]): boolean {
  let cjk = 0;
  let kana = 0;
  for (const l of lines) {
    if (!containsJapanese(l.text)) continue;
    cjk++;
    if (containsKana(l.text)) kana++;
  }
  return kana > 0 && kana / cjk >= 0.3;
}

/** Agrega `romaji` a las líneas japonesas del documento. `analyze` es el analizador de la plataforma. */
export function romanizeDocument(doc: LyricsDocument, analyze: (text: string) => JaToken[]): LyricsDocument {
  if (doc.kind !== 'synced' || !isJapaneseLyrics(doc.lines)) return doc;
  return {
    ...doc,
    lines: doc.lines.map((l) => {
      if (!containsJapanese(l.text)) return l;
      const { romaji, marks } = alignRomaji(l.text, analyze(l.text));
      return { ...l, romaji, romajiMarks: marks };
    }),
  };
}
