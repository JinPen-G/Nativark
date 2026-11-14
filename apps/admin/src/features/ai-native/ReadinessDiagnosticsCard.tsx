/** Original opening material and registered human configuration navigation.
 * Model text never supplies facts or routes. Reads/opens create no task, model,
 * draft, approval, configuration write or publication. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AI_CONVERSATION_DRAFT_VERSION, AI_SCENE_MODEL_HTTP_DRAFT, validateAiConversationAdmissionDraft, validateAiConversationTurnDraft,
  validateAiSceneRequestReceiptDraft, validateAiSceneRequestReconcileDraft, aiOpeningCalendarSourceBasis, aiOpeningCapabilitySourceBasis,
  type AiConversationTurnObservationDraft, type AiTaskSceneReadDraft, type AiTaskSceneObservationDraft, type ApiResult } from '@rental-os/shared';
import { APP_ROUTES, type AppRouteDefinition } from '@/app/navigation';
import { currentSessionEpoch } from '@/app/queryClient';
import { aiConversationsApi } from '@/api/aiConversations';
import { aiOpeningDiagnosticsApi, type OpeningTaskMaterial } from '@/api/aiOpeningDiagnostics';
import { http } from '@/api/http';
import { ActionButton, Alert, Button } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { toOpeningReadinessDiagnostics, toReadinessDiagnostics, readinessCalendarSource,
  type ReadinessDiagnosticRow, type ReadinessDiagnosticsDisplay } from './readiness-diagnostics';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';
import { validateTaskCenterSnapshot } from './task-center-reader';
import { OpeningIntegrationStatus } from './OpeningIntegrationStatus';
import { commandHash } from './budget-settings-session';
import styles from './AiManagement.module.css';

export type ReadinessDiagnosticsOriginalProps = { conversationId: string; turn: AiConversationTurnObservationDraft; current(): boolean; onUnavailable?(): void };
export type ReadinessDiagnosticsCardProps = { data?: unknown } | ReadinessDiagnosticsOriginalProps;
const labels = { required: '必需', optional: '可选', unavailable: '事实源不可用', completed: '检查已通过', unclassified: '尚无法分类' } as const;
const sectionRoutes: Readonly<Record<string, AppRouteDefinition>> = {
  workspace_profile: APP_ROUTES.tenantReadiness, accounts_roles: APP_ROUTES.tenantAccounts,
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
const integrationBasis = (value: OpeningTaskMaterial) => {
  const facts = value.material.integrationObservation && structuredClone(value.material.integrationObservation);
  if (facts?.state === 'observed') delete (facts.observation as Partial<typeof facts.observation>).observedAt;
  return facts;
};
const basis = (value: OpeningTaskMaterial) => JSON.stringify({
  taskId: value.task.state === 'observed' ? value.task.taskId : null, scope: value.material.scope,
  origin: [value.original.inputRef, value.original.contentHash, value.original.sceneVersion], version: value.material.configVersion,
  integrations: integrationBasis(value),
  category: value.material.categorySource,
  capabilities: value.material.capabilityObservation && aiOpeningCapabilitySourceBasis(value.material.capabilityObservation),
  calendarSource: value.material.calendarSource && aiOpeningCalendarSourceBasis(value.material.calendarSource),
  sections: value.material.sections.map(row => ({ key: row.key, title: row.title, status: row.status, issue: row.issue, summary: row.summary,
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
    const calendar = readinessCalendarSource(value.material.calendarSource, value.material.scope, value.material.observedAt);
    if (!toOpeningReadinessDiagnostics(value.material)) throw Error('AI_RESOURCE_UNAVAILABLE');
    if (calendar) {
      const { sourceHash, observations: _observations, ...source } = calendar;
      if (!value.material.sections.some(section => section.key === 'business_calendar') || await commandHash(source) !== sourceHash)
        throw Error('AI_RESOURCE_UNAVAILABLE');
      check();
    }
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
      {frame?.material.integrationObservation?.state === 'observed' && valid() && permitted(APP_ROUTES.tenantIntegrations) && <ActionButton
        label={t('第三方服务')} disabled={busy} onAction={() => run(async (signal, check) => {
          if (!permitted(APP_ROUTES.tenantIntegrations)) throw Error('AI_ACCESS_DENIED');
          const latest = await read(signal, check); check();
          if (basis(latest) !== basis(frame)) { setFrame(latest); setChanged(true); onUnavailable?.(); throw Error('AI_RECONFIRM_OPENING'); }
          // The independent server observation proves current integration read
          // access; a cached frontend permission or opening read cannot do so.
          if (latest.material.integrationObservation?.state !== 'observed' || !permitted(APP_ROUTES.tenantIntegrations)) throw Error('AI_ACCESS_DENIED');
          check(); navigate(APP_ROUTES.tenantIntegrations.path);
        })} />}
      {frame?.material.capabilityObservation?.state === 'observed' && valid() && permitted(APP_ROUTES.rentalCapabilities) && <ActionButton
        label={t('经营空间能力')} intent="review" disabled={busy} onAction={() => run(async (signal, check) => {
          if (!permitted(APP_ROUTES.rentalCapabilities)) throw Error('AI_ACCESS_DENIED');
          const latest = await read(signal, check); check();
          if (basis(latest) !== basis(frame)) { setFrame(latest); setChanged(true); onUnavailable?.(); throw Error('AI_RECONFIRM_OPENING'); }
          if (latest.material.capabilityObservation?.state !== 'observed' || !permitted(APP_ROUTES.rentalCapabilities)) throw Error('AI_ACCESS_DENIED');
          check(); navigate(APP_ROUTES.rentalCapabilities.path);
        })} />}
    </div>
    {error && <Alert type="warning" title={t('开业事实不可读取，旧事实已撤回；请进入原开业配置页。')} />}
    {changed && <Alert type="warning" title={t('分区配置或检查已变化，请核对新事实后再次选择。')} />}
    {frame && valid() && <OpeningIntegrationStatus facts={frame.material.integrationObservation} />}
    {display && frame && <ReadinessDisplay display={display} action={row => manualRoute(row, frame) && <ActionButton
      label={t(row.state === 'completed' ? '查看' : '去配置')} disabled={busy} onAction={() => run(async (signal, check) => {
        const latest = await read(signal, check); check();
        if (basis(latest) !== basis(frame)) { setFrame(latest); setChanged(true); onUnavailable?.(); throw Error('AI_RECONFIRM_OPENING'); }
        const selected = toOpeningReadinessDiagnostics(latest.material)?.rows.find(item => item.key === row.key);
        const route = selected && manualRoute(selected, latest);
        if (!route) throw Error('AI_ACCESS_DENIED'); check(); navigate(route.path);
      })} />} />}
  </section>;
}

function OpeningCalendarDetails({ source }: { source: ReadinessDiagnosticsDisplay['calendarSource'] }) {
  const { t } = useAiManagementLocale();
  if (!source) return <dd>{t('当前日历来源未加载，不能确定已采用版本。')}</dd>;
  return <>
    {source.years.map(row => <dd key={row.year}>
      <p>{row.year} · {row.status === 'not_adopted' ? t('未采用已发布日历')
        : <>{t('当前日历版本')}：{safeDisplayText(row.binding.version, 191)} · {t('原修订')}：{row.binding.revision}</>}</p>
      {row.status === 'adopted' && <>
        <p>{t('日历引用')}：{safeDisplayText(row.binding.id, 191)} · {t('原发布时间')}：{formatTimestamp(row.binding.publishedAt).value}</p>
        {Object.values(row.binding.officialSource).every(value => value === null)
          ? <p>{t('原官方来源引用未记录；不代表当前日历未发布。')}</p>
          : <>
            <p>{t('原官方来源版本')}：{row.binding.officialSource.version === null ? t('未记录') : safeDisplayText(row.binding.officialSource.version, 191)} · {t('原官方来源引用')}：{row.binding.officialSource.versionId === null ? t('未记录') : safeDisplayText(row.binding.officialSource.versionId, 191)}</p>
            <p>{t('原官方发布时间')}：{row.binding.officialSource.publishedAt === null ? t('未记录') : formatTimestamp(row.binding.officialSource.publishedAt).value} · {t('原导入时间')}：{row.binding.officialSource.importedAt === null ? t('未记录') : formatTimestamp(row.binding.officialSource.importedAt).value}</p>
          </>}
      </>}
    </dd>)}
    <dd>{t('日历来源观察')}：{formatTimestamp(source.observations.startedAt).value} – {formatTimestamp(source.observations.completedAt).value}</dd>
    <dd>{t(source.observations.consistency === 'caller_transaction_reads'
      ? '日历来源在调用方原事务内读取。' : '日历来源来自独立持久化读取，不是整体快照。')}</dd>
    <dd>{t('官方引用仅为原日历记录，未重新核验官方来源。')}</dd>
  </>;
}

function ReadinessDisplay({ display, action }: { display: ReadinessDiagnosticsDisplay | null; action?(row: ReadinessDiagnosticRow): ReactNode }) {
  const { t } = useAiManagementLocale();
  if (!display) return <p role="status">{t('开业诊断不可用，请核对当前租户和经营空间。')}</p>;
  return <section className={styles.stack} aria-label={t('开业诊断')} data-ai-readiness="readonly">
    <h3>{t('开业诊断')}</h3>
    {display.ready !== null && <p>{t(display.ready ? '服务端判定可开业' : '仍有配置缺口')}</p>}
    {display.observedAt && <p>{t('查询时点')}：{formatTimestamp(display.observedAt).value} · {t('配置版本')}：{safeDisplayText(display.configVersion, 191)}</p>}
    {display.observedAt && <>
      <p>{display.categorySource ? <>{t('当前采用品类')}：{safeDisplayText(display.categorySource.categoryCode, 191)} · {t('品类版本')}：{safeDisplayText(display.categorySource.categoryVersion, 191)}</>
        : t('原材料未记录品类版本，不能推定当前采用。')}</p>
      <OpeningCapabilityDetails facts={display.capabilityObservation} />
    </>}
    <dl className={styles.facts}>{display.rows.map(row => <div key={row.key} data-readiness-state={row.state}>
      <dt>{t(safeDisplayText(row.title, 200))}</dt><dd>{t(labels[row.state])}</dd>
      {row.state !== 'completed' && <dd>{row.state === 'unavailable' ? t('事实源不可用，不能据此判定完成。') : t(safeDisplayText(row.missing, 1000))}</dd>}
      {row.summary && <dd>{t(safeDisplayText(row.summary, 1000))}</dd>}
      {row.evidence && <dd>{t('来源版本')}：{safeDisplayText(row.evidence.version, 191)}</dd>}
      {row.key === 'business_calendar' && <OpeningCalendarDetails source={display.calendarSource} />}
      {action && <dd>{action(row)}</dd>}
    </div>)}</dl>
    {display.quoteBlockers === null ? <p>{t('本次材料未提供整体开业判定或报价阻塞，请以原开业页面为准。')}</p>
      : display.quoteBlockers.length > 0 && <p role="status">{t('报价/下单阻塞')}：{display.quoteBlockers.map(value => t(safeDisplayText(value, 1000))).join('、')}</p>}
    {display.externalVerification === 'not_loaded' && <p>{t(display.calendarSource
      ? '日历仅显示当前原发布与采用记录；外部凭据和真实连接仍未核验。'
      : '外部凭据、真实连接、发布与采用结果尚未核验。')}</p>}
    <p className={styles.help}>{t('各分区独立读取；保存草稿、审核发布和采用需继续原业务流程。')}</p>
  </section>;
}

function OpeningCapabilityDetails({ facts }: { facts: ReadinessDiagnosticsDisplay['capabilityObservation'] }) {
  const { t } = useAiManagementLocale();
  if (facts?.state !== 'observed') return <p role="status">{t(facts?.reason === 'current_capability_permission_required'
    ? '当前无权读取经营空间能力状态。' : '原经营空间能力来源未加载。')}</p>;
  const states = { enabled: '已启用', paused: '已暂停', disabled: '已停用', declared_not_implemented: '尚未实现', not_enabled: '未启用' };
  const observed = facts.observation;
  return <>
    <p>{observed.missingRequired.length ? <>{t('原服务报告缺少必需能力')}：{observed.missingRequired.map(code => safeDisplayText(code, 191)).join('、')}</>
      : t('原服务本次未报告缺少必需能力。')}</p>
    <p className={styles.help}>{t('能力门槛不是整体开业或外部连接成功证明。')}</p>
    <details>
      <summary>{t('经营空间能力')} · {observed.capabilities.length}</summary>
      <p>{t('能力来源观察时间')}：{formatTimestamp(observed.observedAt).value}</p>
      <dl className={styles.facts}>{observed.capabilities.map(row => <div key={row.code}>
        <dt>{safeDisplayText(row.code, 191)}</dt><dd>{t(states[row.state])} · {t(row.requiredForCategory ? '本品类必需' : '本品类非必需')}</dd>
        <dd>{t(row.declaredByCategory ? '已声明' : '未声明')} · {t(row.implemented ? '已实现' : '未实现')} · {t(row.applicable ? '适用' : '不适用')}{row.providedByCore && <> · {t('Core 内建')}</>}</dd>
        <dd>{t('登记实现版本')}：{row.implementationVersion === null ? t('未记录') : safeDisplayText(row.implementationVersion, 191)}</dd>
        {row.instance ? <>
          <dd>{t('实例实现版本')}：{safeDisplayText(row.instance.implementationVersion, 191)} · {t('配置版本')}：{safeDisplayText(row.instance.configVersion, 191)} · {t('原修订')}：{row.instance.revision}</dd>
          <dd>{t('实例更新时间')}：{formatTimestamp(row.instance.updatedAt).value}{row.upgradeAvailable && <> · {t('原服务提示有可用升级')}</>}</dd>
        </> : <dd>{t('未提供独立能力实例；不据此推断已启用扩展。')}</dd>}
      </div>)}</dl>
    </details>
  </>;
}
