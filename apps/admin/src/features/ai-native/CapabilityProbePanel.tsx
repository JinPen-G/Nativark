/** Tenant management host for the original controlled capability challenge.
 * No auto-start, policy seeding, supplier connection or local enable switch. */
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { aiCapabilityProbeApi } from '@/api/aiCapabilityProbe';
import { currentSessionEpoch } from '@/app/queryClient';
import { useLocale } from '@/app/locale';
import { ActionButton, Alert, ConfirmAction, Select } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { CapabilityProbeSession, PROBE_CAPABILITIES, PROBE_TASK_ACTIONS } from './capability-probe-session';
import { safeDisplayText } from './safe-display';
import { formatUsageQuantity } from './usage-quantity';
import { formatTimestamp } from './formatters';

const labels = { text: '文本', streaming: '流式', vision: '视觉', audio: '音频', structured_output: '结构化输出', tools: '工具调用' };
const messages = { idle: '先准备原验证请求；能力种类仍受服务器白名单限制，准备不代表执行。',
  observed: '已取得本次原操作结果。准备、任务、能力证据、预算与派发权限仍是不同状态。',
  unknown: '原操作待核对。保留同一请求编号，不换编号重发；缺记录不能证明操作未发生。',
  denied: '当前身份、空间或权限已变化，已清除旧结果。重新授权后只核对原操作。',
  invalid: '当前输入或办理顺序无效，请核对能力、原请求与当前任务状态。',
  unavailable: '验证配置、正式政策、当前模型或预算依赖不可用；没有默认放行或供应商回退。' };
