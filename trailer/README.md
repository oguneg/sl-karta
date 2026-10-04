# SL Karta trailer

30-second 1920×1080 trailer rendered with [Remotion](https://www.remotion.dev) from real screenshots of the live app.

```bash
npm install
npm run capture   # screenshots of https://sl.ogun.se (needs Chrome) + measured highlight boxes
npm run music     # generates the original backing track (public/music.wav)
npm run render    # -> out/sl-karta-trailer.mp4
npm run studio    # live preview / editing in the browser
```

Capture during the day for the richest data (more vehicles, no "tomorrow" times).
Scenes, captions and timing live in `src/Trailer.tsx` (120 BPM: one beat = 15 frames).
