// Общая карточка игры (og:image сайта и запасная картинка превью) из того же SVG, что рисует Worker.
// Запуск из корня репозитория: npx vite-node scripts/share-cards/render-og.ts
// Результат: apps/web/public/og.png (1200x630).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createSvgRenderer } from '../../apps/api/src/share/renderCard';
import { buildBrandCardSvg } from '../../apps/api/src/share/runCard';

const require = createRequire(path.resolve('apps/api/package.json'));
const render = createSvgRenderer(async () => readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const out = path.resolve('apps/web/public/og.png');
writeFileSync(out, await render(buildBrandCardSvg()));
console.log('saved', out);
