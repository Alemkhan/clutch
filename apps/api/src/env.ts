export interface Env {
  DB: D1Database;
  API_RATE_LIMITER: RateLimit;
  TELEGRAM_BOT_TOKEN: string;
  SESSION_SIGNING_SECRET: string;
  ENVIRONMENT: string;
  TELEGRAM_MINI_APP_LINK: string;
  PUBLIC_WEB_ORIGIN?: string;
}
