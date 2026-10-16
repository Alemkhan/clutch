import postcss from 'postcss';

/** Селекторы, объявленные на верхнем уровне больше одного раза (в @media и прочих блоках не считаются). */
export function topLevelDuplicateSelectors(css: string): string[] {
  const seen = new Map<string, number>();
  postcss.parse(css).each((node) => {
    if (node.type !== 'rule') return;
    const key = node.selectors.map((selector) => selector.trim().replace(/\s+/g, ' ')).join(', ');
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  return [...seen].filter(([, count]) => count > 1).map(([selector]) => selector);
}
