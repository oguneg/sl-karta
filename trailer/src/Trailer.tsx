import { loadFont } from '@remotion/google-fonts/Inter';
import type { CSSProperties } from 'react';
import {
  AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { CENTER_PX, H, NervousNetwork, useNetwork, W } from './Network';
import measured from './rects.json';
import { seg, SEGMENTS, TOTAL_FRAMES, type Segment } from './timeline';

const { fontFamily } = loadFont('normal', { weights: ['500', '700', '800'], subsets: ['latin'] });
export { TOTAL_FRAMES };

const C = { bg: '#f4f7fb', text: '#0d1726', sub: '#4a5a72', accent: '#0b5ea8' };
const BEAT = 15; // 120 BPM at 30 fps
const OVERLAP = 12; // frames a leaving scene stays on screen while the next one arrives
const out = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

type Rect = { x: number; y: number; w: number; h: number };
const rects = measured as Record<string, Rect | null>;
const FOCUS: Record<string, Rect | undefined> = {
  map: rects.map ? { ...rects.map, w: 5 * 40 + 4 * 8 } : undefined,
  lines: rects.lines ?? undefined,
  vehicle: rects.vehicle ?? undefined,
  favorites: rects.favorites ?? undefined,
  plan: rects.plan ?? undefined,
};
const SHOT: Record<string, string> = { lines: 'lines', vehicle: 'vehicle', favorites: 'favorites', plan: 'plan', nearby: 'nearby' };

/** A soft kick-drum bump: 1 on the beat, decaying quickly. */
const beatPulse = (frame: number) => Math.exp(-(frame % BEAT) / 2.5);

export function Trailer() {
  const network = useNetwork();
  const frame = useCurrentFrame();
  const intro = seg('intro'), map = seg('map'), outro = seg('outro');

  // Network camera: grows while pulling back in the intro, dives into the centre at the cut to the
  // city, rests dimly behind the phones, then returns in full for the outro.
  const grow = interpolate(frame, [0, 80], [0, 1], { ...clamp, easing: Easing.bezier(0.4, 0, 0.2, 1) });
  const dive = interpolate(frame, [map.start - 6, map.start + 22], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const back = interpolate(frame, [map.start + 50, map.start + 80], [0, 1], clamp);
  const fin = interpolate(frame, [outro.start - 8, outro.start + 20], [0, 1], { ...clamp, easing: out });
  const camScale = interpolate(frame, [0, intro.dur], [1.9, 1.05], clamp) * (1 + dive * 5);
  const restScale = 1.12 + Math.sin(frame / 90) * 0.02;
  const scale = back > 0 && fin === 0 ? restScale : fin > 0 ? interpolate(fin, [0, 1], [restScale, 1.0]) : camScale;
  const dim = fin > 0 ? interpolate(fin, [0, 1], [0.42, 1]) : back > 0 ? 0.42 * back : 1 - dive;
  const bump = 1 + beatPulse(frame) * (frame > map.start ? 0.006 : 0);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(110% 90% at 50% 45%, #ffffff 0%, ${C.bg} 65%, #e9eef6 100%)`, fontFamily, color: C.text }}>
      <AbsoluteFill style={{ transformOrigin: `${CENTER_PX[0]}px ${CENTER_PX[1]}px`, transform: `scale(${scale * bump})`, opacity: dim }}>
        <NervousNetwork data={network} frame={frame} grow={grow} glow={fin > 0 ? 1 : 0.85} />
      </AbsoluteFill>

      <Sequence durationInFrames={intro.dur + OVERLAP}><Intro s={intro} /></Sequence>
      <Sequence from={map.start} durationInFrames={map.dur + OVERLAP}><CityMorph s={map} /></Sequence>
      {['lines', 'vehicle', 'favorites', 'plan', 'nearby'].map((id, i) => {
        const s = seg(id);
        return (
          <Sequence key={id} from={s.start} durationInFrames={s.dur + OVERLAP}>
            <PhoneScene s={s} shot={SHOT[id]} side={i % 2 === 0 ? 'left' : 'right'} focus={FOCUS[id]} />
          </Sequence>
        );
      })}
      <Sequence from={seg('desktop').start} durationInFrames={seg('desktop').dur + OVERLAP}><Desktop s={seg('desktop')} /></Sequence>
      <Sequence from={outro.start} durationInFrames={outro.dur}><Outro /></Sequence>

      {SEGMENTS.filter((s) => s.voFile).map((s) => (
        <Sequence key={s.id} from={s.start + s.voDelay}><Audio src={staticFile(s.voFile!)} /></Sequence>
      ))}
      <Audio src={staticFile('music.wav')} volume={(f) => musicVolume(f)} />
    </AbsoluteFill>
  );
}

/** Music sits back while the narrator speaks, with short fades. */
function musicVolume(f: number) {
  const anyVo = SEGMENTS.some((s) => s.voFile);
  if (!anyVo) return 0.9;
  let duck = 0;
  for (const s of SEGMENTS) {
    if (!s.voFrames) continue;
    const a = s.start + s.voDelay, b = a + s.voFrames;
    duck = Math.max(duck, interpolate(f, [a - 6, a, b, b + 10], [0, 1, 1, 0], clamp));
  }
  return 0.85 - duck * 0.55;
}

/* ------------------------------------------------------------------------------------------ */

function Intro({ s }: { s: Segment }) {
  const frame = useCurrentFrame();
  const leave = interpolate(frame, [s.dur - 4, s.dur + OVERLAP], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 1 - leave, transform: `scale(${1 + leave * 0.4})`, filter: `blur(${leave * 10}px)` }}>
      <Halo />
      <Kinetic text={s.caption} accent={s.accent} color={s.color} frame={frame - 58} size={124} center />
    </AbsoluteFill>
  );
}

