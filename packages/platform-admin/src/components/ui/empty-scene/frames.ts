import { FRAMES, type Frame, type Phase, type SceneId } from '@/registry/blocks/empty-states/empty-states-art';

export type EmptySceneKind = SceneId | 'empty';

// Keep the original tray geometry, but reserve its success badge for caught-up work.
const emptyFrames = Object.fromEntries(Object.entries(FRAMES.inbox).map(([phase, frame]) => [phase, {
  ...frame,
  label: 'An empty document tray',
  prims: frame.prims.map((primitive, index) => index === 6 || index === 9
    ? { ...primitive, tone: 'muted', fx: [0, 0] }
    : primitive),
}])) as Record<Phase, Frame>;

export const SCENE_FRAMES = { ...FRAMES, empty: emptyFrames };

/** Start the original per-shape fade/drawing springs without fabricating a loading state. */
export function entranceFrame(frame: Frame, scene: EmptySceneKind): Frame {
  // Reuse the original tray's lifted papers as entrance geometry only, never as a request status.
  const lifted = scene === 'empty' || scene === 'inbox' ? SCENE_FRAMES[scene].loading : frame;
  return { ...frame, prims: frame.prims.map((p, index) => ({ ...p, geo: lifted.prims[index].geo, fx: [0, p.redraw ? 0 : p.fx[1]] })) };
}
