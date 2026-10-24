// Генерация звуковых эффектов (синтез, без внешних ассетов): node scripts/make-sounds.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 22050;
const out = new URL('../assets/sounds/', import.meta.url);
mkdirSync(out, { recursive: true });

/** Тон с экспоненциальным затуханием и быстрой атакой, чтобы не щёлкало. */
function tone(freq, ms, { gain = 0.5, decay = 6, glide = 0, noise = 0 } = {}) {
  const n = Math.floor((RATE * ms) / 1000);
  const a = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = freq + glide * (i / n);
    phase += (2 * Math.PI * f) / RATE;
    const env = Math.min(1, i / (RATE * 0.004)) * Math.exp((-decay * i) / n);
    a[i] = (Math.sin(phase) * (1 - noise) + (Math.random() * 2 - 1) * noise) * env * gain;
    void t;
  }
  return a;
}
const concat = (...parts) => {
  const len = parts.reduce((x, p) => x + p.length, 0);
  const r = new Float32Array(len);
  let o = 0;
  for (const p of parts) {
    r.set(p, o);
    o += p.length;
  }
  return r;
};
const silence = (ms) => new Float32Array(Math.floor((RATE * ms) / 1000));
const mix = (a, b) => {
  const r = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < r.length; i++) r[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return r;
};

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767, 44 + i * 2));
  return buf;
}

const sounds = {
  tap: tone(1400, 35, { gain: 0.35, decay: 8 }),
  move: mix(tone(180, 90, { gain: 0.6, decay: 7 }), tone(520, 60, { gain: 0.25, decay: 9, noise: 0.15 })),
  win: concat(tone(523, 130, { gain: 0.4 }), tone(659, 130, { gain: 0.4 }), tone(784, 130, { gain: 0.4 }), tone(1047, 380, { gain: 0.45, decay: 4 })),
  lose: concat(tone(392, 170, { gain: 0.4 }), tone(330, 170, { gain: 0.4 }), tone(262, 420, { gain: 0.45, decay: 4 })),
  notify: concat(tone(880, 110, { gain: 0.4 }), silence(30), tone(1175, 220, { gain: 0.4, decay: 5 })),
  dice: concat(tone(300, 40, { gain: 0.4, noise: 0.8, decay: 7 }), silence(25), tone(260, 40, { gain: 0.4, noise: 0.8, decay: 7 }), silence(25), tone(340, 60, { gain: 0.45, noise: 0.7, decay: 6 })),
  card: tone(900, 55, { gain: 0.3, decay: 9, noise: 0.6, glide: -500 }),
};
for (const [name, data] of Object.entries(sounds)) writeFileSync(new URL(`${name}.wav`, out), wav(data));
console.log('Готово:', Object.keys(sounds).join(', '));
