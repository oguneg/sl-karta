import script from './script.json';
import vo from './vo.json';

export type Segment = (typeof script)[number] & {
  start: number; // frame the segment starts
  dur: number; // frames
  voFile?: string; // public/vo/<id>.wav when generated
  voFrames?: number;
  voDelay: number; // frames into the segment before the line is spoken
};

/** vo.json is written by vo.mjs (Gemini TTS): spoken length per line, so segments fit the voice. */
const voLines = vo as Record<string, { file: string; seconds: number } | undefined>;

export const FPS = 30;
const VO_DELAY: Record<string, number> = { intro: 24, map: 10, outro: 18 };
const TAIL = 14; // breathing room after a line ends

let t = 0;
export const SEGMENTS: Segment[] = script.map((s) => {
  const line = voLines[s.id];
  const voFrames = line ? Math.ceil(line.seconds * FPS) : undefined;
  const voDelay = VO_DELAY[s.id] ?? 6;
  const dur = Math.max(s.min, voFrames ? voDelay + voFrames + TAIL : 0);
  const seg: Segment = { ...s, start: t, dur, voFile: line?.file, voFrames, voDelay };
  t += dur;
  return seg;
});
export const TOTAL_FRAMES = t;
export const seg = (id: string) => SEGMENTS.find((s) => s.id === id)!;
