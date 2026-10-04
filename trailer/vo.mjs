// Voiceover with Gemini TTS: one clip per line in src/script.json -> public/vo/<id>.wav, and the
// spoken lengths -> src/vo.json (the timeline stretches each scene to fit its line).
// Needs GEMINI_API_KEY (environment or trailer/.env). Optional: GEMINI_TTS_MODEL, GEMINI_VOICE.
import fs from 'node:fs';
import path from 'node:path';

function env(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync('.env')) return undefined;
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith(name + '='));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

const KEY = env('GEMINI_API_KEY');
if (!KEY) {
  console.error('Missing GEMINI_API_KEY (set it in trailer/.env).');
  process.exit(1);
}
const MODEL = env('GEMINI_TTS_MODEL') ?? 'gemini-2.5-flash-preview-tts';
const VOICE = env('GEMINI_VOICE') ?? 'Charon';
const STYLE = env('GEMINI_STYLE') ??
  'Read this as the warm, confident narrator of a modern app trailer: clear, upbeat, natural pacing, not shouting. Say only the line:';

const script = JSON.parse(fs.readFileSync('src/script.json', 'utf8'));
fs.mkdirSync('public/vo', { recursive: true });

async function tts(text) {
  const body = {
    contents: [{ parts: [{ text: `${STYLE} "${text}"` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    },
  };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, // header, not URL: keeps the key out of logs
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!part) throw new Error('No audio in response: ' + JSON.stringify(json).slice(0, 300));
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
      return { pcm: Buffer.from(part.inlineData.data, 'base64'), rate };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
}

/** Trim leading/trailing near-silence from 16-bit mono PCM, keeping a few ms of air. */
function trim(pcm, rate) {
  const n = pcm.length / 2, thr = 500, pad = Math.round(rate * 0.03);
  let a = 0, b = n - 1;
  while (a < n && Math.abs(pcm.readInt16LE(a * 2)) < thr) a++;
  while (b > a && Math.abs(pcm.readInt16LE(b * 2)) < thr) b--;
  a = Math.max(0, a - pad);
  b = Math.min(n - 1, b + pad);
  return pcm.subarray(a * 2, (b + 1) * 2);
}

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const out = {};
for (const s of script) {
  process.stdout.write(`  ${s.id.padEnd(10)} "${s.vo}" … `);
  const { pcm, rate } = await tts(s.vo);
  const clip = trim(pcm, rate);
  const file = `vo/${s.id}.wav`;
  fs.writeFileSync(path.join('public', file), wav(clip, rate));
  out[s.id] = { file, seconds: +(clip.length / 2 / rate).toFixed(3) };
  console.log(`${out[s.id].seconds}s`);
}
fs.writeFileSync('src/vo.json', JSON.stringify(out, null, 2) + '\n');
const total = script.reduce((t, s) => t + out[s.id].seconds, 0);
console.log(`voice: ${MODEL} / ${VOICE}, ${total.toFixed(1)}s of speech. Now: npm run music && npm run render`);
