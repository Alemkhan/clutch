// Synthesises the promo soundtrack and ad-style effects from scratch (no third-party audio, no licence).
// Run: node audio/synth.mjs  → promo/public/audio/*.wav
// The track is written against the promo timeline: drop when the phone enters (2.2 s), a new section
// on the strike montage (8.69 s), the final chord on the call to action (13.55 s). 148 BPM makes those
// three moments land on bar lines.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');
fs.mkdirSync(OUT, { recursive: true });

// ---------- helpers ----------
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
const lpCoef = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / SR);
const note = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI → Hz

function writeWav(name, data, gainDb = -1) {
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 10 ** (gainDb / 20) / peak : 1;
  const out = Buffer.alloc(44 + data.length * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + data.length * 2, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i] * g)) * 32767), 44 + i * 2);
  fs.writeFileSync(path.join(OUT, `${name}.wav`), out);
  console.log(`${name}.wav  ${(data.length / SR).toFixed(2)} s`);
}

/** Adds `fn(t)` for `dur` seconds starting at `at` into `track`. */
function add(track, at, dur, fn, gain = 1) {
  const s0 = Math.floor(at * SR);
  const n = Math.floor(dur * SR);
  for (let i = 0; i < n && s0 + i < track.length; i++) if (s0 + i >= 0) track[s0 + i] += fn(i / SR, i) * gain;
}

// ---------- instruments ----------
function kick(track, at, gain = 1) {
  let ph = 0;
  add(track, at, 0.42, (t) => {
    const f = 46 + 120 * Math.exp(-t * 32);
    ph += (2 * Math.PI * f) / SR;
    const click = t < 0.004 ? (1 - t / 0.004) * 0.6 : 0;
    return Math.tanh(Math.sin(ph) * 1.6) * Math.exp(-t * 7) + click;
  }, gain);
}

function clap(track, at, gain = 1) {
  let lo = 0, hi = 0;
  const a1 = lpCoef(4200), a2 = lpCoef(900);
  add(track, at, 0.28, (t) => {
    const n = rnd();
    lo += a1 * (n - lo); hi += a2 * (n - hi);
    const band = lo - hi;
    const bursts = (t < 0.012 ? 1 : 0) + (t > 0.014 && t < 0.024 ? 0.8 : 0);
    return band * (Math.exp(-t * 22) + bursts * 0.6) * 2.2;
  }, gain);
}

function hat(track, at, open = false, gain = 1) {
  let lo = 0;
  const a = lpCoef(7500);
  add(track, at, open ? 0.22 : 0.06, (t) => {
    const n = rnd();
    lo += a * (n - lo);
    return (n - lo) * Math.exp(-t * (open ? 14 : 70));
  }, gain);
}

function saw(phase) { return 2 * (phase - Math.floor(phase + 0.5)); }

function supersaw(track, at, dur, midis, { cutoff = 2400, attack = 0.005, decay = 6, gain = 1, sweepTo = null } = {}) {
  const voices = midis.flatMap((m) => [-0.12, 0, 0.12].map((d) => ({ f: note(m + d), p: Math.random() })));
  let y = 0;
  add(track, at, dur, (t) => {
    let x = 0;
    for (const v of voices) { v.p += v.f / SR; x += saw(v.p); }
    x /= voices.length;
    const fc = sweepTo ? cutoff + (sweepTo - cutoff) * Math.min(1, t / dur) : cutoff;
    y += lpCoef(fc) * (x - y);
    const env = Math.min(1, t / attack) * Math.exp(-t * decay);
    return y * env;
  }, gain);
}

function bass(track, at, dur, midi, gain = 1) {
  let p = 0, y = 0;
  const f = note(midi);
  add(track, at, dur, (t) => {
    p += f / SR;
    const x = saw(p) * 0.7 + Math.sin(2 * Math.PI * p) * 0.6;
    y += lpCoef(520) * (x - y);
    return y * Math.min(1, t / 0.004) * Math.exp(-t * 3.5);
  }, gain);
}

function pluck(track, at, midi, gain = 1) {
  let p = 0, y = 0;
  const f = note(midi);
  add(track, at, 0.22, (t) => {
    p += f / SR;
    const x = (p % 1 < 0.5 ? 1 : -1) * 0.6 + saw(p) * 0.4;
    y += lpCoef(1800 + 2600 * Math.exp(-t * 18)) * (x - y);
    return y * Math.exp(-t * 16);
  }, gain);
}

function noiseRiser(track, at, dur, gain = 1) {
  let y = 0;
  add(track, at, dur, (t) => {
    const k = t / dur;
    y += lpCoef(300 + 9000 * k * k) * (rnd() - y);
    return y * k * k;
  }, gain);
}

