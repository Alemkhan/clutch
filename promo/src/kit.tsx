import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Freeze,
  OffthreadVideo,
  Sequence,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Montserrat';

export const { fontFamily } = loadFont('normal', { weights: ['600', '800', '900'], subsets: ['cyrillic', 'latin'] });

// Game palette (apps/web tokens).
export const C = {
  bg: '#f3f0e8',
  ink: '#171716',
  red: '#f04a3e',
  green: '#168c51',
  gold: '#f2b100',
  blue: '#4d75e8',
  cream: '#fffefa',
};

export const FPS = 30;
export const s = (seconds: number) => Math.round(seconds * FPS);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const pop = (frame: number, fps: number, delay = 0) =>
  spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 190, mass: 0.6 } });

// ---------- Recorded gameplay ----------

/** Fits the 780-wide recording to the 1080 frame. */
export const FIT = 1080 / 780;

export interface ShotProps {
  take: 'take-a' | 'take-b';
  /** Source second the shot starts at. */
  from: number;
  rate?: number;
  /** Source y (px of the 780x1688 recording) placed at the middle of the frame. */
  focus: number;
  /** Scale of the recording; FIT shows its full width. */
  zoom?: number;
  /** Hold the first frame. */
  freeze?: boolean;
  /** Zoom from `zoomFrom` to `zoom` over the first frames, for a slam-in. */
  zoomFrom?: number;
  grey?: number;
}

/** A full-bleed, zoomed cut of a recorded run. No phone frame: the game is the picture. */
export function Shot({ take, from, rate = 1, focus, zoom = 1.6, freeze, zoomFrom, grey = 0 }: ShotProps) {
  const frame = useCurrentFrame();
  const k = zoomFrom === undefined ? zoom : interpolate(frame, [0, 8], [zoomFrom, zoom], { ...clamp, easing: Easing.out(Easing.cubic) });
  const video = (
    <OffthreadVideo
      src={staticFile(`${take}.mp4`)}
      startFrom={s(from)}
      playbackRate={rate}
      muted
      style={{
        position: 'absolute', width: 780 * k, height: 1688 * k, left: 540 - 390 * k, top: 960 - focus * k,
        filter: grey ? `grayscale(${grey}) brightness(${1 - grey * 0.12})` : undefined,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      {freeze ? <Freeze frame={0}>{video}</Freeze> : video}
    </AbsoluteFill>
  );
}

/** Zoom punch and a decaying shake from frame `at`, around a point of the frame. */
export function Impact({ at, strength = 1, originY = 960, children }: { at: number; strength?: number; originY?: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const t = frame - at;
  const punch = t < 0 ? 0 : interpolate(t, [0, 2, 16], [0, 1, 0], { ...clamp, easing: Easing.out(Easing.quad) });
  const amp = t < 0 ? 0 : 30 * strength * Math.exp(-t / 4.5);
  const dx = amp * (random(`x${frame}`) * 2 - 1);
  const dy = amp * (random(`y${frame}`) * 2 - 1);
  return (
    <AbsoluteFill style={{ transform: `translate(${dx}px, ${dy}px) scale(${1 + 0.16 * strength * punch})`, transformOrigin: `540px ${originY}px` }}>
      {children}
    </AbsoluteFill>
  );
}

export function Flash({ color = 'rgba(255,246,214,1)', peak = 0.9 }: { color?: string; peak?: number }) {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 1, 10], [0, peak, 0], clamp);
  return <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: 'none' }} />;
}

// ---------- Overlays ----------

const stroke = (px: number) => ({ WebkitTextStroke: `${px}px ${C.ink}`, paintOrder: 'stroke fill' }) as CSSProperties;

/** ИДЕАЛЬНО / МИМО stamp over the action. */
export function Stamp({ word, value, color, y = 820, size = 140 }: { word: string; value?: string; color: string; y?: number; size?: number }) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 5, 14], [1.6, 0.94, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const o = interpolate(frame, [0, 2], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: 'center', top: y, height: 'auto', pointerEvents: 'none' }}>
      <div style={{ textAlign: 'center', transform: `scale(${scale}) rotate(-5deg)`, opacity: o, lineHeight: 0.95 }}>
        <div style={{ fontSize: size, fontWeight: 900, color, whiteSpace: 'nowrap', textShadow: `0 12px 0 ${C.ink}`, ...stroke(14) }}>{word}</div>
        {value && <div style={{ fontSize: size * 0.8, fontWeight: 900, color: '#fff', marginTop: 10, textShadow: `0 10px 0 ${C.ink}`, ...stroke(12) }}>{value}</div>}
      </div>
    </AbsoluteFill>
  );
}

