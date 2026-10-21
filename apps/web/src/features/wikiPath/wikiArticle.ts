import type { WikiPathAllowedLink, WikiPathPage } from '@clutch/shared';

export interface SanitizedWikiArticle {
  title: string;
  html: string;
  allowedTitles: ReadonlyMap<string, string>;
}

export function normalizeWikiTitle(title: string): string {
  return title.replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
}

function comparable(title: string): string {
  return normalizeWikiTitle(title).toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

function titleFromHref(href: string | null): string | null {
  if (!href?.startsWith('/wiki/')) return null;
  const raw = href.slice('/wiki/'.length).split('#', 1)[0];
  if (!raw) return null;
  try {
    return normalizeWikiTitle(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

const DROP_ELEMENTS = 'script,style,link,iframe,form,input,button,select,textarea,noscript,object,embed,base,meta,svg,math';

/**
 * The server supplies already-filtered article HTML, but treat it as untrusted again at the
 * browser boundary. Only links listed in allowedLinks become actionable; the server checks them
 * once more when the user clicks.
 */
export function sanitizeWikiArticle(page: Pick<WikiPathPage, 'title' | 'html' | 'allowedLinks'>): SanitizedWikiArticle {
  const parsed = new DOMParser().parseFromString(page.html, 'text/html');
  parsed.querySelectorAll(DROP_ELEMENTS).forEach((node) => node.remove());
  const allowed = new Map<string, string>();
  for (const link of page.allowedLinks) allowed.set(comparable(link.title), normalizeWikiTitle(link.title));

  parsed.body.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'id' || name === 'srcset' || name === 'srcdoc') {
        element.removeAttribute(attribute.name);
      }
    }
    // MediaWiki classes are not needed for presentation and could collide with application CSS.
    element.removeAttribute('class');

    if (element.tagName === 'A') {
      const title = titleFromHref(element.getAttribute('href'));
      const approved = title ? allowed.get(comparable(title)) : undefined;
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
      if (approved) {
        element.setAttribute('href', '#');
        element.setAttribute('data-wiki-title', approved);
      } else {
        element.setAttribute('aria-disabled', 'true');
      }
    } else if (element.tagName === 'IMG') {
      const src = element.getAttribute('src') ?? '';
      let safeSrc = '';
      try {
        const url = new URL(src.startsWith('//') ? `https:${src}` : src);
        if (url.protocol === 'https:') safeSrc = url.href;
      } catch {
        // An unsafe or malformed image is removed below.
      }
      if (safeSrc) {
        element.setAttribute('src', safeSrc);
        element.setAttribute('loading', 'lazy');
        for (const attribute of [...element.attributes]) {
          if (!['src', 'alt', 'title', 'width', 'height', 'loading'].includes(attribute.name.toLowerCase())) {
            element.removeAttribute(attribute.name);
          }
        }
      } else {
        element.remove();
      }
    } else if (element.tagName === 'TH' || element.tagName === 'TD') {
      // Infoboxes need their semantic row headers and spans to stay readable on a phone.
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.toLowerCase();
        const safeScope = name === 'scope' && (value === 'row' || value === 'col');
        const safeSpan = (name === 'rowspan' || name === 'colspan')
          && /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 20;
        if (!safeScope && !safeSpan) element.removeAttribute(attribute.name);
      }
    } else {
      // Article formatting uses semantic tags and text; arbitrary attributes are unnecessary.
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    }
  });

  return { title: page.title, html: parsed.body.innerHTML, allowedTitles: allowed };
}

export function approvedWikiLink(title: string, allowed: ReadonlyMap<string, string>): string | null {
  return allowed.get(comparable(title)) ?? null;
}

export function wikiLinkFromAnchor(anchor: Element): string | null {
  return anchor.getAttribute('data-wiki-title');
}

export function allowedWikiTitles(links: readonly WikiPathAllowedLink[]): ReadonlyMap<string, string> {
  return new Map(links.map(({ title }) => [comparable(title), normalizeWikiTitle(title)]));
}
