import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion';
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Sparkle, Check, ChevronDown, CircleCheck, CircleAlert, FileText, FilePenLine, FileDiff, Hand, ListChecks, LoaderCircle, RotateCcw, Search, Terminal, Undo2 } from 'lucide-react';
import { BrandMark } from '../shared/BrandMark';
import { MeasuredHeight } from '../shared/MeasuredHeight';
import { sampleScript, REQUEST } from './agent-run-data';
import { diffCounts, elapsedText, safePullRequestUrl, stepLabel, type AgentRunState, type ProposedChange, type RunScript, type RunStep } from './agent-run-state';
import { useSimulatedRun } from './useSimulatedRun';
import './tokens.css';
import './original.css';
import './reference-update.css';
import './integration.css';

export { useSimulatedRun } from './useSimulatedRun';
export type { AgentRunState, ChangedFile, DiffLine, ProposedChange, RunResult, RunScript, RunStep, ScriptStep, StepMark } from './agent-run-state';
export type PullRequest = { number: number; url?: string };
export type AgentRunProps = {
  activityOnly?: boolean; task?: string; model?: { name: string; mark?: ReactNode }; script?: RunScript; run?: AgentRunState; autoPlay?: boolean;
  onApprove?: (change: ProposedChange) => void | Promise<unknown>;
  onReject?: (change: ProposedChange, reason: string) => void | Promise<unknown>;
  onOpenPullRequest?: () => PullRequest | void | Promise<PullRequest | void>;
  onRestart?: () => void | Promise<unknown>; className?: string;
};
const classNames = {
  root:'root__JjiAs', header:'header__gYCgV', titleRow:'titleRow__IyQro', task:'task__rcJkh', iconButton:'iconButton__PXZPu', metaRow:'metaRow__pzM_j', model:'model__iT0hw', modelMark:'modelMark__rgw_8', statusLine:'statusLine__oXTW_', status:'status__VUTQ1', statusIcon:'statusIcon__XLpKq', timer:'timer__dBRsk', stepsArea:'stepsArea__EXE7c', steps:'steps__TVfHM', step:'step__3UbO5', stepHead:'stepHead__YLS0_', stepIcon:'stepIcon__Kh7mW', stepLabel:'stepLabel__wsraO', verb:'verb__vUFg4', target:'target__K_bct', stepTime:'stepTime__dli5g', stepState:'stepState___GxZ7', chevronSlot:'chevronSlot__B8kfG', chevron:'chevron__bCXn_', stepBody:'stepBody__FsVZ0', details:'details__NR5Wg', thought:'thought___QsPi', io:'io__CTj1w', ioInput:'ioInput__IKAl0', ioOutput:'ioOutput__fek2o', fold:'fold__cxEek', changeBody:'changeBody__qXEUd', changeSummary:'changeSummary__nRV8z', diffCard:'diffCard__ADpXz', fileTabs:'fileTabs__yPGvt', fileTab:'fileTab__ztCXJ', fileName:'fileName__PSf8l', diffCount:'diffCount__Ywh0V', add:'add__92va7', del:'del__3J2my', panels:'panels__SB_GG', panel:'panel__EK0Mv', code:'code__NrGvo', line:'line__VJems', num:'num__1ALBS', marker:'marker__7HyrP', src:'src__tRXsd', decideStage:'decideStage__ge1Yf', decide:'decide__Hk55P', decideNote:'decideNote___NOKh', decideActions:'decideActions__yREOu', reasonForm:'reasonForm__Brkmd', accentButton:'accentButton__sP1iV', verdict:'verdict__KmabZ', result:'result__eYDn9', summary:'summary__yaXn4', files:'files__CnmCE', filesHead:'filesHead___F4vx', fileList:'fileList__kpwOz', fileRow:'fileRow__xvHBk', fileIcon:'fileIcon__4jRZt', filePath:'filePath__nIb8B', diffBar:'diffBar__ht02a', checks:'checks__GNFtf', resultActions:'resultActions__u6l1N', prButton:'prButton__BDzb6', spin:'spin__wPL_C', srOnly:'srOnly__AqXAP', count:'count__hlyCH', chunk:'chunk__SX9uU',
};
const c = (name: keyof typeof classNames) => `agent-run_${classNames[name]}`;
function StepIcon({ step }: { step: RunStep }) {
  if (step.icon) return <>{step.icon}</>;
  if (['npm', 'typescript', 'github'].includes(step.mark)) return <BrandMark brand={step.mark} size={14} />;
  const Icon = { think: Sparkle, read: FileText, search: Search, edit: FilePenLine, terminal: Terminal, review: FileDiff }[step.mark as 'think' | 'read' | 'search' | 'edit' | 'terminal' | 'review'];
  return Icon ? <Icon size={16} strokeWidth={1.6} /> : <Terminal size={16} />;
}
function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return <span className={c('diffCount')}><span className={c('srOnly')}>{additions} added{deletions ? `, ${deletions} removed` : ''}</span><span className={c('add')} aria-hidden="true">+{additions}</span>{!!deletions && <span className={c('del')} aria-hidden="true">−{deletions}</span>}</span>;
}
function Change({ change, pending, onApprove, onReject }: { change: ProposedChange; pending: boolean; onApprove: () => void; onReject: (reason: string) => void }) {
  const [selected, setSelected] = useState(0), [rejecting, setRejecting] = useState(false), [reason, setReason] = useState('');
  const baseId = useId(), input = useRef<HTMLInputElement>(null), reject = useRef<HTMLButtonElement>(null), tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useLayoutEffect(() => { if (rejecting) input.current?.focus(); }, [rejecting]);
  useEffect(() => { if (change.outcome) setRejecting(false); }, [change.outcome]);
  function cancel() { setRejecting(false); requestAnimationFrame(() => reject.current?.focus()); }
  return <div className={c('changeBody')}><p className={c('changeSummary')}>{change.summary}</p><div className={c('diffCard')}>
    <div className={c('fileTabs')} role="tablist" aria-label="Changed files">{change.files.map((file, index) => <button key={file.path} ref={node => { tabRefs.current[index] = node; }} type="button" className={c('fileTab')} role="tab" id={`${baseId}-tab-${index}`} aria-controls={`${baseId}-panel-${index}`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} title={file.path} onClick={() => setSelected(index)} onKeyDown={event => {
      let next = index; if (event.key === 'ArrowRight') next = (index + 1) % change.files.length; else if (event.key === 'ArrowLeft') next = (index + change.files.length - 1) % change.files.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = change.files.length - 1; else return;
      event.preventDefault(); setSelected(next); tabRefs.current[next]?.focus();
    }}><span className={c('fileName')}>{file.path.split('/').pop()}</span><Counts {...diffCounts(file)} /></button>)}</div>
    <div className={c('panels')}>{change.files.map((file, index) => <div key={file.path} className={c('panel')} id={`${baseId}-panel-${index}`} role="tabpanel" aria-label={file.path} data-active={index === selected || undefined} inert={index !== selected} aria-hidden={index !== selected} tabIndex={index === selected ? 0 : -1}>
      <div className={c('code')}>{file.lines.map((line, i) => <div key={i} className={c('line')} data-type={line.type}><span className={c('num')} aria-hidden="true">{line.type === 'del' ? line.old : line.new ?? line.old}</span><span className={c('marker')} aria-hidden="true">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''}</span><code className={c('src')}>{line.type !== 'ctx' && <span className={c('srOnly')}>{line.type === 'add' ? 'Added: ' : 'Removed: '}</span>}{line.text || ' '}</code></div>)}</div>
    </div>)}</div>
    <MeasuredHeight className={c('decideStage')}>{change.outcome ? <div className={c('decide')}><p className={c('verdict')} data-tone={change.outcome}>{change.outcome === 'approved' ? <><Check size={14} />Approved. The agent can write these changes.</> : <><Undo2 size={14} />Sent back: <q>{change.reason}</q></>}</p></div> : rejecting ? <form className={c('reasonForm')} onSubmit={event => { event.preventDefault(); if (reason.trim()) onReject(reason.trim()); }}><label htmlFor={`${baseId}-reason`}>What should change?</label><input ref={input} id={`${baseId}-reason`} className="agent-run-note-input" placeholder="For example, make the limit configurable" value={reason} onChange={event => setReason(event.target.value)} disabled={pending} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } }} /><div className={c('decideActions')}><button type="button" onClick={cancel} disabled={pending}>Cancel</button><button type="submit" className={c('accentButton')} disabled={!reason.trim() || pending}>Send back</button></div></form> : <div className={c('decide')}><p className={c('decideNote')}>Nothing is written until you approve.</p><div className={c('decideActions')}><button ref={reject} type="button" disabled={pending} onClick={() => setRejecting(true)}>Reject</button><button type="button" className={c('accentButton')} disabled={pending} onClick={onApprove}>Approve</button></div></div>}</MeasuredHeight>
  </div></div>;
}
const Step = memo(function Step({ step, open, pending, onToggle, onApprove, onReject, register }: { step: RunStep; open: boolean; pending: boolean; onToggle: () => void; onApprove: () => void; onReject: (reason: string) => void; register: (node: HTMLButtonElement | null) => void }) {
  const id = useId(), done = step.status === 'done' || step.status === 'rejected';
  const verb = step.status === 'waiting' ? 'Review' : done ? step.doneVerb : step.verb, target = done || step.status === 'waiting' ? step.doneTarget ?? step.target : step.target;
  const hasDetails = !!(step.change || step.io || step.text);
  return <li className={c('step')} data-status={step.status} data-step-id={step.id}>
    <button ref={register} type="button" className={c('stepHead')} aria-label={stepLabel(step)} aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle}>
      <span className={c('stepIcon')} aria-hidden="true"><StepIcon step={step} /></span><span className={c('stepLabel')} title={stepLabel(step)}><span className={`${c('verb')} ${step.status === 'running' ? 'agent-run-live' : ''}`}>{verb}</span>{target && <span className={c('target')}>{target}</span>}{step.status === 'running' && step.progress && <span className={c('count')}>{step.progress.value}/{step.progress.total}</span>}</span>
      <span className={c('stepTime')}>{step.durationMs !== undefined ? `${(step.durationMs / 1000).toFixed(1)}s` : ''}</span><span className={c('stepState')} aria-hidden="true">{done ? step.status === 'rejected' ? <Undo2 size={14} /> : <Check size={14} /> : null}</span><span className={c('chevronSlot')}>{hasDetails && <ChevronDown size={14} className={c('chevron')} aria-hidden="true" />}</span>
    </button>
    <MeasuredHeight open={open && hasDetails} id={`${id}-body`}><div className={c('stepBody')}><div className={c('details')}>
      {step.text && <p className={c('thought')}>{step.text}</p>}
      {step.io && <div className={c('io')}><code className={c('ioInput')}>{step.io.input}</code><div className={c('ioOutput')}>{step.io.output.map((line, i) => <code key={i}>{line}</code>)}</div></div>}
      {step.change && <Change key={step.change.id} change={step.change} pending={pending} onApprove={onApprove} onReject={onReject} />}
    </div></div></MeasuredHeight>
  </li>;
});
function StreamedSummary({ text }: { text: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const [shown, setShown] = useState(0), chunks = text.match(/(?:\S+\s*){1,5}/g) ?? [];
  useEffect(() => {
    if (reducedMotion) { setShown(chunks.length); return; }
    setShown(0); let n = 0; const timer = setInterval(() => { setShown(++n); if (n >= chunks.length) clearInterval(timer); }, 34); return () => clearInterval(timer);
  }, [text, chunks.length, reducedMotion]);
  return <p className={c('summary')} aria-label={text}>{chunks.map((chunk, index) => <span key={index} aria-hidden="true" className={c('chunk')} data-shown={index < shown || undefined}>{chunk}</span>)}</p>;
}
export function AgentRun({ task = REQUEST, model, script = sampleScript, run, autoPlay = true, onApprove, onReject, onOpenPullRequest, onRestart, className = '', activityOnly = false }: AgentRunProps) {
  const root = useRef<HTMLElement>(null), [visible, setVisible] = useState(false), simulated = useSimulatedRun(script, { running: visible && !run }), state = run ?? simulated.state;
  const [open, setOpen] = useState<Record<string, boolean>>({}), [expanded, setExpanded] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(''), [pr, setPr] = useState<{ status: 'idle' | 'opening' | 'opened' | 'error'; number?: number; url?: string; error?: string }>({ status: 'idle' });
  const rowRefs = useRef(new Map<string, HTMLButtonElement>()), restartButton = useRef<HTMLButtonElement>(null), version = useRef(0), lock = useRef(false), prLock = useRef(false), prTimer = useRef<ReturnType<typeof setTimeout> | null>(null), latestState = useRef(state), id = useId(); latestState.current = state;
  const liveRun = useRef(run), lastStatus = useRef(state.status);
  useEffect(() => { const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 }); if (root.current) observer.observe(root.current); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!run && visible && autoPlay && state.status === 'idle') simulated.start(); }, [run, visible, autoPlay, state.status, simulated.start]);
  useEffect(() => {
    if ((state.status === 'idle' && lastStatus.current !== 'idle') || (run && liveRun.current && state.elapsedMs < liveRun.current.elapsedMs)) { version.current++; setOpen({}); setExpanded(false); setPr({ status: 'idle' }); setError(''); }
    lastStatus.current = state.status; liveRun.current = run;
  }, [state.status, state.elapsedMs, run]);
  useEffect(() => () => { version.current++; if (prTimer.current) clearTimeout(prTimer.current); }, []);
  useEffect(() => { version.current++; lock.current = false; prLock.current = false; setPending(false); setPr({ status: 'idle' }); setError(''); setOpen({}); setExpanded(false); }, [script, task]);
  useEffect(() => { if (state.status !== 'done' && state.status !== 'stopped') setExpanded(false); }, [state.status]);
  async function decide(step: RunStep, kind: 'approve' | 'reject', reason = '') {
    if (!step.change || step.status !== 'waiting' || lock.current) return;
    lock.current = true; setPending(true); setError(''); const revision = version.current;
    try {
      if (kind === 'approve') await onApprove?.(structuredClone(step.change)); else await onReject?.(structuredClone(step.change), reason);
      if (revision !== version.current) return;
      if (!run) { if (kind === 'approve') simulated.approve(); else simulated.reject(reason); }
      if (!run) setOpen(previous => ({ ...previous, [step.id]: false })); rowRefs.current.get(step.id)?.focus();
    } catch (failure) { if (revision === version.current) setError(failure instanceof Error ? failure.message : 'The decision could not be saved. Try again.'); }
    finally { if (revision === version.current) { lock.current = false; setPending(false); } }
  }
  async function restart() {
    version.current++; const stamp = version.current; lock.current = false; prLock.current = false; if (prTimer.current) clearTimeout(prTimer.current); setPending(false); setError(''); setPr({ status: 'idle' });
    try { await onRestart?.(); if (stamp !== version.current) return; if (!run) { simulated.restart(); setOpen({}); setExpanded(false); } restartButton.current?.focus(); }
    catch (failure) { if (stamp === version.current) setError(failure instanceof Error ? failure.message : 'Restart failed. Try again.'); }
  }
  async function openPr() {
    if (prLock.current || pr.status === 'opened') return; prLock.current = true; setPr({ status: 'opening' }); const stamp = version.current;
    try {
      const result = onOpenPullRequest ? await onOpenPullRequest() : await new Promise<PullRequest>(resolve => { prTimer.current = setTimeout(() => resolve({ number: 482 }), 700); });
      if (stamp === version.current) setPr({ status: 'opened', number: result?.number, url: safePullRequestUrl(result?.url) });
    } catch (failure) { if (stamp === version.current) setPr({ status: 'error', error: failure instanceof Error ? failure.message : 'Could not open the pull request. Try again.' }); }
    finally { if (stamp === version.current) prLock.current = false; }
  }
  const settled = ['done', 'stopped'].includes(state.status), statusLabel = { idle: '就绪', working: '本地演示中', waiting: '等待确认', done: '已完成', stopped: '已停止' }[state.status], currentStep = state.steps.at(-1), seconds = Math.round(state.elapsedMs / 1000);
  const totalAdd = state.result?.files.reduce((sum, file) => sum + file.additions, 0) ?? 0, totalDel = state.result?.files.reduce((sum, file) => sum + file.deletions, 0) ?? 0;
  return <section ref={root} className={`${c('root')} agent-run-local ${className}`} aria-labelledby={`${id}-task`}>
    <header className={c('header')}><div className={c('titleRow')}><h3 id={`${id}-task`} className={c('task')}>{task}</h3><button ref={restartButton} type="button" className={c('iconButton')} aria-label="Restart run" title="Restart run" onClick={restart} hidden={activityOnly}><RotateCcw size={16} /></button></div>
      <div className={c('metaRow')}><span className={c('model')}><span className={c('modelMark')}>{model?.mark ?? <BrandMark brand="anthropic" size={14} />}</span>{model?.name ?? 'Claude Sonnet 5.5'}</span><span className={c('statusLine')}><span className={`${c('status')} ${state.status === 'working' ? 'agent-run-live' : ''}`} data-status={state.status}>{state.status === 'waiting' && <Hand size={13} className={c('statusIcon')} aria-hidden="true" />}{state.status === 'done' && <CircleCheck size={13} className={c('statusIcon')} aria-hidden="true" />}{state.status === 'stopped' && <CircleAlert size={13} aria-hidden="true" />}{statusLabel}</span><span className={c('timer')} role="timer" aria-label={`Worked for ${elapsedText(state.elapsedMs)}`}>{elapsedText(state.elapsedMs)}</span></span></div>
    </header>
    {error && <p className="agent-run-error" role="alert">{error}</p>}
    <div className={c('stepsArea')}>
      {state.status === 'idle' && !run && <button type="button" className="agent-run-start" onClick={simulated.start}>Start run</button>}
      {settled && <button type="button" className={c('fold')} aria-expanded={expanded} aria-controls={`${id}-steps`} onClick={() => setExpanded(!expanded)}><ListChecks size={16} aria-hidden="true" /><span>{state.steps.length} 个步骤 · {seconds}秒</span><ChevronDown className={c('chevron')} size={16} aria-hidden="true" /></button>}
      <MeasuredHeight open={!settled || expanded} id={`${id}-steps`}><ol className={c('steps')} aria-label="执行步骤">{state.steps.map(step => <Step key={step.id} step={step} open={open[step.id] ?? step.status === 'waiting'} pending={pending} onToggle={() => setOpen(previous => ({ ...previous, [step.id]: !(previous[step.id] ?? step.status === 'waiting') }))} onApprove={() => decide(step, 'approve')} onReject={reason => decide(step, 'reject', reason)} register={node => { if (node) rowRefs.current.set(step.id, node); else rowRefs.current.delete(step.id); }} />)}</ol></MeasuredHeight>
    </div>
    {!activityOnly && state.result && <MeasuredHeight><section className={c('result')} aria-label="Result"><StreamedSummary text={state.result.summary} /><div className={c('files')}><p className={c('filesHead')}><span>{state.result.files.length} files changed</span><Counts additions={totalAdd} deletions={totalDel} /></p><ul className={c('fileList')} aria-label="Files changed">{state.result.files.map(file => <li key={file.path} className={c('fileRow')}><FilePenLine className={c('fileIcon')} size={16} aria-hidden="true" /><span className={c('filePath')} title={file.path}>{file.path}</span><Counts additions={file.additions} deletions={file.deletions} /><span className={c('diffBar')} aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <span key={i} data-kind={i < Math.round(file.additions / Math.max(1, file.additions + file.deletions) * 5) ? 'add' : 'del'} />)}</span></li>)}</ul></div>
      <ul className={c('checks')} aria-label="Checks"><li><Check size={14} />{state.result.tests.passed} of {state.result.tests.total} tests passed</li>{state.result.checks.map(check => <li key={check}><Check size={14} />{check}</li>)}</ul>
      <div className={c('resultActions')}><button type="button" className={c('prButton')} data-pr={pr.status} disabled={pr.status === 'opening' || pr.status === 'opened'} onClick={openPr}>{pr.status === 'opening' ? <LoaderCircle size={16} className={c('spin')} /> : <BrandMark brand="github" size={16} />}{pr.status === 'opened' ? pr.number ? `PR #${pr.number} opened` : 'Pull request opened' : pr.status === 'opening' ? 'Opening' : pr.status === 'error' ? 'Retry pull request' : 'Open pull request'}</button>{pr.url && <a href={pr.url} target="_blank" rel="noreferrer">View pull request</a>}</div>{pr.error && <p className="agent-run-error" role="alert">{pr.error}</p>}
    </section></MeasuredHeight>}
    {!activityOnly && state.status === 'stopped' && <section className={c('result')} aria-label="Stopped result"><p className={c('summary')}>The change was sent back again. Nothing was written.</p><button type="button" className="agent-run-start" onClick={restart}>Restart run</button></section>}
    <span className={c('srOnly')} role="status">{activityOnly ? `${statusLabel}，共${state.steps.length}个步骤，仅本地演示。` : state.status === 'waiting' ? 'Waiting for you. Review the changes to 2 files, then approve or reject.' : state.status === 'done' ? `Done in ${seconds}s. ${state.result?.tests.passed ?? 0} of ${state.result?.tests.total ?? 0} tests passed.` : state.status === 'stopped' ? 'Stopped. Nothing was written.' : currentStep ? stepLabel(currentStep) : 'Ready. This is a local simulated run.'}</span>
    <span className={c('srOnly')} role="status">{pr.status === 'opened' ? `${onOpenPullRequest ? '' : 'Simulated locally. No real pull request was created. '}${pr.number ? `PR #${pr.number} opened.` : 'Pull request opened.'}` : pr.error ?? ''}</span>
  </section>;
}
export default AgentRun;
