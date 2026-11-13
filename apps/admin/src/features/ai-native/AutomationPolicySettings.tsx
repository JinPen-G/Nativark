/** Explicit workspace policy configuration through the original manager. Server
 * discovery owns selectable records; preparation and save remain separate human
 * decisions. Hiding or changing identity clears all displayed policy material. */
import { useEffect, useId, useMemo, useReducer, useRef } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import type { AiAutomationPolicySettingsDraft, AiAutomationSubjectSettingsDraft } from '@rental-os/shared';
import { ActionButton, Alert, ConfirmAction, DatePicker, Input, Select } from '@/components/ui';
import { aiAutomationPoliciesApi } from '@/api/aiAutomationPolicies';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { automationPolicyStore, createAutomationPolicySession, type AutomationPolicyDraft } from './automation-policy-session';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import styles from './AiManagement.module.css';

const events: Record<AiAutomationPolicySettingsDraft['allowedEventTypes'][number], string> = {
  'fulfillment.resource_shortage': '交付资源不足', 'inspection.return_exception': '待处理归还异常',
  'notification.failed': '通知明确失败', 'refund.failed': '退款明确失败', 'opening.missing_configuration': '开业缺项',
};
const modes: Record<AiAutomationPolicySettingsDraft['mode'], string> = { disabled: '停用', shadow: '影子模式', manual_confirmation: '人工确认模式' };
const permissionNames: Record<AiAutomationSubjectSettingsDraft['permissions'][number], string> = {
  'system:integration:manage': '原集成读取范围', 'rental-os:finance:view': '原财务读取范围', 'rental-os:order:view': '原订单读取范围',
};
const permissionCodes = Object.keys(permissionNames) as AiAutomationSubjectSettingsDraft['permissions'];
const numberValue = (value: number | undefined) => Number.isSafeInteger(value) ? value : '';
const dateValue = (value: string) => value && dayjs(value).isValid() ? dayjs(value) : null;

