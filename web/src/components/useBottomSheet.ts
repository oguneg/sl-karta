import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

/** Resting positions of the mobile bottom sheet. */
export type Snap = 'peek' | 'half' | 'full';

const PEEK_MIN = 120, PEEK_MAX = 260; // peek shows the header (+ the next-stop box for vehicles)
const DRAG_START_PX = 6; // movement before a gesture counts as a drag
const FLICK_PX_PER_MS = 0.5; // release speed that jumps to the next snap in that direction

const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;

/** Space the sheet may use: from the bottom of the search/filter bar to the tab bar. */
function available() {
  const tabbar = document.querySelector('.tabbar') as HTMLElement | null;
  return window.innerHeight - (tabbar?.offsetHeight ?? 60) - 12;
}

/** Peek height: just enough to show the sheet's header and, for a vehicle, its next stop. */
function peekHeight(el: HTMLElement | null) {
  const last = (el?.querySelector('.trip-next') ?? el?.querySelector('.sheet-head')) as HTMLElement | null;
  if (!el || !last) return 168;
  const bottom = last.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop;
  return Math.max(PEEK_MIN, Math.min(PEEK_MAX, Math.round(bottom + 12)));
}

function heightOf(snap: Snap, el: HTMLElement | null) {
  const max = available();
  if (snap === 'peek') return Math.min(peekHeight(el), max);
  if (snap === 'half') return Math.round(max * 0.55);
  return max - 96; // keep the search bar visible
}

const ORDER: Snap[] = ['peek', 'half', 'full'];

/**
 * Draggable bottom sheet for phones: drag the grip/header, flick, or pull the content down when it
 * is scrolled to the top. Desktop (side panel) is unaffected. `resetKey` changes when a different
 * item is shown, which reopens the sheet at half height.
 */
export function useBottomSheet(ref: RefObject<HTMLElement | null>, resetKey: string) {
  const [snap, setSnap] = useState<Snap>('half');
  const [dragH, setDragH] = useState<number | null>(null);
  const [desktop, setDesktop] = useState(isDesktop);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  /** Currently visible height, read when a drag starts. */
  const visibleRef = useRef(0);

  useEffect(() => setSnap('half'), [resetKey]);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    window.addEventListener('resize', on);
    return () => {
      mq.removeEventListener('change', on);
      window.removeEventListener('resize', on);
    };
  }, []);

  /** Pick the snap closest to the released height, biased by flick direction. */
  const release = useCallback((h: number, velocity: number) => {
    let target: Snap;
    if (Math.abs(velocity) > FLICK_PX_PER_MS) {
      // Finger moving down (positive velocity) means a smaller sheet.
      const i = ORDER.indexOf(snapRef.current) + (velocity > 0 ? -1 : 1);
      target = ORDER[Math.max(0, Math.min(ORDER.length - 1, i))];
    } else {
      target = ORDER.reduce((best, s) => (Math.abs(heightOf(s, ref.current) - h) < Math.abs(heightOf(best, ref.current) - h) ? s : best), 'half');
    }
    setSnap(target);
    setDragH(null);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el || desktop) return;
    let startY = 0, startH = 0, lastY = 0, lastT = 0, velocity = 0;
    let mode: 'idle' | 'pending' | 'drag' | 'scroll' = 'idle';
    let fromHandle = false;

    const begin = (y: number, target: EventTarget | null) => {
      const t = target as HTMLElement | null;
      if (t?.closest('button, a, input, select, textarea') && !t.closest('.sheet-grip')) fromHandle = false;
      else fromHandle = !!t?.closest('.sheet-grip, .sheet-head');
      startY = lastY = y;
      lastT = performance.now();
      startH = visibleRef.current;
      velocity = 0;
      mode = 'pending';
    };
    const move = (y: number, e: Event) => {
      if (mode === 'idle' || mode === 'scroll') return;
      const dy = y - startY; // > 0: finger moves down
      if (mode === 'pending') {
        if (Math.abs(dy) < DRAG_START_PX) return;
        const atTop = el.scrollTop <= 0;
        // Content gestures: pull down at the top collapses; push up expands until full, then scrolls.
        const take = fromHandle || (dy > 0 && atTop) || (dy < 0 && snapRef.current !== 'full');
        mode = take ? 'drag' : 'scroll';
        if (!take) return;
      }
      if (e.cancelable) e.preventDefault();
      const now = performance.now();
      velocity = (y - lastY) / Math.max(1, now - lastT);
      lastY = y;
      lastT = now;
      setDragH(Math.max(80, Math.min(available() - 40, startH - dy)));
    };
    const end = (y: number) => {
      if (mode === 'drag') {
        release(startH - (y - startY), velocity);
        // The click that follows a drag must not also toggle the grip button.
        const stop = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
      }
      mode = 'idle';
    };

    // Touch: non-passive so we can stop the content from scrolling while dragging the sheet.
    const ts = (e: TouchEvent) => begin(e.touches[0].clientY, e.target);
    const tm = (e: TouchEvent) => move(e.touches[0].clientY, e);
    const te = (e: TouchEvent) => end(e.changedTouches[0].clientY);
    // Mouse (desktop browsers in a narrow window): only from the handle.
    const md = (e: MouseEvent) => {
      if (e.button !== 0) return;
      begin(e.clientY, e.target);
      if (!fromHandle) {
        mode = 'idle';
        return;
      }
      const mm = (ev: MouseEvent) => move(ev.clientY, ev);
      const mu = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', mm);
        window.removeEventListener('mouseup', mu);
        end(ev.clientY);
      };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('mousedown', md);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('mousedown', md);
    };
  }, [ref, desktop, release, resetKey]);

  // The sheet always has its full height and slides with transform: dragging and snapping move pixels
  // only, without re-laying out long stop lists on every frame. The hidden part sits under the tab bar.
  let style: CSSProperties | undefined;
  if (!desktop) {
    const full = heightOf('full', ref.current);
    const visible = Math.min(full, dragH ?? heightOf(snap, ref.current));
    visibleRef.current = visible;
    style = {
      height: full,
      transform: `translateY(${full - visible}px)`,
      transition: dragH === null ? 'transform 0.22s ease-out' : 'none',
    };
  }

  return { snap, setSnap, style, dragging: dragH !== null };
}
