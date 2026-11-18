/**
 * Аватар-зверёк: рисуется из имени (или id), поэтому у игрока он одинаковый на всех экранах.
 * Собственная простая графика: тело, глаза, «украшение» сверху и рот выбираются по хэшу.
 */
const BODY = ['#8b5cf6', '#ff5c8a', '#20c3a0', '#ff9f43', '#4d8bff', '#97d63f', '#f25bd0', '#ffc531'];
const BACK = ['#efe8ff', '#ffe6ee', '#ddf7f0', '#fff0dd', '#e3edff', '#eef9dd', '#ffe3f8', '#fff5d6'];
const DARK = '#2a1b5c';

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function pick(seed: number, shift: number, size: number): number {
  return Math.floor(seed / 7 ** shift) % size;
}

function Eye({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#fff" />
      <circle cx={cx + r * 0.12} cy={cy + r * 0.1} r={r * 0.52} fill={DARK} />
      <circle cx={cx + r * 0.32} cy={cy - r * 0.18} r={r * 0.18} fill="#fff" />
    </g>
  );
}

function Top({ kind, color }: { kind: number; color: string }) {
  if (kind === 0) {
    return (
      <g fill={color}>
        <path d="M19 22 L15 9 L27 17 Z" />
        <path d="M45 22 L49 9 L37 17 Z" />
      </g>
    );
  }
  if (kind === 1) {
    return (
      <g stroke={color} strokeWidth="2.6" strokeLinecap="round" fill={color}>
        <path d="M26 17 L22 7" fill="none" />
        <path d="M38 17 L42 7" fill="none" />
        <circle cx="22" cy="7" r="3" stroke="none" />
        <circle cx="42" cy="7" r="3" stroke="none" />
      </g>
    );
  }
  if (kind === 2) {
    return <path d="M17 21 L21 11 L26 18 L32 8 L38 18 L43 11 L47 21 Z" fill={color} />;
  }
  return (
    <g fill={color}>
      <circle cx="16" cy="22" r="7" />
      <circle cx="48" cy="22" r="7" />
    </g>
  );
}

export function Creature({ seed, className = '' }: { seed: string; className?: string }) {
  const value = hash(seed || '?');
  const tone = pick(value, 0, BODY.length);
  const color = BODY[tone];
  const cyclops = pick(value, 1, 3) === 0;
  const top = pick(value, 2, 4);
  const toothy = pick(value, 3, 2) === 0;
  const tall = pick(value, 4, 2) === 0;

  return (
    <svg className={`creature ${className}`.trim()} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="32" fill={BACK[tone]} />
      <Top kind={top} color={color} />
      {tall
        ? <rect x="15" y="15" width="34" height="44" rx="17" fill={color} />
        : <ellipse cx="32" cy="38" rx="20" ry="21" fill={color} />}
      <ellipse cx="32" cy="50" rx="11" ry="6" fill="#fff" opacity="0.18" />
      {cyclops
        ? <Eye cx={32} cy={tall ? 31 : 33} r={8} />
        : (
          <g>
            <Eye cx={25} cy={tall ? 31 : 34} r={5.5} />
            <Eye cx={39} cy={tall ? 31 : 34} r={5.5} />
          </g>
        )}
      <ellipse cx="20" cy="43" rx="3.4" ry="2.2" fill="#ff8fb0" opacity="0.75" />
      <ellipse cx="44" cy="43" rx="3.4" ry="2.2" fill="#ff8fb0" opacity="0.75" />
      <path d="M25 44 Q32 51 39 44" fill={DARK} />
      {toothy && <path d="M30 45.2 L32 48 L34 45.2 Z" fill="#fff" />}
    </svg>
  );
}
