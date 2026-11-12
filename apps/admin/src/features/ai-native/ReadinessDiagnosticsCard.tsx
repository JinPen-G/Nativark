/** Original opening material and registered human configuration navigation.
 * Model text never supplies facts or routes. Reads/opens create no task, model,
 * draft, approval, configuration write or publication. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AI_CONVERSATION_DRAFT_VERSION, AI_SCENE_MODEL_HTTP_DRAFT, validateAiConversationAdmissionDraft, validateAiConversationTurnDraft,
  validateAiSceneRequestReceiptDraft, validateAiSceneRequestReconcileDraft,
  type AiConversationTurnObservationDraft, type AiTaskSceneReadDraft, type AiTaskSceneObservationDraft, type ApiResult } from '@rental-os/shared';
import { APP_ROUTES, type AppRouteDefinition } from '@/app/navigation';
import { currentSessionEpoch } from '@/app/queryClient';
import { aiConversationsApi } from '@/api/aiConversations';
import { aiOpeningDiagnosticsApi, type OpeningTaskMaterial } from '@/api/aiOpeningDiagnostics';
import { http } from '@/api/http';
import { ActionButton, Alert, Button } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { toOpeningReadinessDiagnostics, toReadinessDiagnostics, type ReadinessDiagnosticRow, type ReadinessDiagnosticsDisplay } from './readiness-diagnostics';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';
import { validateTaskCenterSnapshot } from './task-center-reader';
import styles from './AiManagement.module.css';

export type ReadinessDiagnosticsOriginalProps = { conversationId: string; turn: AiConversationTurnObservationDraft; current(): boolean; onUnavailable?(): void };
export type ReadinessDiagnosticsCardProps = { data?: unknown } | ReadinessDiagnosticsOriginalProps;
const labels = { required: '必需', optional: '可选', unavailable: '事实源不可用', completed: '检查已通过', unclassified: '尚无法分类' } as const;
const sectionRoutes: Readonly<Record<string, AppRouteDefinition>> = {
  workspace_profile: APP_ROUTES.workbench, accounts_roles: APP_ROUTES.tenantAccounts,
  fulfillment_network: APP_ROUTES.locations, business_rule: APP_ROUTES.rentalSettings,
  business_calendar: APP_ROUTES.rentalSettings, item_groups: APP_ROUTES.itemGroups,
  pricing_groups_rates: APP_ROUTES.pricingGroups, price_version: APP_ROUTES.pricing, membership_base: APP_ROUTES.membershipPlans
};
const permitted = (route: AppRouteDefinition) => {
  const auth = useAuthStore.getState();
  return !!auth.token && !auth.user?.isSaasAdmin && (!route.permission || auth.hasPermission(route.permission)
    || !!route.legacyPermissions?.some(permission => auth.hasPermission(permission)));
};
const routeFor = (key: string) => {
  const route = Object.hasOwn(sectionRoutes, key) ? sectionRoutes[key] : null;
  if (key === 'accounts_roles' && route && !permitted(route) && permitted(APP_ROUTES.tenantRoles)) return APP_ROUTES.tenantRoles;
  return route;
};
const basis = (value: OpeningTaskMaterial) => JSON.stringify({
  taskId: value.task.state === 'observed' ? value.task.taskId : null, scope: value.material.scope,
  origin: [value.original.inputRef, value.original.contentHash, value.original.sceneVersion], version: value.material.configVersion,
  sections: value.material.sections.map(row => ({ key: row.key, title: row.title, status: row.status, issue: row.issue,
    required: row.required, impact: row.impact, version: row.evidence.version, manual: row.manual,
    candidateVersion: row.candidate.currentVersion, fields: row.candidate.fieldsToReview })).sort((a, b) => a.key.localeCompare(b.key))
});

/** Preserve the original pure Core projection; only an original conversation
 * binding enables the separate, explicitly operated reader below. */
export function ReadinessDiagnosticsCard(props: ReadinessDiagnosticsCardProps) {
  return 'turn' in props ? <OriginalOpeningDiagnostics {...props} /> : <ReadinessDisplay display={toReadinessDiagnostics(props.data)} />;
}

