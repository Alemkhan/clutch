import { AbsoluteFill, Audio, Sequence } from 'remotion';
import versions from './versions.json';
import {
  AskChip, C, Caption, Confetti, Cta, FIT, Flash, Impact, ProgressBar, Sfx, Shot, Stamp, StrikeSounds, TitleCard,
  sfx, stage, track,
} from './kit';

// Frames are written against the music in audio/synth.mjs (148 BPM, timings in versions.json):
// a beat is 12.16 frames, strikes land on beats, and the music drops out just before the big strike.
const BEAT = (60 / 148) * 30;
const HAMMER = 960; // source y that centres the hammer card and lane
const QUESTION = 640; // source y that centres the prompt and options

/** Source seconds of strikes in the takes; a montage cut starts 4 frames before its strike. */
const STRIKE = { a2: 23.11, a3: 32.83, a4: 41.97, b2: 21.79, b3: 32.1 };
const LEAD = 4;

function MontageStrike({ take, at, size = 118 }: { take: 'take-a' | 'take-b'; at: number; size?: number }) {
  return (
    <>
      <Impact at={LEAD} strength={0.6}>
        <Shot take={take} from={at - LEAD / 30} focus={HAMMER} rate={0.85} />
      </Impact>
      <Sequence from={LEAD} layout="none"><Flash peak={0.55} /></Sequence>
      <Sequence from={LEAD} layout="none"><Stamp word="ИДЕАЛЬНО" value="+25%" color={C.gold} size={size} /></Sequence>
    </>
  );
}

// ---------- Version A: the perfect run, 12.4 s ----------

const A = { cold: 0, card: 24, ask: 66, tap: 102, correct: 120, hammer: 150, strike: 200, montage: 220, win: 284, cta: 309 };
export const A_DURATION = Math.round(versions.a.length * 30);

