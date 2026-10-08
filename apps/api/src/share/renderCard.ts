import { Resvg, initWasm as initResvg } from '@resvg/resvg-wasm';
import { buildShareCardSvg, CARD_WIDTH, type ShareCardData } from './cardLayout';
import { INTER_FONTS } from './interFonts';

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let fonts: Uint8Array[] | null = null;

function loadFonts(): Uint8Array[] {
  fonts ??= INTER_FONTS.map(decodeBase64);
  return fonts;
}

/**
 * Рендерер карточки: SVG вручную + resvg. wasm передаётся снаружи: в Worker его даёт
 * wrangler, в тестах — файл с диска. Инициализация один раз на изолят; при сбое
 * сбрасывается, и следующий запрос пробует снова.
 */
export function createCardRenderer(loadWasm: () => Promise<WebAssembly.Module | BufferSource>) {
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

  return async function renderCard(data: ShareCardData): Promise<Uint8Array> {
    await ensureReady();
    const resvg = new Resvg(buildShareCardSvg(data), {
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
