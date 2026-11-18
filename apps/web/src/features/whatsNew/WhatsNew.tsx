import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CLANS_FROM, dailyKey, type Locale } from '@clutch/shared';
import { useMessages } from '../../i18n/messages';
import { useLocale } from '../../i18n/locale';
import { m, WHATS_NEW_TEXT, type WhatsNewItem } from './messages';

/**
 * «Что нового». Пункты разбиты на выпуски: у пункта может быть свой день (`since`), без него он
 * в основном релизе WHATS_NEW_RELEASE. Каждый выпуск — отдельное окно: кланы не смешиваются
 * со списком релиза. За один заход — одно окно, самое свежее из непросмотренных; более старое
 * покажется при следующем заходе. Новичку (ещё не играл) выпуски просто отмечаются просмотренными.
 */
export const WHATS_NEW_RELEASE = '2026-11-18';

const STORAGE_KEY = 'clutch_whats_new_seen';

const itemVersion = (item: WhatsNewItem): string => item.since ?? WHATS_NEW_RELEASE;

/** Пункты, которые уже можно показывать; в dev-сборке — все, чтобы видеть будущие заранее. */
export function visibleItems(items: readonly WhatsNewItem[], now: number = Date.now()): WhatsNewItem[] {
  const today = dailyKey(now);
  return items.filter((item) => !item.since || item.since <= today || Boolean(import.meta.env.DEV));
}

/** Выпуски среди пунктов, от свежего к старому. */
export function releaseVersions(items: readonly WhatsNewItem[]): string[] {
  return [...new Set(items.map(itemVersion))].sort().reverse();
}

/** Самый свежий выпуск, которого игрок не видел; null — всё просмотрено. */
export function nextRelease(items: readonly WhatsNewItem[], seen: ReadonlySet<string>): string | null {
  return releaseVersions(items).find((version) => !seen.has(version)) ?? null;
}

export function releaseItems(items: readonly WhatsNewItem[], version: string): WhatsNewItem[] {
  return items.filter((item) => itemVersion(item) === version);
}

/** Просмотренные выпуски. Раньше хранилась одна версия строкой — она читается как список из одной. */
export function parseSeen(raw: string | null): Set<string> {
  return new Set((raw ?? '').split(',').map((value) => value.trim()).filter(Boolean));
}

function readSeen(): Set<string> {
  try {
    return parseSeen(localStorage.getItem(STORAGE_KEY));
  } catch {
    return new Set();
  }
}

function markSeen(versions: readonly string[]): void {
  try {
    const seen = readSeen();
    for (const version of versions) seen.add(version);
    localStorage.setItem(STORAGE_KEY, [...seen].sort().join(','));
  } catch {
    // Без хранилища окно покажется снова при следующем заходе — не страшно.
  }
}

const sourceItems = () => visibleItems(WHATS_NEW_TEXT.ru.items);

/** Свежий выпуск на русском (исходные тексты) — для проверок; переводы в messages.ts. */
export const WHATS_NEW = (() => {
  const version = releaseVersions(sourceItems())[0] ?? WHATS_NEW_RELEASE;
  return { version, title: WHATS_NEW_TEXT.ru.title, items: releaseItems(sourceItems(), version) };
})();

/** Выпуск из адреса: `?whatsnew` — свежий, `?whatsnew=2026-11-18` — этот (проверка текста перед релизом). */
function forcedRelease(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('whatsnew')) return null;
  const wanted = params.get('whatsnew');
  const versions = releaseVersions(sourceItems());
  return wanted && versions.includes(wanted) ? wanted : versions[0] ?? null;
}

/** `returning`: игрок уже играл (есть забеги); null — профиль ещё грузится. */
export function useWhatsNew(returning: boolean | null): { release: string | null; close: () => void } {
  const [release, setRelease] = useState<string | null>(null);
  useEffect(() => {
    const forced = forcedRelease();
    if (forced) {
      setRelease(forced);
      return;
    }
    if (returning === null) return;
    const items = sourceItems();
    if (!returning) {
      markSeen(releaseVersions(items));
      return;
    }
    setRelease(nextRelease(items, readSeen()));
  }, [returning]);
  return {
    release,
    close: () => {
      if (release) markSeen([release]);
      setRelease(null);
    },
  };
}

function releaseContent(locale: Locale, version: string) {
  const text = WHATS_NEW_TEXT[locale];
  return releaseItems(visibleItems(text.items), version);
}

export function WhatsNewDialog({ onClose, release = WHATS_NEW.version, onClan }: {
  onClose: () => void;
  release?: string;
  /** Выпуск кланов зовёт сразу занять эмодзи. */
  onClan?: () => void;
}) {
  const t = useMessages(m);
  const locale = useLocale();
  const items = releaseContent(locale, release);
  const clans = release === CLANS_FROM;
  const dialog = (
    <div className="whats-new-backdrop" onClick={onClose}>
      <section
        className={`whats-new${clans ? ' whats-new-clans' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="whats-new-title" className="whats-new-title">{clans ? t.clansTitle : WHATS_NEW_TEXT[locale].title}</h2>
        <ul className="whats-new-list">
          {items.map((item) => (
            <li key={item.title} className="whats-new-item">
              <span className="whats-new-icon" aria-hidden="true">{item.icon}</span>
              <span>
                <strong>{item.title}</strong>
                <span className="whats-new-text">{item.text}</span>
              </span>
            </li>
          ))}
        </ul>
        {clans && onClan ? (
          <>
            <button type="button" className="cta-btn whats-new-close" onClick={() => { onClose(); onClan(); }}>{t.clansAction}</button>
            <button type="button" className="ghost-btn whats-new-later" onClick={onClose}>{t.later}</button>
          </>
        ) : (
          <button type="button" className="cta-btn whats-new-close" onClick={onClose}>{t.close}</button>
        )}
      </section>
    </div>
  );
  // Поверх всего экрана, включая нижнюю панель: оболочка страницы изолирует свои слои (isolation),
  // поэтому окно внутри неё оказалось бы под панелью навигации.
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
