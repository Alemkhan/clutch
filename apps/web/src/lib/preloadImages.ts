// Fire-and-forget image warm-up. Never throws, never blocks rendering: the
// browser downloads in the background and a failure is silently ignored.
const requested = new Set<string>();
// Hold references so in-flight requests are not garbage-collected early.
const holders: HTMLImageElement[] = [];

export function preloadImages(urls: readonly string[]): void {
  if (typeof Image === 'undefined') return;
  for (const url of urls) {
    if (requested.has(url)) continue;
    requested.add(url);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.onerror = () => { requested.delete(url); };
      img.src = url;
      holders.push(img);
    } catch {
      requested.delete(url);
    }
  }
}