function boom(track, at, gain = 1) {
  let ph = 0, y = 0;
  add(track, at, 1.4, (t) => {
    const f = 38 + 60 * Math.exp(-t * 9);
    ph += (2 * Math.PI * f) / SR;
    y += lpCoef(1400 * Math.exp(-t * 4) + 120) * (rnd() - y);
    return Math.sin(ph) * Math.exp(-t * 3.2) * 1.1 + y * Math.exp(-t * 6) * 0.9;
  }, gain);
}

// ---------- music ----------
const BPM = 148;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
// A minor: Am – F – C – G; the final chord is C major.
const PROG = [
  { root: 45, chord: [57, 60, 64] },
  { root: 41, chord: [57, 60, 65] },
  { root: 48, chord: [55, 60, 64] },
  { root: 43, chord: [55, 59, 62] },
];

/**
 * One track per promo cut. drop: first downbeat of the groove; finalBar: bars after the drop to the
 * closing chord (the call to action); hotFromBar: where the 16th hats and arp come in; gaps: windows of
 * silence (the held breath before a strike); tension: a pulsing low pad instead of a sweep before the drop.
 */
function buildMusic(name, cfg) {
  const music = buf(cfg.length);
  const final = cfg.drop + cfg.finalBar * BAR;
  const padTo = cfg.padTo ?? cfg.drop;
  if (cfg.tension) {
    // Low pulsing Am pad that tightens towards padTo.
    let y = 0;
    const voices = [45, 57, 60, 64].map((m) => ({ f: note(m), p: 0 }));
    add(music, cfg.padFrom, padTo - cfg.padFrom, (t) => {
      let x = 0;
      for (const v of voices) { v.p += v.f / SR; x += saw(v.p); }
      x /= voices.length;
      const k = t / (padTo - cfg.padFrom);
      y += lpCoef(220 + 1400 * k) * (x - y);
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * (t / BEAT) * (1 + k)));
      return y * pulse * Math.min(1, t / 0.4);
    }, 0.55);
    for (let t = cfg.padFrom; t < padTo; t += BEAT) kick(music, t, 0.35);
  } else {
    supersaw(music, cfg.padFrom, padTo - cfg.padFrom, [57, 60, 64, 69], { cutoff: 300, sweepTo: 3200, attack: Math.min(1.2, padTo - cfg.padFrom), decay: 0, gain: 0.32 });
  }
  noiseRiser(music, cfg.rollFrom, cfg.drop - cfg.rollFrom, 0.35);
  for (let t = cfg.rollFrom; t < cfg.drop - 0.01;) {
    const left = cfg.drop - t;
    const span = cfg.drop - cfg.rollFrom;
    clap(music, t, 0.25 + 0.6 * (1 - left / span));
    t += left > span / 2 ? BEAT / 2 : left > span / 4 ? BEAT / 4 : BEAT / 8;
  }
  for (let bar = 0; bar < cfg.finalBar; bar++) {
    const at = cfg.drop + bar * BAR;
    const { root, chord } = PROG[bar % 4];
    const hot = bar >= cfg.hotFromBar;
    for (let b = 0; b < 4; b++) {
      const beat = at + b * BEAT;
      kick(music, beat, 0.95);
      if (b % 2 === 1) clap(music, beat, 0.55);
      hat(music, beat + BEAT / 2, b === 3, 0.35);
      if (hot) { hat(music, beat + BEAT / 4, false, 0.18); hat(music, beat + (3 * BEAT) / 4, false, 0.18); }
      bass(music, beat + BEAT / 2, BEAT / 2, root + 12, 0.55);
      bass(music, beat + BEAT * 0.75, BEAT / 4, root + 12, 0.35);
      supersaw(music, beat + BEAT / 2, 0.24, chord, { cutoff: hot ? 3600 : 2600, decay: 11, gain: 0.26 });
    }
    if (hot) {
      const tones = [...chord, chord[0] + 12, chord[1] + 12, chord[2] + 12];
      for (let i = 0; i < 16; i++) pluck(music, at + (i * BEAT) / 4, tones[(i * 2) % tones.length] + 12, 0.16);
    }
  }
  for (let i = 0; i < 4; i++) clap(music, final - BEAT + (i * BEAT) / 4, 0.3 + i * 0.12);
  kick(music, final, 1);
  boom(music, final, 0.7);
  supersaw(music, final, cfg.length - final, [48, 60, 64, 67, 72], { cutoff: 4200, sweepTo: 900, attack: 0.01, decay: 0.55, gain: 0.5 });
  bass(music, final, 2.2, 36, 0.7);
  for (let i = 0; i < music.length; i++) {
    const t = i / SR;
    let g = t > cfg.length - 0.6 ? Math.max(0, (cfg.length - t) / 0.6) : 1;
    for (const [a, b] of cfg.gaps ?? []) {
      if (t > a - 0.03 && t < b) g *= t < a ? (a - t) / 0.03 : 0;
    }
    music[i] = Math.tanh(music[i] * 1.4) * g;
  }
  writeWav(name, music, -1.5);
  console.log(`  ${name}: drop ${cfg.drop}s, hot ${(cfg.drop + cfg.hotFromBar * BAR).toFixed(3)}s, final ${final.toFixed(3)}s`);
}