export const PromoA = () => (
  <AbsoluteFill style={stage}>
    {/* 0–0.8 s: cold open on a perfect strike */}
    <Sequence from={A.cold} durationInFrames={A.card - A.cold}>
      <Impact at={6}><Shot take="take-b" from={STRIKE.b2 - 0.12} rate={0.6} focus={HAMMER} zoom={1.6} /></Impact>
      <Sequence from={6} layout="none"><Flash /></Sequence>
      <Sequence from={6} layout="none"><Stamp word="ИДЕАЛЬНО" value="+25%" color={C.gold} /></Sequence>
    </Sequence>

    {/* 0.8–2.2 s: the promise */}
    <Sequence from={A.card} durationInFrames={A.ask - A.card}>
      <TitleCard
        over={<Shot take="take-a" from={19.4} focus={HAMMER} />}
        lines={[
          { text: 'Ответить правильно — легко.', at: 2, size: 92 },
          { text: 'А попасть в центр?', at: 16, color: C.red, size: 124 },
        ]}
      />
    </Sequence>

    {/* 2.2–3.4 s: the question, held on the beat so the viewer answers too */}
    <Sequence from={A.ask} durationInFrames={A.tap - A.ask}>
      <Impact at={0} strength={0.5}><Shot take="take-a" from={6.5} focus={QUESTION} zoom={1.5} freeze zoomFrom={2} /></Impact>
      <AskChip beat={BEAT} />
    </Sequence>
    <Sequence from={A.tap} durationInFrames={A.correct - A.tap}>
      <Shot take="take-a" from={6.8} focus={QUESTION} zoom={1.5} />
    </Sequence>
    <Sequence from={A.correct} durationInFrames={A.hammer - A.correct}>
      <Shot take="take-a" from={7.56} focus={QUESTION} zoom={1.5} />
      <Caption top={1440} bg={C.green}>Верно → твой удар</Caption>
    </Sequence>

    {/* 5–6.7 s: the hammer; ticking, then a held breath */}
    <Sequence from={A.hammer} durationInFrames={A.strike - A.hammer}>
      <Shot take="take-a" from={9.72} rate={0.912} focus={HAMMER} />
      <Caption>Лови центр</Caption>
    </Sequence>
    <Sequence from={A.strike} durationInFrames={A.montage - A.strike}>
      <Impact at={0}><Shot take="take-a" from={11.24} rate={0.5} focus={HAMMER} /></Impact>
      <Flash />
      <Stamp word="ИДЕАЛЬНО" value="+25%" color={C.gold} />
    </Sequence>

    {/* 7–9.5 s: a strike on every other beat, the bar fills to 100% */}
    <Sequence from={A.montage} durationInFrames={24}><MontageStrike take="take-a" at={STRIKE.a2} /></Sequence>
    <Sequence from={A.montage + 24} durationInFrames={24}><MontageStrike take="take-a" at={STRIKE.a3} /></Sequence>
    <Sequence from={A.montage + 48} durationInFrames={A.win - A.montage - 48}><MontageStrike take="take-a" at={STRIKE.a4} /></Sequence>

    {/* 9.5–10.3 s: the win */}
    <Sequence from={A.win} durationInFrames={A.cta - A.win}>
      <Shot take="take-a" from={43.1} focus={820} zoom={FIT * 1.04} />
      <Confetti />
    </Sequence>
    <Sequence from={A.strike} durationInFrames={A.cta - A.strike}>
      <ProgressBar steps={[[0, 25], [24, 50], [48, 75], [72, 100]]} />
    </Sequence>

    <Sequence from={A.cta}>
      <Cta head={<>Сможешь<br />так же?</>} sub="Проверь себя." />
    </Sequence>

    <Audio src={track('music-a')} volume={0.6} />
    <StrikeSounds at={6} big />
    <Sfx at={A.card - 2} src={track('whoosh')} volume={0.6} />
    <Sfx at={A.card + 16} src={track('pop')} volume={0.7} />
    <Sfx at={A.ask} src={track('impact')} volume={0.5} />
    {[0, 1, 2].map((i) => <Sfx key={i} at={A.ask + Math.round(i * BEAT)} src={track('tick')} volume={1} />)}
    <Sfx at={A.tap + 2} src={track('pop')} volume={0.8} />
    <Sfx at={A.correct} src={track('ding')} volume={0.8} />
    <Sfx at={A.hammer} src={track('whoosh')} volume={0.4} />
    {[2, 13, 23, 31, 37].map((f) => <Sfx key={f} at={A.hammer + f} src={track('tick')} volume={0.9} />)}
    <StrikeSounds at={A.strike} big />
    {[0, 1, 2].map((i) => <StrikeSounds key={i} at={A.montage + 24 * i + LEAD} />)}
    <Sfx at={A.win} src={track('success')} volume={0.85} />
    <Sfx at={A.win} src={track('confetti')} volume={0.8} />
    <Sfx at={A.cta - 6} src={track('whoosh')} volume={0.6} />
  </AbsoluteFill>
);

// ---------- Version B: knowing is not enough, 12.8 s ----------

const B = { question: 0, correct: 30, hammer: 54, miss: 99, card: 135, retry: 168, perfect: 180, montage: 200, cta: 277 };
export const B_DURATION = Math.round(versions.b.length * 30);

