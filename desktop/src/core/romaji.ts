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
}

/** Tokens de una línea → romaji legible, con espacios entre palabras. */
export function tokensToRomaji(tokens: JaToken[]): string {
  const groups: Group[] = [];
  for (const t of tokens) {
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
      continue;
    }
    groups.push({ kana, japanese, particle, opening, closing });
  }
  let out = '';
  let prev: Group | null = null;
  for (const g of groups) {
    const text = (g.particle ?? kanaToRomaji(g.kana)).trim();
    if (text.length === 0) continue;
    const space = out.length > 0 && !g.closing && !(prev?.opening ?? false);
    out += (space ? ' ' : '') + text;
    prev = g;
  }
  return out.replace(/\s+/g, ' ').trim();
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
    lines: doc.lines.map((l) => (containsJapanese(l.text) ? { ...l, romaji: tokensToRomaji(analyze(l.text)) } : l)),
  };
}