/** Soft light pool so text sits cleanly on top of the network. */
const Halo = () => (
  <AbsoluteFill style={{ background: 'radial-gradient(30% 24% at 50% 50%, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.55) 60%, rgba(255,255,255,0) 100%)' }} />
);

/* ------------------------------------------------------------------------------------------ */

const PHONE_H = 860;
const PHONE_W = Math.round((PHONE_H * 390) / 844);
const SCREEN = PHONE_W / 390; // screenshot CSS px → video px
const PHONE_TOP = (H - PHONE_H) / 2;
const phoneLeft = (side: 'left' | 'right') => (side === 'right' ? W - 290 - PHONE_W : 290);

/** Full-bleed rush-hour city that shrinks into the phone: the app *is* the city. */
function CityMorph({ s }: { s: Segment }) {
  const frame = useCurrentFrame();
  const m = interpolate(frame, [30, 64], [0, 1], { ...clamp, easing: Easing.bezier(0.65, 0, 0.25, 1) });
  const enter = interpolate(frame, [0, 14], [0, 1], { ...clamp, easing: out });
  const leave = interpolate(frame, [s.dur, s.dur + OVERLAP], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const L = phoneLeft('right');
  const x = interpolate(m, [0, 1], [0, L]), y = interpolate(m, [0, 1], [0, PHONE_TOP]);
  const w = interpolate(m, [0, 1], [W, PHONE_W]), h = interpolate(m, [0, 1], [H, PHONE_H]);
  const radius = m * 52;
  const zoom = interpolate(frame, [0, 40], [1.12, 1.0], { ...clamp, easing: out }); // settle while full-bleed
  const swap = interpolate(frame, [40, 62], [0, 1], clamp); // landscape city → phone map as it shrinks
  const bump = 1 + beatPulse(frame) * 0.01 * m;
  return (
    <AbsoluteFill style={{ opacity: enter }}>
      <div style={{
        position: 'absolute', left: x - m * 12, top: y - m * 12, width: w + m * 24, height: h + m * 24, padding: m * 12,
        borderRadius: radius + m * 12, background: m > 0 ? `rgba(12,18,30,${m})` : 'transparent',
        boxShadow: `0 ${30 * m}px ${80 * m}px rgba(15,23,42,${0.28 * m})`,
        transform: `translateX(${leave * 900}px) rotate(${leave * 10}deg) scale(${bump})`, filter: `blur(${leave * 14}px)`,
      }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: radius, overflow: 'hidden' }}>
          <OffthreadVideo muted src={staticFile('clips/citywide.mp4')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`, opacity: 1 - swap }} />
          <OffthreadVideo muted src={staticFile('clips/map.mp4')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: swap }} />
          {FOCUS.map && swap > 0 && <FocusRing r={FOCUS.map} frame={frame} on={interpolate(frame, [78, 92], [0, 1], clamp)} />}
        </div>
      </div>
      <Caption s={s} frame={frame - 40} side="left" leave={leave} />
    </AbsoluteFill>
  );
}

function PhoneScene({ s, shot, side, focus }: { s: Segment; shot: string; side: 'left' | 'right'; focus?: Rect }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dir = side === 'right' ? 1 : -1;
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 120, mass: 0.8 } });
  const leave = interpolate(frame, [s.dur, s.dur + OVERLAP], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  // Punch in on the detail that matters, hold, then ease back out before leaving.
  const punch = focus
    ? interpolate(frame, [s.dur * 0.3, s.dur * 0.48, s.dur * 0.82, s.dur], [0, 1, 1, 0.15], { ...clamp, easing: Easing.bezier(0.45, 0, 0.2, 1) })
    : interpolate(frame, [0, s.dur], [0, 0.35], clamp);
  const zoom = 1 + punch * 0.62;
  const fx = focus ? (focus.x + focus.w / 2) * SCREEN + 12 : PHONE_W / 2;
  const fy = focus ? (focus.y + focus.h / 2) * SCREEN + 12 : PHONE_H / 2;
  const tilt = dir * (2.5 * (1 - punch) + (1 - enter) * 12) + leave * dir * 12;
  const bump = 1 + beatPulse(frame) * 0.012 * (1 - punch);
  return (
    <AbsoluteFill>
      <div style={{
        position: 'absolute', left: phoneLeft(side) - 12, top: PHONE_TOP - 12,
        transformOrigin: `${fx}px ${fy}px`,
        transform: `translateX(${(1 - enter) * dir * 760 + leave * dir * 900}px) rotate(${tilt}deg) scale(${zoom * bump})`,
        filter: `blur(${(1 - Math.min(1, enter * 1.3)) * 12 + leave * 14}px)`,
      }}>
        <Phone shot={shot} focus={focus} frame={frame} on={focus ? interpolate(frame, [s.dur * 0.42, s.dur * 0.52], [0, 1], clamp) : 0} />
      </div>
      <Caption s={s} frame={frame - 4} side={side === 'right' ? 'left' : 'right'} leave={leave} />
    </AbsoluteFill>
  );
}

function Phone({ shot, focus, frame, on }: { shot: string; focus?: Rect; frame: number; on: number }) {
  return (
    <div style={{
      width: PHONE_W + 24, height: PHONE_H + 24, padding: 12, borderRadius: 64, background: '#0c121e',
      boxShadow: '0 4px 10px rgba(15,23,42,0.18), 0 34px 80px rgba(15,23,42,0.30)',
    }}>
      <div style={{ position: 'relative', width: PHONE_W, height: PHONE_H, borderRadius: 52, overflow: 'hidden', background: '#fff' }}>
        <OffthreadVideo muted src={staticFile(`clips/${shot}.mp4`)} style={{ width: '100%', height: '100%', display: 'block' }} />
        {focus && <FocusRing r={focus} frame={frame} on={on} />}
      </div>
    </div>
  );
}

function FocusRing({ r, frame, on }: { r: Rect; frame: number; on: number }) {
  const pulse = beatPulse(frame);
  return (
    <div style={{
      position: 'absolute', left: r.x * SCREEN - 6, top: r.y * SCREEN - 6, width: r.w * SCREEN + 12, height: r.h * SCREEN + 12,
      borderRadius: 16, border: `3px solid ${C.accent}`, opacity: on,
      boxShadow: `0 0 ${10 + pulse * 16}px rgba(11,94,168,${0.35 + pulse * 0.3})`, transform: `scale(${1.06 - on * 0.06})`,
    }} />
  );
}

/* ------------------------------------------------------------------------------------------ */

function Desktop({ s }: { s: Segment }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 110 } });
  const leave = interpolate(frame, [s.dur, s.dur + OVERLAP], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const push = interpolate(frame, [0, s.dur], [1, 1.04]);
  const BW = 1180, BH = Math.round((BW * 900) / 1440);
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div style={{ marginTop: 56, opacity: 1 - leave }}>
        <Kinetic text={s.caption.replace('\n', ' ')} accent={s.accent} color={s.color} frame={frame - 2} size={72} center />
      </div>
      <div style={{
        marginTop: 34, width: BW + 16, height: BH + 16, padding: 8, borderRadius: 22, background: '#0c121e',
        boxShadow: '0 4px 10px rgba(15,23,42,0.18), 0 34px 80px rgba(15,23,42,0.28)',
        transform: `translateY(${(1 - enter) * 300 + leave * -80}px) scale(${(0.9 + enter * 0.1) * (1 + leave * 0.2)})`,
        opacity: 1 - leave, filter: `blur(${leave * 12}px)`,
      }}>
        <div style={{ width: BW, height: BH, borderRadius: 14, overflow: 'hidden' }}>
          <OffthreadVideo muted src={staticFile('clips/desktop.mp4')} style={{ width: BW, height: BH, display: 'block', transform: `scale(${push})`, transformOrigin: '60% 45%' }} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - 6, fps, config: { damping: 14, stiffness: 110 } });
  const t2 = spring({ frame: frame - 22, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <Halo />
      <div style={{ transform: `scale(${0.8 + t * 0.2})`, opacity: Math.min(1, t * 1.5) }}>
        <div style={{ fontSize: 172, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1 }}>SL Karta</div>
        <div style={{ marginTop: 18, fontSize: 46, fontWeight: 500, color: C.sub }}>Stockholm, live.</div>
      </div>
      <div style={{ marginTop: 46, opacity: t2, transform: `translateY(${(1 - t2) * 20}px)`, fontSize: 50, fontWeight: 700, color: C.accent }}>
        sl.ogun.se
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------------------------------ */

function Caption({ s, frame, side, leave }: { s: Segment; frame: number; side: 'left' | 'right'; leave: number }) {
  const style: CSSProperties = {
    position: 'absolute', top: 0, bottom: 0, width: 780, display: 'flex', flexDirection: 'column', justifyContent: 'center',
    ...(side === 'left' ? { left: 150 } : { right: 150 }),
    opacity: 1 - leave, transform: `translateY(${-leave * 40}px)`,
  };
  return (
    <div style={style}>
      <Kinetic text={s.caption} accent={s.accent} color={s.color} frame={frame} size={100} />
      <Underline frame={frame} color={s.color} />
    </div>
  );
}

/** Headline whose words slide up through a mask; the accent word arrives in a line colour. */
function Kinetic({ text, accent, color, frame, size, center }: {
  text: string; accent: string; color: string; frame: number; size: number; center?: boolean;
}) {
  const { fps } = useVideoConfig();
  const accentWords = new Set(accent.split(' ').filter(Boolean));
  let i = 0;
  return (
    <div style={{ fontSize: size, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.04, textAlign: center ? 'center' : 'left' }}>
      {text.split('\n').map((lineText, li) => (
        <div key={li}>
          {lineText.split(' ').map((w) => {
            const k = i++;
            const p = spring({ frame: frame - k * 3, fps, config: { damping: 20, stiffness: 170 } });
            const isAccent = accentWords.has(w);
            return (
              <span key={k} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em', marginRight: '0.22em' }}>
                <span style={{
                  display: 'inline-block', transform: `translateY(${(1 - p) * 110}%) scale(${isAccent ? 1 + (1 - p) * 0.3 : 1})`,
                  color: isAccent ? color : C.text,
                }}>
                  {w}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A short line in the scene's colour that draws in under the caption, like a route on the map. */
function Underline({ frame, color }: { frame: number; color: string }) {
  const p = interpolate(frame, [10, 34], [0, 1], { ...clamp, easing: out });
  return <div style={{ marginTop: 26, height: 8, width: 220 * p, borderRadius: 4, background: color }} />;
}