function OriginalOpeningDiagnostics({ conversationId, turn, current, onUnavailable }: ReadinessDiagnosticsOriginalProps) {
  const auth = useAuthStore(), { t } = useAiManagementLocale(), navigate = useNavigate(), epoch = currentSessionEpoch();
  const binding = JSON.stringify([conversationId, turn, auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, epoch]);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const mounted = useRef(false), generation = useRef(0), request = useRef<AbortController | null>(null);
  const [frame, setFrame] = useState<OpeningTaskMaterial | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(false), [changed, setChanged] = useState(false);
  const valid = () => owner.current.binding === binding && epoch === currentSessionEpoch() && !document.hidden && owner.current.current();
  useEffect(() => {
    const clear = () => { generation.current++; request.current?.abort(); request.current = null;
      setFrame(null); setBusy(false); setError(false); setChanged(false); };
    clear(); mounted.current = true; document.addEventListener('visibilitychange', clear);
    return () => { mounted.current = false; generation.current++; request.current?.abort(); request.current = null;
      document.removeEventListener('visibilitychange', clear); };
  }, [binding]);
  const task = turn.task;
  if (!validateAiConversationTurnDraft(turn) || turn.capabilityCode !== 'opening_diagnosis' || turn.material !== 'retained'
    || !task || 'creation' in turn || !valid()) return null;
  const run = async (work: (signal: AbortSignal, check: () => void) => Promise<void>) => {
    if (!mounted.current || !valid()) throw Error('AI_SCOPE_CHANGED');
    if (request.current) throw Error('AI_OPERATION_BUSY');
    const serial = ++generation.current, controller = new AbortController(); request.current = controller;
    const active = () => mounted.current && serial === generation.current && !controller.signal.aborted && valid();
    const check = () => { if (!active()) throw Error('AI_SCOPE_CHANGED'); };
    setBusy(true); setError(false);
    try { await work(controller.signal, check); }
    catch (failure) { if (active() && (failure as Error).message !== 'AI_RECONFIRM_OPENING') {
      setFrame(null); setError(true); onUnavailable?.();
    } throw failure; }
    finally { if (request.current === controller) { request.current = null; if (active()) setBusy(false); } }
  };
  const read = async (signal: AbortSignal, check: () => void) => {
    const query = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId, admissionKey: turn.admissionKey };
    const verify = async () => {
      check(); const value = await aiConversationsApi.admission(query, signal); check();
      if (!validateAiConversationAdmissionDraft(value, query) || JSON.stringify(value.result) !== JSON.stringify(turn)) throw Error('AI_REVISION_CONFLICT');
    };
    const source = async () => {
      check();
      const query: AiTaskSceneReadDraft = { kind: 'original', taskId: task.taskId, runId: task.runId, original: turn.original };
      // This historical observer accepts the original reference. The legacy
      // reconcile endpoint instead requires the complete creation command.
      const response = await http.post<ApiResult<unknown>>(`/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene}`,
        query, { signal, timeout: 15000 }); check();
      if (new TextEncoder().encode(JSON.stringify(response.data.data)).length > 262144) throw Error('AI_RESOURCE_UNAVAILABLE');
      const value = response.data.data as AiTaskSceneObservationDraft;
      if (!value || value.kind !== 'original' || value.taskId !== task.taskId || value.runId !== task.runId
        || value.originRunId !== task.runId || !value.originalInput || !value.task || !value.snapshot
        || value.snapshot.availability !== 'available') throw Error('AI_REVISION_CONFLICT');
      const receipt = value.originalInput.receipt, origin = value.task.original;
      const observed = { state: 'observed' as const, receipt, task: value.task.task };
      if (!validateAiSceneRequestReconcileDraft(observed, turn.original, turn) || observed.task.state !== 'observed'
        || observed.task.taskId !== task.taskId || observed.task.runId !== task.runId || receipt.state === 'revoked'
        || !origin || typeof origin !== 'object' || !('receipt' in origin)
        || !validateAiSceneRequestReceiptDraft(origin.receipt, turn.original, turn)
        || origin.receipt.contentHash !== receipt.contentHash || origin.receipt.revision !== receipt.revision
        || origin.inputRef !== turn.original.inputRef || origin.inputHash !== receipt.contentHash || origin.inputRevision !== receipt.revision
        || origin.sceneCode !== turn.capabilityCode || origin.sceneVersion !== turn.capabilityVersion || origin.audience !== 'operator'
        || origin.scope?.tenantId !== auth.tenant?.tenantId || origin.scope?.workspaceId !== auth.currentWorkspaceId) throw Error('AI_REVISION_CONFLICT');
      const snapshot = validateTaskCenterSnapshot(value.snapshot.value, task.taskId);
      if (snapshot.sceneCode !== turn.capabilityCode || snapshot.sceneVersion !== turn.capabilityVersion
        || snapshot.revision !== observed.task.revision) throw Error('AI_REVISION_CONFLICT');
      return { receipt, task: observed.task };
    };
    await verify();
    const original = await source(); check();
    const value = await aiOpeningDiagnosticsApi.read(task, turn.original, signal); check();
    // The turn hashes the admitted scene body; the original receipt separately
    // hashes its scope, owner and version. Compare each to its original reader.
    if (!validateAiSceneRequestReceiptDraft(value.original, turn.original, turn) || value.original.state === 'revoked'
      || value.original.contentHash !== original.receipt.contentHash || value.original.revision !== original.receipt.revision
      || value.task.state !== 'observed' || value.task.taskId !== task.taskId || value.task.runId !== task.runId
      || value.task.revision !== original.task.revision || value.material.audience !== 'operator'
      || value.material.scope.tenantId !== auth.tenant?.tenantId || value.material.scope.workspaceId !== auth.currentWorkspaceId) throw Error('AI_REVISION_CONFLICT');
    const closing = await source(); check();
    if (closing.receipt.contentHash !== original.receipt.contentHash || closing.receipt.revision !== original.receipt.revision
      || JSON.stringify(closing.task) !== JSON.stringify(original.task)) throw Error('AI_REVISION_CONFLICT');
    await verify(); check(); return value;
  };
  const manualRoute = (row: ReadinessDiagnosticRow, value: OpeningTaskMaterial) => {
    const route = routeFor(row.key), manual = row.manual;
    return route && permitted(route) && manual && 'kind' in manual && manual.kind === 'configuration_section'
      && manual.section === row.key && manual.scope.tenantId === value.material.scope.tenantId
      && manual.scope.workspaceId === value.material.scope.workspaceId ? route : null;
  };
  const display = frame && valid() ? toOpeningReadinessDiagnostics(frame.material) : null;
  return <section className={styles.stack} aria-label={t('开业诊断与人工配置')} aria-busy={busy}>
    <div className={styles.toolbar}>
      <ActionButton label={t('读取开业分区事实')} pendingLabel={t('正在核对')} disabled={busy} onAction={() => run(async (signal, check) => {
        setFrame(null); setChanged(false); const value = await read(signal, check); check(); setFrame(value);
      })} />
      {permitted(APP_ROUTES.tenantReadiness) && <Button onClick={() => { if (valid() && permitted(APP_ROUTES.tenantReadiness)) navigate(APP_ROUTES.tenantReadiness.path); }}>{t('开业配置')}</Button>}
    </div>
    {error && <Alert type="warning" title={t('开业事实不可读取，旧事实已撤回；请进入原开业配置页。')} />}
    {changed && <Alert type="warning" title={t('分区配置或检查已变化，请核对新事实后再次选择。')} />}
    {display && frame && <ReadinessDisplay display={display} action={row => manualRoute(row, frame) && <ActionButton
      label={t(row.state === 'completed' ? '查看' : '去配置')} disabled={busy} onAction={() => run(async (signal, check) => {
        const latest = await read(signal, check); check();
        if (basis(latest) !== basis(frame)) { setFrame(latest); setChanged(true); onUnavailable?.(); throw Error('AI_RECONFIRM_OPENING'); }
        const selected = toOpeningReadinessDiagnostics(latest.material).rows.find(item => item.key === row.key);
        const route = selected && manualRoute(selected, latest);
        if (!route) throw Error('AI_ACCESS_DENIED'); check(); navigate(route.path);
      })} />} />}
  </section>;
}