/** The run's progress to 100%, large, across the top. `steps` are [frame, value] in local frames. */
export function ProgressBar({ steps }: { steps: [number, number][] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let value = 0;
  let last = -999;
  steps.forEach(([at, v], i) => {
    if (frame < at) return;
    last = at;
    const p = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 160 } });
    value = Math.min(v, interpolate(p, [0, 1], [i > 0 ? steps[i - 1][1] : 0, v]));
  });
  const done = value >= 99.5;
  const bump = interpolate(frame - last, [0, 3, 12], [1.12, 1.06, 1], clamp);
  const enter = pop(frame, fps, 0);
  return (
    <div
      style={{
        position: 'absolute', left: 60, right: 60, top: 110, padding: '26px 34px 30px', borderRadius: 40,
        background: C.ink, boxShadow: '0 20px 50px rgba(0,0,0,0.35)', transform: `translateY(${(1 - enter) * -260}px)`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', color: '#fff' }}>
        <div style={{ fontSize: 46, fontWeight: 800, opacity: 0.8 }}>До победы</div>
        <div style={{ fontSize: 96, fontWeight: 900, color: done ? '#3ad17f' : '#fff', transform: `scale(${bump})`, transformOrigin: 'right' }}>
          {Math.round(value)}%
        </div>
      </div>
      <div style={{ height: 46, borderRadius: 23, background: 'rgba(255,255,255,0.14)', marginTop: 14, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, borderRadius: 23, background: done ? '#3ad17f' : C.red, boxShadow: `0 0 30px ${done ? '#3ad17f' : C.red}` }} />
      </div>
    </div>
  );
}

export function Caption({ children, top = 150, color = '#fff', bg = C.ink, size = 72 }: { children: ReactNode; top?: number; color?: string; bg?: string; size?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = pop(frame, fps, 0);
  return (
    <AbsoluteFill style={{ alignItems: 'center', top, height: 'auto', pointerEvents: 'none' }}>
      <div
        style={{
          padding: '22px 44px', borderRadius: 34, background: bg, color, fontSize: size, fontWeight: 900, whiteSpace: 'nowrap',
          boxShadow: '0 18px 44px rgba(0,0,0,0.28)', transform: `scale(${0.6 + 0.4 * p})`, opacity: p,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}

/** «А ты знаешь?» with a 3-2-1 count on the beat: the viewer gets a moment to answer. */
export function AskChip({ beat, top = 1540 }: { beat: number; top?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = pop(frame, fps, 0);
  const n = Math.min(3, Math.floor(frame / beat));
  const tickPop = interpolate(frame % beat, [0, 4], [1.25, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: 'center', top, height: 'auto', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, transform: `scale(${0.5 + 0.5 * p})`, opacity: p }}>
        <div style={{ padding: '26px 48px', borderRadius: 40, background: C.red, color: '#fff', fontSize: 84, fontWeight: 900, whiteSpace: 'nowrap', boxShadow: '0 18px 44px rgba(240,74,62,0.45)' }}>
          А ты знаешь?
        </div>
        {n < 3 && (
          <div
            style={{
              width: 140, height: 140, borderRadius: 70, background: C.ink, color: '#fff', fontSize: 86, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${tickPop})`,
            }}
          >
            {3 - n}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

/** Big words on a dark card; each line pops in on its own frame. */
export function TitleCard({ lines, over }: { lines: { text: string; at: number; color?: string; size?: number }[]; over?: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      {over && <AbsoluteFill style={{ opacity: 0.35, filter: 'blur(6px)' }}>{over}</AbsoluteFill>}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 34, padding: '0 60px' }}>
        {lines.map(({ text, at, color = '#fff', size = 112 }) => {
          const p = pop(frame, fps, at);
          return (
            <div key={text} style={{ fontSize: size, fontWeight: 900, color, textAlign: 'center', lineHeight: 1.04, opacity: p, transform: `translateY(${(1 - p) * 70}px) scale(${0.85 + 0.15 * p})` }}>
              {text}
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

const CONFETTI = ['#f04a3e', '#f2b100', '#168c51', '#4d75e8', '#ffffff', '#ff8fb1'];

export function Confetti({ count = 110 }: { count?: number }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      {Array.from({ length: count }, (_, i) => {
        const r = (k: string) => random(`${k}${i}`);
        const t = Math.max(0, frame - r('d') * 6) / FPS;
        const vx = (r('vx') * 2 - 1) * 900;
        const vy = -1500 - r('vy') * 900;
        const x = 540 + vx * t;
        const y = 1250 + vy * t + 2600 * t * t;
        const spin = r('s') * 900 * t + r('a') * 360;
        const w = 22 + r('w') * 20;
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: x, top: y, width: w, height: w * 0.5, background: CONFETTI[i % CONFETTI.length],
              borderRadius: 4, transform: `rotate(${spin}deg) scaleX(${Math.cos(t * 12 + i)})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

// ---------- Call to action ----------

export function Logo({ scale = 1 }: { scale?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 30, transform: `scale(${scale})` }}>
      <div style={{ width: 150, height: 150, borderRadius: 42, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 108, fontWeight: 900, color: C.ink }}>C</div>
      <div style={{ fontSize: 120, fontWeight: 900, color: '#fff', letterSpacing: 9 }}>CLUTCH</div>
    </div>
  );
}

export function Cta({ head, sub, logoFirst = false }: { head: ReactNode; sub?: ReactNode; logoFirst?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = pop(frame, fps, 0);
  const b = pop(frame, fps, logoFirst ? 14 : 8);
  const c = pop(frame, fps, 22);
  const pulse = 1 + 0.035 * Math.sin((frame / fps) * 2 * Math.PI * (148 / 60) / 2);
  const headBlock = (p: number) => (
    <div style={{ textAlign: 'center', color: '#fff', fontSize: 112, fontWeight: 900, lineHeight: 1.05, opacity: p, transform: `translateY(${(1 - p) * 50}px)` }}>
      {head}
      {sub && <div style={{ fontSize: 64, fontWeight: 800, color: 'rgba(255,255,255,0.8)', marginTop: 22 }}>{sub}</div>}
    </div>
  );
  return (
    <AbsoluteFill style={{ background: C.ink, alignItems: 'center', justifyContent: 'center', gap: 80, paddingBottom: 140 }}>
      {logoFirst ? <><div style={{ opacity: a }}><Logo scale={0.7 + 0.3 * a} /></div>{headBlock(b)}</> : <>{headBlock(a)}<div style={{ opacity: b }}><Logo scale={0.85 * (0.7 + 0.3 * b)} /></div></>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, opacity: c }}>
        <div style={{ padding: '36px 76px', borderRadius: 44, background: C.red, color: '#fff', fontSize: 72, fontWeight: 900, transform: `scale(${(0.7 + 0.3 * c) * pulse})`, boxShadow: '0 20px 60px rgba(240,74,62,0.5)' }}>
          Играй в Telegram
        </div>
        <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 54, fontWeight: 700 }}>@playclutchbot</div>
      </div>
    </AbsoluteFill>
  );
}

// ---------- Sound ----------

export const sfx = (name: string) => staticFile(`sfx/${name}.m4a`);
export const track = (name: string) => staticFile(`audio/${name}.wav`);

/** One sound at a frame. */
export function Sfx({ at, src, volume = 0.8 }: { at: number; src: string; volume?: number }) {
  return <Sequence from={at} layout="none"><Audio src={src} volume={volume} /></Sequence>;
}

/** The sound bed of a strike: thump, the game's own perfect chime, the fill of the bar. */
export function StrikeSounds({ at, big = false }: { at: number; big?: boolean }) {
  return (
    <>
      <Sfx at={at} src={track('impact')} volume={big ? 1 : 0.7} />
      <Sfx at={at} src={sfx('strike-perfect')} volume={0.6} />
      {big && <Sfx at={at + 1} src={track('sparkle')} volume={0.55} />}
      <Sfx at={at + 4} src={track('fill')} volume={0.45} />
    </>
  );
}

export const stage: CSSProperties = { background: C.bg, fontFamily };
