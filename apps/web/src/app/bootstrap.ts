export type TelegramBootstrapResult = 'ready' | 'timeout' | 'error';

export function observeTelegramInitialization(
  initialization: Promise<void>,
  onSettle: (result: TelegramBootstrapResult) => void,
  timeoutMs: number,
): () => void {
  let active = true;
  let initializationFinished = false;
  const finish = (result: Exclude<TelegramBootstrapResult, 'timeout'>) => {
    if (!active) return;
    initializationFinished = true;
    clearTimeout(timeoutId);
    onSettle(result);
  };
  const timeoutId = setTimeout(() => {
    if (active && !initializationFinished) onSettle('timeout');
  }, timeoutMs);

  void initialization.then(
    () => finish('ready'),
    () => finish('error'),
  );

  return () => {
    active = false;
    clearTimeout(timeoutId);
  };
}
