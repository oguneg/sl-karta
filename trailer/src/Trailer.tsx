import { loadFont } from '@remotion/google-fonts/Inter';
import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { NetworkLines, useNetwork } from './Network';
import measured from './rects.json';

const { fontFamily } = loadFont('normal', { weights: ['500', '700', '800'], subsets: ['latin'] });

// 120 BPM: one beat = 15 frames, one bar = 60 frames. Every cut lands on a beat.
export const TRAILER_FRAMES = 900;

const C = {
  bg: '#0a1120',
  text: '#f3f6fb',
  sub: '#9aabc4',
  accent: '#4fb3ff',
  pink: '#ec619f',
};

// Screenshots are 390 × 844 CSS px (captured at 2.5×). Highlights below use that space.
type Rect = { x: number; y: number; w: number; h: number };
type SceneDef = { from: number; dur: number; shot: string; title: string; sub: string; side: 'left' | 'right'; focus?: Rect };
const rects = measured as Record<string, Rect | null>;
// The filter row's container spans the width; the five 40 px toggles (8 px apart) are what to point at.
const mapFocus = rects.map ? { ...rects.map, w: 5 * 40 + 4 * 8 } : undefined;

const SCENES: SceneDef[] = [
  { from: 120, dur: 150, shot: 'map', side: 'right', title: 'Every bus, train\nand metro. Live.', sub: 'All of Stockholm moving on one map.', focus: mapFocus },
  { from: 270, dur: 120, shot: 'lines', side: 'left', title: 'Tap a stop.\nSee every line.', sub: 'Metro, pendeltåg and buses, drawn where they go.', focus: rects.lines ?? undefined },
  { from: 390, dur: 120, shot: 'vehicle', side: 'right', title: 'Follow it to\nyour stop.', sub: 'Live arrival times, stop by stop.', focus: rects.vehicle ?? undefined },
  { from: 510, dur: 120, shot: 'favorites', side: 'left', title: 'Save your rides.', sub: 'Sollentuna → Odenplan: every line that gets you there.', focus: rects.favorites ?? undefined },
  { from: 630, dur: 90, shot: 'plan', side: 'right', title: 'Plan your day.', sub: 'It works out which departures you make.', focus: rects.plan ?? undefined },
  { from: 720, dur: 60, shot: 'nearby', side: 'left', title: 'What leaves\nnear you.', sub: 'The next departures, wherever you stand.' },
];

const ease = Easing.bezier(0.16, 1, 0.3, 1); // exponential-feeling ease-out

export function Trailer() {
  const network = useNetwork();
  const frame = useCurrentFrame();
  // Background network: drawn in the intro, then a dim, slowly drifting layer.
  const bgOpacity = interpolate(frame, [100, 140, 840, 870], [1, 0.14, 0.14, 0.5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const draw = interpolate(frame, [0, 95], [0, 1], { extrapolateRight: 'clamp', easing: ease });
  const drift = interpolate(frame, [0, TRAILER_FRAMES], [1, 1.12]);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 90% at 50% 40%, #12203a 0%, ${C.bg} 70%)`, fontFamily, color: C.text }}>
      <AbsoluteFill style={{ transform: `scale(${drift})` }}>
        <NetworkLines data={network} draw={draw} opacity={bgOpacity} strokeWidth={3.2} focus={0.72} />
      </AbsoluteFill>

      <Sequence durationInFrames={125}><Intro /></Sequence>
      {SCENES.map((s) => (
        <Sequence key={s.shot} from={s.from} durationInFrames={s.dur}><PhoneScene {...s} /></Sequence>
      ))}
      <Sequence from={780} durationInFrames={60}><DesktopScene /></Sequence>
      <Sequence from={840} durationInFrames={60}><Outro /></Sequence>

      <Audio src={staticFile('music.wav')} />
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------------------------------ */

const Pool = () => (
  <AbsoluteFill style={{ background: 'radial-gradient(38% 32% at 50% 50%, rgba(10,17,32,0.92) 0%, rgba(10,17,32,0.6) 55%, rgba(10,17,32,0) 100%)' }} />
);

function Intro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - 45, fps, config: { damping: 200 } });
  const t2 = spring({ frame: frame - 62, fps, config: { damping: 200 } });
  const out = interpolate(frame, [105, 125], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: out }}>
      <AbsoluteFill style={{ opacity: t }}><Pool /></AbsoluteFill>
      <div style={{ textAlign: 'center', transform: `translateY(${(1 - t) * 30}px)`, opacity: t }}>
        <div style={{ fontSize: 168, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1, textShadow: '0 6px 40px rgba(0,0,0,0.6)' }}>
          SL Karta
        </div>
        <div style={{ marginTop: 26, fontSize: 48, fontWeight: 500, color: C.sub, opacity: t2, transform: `translateY(${(1 - t2) * 16}px)` }}>
          Stockholm, live.
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------------------------------ */

const PHONE_H = 880;
const PHONE_W = Math.round((PHONE_H * 390) / 844);
const SCALE = PHONE_W / 390; // CSS px of the screenshot → video px