const versions = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'versions.json'), 'utf8'));
buildMusic('music-a', versions.a);
buildMusic('music-b', versions.b);
buildMusic('music', versions.promo);

// ---------- effects ----------
const fx = (name, sec, draw, db = -1) => { const b = buf(sec); draw(b); writeWav(name, b, db); };

fx('riser', 2.2, (b) => {
  noiseRiser(b, 0, 2.15, 0.8);
  let ph = 0;
  add(b, 0, 2.15, (t) => { ph += (2 * Math.PI * (180 + 700 * (t / 2.15) ** 2)) / SR; return Math.sin(ph) * (t / 2.15) ** 2 * 0.5; });
});

fx('whoosh', 0.55, (b) => {
  let y1 = 0, y2 = 0;
  add(b, 0, 0.55, (t) => {
    const k = t / 0.55;
    const fc = 400 + 5200 * Math.sin(Math.PI * k);
    const n = rnd();
    y1 += lpCoef(fc) * (n - y1); y2 += lpCoef(fc * 0.35) * (n - y2);
    return (y1 - y2) * Math.sin(Math.PI * k) ** 1.5;
  });
});

fx('impact', 1.2, (b) => { boom(b, 0, 1); kick(b, 0, 0.8); });

fx('pop', 0.12, (b) => {
  let ph = 0;
  add(b, 0, 0.12, (t) => { ph += (2 * Math.PI * (700 + 1100 * Math.min(1, t / 0.03))) / SR; return Math.sin(ph) * Math.exp(-t * 38); });
}, -4);

const chime = (b, at, midi, gain = 1) => {
  const f = note(midi);
  add(b, at, 0.9, (t) => (
    Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 6) + 0.25 * Math.sin(2 * Math.PI * f * 3.01 * t) * Math.exp(-t * 9)
  ) * Math.exp(-t * 4.5) * Math.min(1, t / 0.003), gain);
};

fx('ding', 1.0, (b) => { chime(b, 0, 88); chime(b, 0.09, 95, 0.8); }, -2);

fx('success', 1.5, (b) => {
  [72, 76, 79, 84].forEach((m, i) => chime(b, i * 0.085, m, 0.9));
  supersaw(b, 0.34, 1.1, [72, 76, 79, 84], { cutoff: 5000, decay: 2.2, gain: 0.5 });
}, -1.5);

fx('tick', 0.08, (b) => {
  add(b, 0, 0.08, (t) => ((t * 2400) % 1 < 0.5 ? 1 : -1) * Math.exp(-t * 60));
}, -6);

fx('sparkle', 0.9, (b) => {
  [96, 100, 103, 108, 103, 108].forEach((m, i) => chime(b, i * 0.035, m, 0.5 - i * 0.05));
}, -3);

fx('fill', 0.45, (b) => {
  let ph = 0;
  add(b, 0, 0.42, (t) => { ph += (2 * Math.PI * (500 * 2 ** (t / 0.42 * 1.4))) / SR; return (Math.sin(ph) * 0.7 + ((ph / (2 * Math.PI)) % 1 < 0.5 ? 0.2 : -0.2)) * Math.min(1, t / 0.01) * (1 - t / 0.45); });
}, -3);

fx('flop', 1.0, (b) => {
  // A dull, deflating thud: low knock plus a sliding "bwomp".
  kick(b, 0, 0.7);
  let ph = 0, y = 0;
  add(b, 0.04, 0.9, (t) => {
    ph += (2 * Math.PI * (220 * 2 ** (-t * 2.2))) / SR;
    y += lpCoef(900) * (saw(ph / (2 * Math.PI)) - y);
    return y * Math.exp(-t * 2.5) * Math.min(1, t / 0.02);
  }, 0.9);
}, -2);

fx('confetti', 0.9, (b) => {
  let y = 0;
  add(b, 0, 0.12, (t) => { y += lpCoef(3000) * (rnd() - y); return y * Math.exp(-t * 30) * 2; });
  for (let i = 0; i < 14; i++) {
    const at = 0.05 + i * 0.045 + (rnd() + 1) * 0.01;
    const f = 2500 + (rnd() + 1) * 1800;
    add(b, at, 0.05, (t) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 70), 0.35);
  }
}, -3);