// These are existing server template codes, not caller-defined permissions.
const policyActions = PROBE_TASK_ACTIONS;
export function CapabilityProbePanel({ identity }: { identity: string }) {
  const { t } = useLocale(), label = useId();
  const [capability, setCapability] = useState<(typeof PROBE_CAPABILITIES)[number]>('text'), [operation, setOperation] = useState<string>('read_metadata');
  const session = useMemo(() => {
    const epoch = currentSessionEpoch(), owner = useAuthStore.getState(); let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* no durable original locator -> fail closed */ }
    return new CapabilityProbeSession(aiCapabilityProbeApi, () => {
      const a = useAuthStore.getState();
      return !!a.token && !!a.user?.id && !a.user.isSaasAdmin && a.hasPermission('system:params:manage') && !document.hidden
        && currentSessionEpoch() === epoch && JSON.stringify([a.tenant?.tenantId, a.currentWorkspaceId, a.user]) === identity;
    }, storage, `rental_ai_capability_probe:${JSON.stringify([owner.tenant?.tenantId, owner.currentWorkspaceId, owner.user?.id])}`);
  }, [identity]);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot), journal = state.journal;
  const frozen = state.busy || !!journal?.uncertain || state.locked;
  return <section aria-label={t('受控能力验证')} aria-busy={state.busy}>
    <h3>{t('受控能力验证')}</h3>
    <Alert type={state.feedback === 'unknown' || state.feedback === 'denied' ? 'warning' : 'info'} title={t(messages[state.feedback])} />
    <p>{t('此入口使用当前租户、空间及本人正式验证任务。启动可能消耗预算；模型配置、执行政策、真实能力证据和计数仍须分别成立。不会自动开通权益或预算。')}</p>
    <div className="panel-toolbar">
      <label htmlFor={`${label}-capability`}>{t('验证能力')}</label>
      <Select id={`${label}-capability`} value={journal?.capability ?? capability} disabled={state.busy || !!journal}
        options={PROBE_CAPABILITIES.map(value => ({ value, label: t(labels[value]) }))}
        onChange={value => { if (PROBE_CAPABILITIES.includes(value as typeof capability)) setCapability(value as typeof capability); }} />
      <ActionButton label={t('准备原验证请求')} successLabel={t('已准备，尚未执行')} disabled={frozen || !!journal?.started}
        onAction={() => session.prepare(journal?.capability ?? capability)} />
    </div>
    {journal && <>
      <p>{t('原请求编号')}: <code>{journal.requestKey}</code>；{t('能力')}: {t(labels[journal.capability])}</p>
      <p>{t('此页保留一个原请求，不提供清锁换编号重试。Embedding、Reasoning及平台独立主体验证尚未接入此宿主。')}</p>
      <div className="panel-toolbar">
        <ActionButton label={t('读取原请求保存结果')} successLabel={t('原请求已核对')} disabled={state.busy} onAction={() => session.act('readOriginal')} />
        <ActionButton label={t('读取原任务')} successLabel={t('原任务已读取')} disabled={state.busy} onAction={() => session.act('readTask')} />
        <ActionButton label={t('只读历史观察')} successLabel={t('历史观察已读取')} disabled={state.busy} onAction={() => session.act('readHistory')} />
      </div>
      {journal.policyWrite && <ActionButton label={t('核对原动作政策保存')} successLabel={t('原保存观察已返回')} disabled={state.busy}
        onAction={() => session.act('readTaskActionReceipt')} />}
      {journal.cancellationWrite && <ActionButton label={t('核对原取消请求')} successLabel={t('原取消观察已返回')} disabled={state.busy}
        onAction={() => session.readCancellationReceipt()} />}
      {journal.uncertain === 'cancel' && !journal.cancellationWrite && <p role="status">{t('旧记录缺少原取消任务与修订，只能人工核对；当前任务状态不能补造原收据或允许重发。')}</p>}
      {state.cancellationReceipt && <p role="status" aria-live="polite">{t(state.cancellationReceipt.status === 'observed'
        ? '原取消请求已记录；不表示任务已取消、远端已停止或费用已释放。'
        : '尚未观察到原取消收据，不能证明未提交，不允许重新发送。')}
        {t('原任务')}: <code>{state.cancellationReceipt.taskId}</code>；{t('原请求修订')}: {state.cancellationReceipt.expectedRevision}</p>}
      {state.policyReceipt && <p role="status">{t('已确认原动作政策保存修订')}: {state.policyReceipt.revision}；
        {t('原到期时间')}: {state.policyReceipt.expiresAt}。{t('不代表当前政策仍有效；须重新读取当前动作政策，不能据此启动或重派。')}</p>}
      {state.prepared && <p>{t('准备时配置修订')}: {state.prepared.configurationRevision}；{t('验证方法')}: {safeDisplayText(state.prepared.methodVersion, 64)}</p>}
      <ConfirmAction label={t('保存原验证请求')} prompt={t('保存当前准备的不可变验证请求？不会启动任务或模型。')}
        doneLabel={t('原请求已保存')} disabled={frozen || !state.prepared || state.published || !!journal.started} onConfirm={() => session.act('publish')} />
      <ConfirmAction label={t('创建原验证任务')} prompt={t('为已保存的原请求创建唯一任务？执行政策仍须由正式模板明确配置。')}
        doneLabel={t('原任务已创建')} disabled={frozen || !state.published || !!state.task || !!journal.started} onConfirm={() => session.act('createTask')} />
      {state.task && <>
        <p>{t('原任务')}: <code>{state.task.taskId}</code>；{t('任务状态（非能力结论）')}: {safeDisplayText(state.task.status, 64)}；{t('修订')}: {state.task.revision}</p>
        <div className="panel-toolbar">
          <label htmlFor={`${label}-policy`}>{t('原任务动作政策')}</label>
          <Select id={`${label}-policy`} value={operation} disabled={state.busy} options={policyActions.map(value => ({ value, label: value }))}
            onChange={value => setOperation(String(value))} />
          <ActionButton label={t('读取当前动作政策')} successLabel={t('动作政策已读取')} disabled={state.busy} onAction={() => session.act('readTaskAction', operation)} />
          <ConfirmAction label={t('按服务器模板配置此动作')} prompt={t('只配置当前选择的原任务动作？权限和有效期由服务器模板决定，不授业务批准或派发。')}
            doneLabel={t('本动作政策已配置')} disabled={frozen || state.policy?.operation !== operation}
            onConfirm={() => session.act('configureTaskAction', operation)} />
        </div>
      </>}
      <ConfirmAction label={t('明确启动原验证')} prompt={t('通过原运行器启动本次能力挑战，可能发起真实模型调用并占用预算？缺政策、权益或预算仍会拒绝。')}
        doneLabel={t('原启动已返回，请核对证据')} disabled={frozen || !state.task || !!journal.started || !!journal.cancellationWrite} onConfirm={() => session.act('start')} />
      <ConfirmAction label={t('恢复或核对原任务')} prompt={t('按原任务恢复规则核对，合法可恢复步骤可能继续；未知外部调用不能因重试换编号。')}
        doneLabel={t('原恢复已返回，请核对证据')} disabled={state.busy || !journal.started || !!journal.uncertain && !['start', 'reconcile'].includes(journal.uncertain)}
        onConfirm={() => session.act('reconcile')} />
      <ActionButton label={t('读取原任务当前状态')} successLabel={t('任务状态已读取')} disabled={state.busy} onAction={() => session.act('inspect')} />
      <ConfirmAction label={t('请求取消原任务')} prompt={t('提交原任务取消请求？已发生的调用仍需原证据核对，不能保证回滚或退额。')}
        doneLabel={t('取消请求已返回，尚非取消完成')} disabled={frozen || !state.task || !!journal.cancellationWrite} onConfirm={() => session.act('cancel')} />
      <ConfirmAction label={t('核对并登记原能力证据')} prompt={t('从原调用收据核对并登记能力证据？不会新派发模型，但可能写入原证据记录。')}
        doneLabel={t('原证据核对已返回')} disabled={state.busy || !journal.started || !!journal.uncertain && journal.uncertain !== 'readCapabilityReceipt'}
        onConfirm={() => session.act('readCapabilityReceipt')} />
      <ActionButton label={t('读取当前能力准入')} successLabel={t('当前能力准入已读取')} disabled={state.busy} onAction={() => session.act('preflight')} />
      <section aria-label={t('原验证账务')}>
        <h4>{t('原验证账务')}</h4>
        <p>{t('仅观察同一原请求的预算账本，不是供应商账单、能力证明或业务成功。未知保留占用；取消请求不等于退额。')}</p>
        <ActionButton label={t('读取原验证账务')} successLabel={t('原账观察已返回')} disabled={state.busy}
          onAction={() => session.act('readAccounting')} />
        {state.accounting && <div role="status" aria-live="polite">
          <p>{t('原调用')}: <code>{safeDisplayText(state.accounting.record.callId, 128)}</code>；
            {t('账务状态')}: {safeDisplayText(state.accounting.record.status, 64)}；
            {t('观察时间')}: {formatTimestamp(state.accounting.record.observedVersionAt).value}</p>
          <p>{t('原预留')}: {formatUsageQuantity(state.accounting.record.reserved)}；{t('原实耗')}: {formatUsageQuantity(state.accounting.record.actual)}。
            {t('原预算已标派发')}: {t(state.accounting.record.budgetDispatchMarked ? '是' : '否')}。{t('未标记不单独证明供应商未消耗。')}</p>
          {state.accounting.accounting === 'observed' && <>
            <ConfirmAction label={t('核对并释放原未派发占用')} prompt={t('由原服务核验同一调用未派发证据后释放原占用？无可信证据仍拒绝，不退款、不重发模型。')}
              doneLabel={t('原占用操作已返回')} disabled={frozen || !!journal.accountingWrite || state.accounting.record.budgetDispatchMarked || state.accounting.record.status !== 'reserved'}
              onConfirm={() => session.act('releaseUnsent')} />
            <ConfirmAction label={t('按原证据核对账务')} prompt={t('由原服务按同一调用和已保存用量核对原账？可能结算或更新原账务状态，不启动模型或释放未知消耗。')}
              doneLabel={t('原账务操作已返回')} disabled={frozen || !!journal.accountingWrite || state.accounting.record.status !== 'pending_reconciliation'}
              onConfirm={() => session.act('reconcileAccounting')} />
          </>}
        </div>}
        {journal.accountingWrite && <>
          <ActionButton label={t('核对原账务操作收据')} successLabel={t('原操作收据观察已返回')} disabled={state.busy}
            onAction={() => session.act('readAccountingOperation')} />
          <p>{t('原引用继续保留，不重复办理。当前账务值只作观察；只有匹配的原账本操作收据才解除本次待核对状态。')}</p>
        </>}
        {state.accountingOperation && <p role="status" aria-live="polite">{t(state.accountingOperation.status === 'observed'
          ? '已观察到匹配的原账务操作收据；不授新执行、重发或再次退额。'
          : '未观察到这份原操作收据；当前账务状态不能证明本次提交，保持待核对。')}</p>}
      </section>
      {state.receipt && <p role="status">{t('原能力证据')}: {t(state.receipt.status === 'supported' ? '原收据支持' : state.receipt.status === 'unsupported' ? '不支持' : '未验证')}；
        {t('证据模式')}: {state.receipt.mode ?? t('无观察')}；{t('原失效时间')}: {state.receipt.expiresAt ?? t('未知')}。{t('不是当前准入或供应商账单。')}</p>}
      {state.preflight && <p role="status">{t('当前能力准入')}: {t(state.preflight.allowed ? '能力检查满足，仍非派发许可' : '尚未满足')}；
        {t('缺失')}: {t(state.preflight.missing ? '是' : '否')}；{t('陈旧')}: {t(state.preflight.stale ? '是' : '否')}</p>}
      {state.history && <p role="status">{t('历史只读观察')}: {state.history.state}；{t('原材料')}: {state.history.originalValidity}；
        {t('历史任务状态')}: {safeDisplayText(state.history.taskStatus, 64)}；{t('观察到结果')}: {t(state.history.resultObserved ? '是' : '否')}。{t('不评估当前能力，不授恢复或退款。')}</p>}
    </>}
  </section>;
}
