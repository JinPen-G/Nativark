/** Opt-in original HTML display. Facts and fixed business confirmation stay
 * outside the opaque frame; source/candidate requests require trusted review. */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ActionButton, Alert } from '@/components/ui';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';
import { WorkbenchDisplaySession } from './workbench-display-session';
import type { WorkbenchDisplayExpectation, WorkbenchDisplayPort } from './workbench-display-host';

export interface TaskWorkbenchDisplayProps {
  identity: string; expected: WorkbenchDisplayExpectation; port: WorkbenchDisplayPort;
  current(): boolean; enabled?: boolean;
}
export function TaskWorkbenchDisplay({ identity, expected, port, current, enabled = true }: TaskWorkbenchDisplayProps) {
  const { t } = useAiManagementLocale();
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
  if (!enabled || !current() || document.hidden) return null;
  const frame = state.frame && (expected.runId === undefined || state.frame.runId === expected.runId)
    && (expected.resultId === undefined || state.frame.resultId === expected.resultId) ? state.frame : null;
  return <section aria-label={t('原结果动态展示')} aria-busy={state.busy}>
    <p>{t('展示内容来自原结果。事实、候选输入和正式确认分别核对。')}</p>
    <ActionButton label={t('读取原展示')} pendingLabel={t('读取中…')} disabled={state.busy} onAction={() => session.read()} />
    {state.reason && <Alert type="warning" title={t('动态展示当前不可用，请使用原事实摘要和人工入口。')} />}
    {frame && <div inert={state.candidateConflict}><iframe key={frame.binding.instanceId} ref={attach} sandbox="allow-scripts"
      srcDoc={frame.document} title={t('隔离的原结果展示')} referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'"
      style={{ display: 'block', width: '100%', height: 'min(65vh, 40rem)', minHeight: '20rem', border: 0, marginBlock: 'var(--space-3, 12px)' }} /></div>}
    {state.candidate && <div>
      <p>{t('以下仅是未提交候选，尚未重新准备或批准。')}</p>
      {state.candidateConflict && <Alert type="warning" title={t('材料已更新，保留的候选需要在原输入控件重新核对。')} />}
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{safeDisplayText(JSON.stringify(state.candidate.answers), 4096)}</pre>
      <ActionButton label={t('核对候选输入')} disabled={state.busy || !port.reviewCandidate} onAction={() => session.reviewCandidate()} />
      {state.candidateConflict && <ActionButton label={t('放弃旧候选')} disabled={state.busy} onAction={async () => { session.discardCandidate(); }} />}
    </div>}
    {state.sourceId && <ActionButton label={t('读取原来源')} disabled={state.busy || !port.readSource} onAction={() => session.openSource()} />}
    {state.source && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{safeDisplayText(state.source.text, 20000)}</pre>}
    {state.confirmation && <ActionButton label={t('打开原确认材料')} disabled={state.busy || !port.openConfirmation} onAction={() => session.openConfirmation()} />}
  </section>;
}
