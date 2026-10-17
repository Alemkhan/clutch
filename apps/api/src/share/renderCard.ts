import { Resvg, initWasm as initResvg } from '@resvg/resvg-wasm';
import { buildShareCardSvg, CARD_WIDTH, CYRILLIC_FAMILY, type ShareCardData } from './cardLayout';

export { CYRILLIC_FAMILY };
import { INTER_FONTS } from './interFonts';

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Кириллические подмножества Inter переименовываются в «InteC» (та же длина, файл не
 * перестраивается). Иначе resvg добирает недостающие глифы из первого попавшегося шрифта
 * без учёта веса, и кириллица в жирном заголовке выходит другим начертанием, чем цифры.
 * Карточки из runCard.ts поэтому явно задают семейство для кириллических фрагментов.
 */

function tableOffset(font: Uint8Array, tag: string): number | null {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(4);
  for (let i = 0; i < count; i += 1) {
    const record = 12 + i * 16;
    if (String.fromCharCode(...font.subarray(record, record + 4)) === tag) return view.getUint32(record + 8);
  }
  return null;
}

/** Последний символ подмножества (OS/2 usLastCharIndex): у кириллицы fontsource это № или ꚟ. */
function isCyrillicSubset(font: Uint8Array): boolean {
  const os2 = tableOffset(font, 'OS/2');
  if (os2 === null) return false;
  const last = new DataView(font.buffer, font.byteOffset, font.byteLength).getUint16(os2 + 66);
  return last === 0x2116 || last === 0xa69f;
}

/** «Inter» → «InteC» во всех записях имени (UTF-16BE и однобайтовых). */
export function renameFamily(font: Uint8Array): Uint8Array {
  const name = tableOffset(font, 'name');
  if (name === null) return font;
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(name + 2);
  const storage = name + view.getUint16(name + 4);
  const out = font.slice();
  for (let i = 0; i < count; i += 1) {
    const record = name + 6 + i * 12;
    const wide = view.getUint16(record) !== 1;
    const start = storage + view.getUint16(record + 10);
    const length = view.getUint16(record + 8);
    const step = wide ? 2 : 1;
    for (let at = start; at + 5 * step <= start + length; at += step) {
      let match = true;
      for (let k = 0; k < 5 && match; k += 1) match = out[at + k * step + step - 1] === 'Inter'.charCodeAt(k);
      if (match) out[at + 4 * step + step - 1] = CYRILLIC_FAMILY.charCodeAt(4);
    }
  }
  return out;
}

let fonts: Uint8Array[] | null = null;

function loadFonts(): Uint8Array[] {
  fonts ??= INTER_FONTS.map(decodeBase64).map((font) => (isCyrillicSubset(font) ? renameFamily(font) : font));
  return fonts;
}

/**
 * Рендерер карточки: SVG вручную + resvg. wasm передаётся снаружи: в Worker его даёт
 * wrangler, в тестах — файл с диска. Инициализация один раз на изолят; при сбое
 * сбрасывается, и следующий запрос пробует снова.
 */
export function createCardRenderer(loadWasm: () => Promise<WebAssembly.Module | BufferSource>) {
  const renderSvg = createSvgRenderer(loadWasm);
  return (data: ShareCardData): Promise<Uint8Array> => renderSvg(buildShareCardSvg(data));
}

/** Растеризует любую готовую карточку 1200x630 (см. runCard.ts). */
export function createSvgRenderer(loadWasm: () => Promise<WebAssembly.Module | BufferSource>) {
  let ready: Promise<void> | null = null;

  function ensureReady(): Promise<void> {
    ready ??= loadWasm()
      .then((wasm) => initResvg(wasm))
      .catch((error) => {
        ready = null;
        throw error;
      });
    return ready;
  }

  return async function renderSvg(svg: string): Promise<Uint8Array> {
    await ensureReady();
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: CARD_WIDTH },
      font: { fontBuffers: loadFonts(), loadSystemFonts: false, defaultFontFamily: 'Inter' },
    });
    try {
      const image = resvg.render();
      try {
        return image.asPng();
      } finally {
        image.free();
      }
    } finally {
      resvg.free();
    }
  };
}