function ReadinessDisplay({ display, action }: { display: ReadinessDiagnosticsDisplay | null; action?(row: ReadinessDiagnosticRow): ReactNode }) {
  const { t } = useAiManagementLocale();
  if (!display) return <p role="status">{t('开业诊断不可用，请核对当前租户和经营空间。')}</p>;
  return <section className={styles.stack} aria-label={t('开业诊断')} data-ai-readiness="readonly">
    <h3>{t('开业诊断')}</h3>
    {display.ready !== null && <p>{t(display.ready ? '服务端判定可开业' : '仍有配置缺口')}</p>}
    {display.observedAt && <p>{t('查询时点')}：{formatTimestamp(display.observedAt).value} · {t('配置版本')}：{safeDisplayText(display.configVersion, 191)}</p>}
    <dl className={styles.facts}>{display.rows.map(row => <div key={row.key} data-readiness-state={row.state}>
      <dt>{t(safeDisplayText(row.title, 200))}</dt><dd>{t(labels[row.state])}</dd>
      {row.state !== 'completed' && <dd>{row.state === 'unavailable' ? t('事实源不可用，不能据此判定完成。') : t(safeDisplayText(row.missing, 1000))}</dd>}
      {row.summary && <dd>{t(safeDisplayText(row.summary, 1000))}</dd>}
      {row.evidence && <dd>{t('来源版本')}：{safeDisplayText(row.evidence.version, 191)}</dd>}
      {action && <dd>{action(row)}</dd>}
    </div>)}</dl>
    {display.quoteBlockers === null ? <p>{t('本次材料未提供整体开业判定或报价阻塞，请以原开业页面为准。')}</p>
      : display.quoteBlockers.length > 0 && <p role="status">{t('报价/下单阻塞')}：{display.quoteBlockers.map(value => t(safeDisplayText(value, 1000))).join('、')}</p>}
    {display.externalVerification === 'not_loaded' && <p>{t('外部凭据、真实连接、发布与采用结果尚未核验。')}</p>}
    <p className={styles.help}>{t('各分区独立读取；保存草稿、审核发布和采用需继续原业务流程。')}</p>
  </section>;
}
