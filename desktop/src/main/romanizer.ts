// Romaji en Windows: kuromoji (diccionario IPADIC incluido en el instalador) da las lecturas de los kanji
// y el núcleo (core/romaji.ts) las convierte a Hepburn. El analizador se construye una sola vez, la
// primera vez que suena una canción en japonés (~1 s).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import kuromoji from 'kuromoji';
import { isJapaneseLyrics, romanizeDocument, type JaToken } from '../core/romaji';
import type { LyricsDocument } from '../core/types';
import { log } from './logger';

type Tokenizer = kuromoji.Tokenizer<kuromoji.IpadicFeatures>;

let tokenizer: Promise<Tokenizer> | null = null;

function dictionaryPath(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('kuromoji/package.json')), 'dict');
}

function getTokenizer(): Promise<Tokenizer> {
  tokenizer ??= new Promise<Tokenizer>((resolve, reject) => {
    const t0 = Date.now();
    kuromoji.builder({ dicPath: dictionaryPath() }).build((err, tk) => {
      if (err) {
        tokenizer = null; // se reintenta en la próxima canción
        reject(err);
        return;
      }
      log('info', 'romaji', `analizador listo en ${Date.now() - t0} ms`);
      resolve(tk);
    });
  });
  return tokenizer;
}

/** Agrega romaji a las letras en japonés. Ante cualquier error devuelve el documento sin cambios. */
export async function addRomaji(doc: LyricsDocument): Promise<LyricsDocument> {
  if (doc.kind !== 'synced' || !isJapaneseLyrics(doc.lines)) return doc;
  try {
    const tk = await getTokenizer();
    const analyze = (text: string): JaToken[] =>
      tk.tokenize(text).map((t) => ({
        surface: t.surface_form,
        reading: t.reading ?? null,
        pos: t.pos,
        posDetail: t.pos_detail_1,
      }));
    return romanizeDocument(doc, analyze);
  } catch (e) {
    log('warn', 'romaji', `sin romaji: ${String(e)}`);
    return doc;
  }
}