export function AutomationPolicySettings({ identity, current }: { identity: string; current(): boolean }) {
  const auth = useAuthStore(), { t } = useAiManagementLocale(), [, changed] = useReducer(value => value + 1, 0), field = useId();
  const tenantId = auth.tenant?.tenantId ?? '', workspaceId = auth.currentWorkspaceId ?? '', actorId = auth.user?.id ?? '';
  const epoch = currentSessionEpoch(), binding = JSON.stringify([identity, tenantId, workspaceId, auth.user, auth.token, epoch]);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const permitted = () => {
    const now = useAuthStore.getState();
    return now.sessionVerified && !!now.token && !now.user?.isSaasAdmin && now.hasPermission('system:params:manage')
      && now.tenant?.tenantId === tenantId && now.currentWorkspaceId === workspaceId && now.user?.id === actorId
      && owner.current.binding === binding && currentSessionEpoch() === epoch && owner.current.current()
      && typeof document !== 'undefined' && !document.hidden;
  };
  const storageName = `rental-os-automation-policy:${JSON.stringify([tenantId, workspaceId, actorId])}`;
  const session = useMemo(() => {
    if (!tenantId || !workspaceId || !actorId) return null;
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Storage readback must succeed before sending any policy write. */ }
    const locations = auth.user?.locationScope;
    const locationScope: AiAutomationSubjectSettingsDraft['locationScope'] = locations?.mode === 'selected'
      ? { mode: 'selected', locationIds: [...locations.locationIds] } : { mode: 'all', locationIds: [] };
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return createAutomationPolicySession({ scope: { tenantId, workspaceId, actorId, audience: 'operator' }, current: permitted, changed,
      api: aiAutomationPoliciesApi, store: automationPolicyStore(storageName, storage, locks),
      permissions: permissionCodes.filter(auth.hasPermission), locationScope });
  }, [binding, storageName]);
  useEffect(() => {
    if (!session) return;
    session.activate();
    const clear = () => session.invalidate();
    const storageChanged = (event: StorageEvent) => { if (event.key === storageName || event.key === null) session.invalidate(); };
    document.addEventListener('visibilitychange', clear); window.addEventListener('storage', storageChanged);
    return () => { document.removeEventListener('visibilitychange', clear); window.removeEventListener('storage', storageChanged); session.dispose(); };
  }, [session, storageName]);
  if (!session || !permitted() || !session.isCurrent()) return null;
  const data = session.view, draft = data.draft, catalog = data.discovery, busy = !!data.busy, editable = session.canEdit();
  const change = (update: (value: AutomationPolicyDraft) => AutomationPolicyDraft) => {
    const currentDraft = session.view.draft;
    if (currentDraft) session.edit(update(currentDraft));
  };
  const setPolicy = <K extends keyof AiAutomationPolicySettingsDraft>(key: K, value: AiAutomationPolicySettingsDraft[K]) =>
    change(next => ({ ...next, policy: { ...next.policy, [key]: value } }));
  const setTime = (key: 'validFrom' | 'expiresAt', value: Dayjs | null) => setPolicy(key, value?.isValid() ? value.toISOString() : '');
  const setLimit = (key: 'maxActionsPerRun' | 'maxQuantity' | 'maxCausalDepth', value: number) => change(next => ({ ...next,
    policy: { ...next.policy, constraints: { allowedTools: [], allowedRecipientIds: [], limits: {
      maxActionsPerRun: 1, maxQuantity: 1, maxCausalDepth: 1, ...next.policy.constraints?.limits, [key]: value } } } }));
  const error = data.error === 'AI_POLICY_DRAFT_INVALID' ? '政策字段不完整或超出当前限制，请检查后再预览。'
    : data.error === 'AI_REVISION_CONFLICT' ? '原配置已变化，请重新读取并预览差异。'
      : data.error === 'AI_POLICY_SCENE_UNAVAILABLE' ? '当前没有可配置的原模型场景，请先完成原场景配置。'
        : data.locator ? '上次政策请求尚未核对，请读取原记录。' : '当前政策、场景或管理权限不可用，请重新核对。';
  const preview = data.preview, review = data.review && data.review.state !== 'observed' ? data.review : null;
  const recorded = data.operation?.state === 'observed' ? data.operation : data.review?.state === 'observed' ? data.review : null;
  const selectedSubject = catalog?.subjects.find(row => row.id === data.selection?.subjectId);
  const selectedPolicy = catalog?.policies.find(row => row.id === data.selection?.policyId);
  const sceneOptions = catalog?.scenes.map(scene => ({ value: JSON.stringify([scene.sceneCode, scene.sceneVersion]),
    label: `${scene.sceneCode} · ${scene.sceneVersion} · ${t(scene.enabled ? '已启用' : '停用')}` })) ?? [];
  const numberInput = (name: string, label: string, value: number | undefined, maximum: number, onChange: (value: number) => void, minimum = 1) =>
    <div className={styles.field}><label htmlFor={`${field}-${name}`}>{t(label)}</label>
      <Input id={`${field}-${name}`} type="number" inputMode="numeric" min={minimum} max={maximum} step={1}
        value={numberValue(value)} disabled={!editable} onChange={event => onChange(event.target.value === '' ? NaN : Number(event.target.value))} /></div>;
  return <section className={styles.stack} aria-label={t('经营事件政策设置')} aria-busy={busy}>
    <p className={styles.help}>{t('只配置当前经营空间的解释与人工办理政策。准备、保存和模型运行分别确认。')}</p>
    <dl className={styles.facts}><div><dt>{t('经营空间')}</dt><dd>{workspaceId}</dd></div>
      <div><dt>{t('当前操作人')}</dt><dd>{auth.user?.displayName ?? actorId}</dd></div></dl>
    {data.damaged && <Alert type="warning" title={t('原政策定位无法核对，请保留原记录。')} />}
    {!session.writesAvailable() && <Alert type="warning" title={t('当前浏览器无法安全保存原政策定位，可读取原记录。')} />}
    {!!data.error && <Alert type="warning" title={t(error)} />}
    <div className={styles.toolbar}>
      <ActionButton label={t('读取现有政策与场景')} successLabel={t('已读取')} disabled={busy}
        onAction={() => session.discover()} />
      {data.locator && <ActionButton label={t('核对原政策操作')} successLabel={t('已读取')} disabled={busy}
        onAction={() => session.recover()} />}
    </div>
    {data.locator && <Alert type="warning" title={t(data.locator.phase === 'prepared' ? '原变更已准备，保存前仍需核对。' : '上次政策请求已保留，请先核对原结果。')}
      description={t('未观察到记录不证明未提交；请沿原定位读取，不重新发送。')} />}
    {catalog && <>
      <p className={styles.help}>{t('以下为当前空间的有界读取，未出现的记录不表示不存在。')}</p>
      <div className={styles.formGrid}>
        <div className={styles.field}><label htmlFor={`${field}-policy`}>{t('选择原政策')}</label>
          <Select id={`${field}-policy`} value={data.selection ? data.selection.policyId ? `policy:${data.selection.policyId}` : 'new' : undefined}
            placeholder={t('请选择原记录或新建停用草稿')} disabled={!editable}
            options={[{ value: 'new', label: t('新建停用政策') }, ...catalog.policies.map(policy => ({ value: `policy:${policy.id}`,
              label: `${policy.sceneCode} · ${t(modes[policy.mode])} · ${policy.id}` }))]}
            onChange={value => {
              const selected = catalog.policies.find(row => `policy:${row.id}` === value);
              void session.select(selected ? { subjectId: selected.subjectId, policyId: selected.id } : { subjectId: null, policyId: null }).catch(() => undefined);
            }} /></div>
        {data.selection?.policyId === null && <div className={styles.field}><label htmlFor={`${field}-subject`}>{t('选择原主体')}</label>
          <Select id={`${field}-subject`} value={data.selection.subjectId ? `subject:${data.selection.subjectId}` : 'new'} disabled={!editable}
            options={[{ value: 'new', label: t('同时创建停用主体') }, ...catalog.subjects.map(subject => ({ value: `subject:${subject.id}`,
              label: `${subject.id} · ${t(subject.enabled ? '已启用' : '停用')}` }))]}
            onChange={value => {
              const selected = catalog.subjects.find(row => `subject:${row.id}` === value);
              void session.select({ subjectId: selected?.id ?? null, policyId: null }).catch(() => undefined);
            }} /></div>}
      </div>
      {!catalog.scenes.length && <Alert type="warning" title={t('当前没有可配置的原模型场景，请先完成原场景配置。')} />}
      {!catalog.policies.length && <p className={styles.help}>{t('当前读取窗口没有政策。可明确准备停用草稿，保存后再选择原记录启用。')}</p>}
      {selectedPolicy && <dl className={styles.facts}>
        <div><dt>{t('原政策修订')}</dt><dd>{selectedPolicy.revision}</dd></div>
        <div><dt>{t('原统计日累计准备次数')}</dt><dd>{selectedPolicy.preparedCount} · {selectedPolicy.counterDay ? formatTimestamp(selectedPolicy.counterDay).value : t('未记录日期')}</dd></div>
        <div><dt>{t('原启用人')}</dt><dd>{selectedPolicy.enabledBy ?? t('未记录')}</dd></div>
        <div><dt>{t('原启用时间')}</dt><dd>{selectedPolicy.enabledAt ? formatTimestamp(selectedPolicy.enabledAt).value : t('未记录')}</dd></div>
      </dl>}
    </>}
    {draft && <section className={styles.section} aria-label={t('未保存政策草稿')}>
      <h3>{t('未保存政策草稿')}</h3>
      <p className={styles.help}>{t('首期工具和收件人白名单均为空；影子与人工确认只提供解释，不自动执行业务。')}</p>
      {draft.policy.constraints?.limits.maxCausalDepth === 0 && <p className={styles.help}>{t('因果深度为0时，本期事件解释不会启动。')}</p>}
      {(!draft.policyId || !selectedPolicy?.constraints) && <p className={styles.help}>{t('下列限制为本次拟保存值，尚未成为原政策。')}</p>}
      <div className={styles.formGrid}>
        <div className={styles.field}><label htmlFor={`${field}-scene`}>{t('原任务场景')}</label>
          <Select id={`${field}-scene`} value={JSON.stringify([draft.policy.sceneCode, draft.policy.sceneVersion])} options={sceneOptions} disabled={!editable}
            onChange={value => {
              const scene = catalog?.scenes.find(row => JSON.stringify([row.sceneCode, row.sceneVersion]) === value);
              if (scene) change(next => ({ ...next, policy: { ...next.policy, sceneCode: scene.sceneCode, sceneVersion: scene.sceneVersion } }));
            }} /></div>
        <div className={styles.field}><label htmlFor={`${field}-mode`}>{t('政策模式')}</label>
          <Select id={`${field}-mode`} value={draft.policy.mode} disabled={!editable || draft.policy.revoked}
            options={Object.entries(modes).map(([value, label]) => ({ value, label: t(label), disabled: value !== 'disabled' && (!draft.policyId || !draft.subjectId || draft.subject.revoked) }))}
            onChange={(value: AiAutomationPolicySettingsDraft['mode']) => change(next => ({ ...next,
              subject: { ...next.subject, enabled: value === 'disabled' ? next.subject.enabled : true }, policy: { ...next.policy, mode: value } }))} /></div>
        <div className={styles.field}><label htmlFor={`${field}-subject-state`}>{t('主体状态')}</label>
          <Select id={`${field}-subject-state`} value={draft.subject.enabled ? 'enabled' : 'disabled'} disabled={!editable || !draft.subjectId || draft.subject.revoked}
            options={[{ value: 'disabled', label: t('停用') }, { value: 'enabled', label: t('已启用') }]}
            onChange={value => change(next => ({ ...next, subject: { ...next.subject, enabled: value === 'enabled' },
              policy: { ...next.policy, mode: value === 'disabled' ? 'disabled' : next.policy.mode } }))} /></div>
        <div className={`${styles.field} ${styles.full}`}><label htmlFor={`${field}-events`}>{t('限定事件')}</label>
          <Select id={`${field}-events`} mode="multiple" showSearch={false} value={draft.policy.allowedEventTypes} disabled={!editable}
            options={Object.entries(events).map(([value, label]) => ({ value, label: t(label) }))}
            onChange={(value: AiAutomationPolicySettingsDraft['allowedEventTypes']) => setPolicy('allowedEventTypes', value)} /></div>
        {numberInput('daily', '每日最多准备任务数', draft.policy.maxTasksPerDay, 1000, value => setPolicy('maxTasksPerDay', value))}
        {numberInput('cooldown', '冷却时间（秒）', draft.policy.cooldownSeconds, 86400, value => setPolicy('cooldownSeconds', value))}
        <div className={styles.field}><label htmlFor={`${field}-valid-from`}>{t('政策开始时间')}</label>
          <DatePicker id={`${field}-valid-from`} showTime value={dateValue(draft.policy.validFrom)} disabled={!editable} onChange={value => setTime('validFrom', value)} /></div>
        <div className={styles.field}><label htmlFor={`${field}-policy-expiry`}>{t('政策有效至')}</label>
          <DatePicker id={`${field}-policy-expiry`} showTime value={dateValue(draft.policy.expiresAt)} disabled={!editable} onChange={value => setTime('expiresAt', value)} /></div>
        <div className={styles.field}><label htmlFor={`${field}-subject-expiry`}>{t('主体有效至')}</label>
          <DatePicker id={`${field}-subject-expiry`} showTime value={dateValue(draft.subject.expiresAt)} disabled={!editable}
            onChange={value => change(next => ({ ...next, subject: { ...next.subject, expiresAt: value?.isValid() ? value.toISOString() : '' } }))} /></div>
        {numberInput('actions', '每次最多动作数', draft.policy.constraints?.limits.maxActionsPerRun, 20, value => setLimit('maxActionsPerRun', value))}
        {numberInput('quantity', '每次最大数量', draft.policy.constraints?.limits.maxQuantity, 1000, value => setLimit('maxQuantity', value))}
        {numberInput('depth', '最大因果深度', draft.policy.constraints?.limits.maxCausalDepth, 20, value => setLimit('maxCausalDepth', value), 0)}
      </div>
      <dl className={styles.facts}>
        <div><dt>{t('主体读取范围')}</dt><dd>{draft.subject.permissions.map(code => t(permissionNames[code])).join(' · ') || t('当前无可用读取权限')}</dd></div>
        <div><dt>{t('主体地点范围')}</dt><dd>{draft.subject.locationScope.mode === 'all' ? t('当前空间全部地点') : draft.subject.locationScope.locationIds.join(' · ')}</dd></div>
        <div><dt>{t('拟配置工具')}</dt><dd>{t('无自动业务工具')}</dd></div>
        <div><dt>{t('拟配置收件人')}</dt><dd>{t('无自动收件人')}</dd></div>
      </dl>
      {selectedSubject && <p className={styles.help}>{t('同一主体可能用于其他政策，请核对主体状态、期限和地点的影响。')}</p>}
      {selectedSubject && draft.subject.locationScope.mode === 'selected' && <div className={styles.field}><label htmlFor={`${field}-locations`}>{t('选择原主体范围内的地点')}</label>
        <Select id={`${field}-locations`} mode="multiple" showSearch={false} value={draft.subject.locationScope.locationIds} disabled={!editable}
          options={selectedSubject.locationScope.locationIds.map(id => ({ value: id, label: id }))}
          onChange={(value: string[]) => change(next => ({ ...next, subject: { ...next.subject, locationScope: { mode: 'selected', locationIds: value } } }))} /></div>}
      <ActionButton label={t('预览政策差异')} successLabel={t('差异已读取')} disabled={!editable} onAction={() => session.preview()} />
    </section>}
    {preview && <section className={styles.section} aria-label={t('原来源与本次差异')}>
      <h3>{t('原来源与本次差异')}</h3>
      <dl className={styles.facts}>
        <div><dt>{t('政策模式')}</dt><dd>{preview.before.policy ? t(modes[preview.before.policy.settings.mode]) : t('未创建')} → {t(modes[preview.command.policy.mode])}</dd></div>
        <div><dt>{t('主体状态')}</dt><dd>{t(preview.before.subject?.settings.enabled ? '已启用' : '停用')} → {t(preview.command.subject.enabled ? '已启用' : '停用')}</dd></div>
        <div><dt>{t('原场景修订')}</dt><dd>{preview.before.scene.revision}</dd></div>
        <div><dt>{t('原任务场景')}</dt><dd>{preview.before.policy ? `${preview.before.policy.settings.sceneCode} · ${preview.before.policy.settings.sceneVersion}` : t('未创建')}
          {' → '}{preview.command.policy.sceneCode} · {preview.command.policy.sceneVersion}</dd></div>
        <div><dt>{t('限定事件')}</dt><dd>{preview.before.policy?.settings.allowedEventTypes.map(value => t(events[value])).join(' · ') || t('未创建')} → {preview.command.policy.allowedEventTypes.map(value => t(events[value])).join(' · ')}</dd></div>
        <div><dt>{t('每日最多准备任务数')}</dt><dd>{preview.before.policy?.settings.maxTasksPerDay ?? t('未创建')} → {preview.command.policy.maxTasksPerDay}</dd></div>
        <div><dt>{t('冷却时间（秒）')}</dt><dd>{preview.before.policy?.settings.cooldownSeconds ?? t('未创建')} → {preview.command.policy.cooldownSeconds}</dd></div>
        <div><dt>{t('每次最多动作数')}</dt><dd>{preview.before.policy?.settings.constraints?.limits.maxActionsPerRun ?? t('未记录')} → {preview.command.policy.constraints?.limits.maxActionsPerRun}</dd></div>
        <div><dt>{t('每次最大数量')}</dt><dd>{preview.before.policy?.settings.constraints?.limits.maxQuantity ?? t('未记录')} → {preview.command.policy.constraints?.limits.maxQuantity}</dd></div>
        <div><dt>{t('最大因果深度')}</dt><dd>{preview.before.policy?.settings.constraints?.limits.maxCausalDepth ?? t('未记录')} → {preview.command.policy.constraints?.limits.maxCausalDepth}</dd></div>
        <div><dt>{t('工具白名单')}</dt><dd>{preview.before.policy?.settings.constraints ? preview.before.policy.settings.constraints.allowedTools.map(tool => tool.toolCode).join(' · ') || t('无自动业务工具') : t('未记录')}
          {' → '}{t('无自动业务工具')}</dd></div>
        <div><dt>{t('收件人范围')}</dt><dd>{preview.before.policy?.settings.constraints ? preview.before.policy.settings.constraints.allowedRecipientIds.join(' · ') || t('无自动收件人') : t('未记录')}
          {' → '}{t('无自动收件人')}</dd></div>
        <div><dt>{t('主体读取范围')}</dt><dd>{preview.before.subject?.settings.permissions.map(code => t(permissionNames[code])).join(' · ') || t('未创建')}
          {' → '}{preview.command.subject.permissions.map(code => t(permissionNames[code])).join(' · ')}</dd></div>
        <div><dt>{t('政策开始时间')}</dt><dd>{preview.before.policy ? formatTimestamp(preview.before.policy.settings.validFrom).value : t('未创建')} → {formatTimestamp(preview.command.policy.validFrom).value}</dd></div>
        <div><dt>{t('政策有效至')}</dt><dd>{preview.before.policy ? formatTimestamp(preview.before.policy.settings.expiresAt).value : t('未创建')} → {formatTimestamp(preview.command.policy.expiresAt).value}</dd></div>
        <div><dt>{t('主体有效至')}</dt><dd>{preview.before.subject ? formatTimestamp(preview.before.subject.settings.expiresAt).value : t('未创建')} → {formatTimestamp(preview.command.subject.expiresAt).value}</dd></div>
        <div><dt>{t('主体地点范围')}</dt><dd>{preview.before.subject ? preview.before.subject.settings.locationScope.mode === 'all' ? t('当前空间全部地点') : preview.before.subject.settings.locationScope.locationIds.join(' · ') : t('未创建')}
          {' → '}{preview.command.subject.locationScope.mode === 'all' ? t('当前空间全部地点') : preview.command.subject.locationScope.locationIds.join(' · ')}</dd></div>
      </dl>
      <p className={styles.help}>{t('准备只保存这份差异，尚未应用原政策。')}</p>
      <ConfirmAction key={preview.changeHash} label={t('明确准备政策变更')} prompt={t('按当前原来源和这份差异准备变更？尚不应用政策。')}
        doneLabel={t('已准备')} disabled={busy || data.damaged || !session.writesAvailable()} onConfirm={() => session.prepare()} />
    </section>}
    {review && <section className={styles.section} aria-label={t('已准备的原政策变更')}>
      <h3>{t('已准备的原政策变更')}</h3>
      <p>{t(review.state === 'prepared' ? '原变更已准备，保存前仍需核对。' : '原准备已过期或来源已变化，当前不能保存。')}</p>
      <dl className={styles.facts}>
        <div><dt>{t('原主体')}</dt><dd>{review.subjectId}</dd></div><div><dt>{t('原政策')}</dt><dd>{review.policyId}</dd></div>
        <div><dt>{t('政策模式')}</dt><dd>{t(modes[review.proposal.policy.mode])}</dd></div>
        <div><dt>{t('准备有效至')}</dt><dd>{formatTimestamp(review.expiresAt).value}</dd></div>
        <div><dt>{t('原任务场景')}</dt><dd>{review.proposal.policy.sceneCode} · {review.proposal.policy.sceneVersion}</dd></div>
        <div><dt>{t('限定事件')}</dt><dd>{review.proposal.policy.allowedEventTypes.map(value => t(events[value])).join(' · ')}</dd></div>
        <div><dt>{t('每日最多准备任务数')}</dt><dd>{review.proposal.policy.maxTasksPerDay}</dd></div>
        <div><dt>{t('冷却时间（秒）')}</dt><dd>{review.proposal.policy.cooldownSeconds}</dd></div>
        <div><dt>{t('政策开始时间')}</dt><dd>{formatTimestamp(review.proposal.policy.validFrom).value}</dd></div>
        <div><dt>{t('政策有效至')}</dt><dd>{formatTimestamp(review.proposal.policy.expiresAt).value}</dd></div>
        <div><dt>{t('主体状态')}</dt><dd>{t(review.proposal.subject.enabled ? '已启用' : '停用')}</dd></div>
        <div><dt>{t('主体有效至')}</dt><dd>{formatTimestamp(review.proposal.subject.expiresAt).value}</dd></div>
        <div><dt>{t('每次最多动作数')}</dt><dd>{review.proposal.policy.constraints?.limits.maxActionsPerRun ?? t('未记录')}</dd></div>
        <div><dt>{t('每次最大数量')}</dt><dd>{review.proposal.policy.constraints?.limits.maxQuantity ?? t('未记录')}</dd></div>
        <div><dt>{t('最大因果深度')}</dt><dd>{review.proposal.policy.constraints?.limits.maxCausalDepth ?? t('未记录')}</dd></div>
        <div><dt>{t('主体读取范围')}</dt><dd>{review.proposal.subject.permissions.map(code => t(permissionNames[code])).join(' · ')}</dd></div>
        <div><dt>{t('主体地点范围')}</dt><dd>{review.proposal.subject.locationScope.mode === 'all' ? t('当前空间全部地点') : review.proposal.subject.locationScope.locationIds.join(' · ')}</dd></div>
        <div><dt>{t('工具白名单')}</dt><dd>{review.proposal.policy.constraints?.allowedTools.map(tool => tool.toolCode).join(' · ') || t('无自动业务工具')}</dd></div>
        <div><dt>{t('收件人范围')}</dt><dd>{review.proposal.policy.constraints?.allowedRecipientIds.join(' · ') || t('无自动收件人')}</dd></div>
      </dl>
      {review.state === 'prepared' && data.locator?.phase === 'prepared' && <ConfirmAction key={review.preparationId} label={t('明确保存原政策')}
        prompt={t('将已准备的变更保存到原政策？模型运行和业务办理仍需独立确认。')} doneLabel={t('原政策已保存')}
        disabled={busy || data.damaged || !session.writesAvailable()} onConfirm={() => session.commit()} />}
      {review.state !== 'prepared' && data.locator?.phase === 'prepared' && <ConfirmAction label={t('结束失效准备')}
        prompt={t('核对原操作并结束这份失效准备？原记录保留，下一次修改须重新读取。')} doneLabel={t('已结束本次编辑')}
        disabled={busy || data.damaged || !session.writesAvailable()} onConfirm={() => session.finishPreparation()} />}
    </section>}
    {recorded && <section className={styles.section} aria-label={t('原政策保存收据')}>
      <h3>{t('原政策保存收据')}</h3>
      <Alert type="success" title={t('原政策保存已记录。')} description={t('当前有效性仍由原权限、期限和政策核对；没有启动模型或业务。')} />
      <dl className={styles.facts}>
        <div><dt>{t('原主体')}</dt><dd>{recorded.result.subject.id} · {recorded.result.subject.authorizationRevision}</dd></div>
        <div><dt>{t('原政策')}</dt><dd>{recorded.result.policy.id} · {recorded.result.policy.revision}</dd></div>
        <div><dt>{t('政策模式')}</dt><dd>{t(modes[recorded.result.policy.mode])}</dd></div>
        <div><dt>{t('保存时间')}</dt><dd>{formatTimestamp(recorded.recordedAt).value}</dd></div>
        <div><dt>{t('原统计日累计准备次数')}</dt><dd>{recorded.result.policy.preparedCount} · {recorded.result.policy.counterDay ? formatTimestamp(recorded.result.policy.counterDay).value : t('未记录日期')}</dd></div>
        <div><dt>{t('政策有效至')}</dt><dd>{formatTimestamp(recorded.result.policy.expiresAt).value}</dd></div>
      </dl>
      {recorded.result.policy.mode === 'disabled' && <p className={styles.help}>{t('此政策保持停用。需要启用时，重新读取并选择这条原记录，再预览和确认。')}</p>}
    </section>}
  </section>;
}
