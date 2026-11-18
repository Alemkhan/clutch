import type { Context, Hono } from 'hono';
import {
  isLocale,
  isRegion,
  regionFromCountry,
  type Locale,
  type PlayerSettingsResponse,
  type Region,
} from '@clutch/shared';
import { resolveRequestIdentity } from '../auth/identity';
import type { Env } from '../env';
import { readJsonBody } from '../http/jsonBody';
import { requestLocale } from '../http/locale';
import { checkRateLimit, RATE_LIMIT_PERIOD_SECONDS } from '../http/rateLimit';

type AppContext = Context<{ Bindings: Env }>;

interface SettingsRow {
  locale: Locale;
  region: Region;
  region_source: 'auto' | 'manual';
}

/** Страна подключения от Cloudflare; в тестах и локально её нет — тогда «мир». */
export function connectionCountry(c: AppContext): string | null {
  const cf = (c.req.raw as Request & { cf?: { country?: string } }).cf;
  return typeof cf?.country === 'string' ? cf.country : null;
}

export async function findPlayerSettings(db: D1Database, playerId: string): Promise<SettingsRow | null> {
  return await db.prepare('SELECT locale, region, region_source FROM player_settings WHERE player_id = ?1')
    .bind(playerId).first<SettingsRow>();
}

/** Язык сообщений бота для игрока; без записи — русский (язык исходного контента). */
export async function playerLocale(db: D1Database, playerId: string): Promise<Locale> {
  const row = await findPlayerSettings(db, playerId).catch(() => null);
  return row && isLocale(row.locale) ? row.locale : 'ru';
}

async function saveSettings(db: D1Database, playerId: string, settings: SettingsRow, now: number): Promise<void> {
  await db.prepare(`
    INSERT INTO player_settings (player_id, locale, region, region_source, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT (player_id) DO UPDATE SET
      locale = excluded.locale, region = excluded.region, region_source = excluded.region_source, updated_at = excluded.updated_at
  `).bind(playerId, settings.locale, settings.region, settings.region_source, now).run();
}

/**
 * Настройки с учётом страны: зона 'auto' следует за страной подключения (игрок в поездке получает
 * пул той страны), выбранная вручную — нет. Язык — последний выбранный на клиенте.
 */
async function currentSettings(c: AppContext, playerId: string): Promise<{ row: SettingsRow; changed: boolean }> {
  const stored = await findPlayerSettings(c.env.DB, playerId);
  const autoRegion = regionFromCountry(connectionCountry(c));
  const locale = requestLocale(c);
  if (!stored) return { row: { locale, region: autoRegion, region_source: 'auto' }, changed: true };
  const region = stored.region_source === 'auto' ? autoRegion : stored.region;
  const row = { ...stored, locale, region };
  return { row, changed: row.locale !== stored.locale || row.region !== stored.region };
}

function toResponse(row: SettingsRow, country: string | null): PlayerSettingsResponse {
  return { locale: row.locale, region: row.region, regionSource: row.region_source, detectedRegion: regionFromCountry(country) };
}

export function registerSettingsRoutes(app: Hono<{ Bindings: Env }>): void {
  const authenticate = async (c: AppContext) => {
    const identity = await resolveRequestIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ error: 'Authentication required.' }, 401);
    const limited = await checkRateLimit(c.env.API_RATE_LIMITER, `settings:${identity.playerId}`);
    if (limited === 'limited') {
      c.header('Retry-After', String(RATE_LIMIT_PERIOD_SECONDS));
      return c.json({ error: 'Too many requests.' }, 429);
    }
    if (limited === 'unavailable') return c.json({ error: 'Rate limiter unavailable.' }, 503);
    return identity;
  };

  /** Синхронизация при запуске: запоминает язык клиента и обновляет автоматическую зону. */
  app.get('/api/settings', async (c) => {
    const identity = await authenticate(c);
    if (identity instanceof Response) return identity;
    const { row, changed } = await currentSettings(c, identity.playerId);
    if (changed) await saveSettings(c.env.DB, identity.playerId, row, Date.now());
    return c.json(toResponse(row, connectionCountry(c)));
  });

  /** Выбор зоны в профиле: конкретная зона ('manual') или «по стране» (region: 'auto'). */
  app.put('/api/settings', async (c) => {
    const identity = await authenticate(c);
    if (identity instanceof Response) return identity;
    const parsed = await readJsonBody(c.req.raw, 256);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
    const body = parsed.value as { region?: unknown } | null;
    const wanted = body?.region;
    if (wanted !== 'auto' && !isRegion(wanted)) return c.json({ error: 'Invalid region.' }, 400);
    const { row } = await currentSettings(c, identity.playerId);
    const next: SettingsRow = wanted === 'auto'
      ? { ...row, region: regionFromCountry(connectionCountry(c)), region_source: 'auto' }
      : { ...row, region: wanted, region_source: 'manual' };
    await saveSettings(c.env.DB, identity.playerId, next, Date.now());
    return c.json(toResponse(next, connectionCountry(c)));
  });
}
