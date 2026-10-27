import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceSimulation, createSimulation, decideSimulation, startSimulation, type RunScript } from './agent-run-state';

export function useSimulatedRun(script: RunScript, { running = true }: { running?: boolean } = {}) {
  const [simulation, setSimulation] = useState(() => createSimulation(script));
  const current = useRef(simulation), scriptRef = useRef(script), permitted = useRef(running);
  permitted.current = running;
  const commit = useCallback((next: typeof simulation) => { current.current = next; setSimulation(next); }, []);
  useEffect(() => { if (scriptRef.current !== script) { scriptRef.current = script; commit(createSimulation(script)); } }, [script, commit]);
  useEffect(() => {
    let frame = 0, stamp = 0, accumulated = 0;
    const tick = (time: number) => {
      const state = current.current.state;
      if (permitted.current && !window.document.hidden && state.status === 'working') {
        accumulated += stamp ? Math.min(time - stamp, 100) : 0;
        if (accumulated >= 40) { commit(advanceSimulation(current.current, accumulated)); accumulated = 0; }
      } else accumulated = 0;
      stamp = time; frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [commit]);
  return {
    state: simulation.state,
    start: useCallback(() => commit(startSimulation(current.current)), [commit]),
    restart: useCallback(() => commit(startSimulation(createSimulation(scriptRef.current))), [commit]),
    approve: useCallback(() => commit(decideSimulation(current.current, scriptRef.current, 'approve')), [commit]),
    reject: useCallback((reason: string) => commit(decideSimulation(current.current, scriptRef.current, 'reject', reason)), [commit]),
  };
}
