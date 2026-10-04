import { Composition } from 'remotion';
import { Trailer } from './Trailer';
import { FPS, TOTAL_FRAMES } from './timeline';

export const Root = () => (
  <Composition id="Trailer" component={Trailer} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
