export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string };

export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      return { ok: false, status: 413, error: 'Request body is too large.' };
    }
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body.' };
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, status: 413, error: 'Request body is too large.' };
  }
  if (text.length === 0) return { ok: false, status: 400, error: 'Invalid JSON body.' };

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body.' };
  }
}
