import type { ReactNode } from 'react';

export type DiffLine = { type: 'add' | 'del' | 'ctx'; old?: number; new?: number; text: string };
export type ChangedFile = { path: string; status?: 'added' | 'modified'; lines: DiffLine[] };
export type ProposedChange = { id: string; summary: string; files: ChangedFile[]; outcome?: 'approved' | 'rejected'; reason?: string };
export type StepMark = 'think' | 'read' | 'search' | 'edit' | 'terminal' | 'review' | 'npm' | 'typescript' | 'github';
export type RunStep = { id: string; mark: StepMark; icon?: ReactNode; verb: string; doneVerb: string; target?: string; doneTarget?: string; status: 'running' | 'waiting' | 'done' | 'rejected'; durationMs?: number; text?: string; io?: { input: string; output: string[] }; change?: ProposedChange; progress?: { value: number; total: number } };
export type RunResult = { summary: string; files: { path: string; additions: number; deletions: number }[]; tests: { passed: number; total: number }; checks: string[] };
export type AgentRunState = { status: 'idle' | 'working' | 'waiting' | 'done' | 'stopped'; elapsedMs: number; steps: RunStep[]; result?: RunResult };
export type ScriptStep = Omit<RunStep, 'status' | 'durationMs'> & { durationMs: number };
export type RunScript = { steps: ScriptStep[]; result: RunResult; revise?: { steps: ScriptStep[]; result: RunResult } };
export type Simulation = { state: AgentRunState; queue: ScriptStep[]; index: number; progressMs: number; revision: number; result: RunResult };
export function createSimulation(script: RunScript): Simulation { return { state: { status: 'idle', elapsedMs: 0, steps: [] }, queue: script.steps, index: 0, progressMs: 0, revision: 0, result: script.result }; }
function begin(sim: Simulation): Simulation {
  const next = sim.queue[sim.index];
  if (!next) return { ...sim, state: { ...sim.state, status: 'done', result: sim.result } };
  const waiting = !!next.change, step: RunStep = { ...next, status: waiting ? 'waiting' : 'running', durationMs: undefined, progress: next.progress ? { value: 0, total: next.progress.total } : undefined };
  return { ...sim, progressMs: 0, state: { ...sim.state, elapsedMs: sim.state.elapsedMs + (waiting ? next.durationMs : 0), status: waiting ? 'waiting' : 'working', steps: [...sim.state.steps, step] } };
}
export function startSimulation(sim: Simulation) { return sim.state.status === 'idle' ? begin(sim) : sim; }
export function advanceSimulation(sim: Simulation, delta: number): Simulation {
  if (sim.state.status !== 'working' || !Number.isFinite(delta) || delta <= 0) return sim;
  let next = sim, remaining = delta;
  while (remaining > 0 && next.state.status === 'working') {
    const spec = next.queue[next.index]; if (!spec) return begin(next);
    const duration = Math.max(1, spec.durationMs), increment = Math.min(remaining, duration - next.progressMs), progressMs = next.progressMs + increment;
    const steps = next.state.steps.slice(), last = steps.length - 1, done = progressMs >= duration;
    steps[last] = { ...steps[last], status: done ? 'done' : 'running', durationMs: done ? spec.durationMs : undefined, progress: spec.progress ? { total: spec.progress.total, value: done ? spec.progress.total : Math.min(spec.progress.total, Math.floor(progressMs / duration * spec.progress.total)) } : undefined };
    next = { ...next, progressMs, state: { ...next.state, elapsedMs: next.state.elapsedMs + increment, steps } }; remaining -= increment;
    if (done) next = begin({ ...next, index: next.index + 1 });
  }
  return next;
}
export function decideSimulation(sim: Simulation, script: RunScript, decision: 'approve' | 'reject', reason = ''): Simulation {
  if (sim.state.status !== 'waiting') return sim;
  if (decision === 'reject' && !reason.trim()) return sim;
  const steps = sim.state.steps.slice(), last = steps.length - 1, gated = steps[last];
  if (!gated?.change) return sim;
  const approved = decision === 'approve';
  steps[last] = { ...gated, status: approved ? 'done' : 'rejected', doneVerb: approved ? 'Approved' : 'Sent back', doneTarget: approved ? gated.doneTarget : reason.trim(), durationMs: approved ? 700 : undefined, change: { ...gated.change, outcome: approved ? 'approved' : 'rejected', reason: approved ? undefined : reason.trim() } };
  const base = { ...sim, state: { ...sim.state, steps } };
  if (approved) return begin({ ...base, index: sim.index + 1 });
  if (sim.revision || !script.revise) return { ...base, state: { ...base.state, status: 'stopped' } };
  const queue = script.revise.steps.map(step => step.mark === 'think' && step.id === 'revise' ? { ...step, text: `“${reason.trim()}” ${step.text ?? ''}` } : step);
  return begin({ ...base, revision: 1, index: 0, queue, result: script.revise.result });
}
export function stepLabel(step: RunStep) { return `${step.status === 'waiting' ? 'Review' : step.status === 'done' || step.status === 'rejected' ? step.doneVerb : step.verb}${(step.status === 'running' ? step.target : step.doneTarget ?? step.target) ? ` ${step.status === 'running' ? step.target : step.doneTarget ?? step.target}` : ''}`; }
export function diffCounts(file: ChangedFile) { return { additions: file.lines.filter(line => line.type === 'add').length, deletions: file.lines.filter(line => line.type === 'del').length }; }
export function elapsedText(ms: number) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
export function safePullRequestUrl(url?: string) { if (!url) return undefined; try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : undefined; } catch { return undefined; } }
