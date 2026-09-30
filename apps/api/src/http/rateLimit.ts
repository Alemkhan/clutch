export const RATE_LIMIT_PERIOD_SECONDS = 60;

export type RateLimitResult = 'allowed' | 'limited' | 'unavailable';

export async function checkRateLimit(limiter: RateLimit, key: string): Promise<RateLimitResult> {
  try {
    const outcome = await limiter.limit({ key });
    return outcome.success ? 'allowed' : 'limited';
  } catch {
    return 'unavailable';
  }
}

export function clientRateLimitKey(request: Request): string {
  return request.headers.get('CF-Connecting-IP')?.trim() || 'local-unknown-client';
}
