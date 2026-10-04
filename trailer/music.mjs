// Generates an original 30 s backing track (public/music.wav): 120 BPM, Am–F–C–G.
// One bar = 2 s = 60 video frames, so scene cuts in the trailer land on bars.
import fs from 'node:fs';

const SR = 44100, BPM = 120, BARS = 15;
const beat = 60 / BPM, bar = beat * 4, dur = BARS * bar;
const N = Math.round(dur * SR);
const L = new Float32Array(N), R = new Float32Array(N);

const midi = (m) => 440 * 2 ** ((m - 69) / 12);
// Am, F, C, G (root note + chord tones), one chord per bar.
const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const INTRO = 2; // bars before the drop
const OUTRO_FROM = 14; // last bar fades

function add(buf, start, samples, gainL, gainR) {
  const s0 = Math.round(start * SR);
  for (let i = 0; i < samples.length && s0 + i < N; i++) {
    L[s0 + i] += samples[i] * gainL;
    R[s0 + i] += samples[i] * gainR;
  }
}

function kick() {
  const len = Math.round(0.35 * SR), out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 45 + 110 * Math.exp(-t * 28);
    phase += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(phase) * Math.exp(-t * 7);
  }
  return out;
}
function noise(len, decay, hp = 0.85) {
  const out = new Float32Array(len);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    const h = w - prev * hp; // crude high-pass
    prev = w;
    out[i] = h * Math.exp(-(i / SR) * decay);
  }
  return out;
}
function tone(freq, len, { type = 'saw', attack = 0.01, decay = 2, detune = 0, cutoff = 1 } = {}) {
  const n = Math.round(len * SR), out = new Float32Array(n);
  let p1 = 0, p2 = 0, lp = 0;
  const f1 = freq * (1 + detune), f2 = freq * (1 - detune);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p1 = (p1 + f1 / SR) % 1;
    p2 = (p2 + f2 / SR) % 1;
    let v = type === 'saw' ? (p1 * 2 - 1 + p2 * 2 - 1) / 2 : Math.sin(2 * Math.PI * p1);
    lp += (v - lp) * cutoff; // one-pole low-pass: softens the saw
    const env = Math.min(1, t / attack) * Math.exp(-t * decay);
    out[i] = lp * env;
  }
  return out;
}

const K = kick();
for (let b = 0; b < BARS; b++) {
  const t0 = b * bar;
  const [root, ...tones] = chords[b % 4];
  const fade = b >= OUTRO_FROM ? 0.5 : 1;
  // Pad: whole bar, always (soft intro, holds the outro).
  for (const m of [root, ...tones]) add(L, t0, tone(midi(m), bar + 0.3, { attack: 0.4, decay: 0.6, detune: 0.004, cutoff: 0.06 }), 0.07 * fade, 0.07 * fade);
  // Intro riser on the bar before the drop.
  if (b === INTRO - 1) add(L, t0, noise(Math.round(bar * SR), -1.2, 0.5).map((v, i) => v * (i / (bar * SR)) ** 2 * 0.6), 0.25, 0.25);
  if (b < INTRO) continue;
  for (let q = 0; q < 4; q++) {
    const t = t0 + q * beat;
    add(L, t, K, 0.9 * fade, 0.9 * fade); // kick on every beat
    if (q % 2 === 1) add(L, t, noise(Math.round(0.18 * SR), 22, 0.6), 0.32 * fade, 0.32 * fade); // clap on 2 and 4
    add(L, t + beat / 2, noise(Math.round(0.05 * SR), 70), 0.12 * fade, 0.16 * fade); // off-beat hat
    // Bass: root on the off-beats, octave down.
    add(L, t + beat / 2, tone(midi(root - 12), beat / 2, { decay: 5, cutoff: 0.08 }), 0.5 * fade, 0.5 * fade);
  }
  // Arpeggio: 16ths through the chord, panned slightly right.
  const arp = [root + 12, tones[0] + 12, tones[1] + 12, tones[0] + 12];
  for (let s = 0; s < 16; s++) {
    add(L, t0 + (s * beat) / 4, tone(midi(arp[s % 4]), beat / 4, { decay: 14, cutoff: 0.25, detune: 0.002 }), 0.05 * fade, 0.08 * fade);
  }
}

// Master: gentle fade-in/out and soft clipping.
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const g = Math.min(1, t / 0.5) * Math.min(1, (dur - t) / 1.5);
  L[i] = Math.tanh(L[i] * 1.2) * g;
  R[i] = Math.tanh(R[i] * 1.2) * g;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.89 / peak;

const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(L[i] * norm * 32767), i * 4);
  data.writeInt16LE(Math.round(R[i] * norm * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(data.length, 40);
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/music.wav', Buffer.concat([header, data]));
console.log(`music.wav: ${dur}s, ${(44 + data.length) / 1e6} MB`);
