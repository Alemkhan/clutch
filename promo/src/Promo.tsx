import type { ReactNode } from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  OffthreadVideo,
  Sequence,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import versions from './versions.json';
import { C, Confetti, FPS, Sfx, pop, s, sfx, stage, track } from './kit';

// The product cut: the real game inside a phone, calm layout, short headlines above the phone.
// Motion comes from the edit and from one strong moment, the perfect strike. Frames follow
// audio/synth.mjs ("promo" in versions.json): the drop lands as the phone enters, the music holds
// its breath before the strike, and the final chord opens the end card.

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const BEAT = (60 / 148) * FPS;
const beat = (n: number) => Math.round(s(versions.promo.drop) + n * BEAT);

/** Source seconds in take-a.mp4 (a real recorded run, see capture.ts). */
const RUN = {
  question: 5.6, // the question is up; the answer is tapped at 6.89, «Верно» at 7.53
  hammer: 9.75,
  strike: 11.24,
  strikes: [23.11, 32.83, 41.97],
  result: 42.95,
};

const T = {
  phone: beat(0), // 45: the drop
  tap: 0, // set below
  correct: 0,
  hammer: 140,
  strike: beat(12), // 191: the downbeat after the held breath
  montage: beat(16) - 4, // strikes on every other beat from bar 4
  result: beat(20) + 20,
  cta: beat(24), // 337: the final chord
};
T.tap = T.phone + s(6.89 - RUN.question);
T.correct = T.phone + s(7.53 - RUN.question);
const MONTAGE_CUT = beat(18) - beat(16);
export const PROMO_DURATION = Math.round(versions.promo.length * FPS);

// ---------- Hook ----------

function MarkerBar({ stopAt }: { stopAt: number }) {
  const frame = useCurrentFrame();
  // Runs back and forth, then settles on the centre on `stopAt`.
  const t = Math.min(frame, stopAt);
  const running = 0.5 + 0.42 * Math.sin((t / FPS) * 6.4 + 1.2);
  const settle = interpolate(frame, [stopAt - 6, stopAt], [running, 0.5], { ...clamp, easing: Easing.out(Easing.cubic) });
  const pos = frame < stopAt - 6 ? running : settle;
  const flash = interpolate(frame, [stopAt, stopAt + 3, stopAt + 14], [0, 1, 0], clamp);
  const zones: [number, number, string][] = [
    [0, 100, '#f3e2b9'], [22, 56, '#f3c46a'], [34, 32, '#ec9a2c'], [44, 12, C.red],
  ];
  return (
    <div style={{ position: 'relative', width: 820, height: 120 }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 26, overflow: 'hidden', background: '#2b2925' }}>
        {zones.map(([left, width, color]) => (
          <div key={left} style={{ position: 'absolute', top: 0, bottom: 0, left: `${left}%`, width: `${width}%`, background: color }} />
        ))}
      </div>
      <div
        style={{
          position: 'absolute', top: -14, bottom: -14, width: 22, left: `calc(${pos * 100}% - 11px)`,
          background: C.ink, border: '6px solid #fff', borderRadius: 12, boxShadow: `0 0 ${40 * flash}px ${20 * flash}px rgba(255,214,90,${flash})`,
        }}
      />
    </div>
  );
}

function Hook({ length }: { length: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = pop(frame, fps, 0);
  const b = pop(frame, fps, 14);
  const out = interpolate(frame, [length - 5, length], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.ink, alignItems: 'center', justifyContent: 'center', gap: 90, opacity: out }}>
      <div style={{ textAlign: 'center', lineHeight: 1.02 }}>
        <div style={{ fontSize: 96, fontWeight: 900, color: '#fff', whiteSpace: 'nowrap', transform: `translateY(${(1 - a) * 60}px)`, opacity: a }}>
          Ты знаешь ответ.
        </div>
        <div style={{ fontSize: 124, fontWeight: 900, color: C.red, marginTop: 18, whiteSpace: 'nowrap', transform: `scale(${0.6 + 0.4 * b})`, opacity: b }}>
          А попадёшь?
        </div>
      </div>
      <MarkerBar stopAt={length - 9} />
    </AbsoluteFill>
  );
}

// ---------- Phone with the recorded run ----------

const PHONE_W = 720;
const PHONE_H = Math.round((PHONE_W * 1688) / 780);
const PHONE_TOP = 330;

