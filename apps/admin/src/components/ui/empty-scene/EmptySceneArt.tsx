/** UIArc empty-states vector renderer, extracted for controlled business scenes. */
import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react';
import { animate } from 'motion/react';
import { motionTokens } from '@/lib/motion-tokens';
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion';
import { KINDS, VIEW, shapePath, type Frame, type Phase } from '@/registry/blocks/empty-states/empty-states-art';
import { SCENE_FRAMES, entranceFrame, type EmptySceneKind } from './frames';
import styles from '@/registry/blocks/empty-states/empty-states.module.css';

const DELAY = [.05, .03, 0, .04, .07, .1, .06, .09, .11, .14];
const NUDGE = [.03, .015, 0, .02, .035, .05, .02, .04, .05, .07];
const DRIFT = 2.5;

const standard = [...motionTokens.ease.standard] as [number, number, number, number];

/** Motion's visualDuration and bounce, turned into stiffness and damping for the vector springs below. */
function springOf({ visualDuration, bounce }: { visualDuration: number; bounce: number }) {
  const root = (2 * Math.PI) / (visualDuration * 1.2);
  return { k: root * root, c: 2 * Math.min(1, Math.max(.05, 1 - bounce)) * root };
}
const MORPH = springOf(motionTokens.spring.morph), SMOOTH = springOf(motionTokens.spring.smooth), SWAY = { k: 90, c: 19 };

type Channel = { pos: Float64Array; vel: Float64Array; target: Float64Array; queue: { at: number; values: number[] }[]; k: number; c: number; still: boolean };
const channel = (values: number[], spring: { k: number; c: number }): Channel =>
  ({ pos: Float64Array.from(values), vel: new Float64Array(values.length), target: Float64Array.from(values), queue: [], ...spring, still: true });

/** Integrates one spring vector. A new target keeps the current velocity, so shapes retarget mid-flight without a hitch. */
function advance(ch: Channel, now: number, dt: number) {
  while (ch.queue.length && ch.queue[0].at <= now) {
    const next = ch.queue.shift();
    if (next) { ch.target.set(next.values); ch.still = false; }
  }
  if (!ch.still) {
    const steps = Math.max(1, Math.ceil(dt * 240)), h = dt / steps, { pos, vel, target, k, c } = ch;
    for (let s = 0; s < steps; s++) for (let i = 0; i < pos.length; i++) { vel[i] += (-k * (pos[i] - target[i]) - c * vel[i]) * h; pos[i] += vel[i] * h; }
    let settled = true;
    for (let i = 0; i < pos.length; i++) if (Math.abs(pos[i] - target[i]) > .004 || Math.abs(vel[i]) > .02) { settled = false; break; }
    if (settled) { pos.set(target); vel.fill(0); ch.still = true; }
  }
  return !ch.still || ch.queue.length > 0;
}

type Nodes = { paths: SVGPathElement[]; ghosts: SVGPathElement[]; main: SVGGElement; ghost: SVGGElement };