export const PromoB = () => (
  <AbsoluteFill style={stage}>
    <Sequence from={B.question} durationInFrames={B.correct - B.question}>
      <Shot take="take-b" from={6.05} focus={QUESTION} zoom={1.5} zoomFrom={1.8} />
      <Caption>Знаешь ответ?</Caption>
    </Sequence>
    <Sequence from={B.correct} durationInFrames={B.hammer - B.correct}>
      <Shot take="take-b" from={7.65} focus={QUESTION} zoom={1.5} />
      <Caption top={1440} bg={C.green}>Верно. Теперь удар.</Caption>
    </Sequence>
    <Sequence from={B.hammer} durationInFrames={B.miss - B.hammer}>
      <Shot take="take-b" from={10.5} rate={0.973} focus={HAMMER} />
      <Caption>Попади в центр</Caption>
    </Sequence>

    {/* 3.3 s: the miss */}
    <Sequence from={B.miss} durationInFrames={B.card - B.miss}>
      <Impact at={0} strength={0.45}><Shot take="take-b" from={11.96} rate={0.5} focus={HAMMER} grey={0.75} /></Impact>
      <Flash color="rgba(240,74,62,1)" peak={0.3} />
      <Stamp word="МИМО" value="+0%" color={C.red} />
    </Sequence>

    <Sequence from={B.card} durationInFrames={B.retry - B.card}>
      <TitleCard lines={[{ text: 'Знать ответ', at: 0, size: 120 }, { text: 'недостаточно.', at: 8, color: C.red, size: 120 }]} />
    </Sequence>

    {/* 6 s: the drop lands on a perfect strike */}
    <Sequence from={B.retry} durationInFrames={B.montage - B.retry}>
      <Impact at={B.perfect - B.retry}><Shot take="take-b" from={STRIKE.b2 - (B.perfect - B.retry) / 30} focus={HAMMER} /></Impact>
      <Sequence from={B.perfect - B.retry} layout="none"><Flash /></Sequence>
      <Sequence from={B.perfect - B.retry} layout="none"><Stamp word="ИДЕАЛЬНО" value="+25%" color={C.gold} /></Sequence>
    </Sequence>
    <Sequence from={B.montage} durationInFrames={24}><MontageStrike take="take-b" at={STRIKE.b3} /></Sequence>
    <Sequence from={B.montage + 24} durationInFrames={24}><MontageStrike take="take-a" at={STRIKE.a2} /></Sequence>
    <Sequence from={B.montage + 48} durationInFrames={B.cta - B.montage - 48}><MontageStrike take="take-a" at={STRIKE.a3} /></Sequence>
    <Sequence from={B.perfect} durationInFrames={B.cta - B.perfect}>
      <ProgressBar steps={[[0, 25], [24, 50], [48, 75], [72, 100]]} />
    </Sequence>
    <Sequence from={B.montage + 48 + LEAD + 6} durationInFrames={B.cta - B.montage - 48 - LEAD - 6}><Confetti /></Sequence>

    <Sequence from={B.cta}>
      <Cta logoFirst head={<>Здесь решает<br />не только IQ.</>} sub={<span style={{ color: C.red, fontSize: 80 }}>А ты попадёшь?</span>} />
    </Sequence>

    <Audio src={track('music-b')} volume={0.6} />
    {[0, 1, 2].map((i) => <Sfx key={i} at={Math.round(i * BEAT)} src={track('tick')} volume={0.9} />)}
    <Sfx at={27} src={track('pop')} volume={0.8} />
    <Sfx at={B.correct} src={track('ding')} volume={0.8} />
    <Sfx at={B.hammer} src={track('whoosh')} volume={0.4} />
    {[2, 14, 25, 34, 41].map((f) => <Sfx key={f} at={B.hammer + f} src={track('tick')} volume={0.9} />)}
    <Sfx at={B.miss} src={track('flop')} volume={0.9} />
    <Sfx at={B.miss} src={sfx('strike-miss')} volume={0.5} />
    <Sfx at={B.card - 3} src={track('whoosh')} volume={0.5} />
    {[0, 1, 2].map((i) => <Sfx key={i} at={B.retry + i * 4} src={track('tick')} volume={0.8} />)}
    <StrikeSounds at={B.perfect} big />
    {[0, 1, 2].map((i) => <StrikeSounds key={i} at={B.montage + 24 * i + LEAD} />)}
    <Sfx at={B.montage + 48 + LEAD + 6} src={track('success')} volume={0.8} />
    <Sfx at={B.montage + 48 + LEAD + 6} src={track('confetti')} volume={0.8} />
    <Sfx at={B.cta - 6} src={track('whoosh')} volume={0.6} />
  </AbsoluteFill>
);