function Clip({ from, rate = 1 }: { from: number; rate?: number }) {
  return (
    <OffthreadVideo
      src={staticFile('take-a.mp4')}
      startFrom={s(from)}
      playbackRate={rate}
      muted
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}

/** Frames (from the phone's entry) of strikes: each gives a small push towards the viewer. */
function Phone({ hits, children }: { hits: { at: number; strength: number }[]; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = pop(frame, fps, 0);
  const exit = interpolate(frame, [T.cta - T.phone - 8, T.cta - T.phone], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  let punch = 0;
  let shake = 0;
  let glow = 0;
  for (const { at, strength } of hits) {
    const t = frame - at;
    if (t < 0) continue;
    punch = Math.max(punch, strength * interpolate(t, [0, 2, 14], [0, 1, 0], clamp));
    shake = Math.max(shake, strength * 10 * Math.exp(-t / 4));
    glow = Math.max(glow, strength * interpolate(t, [0, 1, 12], [0, 1, 0], clamp));
  }
  const dx = shake * (random(`x${frame}`) * 2 - 1);
  const dy = shake * (random(`y${frame}`) * 2 - 1);
  return (
    <div
      style={{
        position: 'absolute', left: (1080 - PHONE_W) / 2 - 14, top: PHONE_TOP,
        padding: 14, borderRadius: 78, background: C.ink,
        boxShadow: `0 40px 90px rgba(23,22,20,0.35), 0 0 ${120 * glow}px ${30 * glow}px rgba(242,177,0,${0.55 * glow})`,
        transform: `translate(${dx}px, ${(1 - enter) * 900 + exit * 1400 + dy}px) scale(${1 + 0.06 * punch})`,
        transformOrigin: '50% 60%',
      }}
    >
      <div style={{ position: 'relative', width: PHONE_W, height: PHONE_H, borderRadius: 64, overflow: 'hidden', background: C.bg }}>
        {children}
        <AbsoluteFill style={{ background: '#fff6d6', opacity: 0.55 * glow }} />
      </div>
    </div>
  );
}

function Caption({ children, color = C.ink, size = 84 }: { children: ReactNode; color?: string; size?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = pop(frame, fps, 0);
  return (
    <div
      style={{
        position: 'absolute', top: 92, left: 40, right: 40, height: 210, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        fontSize: size, fontWeight: 900, lineHeight: 1.05, color,
        transform: `translateY(${(1 - p) * -40}px)`, opacity: p,
      }}
    >
      {children}
    </div>
  );
}

/** The reward, above the phone: arrives hard, settles. */
function Reward({ children, color = C.gold, size = 120 }: { children: ReactNode; color?: string; size?: number }) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 4, 12], [1.7, 0.95, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const o = interpolate(frame, [0, 2], [0, 1], clamp);
  return (
    <div
      style={{
        position: 'absolute', top: 92, left: 0, right: 0, height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size, fontWeight: 900, color, whiteSpace: 'nowrap', opacity: o, transform: `scale(${scale})`,
        WebkitTextStroke: `5px ${C.ink}`, paintOrder: 'stroke fill', textShadow: `0 8px 0 ${C.ink}`,
      }}
    >
      {children}
    </div>
  );
}

// ---------- End card ----------

function EndCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = pop(frame, fps, 0);
  const b = pop(frame, fps, 6);
  const c = pop(frame, fps, 12);
  const pulse = 1 + 0.03 * Math.sin((frame / BEAT) * Math.PI);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 64, paddingBottom: 80 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 30, opacity: a, transform: `scale(${0.8 + 0.2 * a})` }}>
        <div style={{ width: 150, height: 150, borderRadius: 42, background: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 108, fontWeight: 900, color: '#fff' }}>C</div>
        <div style={{ fontSize: 120, fontWeight: 900, color: C.ink, letterSpacing: 9 }}>CLUTCH</div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 66, fontWeight: 800, lineHeight: 1.15, color: C.ink, opacity: b, transform: `translateY(${(1 - b) * 30}px)` }}>
        Сегодня у всех<br />одни и те же вопросы.<br />
        <span style={{ color: C.red }}>Кто попадёт точнее?</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, opacity: c }}>
        <div style={{ padding: '34px 72px', borderRadius: 44, background: C.red, color: '#fff', fontSize: 68, fontWeight: 900, transform: `scale(${(0.8 + 0.2 * c) * pulse})`, boxShadow: '0 20px 50px rgba(240,74,62,0.35)' }}>
          Играй в Telegram
        </div>
        <div style={{ color: 'rgba(23,23,22,0.6)', fontSize: 52, fontWeight: 700 }}>@playclutchbot · без установки</div>
      </div>
    </AbsoluteFill>
  );
}

// ---------- Timeline ----------

