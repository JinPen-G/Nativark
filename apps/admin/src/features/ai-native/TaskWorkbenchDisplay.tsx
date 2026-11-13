/** Opt-in original HTML display. Facts and fixed business confirmation stay
 * outside the opaque frame; source/candidate requests require trusted review. */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ActionButton, Alert } from '@/components/ui';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';
import { WorkbenchDisplaySession } from './workbench-display-session';
import type { WorkbenchDisplayExpectation, WorkbenchDisplayPort } from './workbench-display-host';
import type { AiWorkbenchModelControlObservation } from '@rental-os/shared';
import { TaskWorkbenchModelControls, useTaskWorkbenchModelControlHost } from './TaskWorkbenchModelControls';

export interface TaskWorkbenchDisplayProps {
  identity: string; expected: WorkbenchDisplayExpectation; port: WorkbenchDisplayPort;
  current(): boolean; enabled?: boolean;
}
export function TaskWorkbenchDisplay({ identity, expected, port, current, enabled = true }: TaskWorkbenchDisplayProps) {
  const { t } = useAiManagementLocale();
  const controlHost = useTaskWorkbenchModelControlHost(), controls = useRef(controlHost); controls.current = controlHost;
  const controlResult = useRef<AiWorkbenchModelControlObservation | null>(null);
  const owner = JSON.stringify([identity, expected.taskId, expected.tenantId, expected.workspaceId]);
  const scope = useRef({ owner, current, expected }); scope.current = { owner, current, expected };
  const session = useMemo(() => new WorkbenchDisplaySession(() => scope.current.expected, port,
    () => scope.current.owner === owner && !document.hidden && scope.current.current()), [owner, port]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const attach = useCallback((frame: HTMLIFrameElement | null) => session.attach(frame), [session]);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) session.retract(); };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [session]);
  useEffect(() => { if (!current()) session.retract('revoked'); else if (!enabled) session.suspend(); }, [session, enabled, current]);
  useEffect(() => { session.suspend(); }, [session, expected.runId, expected.resultId]);
  const refreshControl = useCallback(async (value: AiWorkbenchModelControlObservation, signal: AbortSignal) => {
    const host = controls.current;
    if (!host || host.identity !== identity || host.taskId !== value.taskId || value.taskId !== scope.current.expected.taskId
      || signal.aborted || !scope.current.current() || !host.current()) throw Error('AI_SCOPE_CHANGED');
    await host.refresh(value, signal);
    if (signal.aborted || controls.current !== host || !scope.current.current() || !host.current()) throw Error('AI_SCOPE_CHANGED');
    controlResult.current = value; session.suspend();
  }, [identity, session]);
  useEffect(() => {
    const original = controlResult.current;
    if (!original || !enabled || !current() || document.hidden || original.taskId !== expected.taskId
      || original.runId !== expected.runId || original.resultId !== expected.resultId) return;
    controlResult.current = null;
    void session.read().catch(() => undefined);
  }, [session, enabled, expected.taskId, expected.runId, expected.resultId, state, current]);
  if (!current() || document.hidden) return null;
  const frame = state.frame && (expected.runId === undefined || state.frame.runId === expected.runId)
    && (expected.resultId === undefined || state.frame.resultId === expected.resultId) ? state.frame : null;
  return <>
    {controlHost?.identity === identity && controlHost.taskId === expected.taskId && <TaskWorkbenchModelControls
      identity={identity} taskId={expected.taskId} current={current} sourceEnabled={enabled}
      sourceRunId={expected.runId} sourceResultId={expected.resultId} onAvailable={refreshControl} />}
    {enabled && <section aria-label={t('原结果动态展示')} aria-busy={state.busy}>
    <p>{t('展示内容来自原结果。事实、候选输入和正式确认分别核对。')}</p>
    <ActionButton label={t('读取原展示')} pendingLabel={t('读取中…')} disabled={state.busy} onAction={() => session.read()} />
    {(state.busy || frame) && <ActionButton variant="secondary" label={t('停止当前展示')}
      onAction={async () => { session.suspend(); }} />}
    {(state.busy || frame) && <p>{t('停止展示只撤回本页内容；需要取消任务时，请使用原取消请求。')}</p>}
    {state.reason && <Alert type="warning" title={t('动态展示当前不可用，请使用原事实摘要和人工入口。')} />}
    {frame && <div inert={state.candidateConflict}><iframe key={frame.binding.instanceId} ref={attach} sandbox="allow-scripts"
      srcDoc={frame.document} title={t('隔离的原结果展示')} referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'"
      style={{ display: 'block', width: '100%', height: 'min(65vh, 40rem)', minHeight: '20rem', border: 0, marginBlock: 'var(--space-3, 12px)' }} /></div>}
    {state.candidate && <div>
      <p>{t('以下仅是未提交候选，尚未重新准备或批准。')}</p>
      {state.candidateConflict && <Alert type="warning" title={t('候选需要重新核对，当前不能继续使用。')} />}
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{safeDisplayText(JSON.stringify(state.candidate.answers), 4096)}</pre>
      <ActionButton label={t('核对候选输入')} disabled={state.busy || state.candidateConflict || state.phase !== 'rendered' || !port.reviewCandidate}
        onAction={() => session.reviewCandidate()} />
      {state.candidateConflict && <ActionButton label={t('放弃旧候选')} disabled={state.busy} onAction={async () => { session.discardCandidate(); }} />}
    </div>}
    {state.sourceId && <ActionButton label={t('读取原来源')} disabled={state.busy || !port.readSource} onAction={() => session.openSource()} />}
    {state.source && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{safeDisplayText(state.source.text, 20000)}</pre>}
    {state.confirmation && <ActionButton label={t('打开原确认材料')} disabled={state.busy || !port.openConfirmation} onAction={() => session.openConfirmation()} />}
    </section>}
  </>;
}
