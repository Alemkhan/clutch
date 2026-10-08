import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import { createCardRenderer } from './renderCard';

// Отдельный модуль: .wasm импортируется только wrangler-ом, поэтому в тестах
// (Node) этот файл подменяется, а сам рендерер проверяется с wasm с диска.
export const renderShareCardPng = createCardRenderer(async () => resvgWasm);