export const Promo = () => {
  const p = (frame: number) => frame - T.phone; // phone-local frames
  const strikesAt = [0, 1, 2].map((i) => T.montage + i * MONTAGE_CUT + 4);
  return (
    <AbsoluteFill style={stage}>
      <AbsoluteFill style={{ background: 'radial-gradient(1100px 900px at 85% 0%, rgba(240,74,62,0.16), transparent 60%)' }} />

      <Sequence from={T.phone} durationInFrames={T.cta - T.phone} layout="none">
        <Phone hits={[{ at: p(T.strike), strength: 1 }, ...strikesAt.map((at) => ({ at: p(at), strength: 0.4 }))]}>
          <Sequence durationInFrames={T.hammer - T.phone} layout="none"><Clip from={RUN.question} /></Sequence>
          <Sequence from={p(T.hammer)} durationInFrames={T.strike - T.hammer} layout="none">
            <Clip from={RUN.hammer} rate={(RUN.strike - RUN.hammer) / ((T.strike - T.hammer) / FPS)} />
          </Sequence>
          <Sequence from={p(T.strike)} durationInFrames={T.montage - T.strike} layout="none"><Clip from={RUN.strike} rate={0.4} /></Sequence>
          {RUN.strikes.map((at, i) => (
            <Sequence key={at} from={p(T.montage + i * MONTAGE_CUT)} durationInFrames={i < 2 ? MONTAGE_CUT : T.result - T.montage - 2 * MONTAGE_CUT} layout="none">
              <Clip from={at - 4 / FPS} />
            </Sequence>
          ))}
          <Sequence from={p(T.result)} layout="none"><Clip from={RUN.result} /></Sequence>
        </Phone>
      </Sequence>

      <Sequence from={T.phone} durationInFrames={T.correct - T.phone}><Caption>Сначала ответь сам</Caption></Sequence>
      <Sequence from={T.correct} durationInFrames={T.hammer - T.correct}><Caption color={C.green}>Верно. Теперь удар</Caption></Sequence>
      <Sequence from={T.hammer} durationInFrames={T.strike - T.hammer}><Caption size={76}>Красная зона:<br />6% полосы</Caption></Sequence>
      <Sequence from={T.strike} durationInFrames={T.montage - T.strike}><Reward size={96}>ИДЕАЛЬНО +25%</Reward></Sequence>
      {strikesAt.map((at, i) => (
        <Sequence key={at} from={at} durationInFrames={i < 2 ? MONTAGE_CUT : T.result - at}>
          <Reward color={i === 2 ? '#3ad17f' : C.red} size={150}>{[50, 75, 100][i]}%</Reward>
        </Sequence>
      ))}
      <Sequence from={T.result} durationInFrames={T.cta - T.result}><Caption color={C.green} size={80}>4 из 4.<br />Быстрее не бывает</Caption></Sequence>
      <Sequence from={T.result} durationInFrames={T.cta - T.result + 20}><Confetti count={70} /></Sequence>

      <Sequence from={0} durationInFrames={T.phone}><Hook length={T.phone} /></Sequence>
      <Sequence from={T.cta}><EndCard /></Sequence>

      <Audio src={track('music')} volume={0.55} />
      <Sfx at={T.phone - 9} src={track('pop')} volume={0.7} />
      <Sfx at={T.phone - 6} src={track('whoosh')} volume={0.7} />
      <Sfx at={T.tap} src={track('pop')} volume={0.8} />
      <Sfx at={T.correct} src={track('ding')} volume={0.75} />
      <Sfx at={T.hammer} src={track('whoosh')} volume={0.4} />
      {[2, 14, 24, 32, 38].map((f) => <Sfx key={f} at={T.hammer + f} src={track('tick')} volume={0.85} />)}
      <Sfx at={T.strike} src={track('impact')} volume={1} />
      <Sfx at={T.strike} src={sfx('strike-perfect')} volume={0.65} />
      <Sfx at={T.strike + 1} src={track('sparkle')} volume={0.5} />
      {strikesAt.map((at) => (
        <Sequence key={at} from={at} layout="none">
          <Audio src={track('impact')} volume={0.55} />
          <Audio src={sfx('strike-perfect')} volume={0.4} />
          <Sequence from={3} layout="none"><Audio src={track('fill')} volume={0.4} /></Sequence>
        </Sequence>
      ))}
      <Sfx at={T.result} src={track('success')} volume={0.8} />
      <Sfx at={T.result} src={track('confetti')} volume={0.6} />
      <Sfx at={T.cta - 6} src={track('whoosh')} volume={0.6} />
    </AbsoluteFill>
  );
};