/** One animation frame loop drives every shape through refs. It sleeps once everything has settled. */
function createEngine(nodes: Nodes, start: Frame) {
  const geo = start.prims.map(p => channel(p.geo, MORPH));
  const fx = start.prims.map(p => channel(p.fx, SMOOTH));
  const sway = channel([0, 0], SWAY);
  const written = nodes.paths.map(node => ({ d: node.getAttribute('d') ?? '', o: node.getAttribute('opacity') ?? '1', dash: node.getAttribute('stroke-dasharray') ?? 'none' }));
  let frame = start, raf = 0, last = 0, parallax = false;

  const paint = () => {
    const ox = sway.pos[0] * DRIFT, oy = sway.pos[1] * DRIFT;
    nodes.paths.forEach((node, i) => {
      const { d, dash } = shapePath(KINDS[i], geo[i].pos, fx[i].pos[1], ox, oy);
      const o = String(Math.round(Math.min(1, Math.max(0, fx[i].pos[0])) * 1000) / 1000);
      if (d !== written[i].d) { node.setAttribute("d", d); written[i].d = d; }
      if (o !== written[i].o) { node.setAttribute("opacity", o); written[i].o = o; }
      if (dash !== written[i].dash) { node.setAttribute("stroke-dasharray", dash); written[i].dash = dash; }
    });
  };
  const tick = (time: number) => {
    raf = 0;
    const now = time / 1000, dt = last ? Math.min(.034, Math.max(0, now - last)) : 1 / 60;
    last = now;
    let busy = advance(sway, now, dt);
    for (let i = 0; i < geo.length; i++) busy = advance(geo[i], now, dt) || busy;
    for (let i = 0; i < fx.length; i++) busy = advance(fx[i], now, dt) || busy;
    paint();
    if (busy) raf = requestAnimationFrame(tick); else last = 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  paint();

  const pointer = (x: number, y: number) => {
    sway.queue = [];
    sway.target.set(parallax ? [x, y] : [0, 0]);
    sway.still = false;
    kick();
  };

  return {
    pointer,
    go(next: Frame, sceneChanged: boolean, reduced: boolean) {
      if (reduced) {
        // Crossfade without travel: freeze the old drawing in a ghost layer, snap to the new one, and fade between them.
        nodes.paths.forEach((node, i) => {
          const ghost = nodes.ghosts[i];
          ghost.setAttribute("d", node.getAttribute("d") ?? "");
          ghost.setAttribute("opacity", node.getAttribute("opacity") ?? "1");
          ghost.setAttribute("stroke-dasharray", node.getAttribute("stroke-dasharray") ?? "none");
          ghost.dataset.tone = frame.prims[i].tone;
        });
        next.prims.forEach((p, i) => {
          for (const [ch, values] of [[geo[i], p.geo], [fx[i], p.fx]] as const) { ch.queue = []; ch.target.set(values); ch.pos.set(values); ch.vel.fill(0); ch.still = true; }
        });
        frame = next;
        paint();
        animate(nodes.ghost, { opacity: [1, 0] }, { duration: motionTokens.duration.standard, ease: standard });
        animate(nodes.main, { opacity: [0, 1] }, { duration: motionTokens.duration.standard, ease: standard });
        return;
      }
      const now = performance.now() / 1000, delays = sceneChanged ? DELAY : NUDGE;
      next.prims.forEach((p, i) => {
        geo[i].queue = [{ at: now + delays[i], values: p.geo }];
        if (sceneChanged && p.redraw) fx[i].queue = [{ at: now, values: [p.fx[0], 0] }, { at: now + delays[i] + .18, values: p.fx }];
        else fx[i].queue = [{ at: now + delays[i] + (p.fx[1] > fx[i].target[1] + .01 ? .12 : 0), values: p.fx }];
      });
      frame = next;
      kick();
    },
    setParallax(on: boolean) { parallax = on; if (!on) pointer(0, 0); },
    destroy() { if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}

export function EmptySceneArt({ scene, phase = 'idle' }: { scene: EmptySceneKind; phase?: Phase }) {
  const reduced = usePrefersReducedMotion();
  const initial = useRef(SCENE_FRAMES[scene][phase]);
  const paths = useRef<(SVGPathElement | null)[]>([]), ghosts = useRef<(SVGPathElement | null)[]>([]);
  const mainLayer = useRef<SVGGElement>(null), ghostLayer = useRef<SVGGElement>(null);
  const engine = useRef<ReturnType<typeof createEngine> | null>(null), shown = useRef({ scene, phase, reduced });
  const frame = SCENE_FRAMES[scene][phase];
  useLayoutEffect(() => {
    if (!mainLayer.current || !ghostLayer.current) return;
    const instance = createEngine({ main: mainLayer.current, ghost: ghostLayer.current,
      paths: paths.current.filter(Boolean) as SVGPathElement[], ghosts: ghosts.current.filter(Boolean) as SVGPathElement[] }, reduced ? initial.current : entranceFrame(initial.current, scene));
    engine.current = instance;
    instance.go(initial.current, true, reduced);
    return () => { instance.destroy(); engine.current = null; };
  }, []);
  useEffect(() => {
    engine.current?.setParallax(window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduced);
    const previous = shown.current;
    if (previous.scene === scene && previous.phase === phase && previous.reduced === reduced) return;
    engine.current?.go(frame, previous.scene !== scene, reduced);
    shown.current = { scene, phase, reduced };
  }, [scene, phase, reduced]);
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    engine.current?.pointer(((event.clientX - rect.left) / rect.width - .5) * 2, ((event.clientY - rect.top) / rect.height - .5) * 2);
  }
  return <div className={styles.stage} onPointerMove={onPointerMove} onPointerLeave={() => engine.current?.pointer(0, 0)} aria-hidden="true">
    <svg className={styles.art} viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}>
      <g ref={ghostLayer} opacity={0}>{KINDS.map((kind, i) => <path key={i} ref={node => { ghosts.current[i] = node; }} className={styles.shape} data-kind={kind} d="" />)}</g>
      <g ref={mainLayer}>{initial.current.prims.map((p, i) => {
        const item = shapePath(KINDS[i], p.geo, p.fx[1], 0, 0);
        return <path key={i} ref={node => { paths.current[i] = node; }} className={styles.shape} data-kind={KINDS[i]} data-tone={frame.prims[i].tone} d={item.d} opacity={p.fx[0]} strokeDasharray={item.dash} style={{ transitionDelay: `${DELAY[i]}s` }} />;
      })}</g>
    </svg>
  </div>;
}