function PhoneScene({ dur, shot, title, sub, side, focus }: SceneDef) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 90, mass: 0.9 } });
  const exit = interpolate(frame, [dur - 10, dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const dir = side === 'right' ? 1 : -1;
  const phoneX = side === 'right' ? 1920 - 300 - PHONE_W / 2 : 300 + PHONE_W / 2;
  const textX = side === 'right' ? 170 : 1920 - 170 - 760;
  const tilt = interpolate(enter, [0, 1], [dir * 9, dir * 2.5]) + exit * dir * 6;
  const lift = (1 - enter) * 260 + exit * -60;
  const drift = interpolate(frame, [0, dur], [1, 1.035]);

  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <div style={{
        position: 'absolute', left: phoneX - PHONE_W / 2, top: (1080 - PHONE_H) / 2,
        transform: `translateY(${lift}px) rotate(${tilt}deg) scale(${drift})`, opacity: Math.min(1, enter * 1.4),
      }}>
        <Phone shot={shot} focus={focus} frame={frame} dur={dur} />
      </div>
      <div style={{ position: 'absolute', left: textX, top: 0, bottom: 0, width: 760, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Words text={title} frame={frame} style={{ fontSize: 92, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.02 }} />
        <Rise frame={frame} delay={14} style={{ marginTop: 30, fontSize: 36, fontWeight: 500, color: C.sub, lineHeight: 1.3, maxWidth: 680 }}>
          {sub}
        </Rise>
      </div>
    </AbsoluteFill>
  );
}

function Phone({ shot, focus, frame, dur }: { shot: string; focus?: Rect; frame: number; dur: number }) {
  // Highlight pulse arrives a third into the scene.
  const on = interpolate(frame, [dur * 0.32, dur * 0.42], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const pulse = 0.5 + 0.5 * Math.sin((frame - dur * 0.32) / 6);
  return (
    <div style={{
      width: PHONE_W + 24, height: PHONE_H + 24, padding: 12, borderRadius: 64, background: '#05080f',
      boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.4), inset 0 0 0 2px #1d2a40',
    }}>
      <div style={{ position: 'relative', width: PHONE_W, height: PHONE_H, borderRadius: 52, overflow: 'hidden', background: '#fff' }}>
        <Img src={staticFile(`shots/${shot}.png`)} style={{ width: '100%', height: '100%', display: 'block' }} />
        {focus && (
          <div style={{
            position: 'absolute',
            left: focus.x * SCALE - 6, top: focus.y * SCALE - 6, width: focus.w * SCALE + 12, height: focus.h * SCALE + 12,
            borderRadius: 18, border: `3px solid ${C.accent}`, opacity: on,
            boxShadow: `0 0 ${18 + pulse * 18}px ${C.accent}`,
            transform: `scale(${1.08 - on * 0.08})`,
          }} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

function DesktopScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 80 } });
  const exit = interpolate(frame, [50, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const W = 1240, H = Math.round((W * 900) / 1440);
  return (
    <AbsoluteFill style={{ alignItems: 'center', opacity: 1 - exit }}>
      <Words text="On your phone. On the web." frame={frame} style={{ marginTop: 70, fontSize: 70, fontWeight: 800, letterSpacing: '-0.03em' }} />
      <div style={{
        marginTop: 44, width: W + 16, height: H + 16, padding: 8, borderRadius: 22, background: '#05080f',
        boxShadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 0 0 2px #1d2a40',
        transform: `translateY(${(1 - enter) * 120}px) scale(${0.94 + enter * 0.06})`, opacity: enter,
      }}>
        <Img src={staticFile('shots/desktop.png')} style={{ width: W, height: H, borderRadius: 14, display: 'block' }} />
      </div>
    </AbsoluteFill>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame, fps, config: { damping: 200 } });
  const t2 = spring({ frame: frame - 10, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <AbsoluteFill style={{ opacity: t }}><Pool /></AbsoluteFill>
      <div style={{ opacity: t, transform: `scale(${0.96 + t * 0.04})` }}>
        <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1, textShadow: '0 6px 40px rgba(0,0,0,0.6)' }}>SL Karta</div>
        <div style={{ marginTop: 22, fontSize: 40, fontWeight: 500, color: C.sub }}>Live map · Departures · Your rides</div>
      </div>
      <div style={{
        marginTop: 54, opacity: t2, transform: `translateY(${(1 - t2) * 18}px)`,
        fontSize: 46, fontWeight: 700, color: C.accent, letterSpacing: '-0.01em',
      }}>
        sl.ogun.se
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------------------------------ */

/** Headline whose words rise in one after another. `\n` breaks lines. */
function Words({ text, frame, style }: { text: string; frame: number; style: CSSProperties }) {
  const { fps } = useVideoConfig();
  let i = 0;
  return (
    <div style={style}>
      {text.split('\n').map((lineText, li) => (
        <div key={li} style={{ display: 'block' }}>
          {lineText.split(' ').map((w) => {
            const k = i++;
            const p = spring({ frame: frame - 4 - k * 3, fps, config: { damping: 22, stiffness: 140 } });
            return (
              <span key={k} style={{ display: 'inline-block', marginRight: '0.24em', opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>
                {w}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Rise({ children, frame, delay, style }: { children: ReactNode; frame: number; delay: number; style: CSSProperties }) {
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return <div style={{ ...style, opacity: p, transform: `translateY(${(1 - p) * 20}px)` }}>{children}</div>;
}
