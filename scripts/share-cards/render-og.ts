// Общая карточка игры (og:image сайта и запасная картинка превью) из того же SVG, что рисует Worker.
// Запуск из корня репозитория: npx vite-node scripts/share-cards/render-og.ts
// Результат: apps/web/public/og.png (русская, og:image сайта) и og.en.png, og.kk.png (1200x630) -
// запасные картинки превью на языке ссылки (см. localizedAsset в shareText.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { LOCALES } from '@clutch/shared';
import { createSvgRenderer } from '../../apps/api/src/share/renderCard';
import { buildBrandCardSvg } from '../../apps/api/src/share/runCard';
import { localizedAsset } from '../../apps/api/src/share/shareText';

const require = createRequire(path.resolve('apps/api/package.json'));
const render = createSvgRenderer(async () => readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
for (const locale of LOCALES) {
  const out = path.resolve('apps/web/public', localizedAsset('og.png', locale));
  writeFileSync(out, await render(buildBrandCardSvg(locale)));
  console.log('saved', out);
}
