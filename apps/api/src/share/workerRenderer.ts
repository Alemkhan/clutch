import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import { buildShareCardSvg, type ShareCardData } from './cardLayout';
import { createSvgRenderer } from './renderCard';

// Отдельный модуль: .wasm импортируется только wrangler-ом, поэтому в тестах
// (Node) этот файл подменяется, а сам рендерер проверяется с wasm с диска.
// Один рендерер на все карточки: resvg инициализируется один раз на изолят.
export const renderSvgPng = createSvgRenderer(async () => resvgWasm);
export const renderShareCardPng = (data: ShareCardData): Promise<Uint8Array> => renderSvgPng(buildShareCardSvg(data));
