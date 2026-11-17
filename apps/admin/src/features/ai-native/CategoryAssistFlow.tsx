/** Human category-assist consumer in the original platform or workspace page.
 * Catalogues and differences are Core reads; each write has a separate explicit
 * confirmation. Model candidates may fill local inputs but cannot submit them.
 * Hidden, unmounted and replaced identities release buffered business facts. */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { InputNumber } from 'antd';
import { CATEGORY_DRAFT_SECTIONS, CATEGORY_GOVERNANCE_PERMISSIONS as P, RENTAL_FULFILLMENT_MODES,
  RENTAL_LOCATION_TYPES, RENTAL_CATEGORY_ICON_CODES, RENTAL_PRICING_UNIT_LABELS, RentalInventoryMode,
  type CategoryDraftSection, type CategoryVersionView, type RentalCategoryDefinition,
  type PreviewRentalCategoryCreationRequest, type SaveCategoryOpeningRequest, type SaveCategoryVersionPolicyRequest,
  type CategoryPreparationOperation, type CategoryEntityPreparationPatch } from '@rental-os/shared';
import type { AiCategoryProposalSource, AiCategoryProposalCandidate } from '@rental-os/shared';
import { ActionButton, Alert, App, Button, ConfirmAction, Form, Input, Select, Switch, Tabs } from '@/components/ui';
import { ContentTransition } from '@/components/workspace/ContentTransition';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { useLocale } from '@/app/locale';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import type { CategoryCatalog, CategoryProposalPolicy } from '@/api/aiCategoryDraft';
import { CategoryConditionalCapabilitiesEditor } from '@/features/platform/CategoryConditionalCapabilitiesEditor';
import { CATEGORY_ATTRIBUTE_TYPES, CATEGORY_INSPECTION_TYPES, addCategoryAttributeSchemaField, updateCategoryField } from '@/features/platform/categoryDraftFields';
import { categoryDefinitionWithLocalSections, categoryInspectionFieldSuggestion, initialCategorySectionDrafts,
  reconcileCategorySectionDrafts, resetCategoryDraftSection,
  type CategorySectionDrafts } from '@/features/platform/categoryDraftSections';
import { CategoryCompatibilityRelationsEditor } from '@/features/settings/governance/CategoryCompatibilityRelationsEditor';
import { capabilityPreparationPatches, initialCapabilityDrafts, preparationCapabilityDefinitions,
  type CapabilityPreparationDrafts } from '@/features/settings/governance/categoryPreparationCapabilities';
import { nextPreparationBatch, preparationEntityKey, preparationEntityValue } from '@/features/settings/governance/categoryPreparationFields';
import { categoryAssistStore, createCategoryAssistSession, type CategoryAssistOwner, type CategoryAssistSession } from './category-assist-session';
import { safeDisplayText } from './safe-display';
import styles from './AiManagement.module.css';

const sectionLabels: Record<CategoryDraftSection, string> = { basic: '基本信息与术语', attributes: '商品与资产资料', inventory: '库存与履约',
  pricing: '计费与规则', inspection: '资质与交接检查', capabilities: '能力与条件' };
const fieldLabels: Record<string, string> = { name: '品类名称', description: '说明', terminology: '业务术语', display: '展示设置',
  nameEn: '英文名称', descriptionEn: '英文说明', icon: '品类图标', defaultWorkspaceName: '默认空间名称', defaultWorkspaceNameEn: '默认空间英文名称',
  terminologyEn: '英文业务术语', attributeSchema: '属性类型', assetFields: '型号与资产字段', catalogPresentation: '目录展示',
  supportedInventoryModes: '库存模式', fulfillmentModes: '履约方式', locationTypes: '地点类型', deliveryDestination: '配送目的地',
  pricingUnits: '支持计价单位', defaultPricingUnit: '默认计价单位', settingModules: '设置模块', supportsHolidayPricing: '支持节假日定价',
  supportsUsagePricing: '支持使用量计价', supportsPreauthorization: '支持预授权', payment: '支付规则', overdue: '逾时规则', fulfillment: '履约规则',
  supportsQualificationReview: '支持资质审核', rules: '默认业务规则', inspectionFields: '交接检查字段', defaultCapabilities: '默认能力',
  requiredCapabilities: '必选能力', conditionalCapabilities: '条件必选能力', valueAddedServicePresets: '增值服务预设',
  code: '编码', label: '字段名称', type: '字段类型', scope: '适用对象', required: '必填', unique: '唯一', options: '可选值', unit: '单位',
  clientVisible: '客户目录公开展示', appliesToCapability: '关联能力', usageMetric: '使用量读数', identifierLabel: '资产编号称呼',
  itemLabel: '商品称呼', itemGroupLabel: '型号称呼', assetLabel: '资产称呼', fulfillmentLabel: '经营地点称呼', pickupLabel: '领取称呼',
  returnLabel: '归还称呼', deliveryLabel: '配送称呼', serialLabel: '序列标识称呼', usageMetricLabel: '使用量称呼', navigationLabels: '导航术语',
  inventoryGroup: '商品分组名称', itemGroups: '型号菜单名称', pricingGroups: '定价分组名称', assets: '资产菜单名称', locations: '地点菜单名称',
  brand: '品牌', model: '型号', serialNo: '序列号', graceMinutes: '逾时宽限分钟', feeMode: '逾时收费方式', feeMultiplier: '收费倍率',
  timing: '收款时点', allowDifferentReturnLocation: '允许异地归还', evidenceRequired: '要求交接证据', cancellation: '取消规则',
  freeBeforeHours: '免费取消提前小时数', lateFeeType: '取消费类型', lateFeeValue: '取消费数值', weatherExceptionEnabled: '天气例外',
  qualificationDocumentTypes: '要求资质类型', fixedInventoryMode: '固定库存方式', fixedUnit: '固定计价单位',
  itemGroupSummaryFields: '型号摘要字段', assetSummaryFields: '资产摘要字段', assetCollectionLabel: '资产集合称呼' };
const inventoryLabels: Record<string, string> = { serialized: '单件资产', quantity: '数量库存', bundle: '套装', consumable: '耗材' };
const outcomeLabels: Record<string, string> = { create: '新品类草稿已创建', copy: '同品类草稿已创建', patch: '当前页签草稿已保存',
  publish: '品类版本已发布', policy: '版本采用资格已保存', opening: '新开通政策已保存', preparation: '本批准备资料已保存', adopt: '本空间品类版本已采用' };
const scopeLabels: Record<string, string> = { all: '全部租户', pilot: '试点租户', none: '不允许采用', unopened: '尚未开放', stopped: '停止新开通' };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const originalIdentity = () => {
  const auth = useAuthStore.getState();
  return JSON.stringify([auth.sessionVerified, auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, currentSessionEpoch()]);
};

export function CategoryAssistFlow({ mode, code, identity, current, onChanged }: {
  mode: 'platform' | 'workspace'; code?: string; identity?: string; current?: () => boolean; onChanged?: () => void | Promise<void>;
}) {
  const auth = useAuthStore(), { t } = useLocale(), [, changed] = useReducer(value => value + 1, 0);
  const epoch = currentSessionEpoch(), authIdentity = originalIdentity(), binding = JSON.stringify([mode, code, identity, authIdentity]);
  const mounted = useRef(true), ownerRef = useRef({ binding, current }); ownerRef.current = { binding, current };
  const [dirty, setDirty] = useState(false), [generation, setGeneration] = useState(0);
  const owner: CategoryAssistOwner = { tenantId: auth.tenant?.tenantId ?? '', actorId: auth.user?.id ?? '',
    workspaceId: mode === 'workspace' ? auth.currentWorkspaceId ?? null : null, mode };
  const available = () => mounted.current && ownerRef.current.binding === binding && originalIdentity() === authIdentity
    && currentSessionEpoch() === epoch && !currentSessionSignal().aborted && typeof document !== 'undefined' && !document.hidden
    && (ownerRef.current.current?.() ?? true);
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.localStorage; } catch { /* Reads remain available; writes require preserved IDs. */ }
    return createCategoryAssistSession({ owner, current: available, changed, store: categoryAssistStore(owner, storage),
      permission: permission => useAuthStore.getState().hasPermission(permission) });
  }, [binding]);
  useEffect(() => {
    mounted.current = true; session.activate(); setDirty(false);
    const visibility = () => { session.dispose(); setDirty(false); setGeneration(value => value + 1); if (!document.hidden) session.activate(); changed(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', visibility); session.dispose(); };
  }, [session]);
  const view = session.view, authorized = auth.sessionVerified && !!auth.token && !!auth.user && !!auth.tenant?.tenantId
    && (mode === 'platform' ? auth.user.isSaasAdmin : !auth.user.isSaasAdmin && !!auth.currentWorkspaceId);
  if (!authorized || !available()) return null;
  const locked = !!view.busy || !!view.pending || view.damaged || view.proposalDamaged || !!view.policyPending
    || !!view.proposal && ['preparing', 'generating', 'read_only'].includes(view.proposal.phase);
  const afterWrite = async (action: () => Promise<unknown>) => {
    const result = await action(); if (available()) { try { await onChanged?.(); } catch { /* The original receipt stays visible. */ } }
    return result;
  };
  return <section className={styles.stack} aria-label={t('品类治理助手')} aria-busy={!!view.busy}>
    <UnsavedChangesGuard dirty={dirty} busy={!!view.busy} />
    <h3>{t(mode === 'platform' ? '品类草稿与发布' : '品类版本准备与采用')}</h3>
    {view.damaged && <Alert type="warning" title={t('原操作定位无法核对，暂不能发起新操作。')} />}
    {view.proposalDamaged && <Alert type="warning" title={t('原模型操作定位无法核对，暂不能发起新模型操作。')} />}
    {view.policyPending && <Alert type="warning" title={t('原模型准入政策应答未确认。')}
      description={t('当前政策不等于原操作收据。保留原待核记录，暂不能发起新政策或模型操作。')} />}
    {view.policyPending && <ActionButton label={t('核对原模型准入政策结果')} disabled={!!view.busy || view.proposalDamaged}
      onAction={async () => {
        const receipt = await session.reconcileProposalPolicy();
        if (receipt && available()) { setDirty(false); setGeneration(value => value + 1); }
      }} />}
    {view.proposalPolicyReceipt && <p role="status">{t('原模型准入政策已记录')} · {t('原修订')}: {view.proposalPolicyReceipt.revision}</p>}
    {view.pending && <Alert type="warning" title={t('原操作结果待核对。')}
      description={t('原定位已保留。只读取原收据或审计，未查到记录时继续等待核对。')} />}
    {!!view.error && <Alert type="warning" title={t(view.pending ? '原操作结果尚未确认，请核对原结果。' : '资料或操作未完成，请核对当前权限、版本和原结果。')} />}
    {view.pending && <ActionButton label={t('核对原操作结果')} disabled={!!view.busy || view.damaged} onAction={async () => {
      const receipt = await session.reconcile();
      if (receipt && available()) { setDirty(false); setGeneration(value => value + 1);
        try { await onChanged?.(); } catch { /* Keep the confirmed original receipt. */ } }
    }} />}
    {view.receipt && <div role="status" className={styles.section}>
      <strong>{t(outcomeLabels[view.receipt.kind])}</strong>
      {view.receipt.version && <p>{t('版本')}: {view.receipt.version.versionLabel} · {t('修订')}: {view.receipt.version.revision}</p>}
      {view.receipt.audit && <p>{t('原审计')}: {view.receipt.audit.id} · {view.receipt.audit.createdAt}</p>}
      {view.receipt.preparation && <p>{t('已准备')}: {view.receipt.preparation.entityCount} · {t('准备修订')}: {view.receipt.preparation.revision}</p>}
      {view.receipt.adoption && <p>{t('原空间采用修订')}: {view.receipt.adoption.sourceRevision} → {view.receipt.adoption.adoptionRevision}</p>}
      {['publish', 'policy', 'opening'].includes(view.receipt.kind) && <p className={styles.help}>{t('该结果没有自动切换任何已有经营空间。')}</p>}
    </div>}
    <ContentTransition value={`${mode}:${generation}`}>
      {mode === 'platform' ? <PlatformFlow key={`${binding}:${generation}`} code={code} session={session} locked={locked}
        dirty={dirty} onDirty={setDirty} afterWrite={afterWrite} /> : <WorkspaceFlow key={`${binding}:${generation}`} session={session}
        locked={locked} dirty={dirty} onDirty={setDirty} scopeKey={JSON.stringify(owner)} afterWrite={afterWrite} />}
    </ContentTransition>
  </section>;
}

function PlatformFlow({ code, session, locked, dirty, onDirty, afterWrite }: {
  code?: string; session: CategoryAssistSession; locked: boolean; dirty: boolean; onDirty(value: boolean): void;
  afterWrite(action: () => Promise<unknown>): Promise<unknown>;
}) {
  const { t } = useLocale(), auth = useAuthStore(), view = session.view;
  const [mode, setMode] = useState<'versions' | 'create'>('versions'), [why, setWhy] = useState('');
  const [editorDirty, setEditorDirty] = useState(false), [policyDirty, setPolicyDirty] = useState(false), [openingDirty, setOpeningDirty] = useState(false);
  const [modelDirty, setModelDirty] = useState(false), [fill, setFill] = useState<{ candidate: AiCategoryProposalCandidate; versionId?: string }>();
  useEffect(() => { onDirty(editorDirty || policyDirty || openingDirty || modelDirty || !!why.trim()); }, [editorDirty, policyDirty, openingDirty, modelDirty, why]);
  useEffect(() => { if (view.receipt?.kind === 'publish') setWhy(''); }, [view.receipt?.kind, view.receipt?.audit?.id, view.receipt?.version?.id]);
  const version = view.detail?.versions.find(row => row.id === view.selectedVersionId);
  return <div className={styles.stack}>
    <div className={styles.toolbar}>
      <ActionButton label={t('读取正式品类目录')} disabled={!!view.busy || dirty} onAction={() => session.readPlatform(code ?? view.detail?.code)} />
      {view.categories && <Select aria-label={t('选择品类')} placeholder={t('选择品类')} value={view.detail?.code}
        disabled={locked || dirty || !!code} options={view.categories.map(row => ({ value: row.code, label: row.name }))}
        onChange={value => session.readPlatform(String(value)).catch(() => undefined)} />}
    </div>
    {view.catalog && <p className={styles.help}>{t('目录来自当前部署。')}{view.catalog.dynamicCreationEnabled
      ? t('新类可从正式模板或发布版本形成草稿。') : t('当前部署未开放新品类创建。')}</p>}
    {view.catalog && <ModelProposalPanel session={session} disabled={!!view.busy || !!view.pending || view.damaged || view.proposalDamaged
      || editorDirty || policyDirty || openingDirty || !!why.trim()} onDirty={setModelDirty}
      onCandidate={async candidate => {
        if (candidate.kind === 'patch') {
          if (candidate.source.kind !== 'version' || !version || version.status !== 'draft'
            || version.categoryCode.toLowerCase() !== candidate.source.code) throw Error('请先选择同品类原草稿，或明确复制来源版本为草稿。');
          const original = view.detail?.versions.find(row => candidate.source.kind === 'version' && row.id === candidate.source.versionId);
          if (!original || original.revision !== candidate.source.expectedRevision
            || version.id !== original.id && version.sourceVersionId !== original.id) throw Error('原提案来源已变化，请重新核对。');
          setFill({ candidate, versionId: version.id }); setMode('versions'); setEditorDirty(true);
        } else { setFill({ candidate }); setMode('create'); setEditorDirty(true); }
      }} />}
    {view.catalog && <Tabs activeKey={mode} onChange={value => { if (!locked && !dirty) setMode(value as 'versions' | 'create'); }}
      items={[{ key: 'versions', label: t('版本与草稿'), disabled: locked || dirty },
        { key: 'create', label: t('新品类草稿'), disabled: locked || dirty || !view.catalog.dynamicCreationEnabled || !auth.hasPermission(P.edit) }]} />}
    {mode === 'create' && view.catalog && <CreationForm session={session} locked={locked} onDirty={setEditorDirty} afterWrite={afterWrite}
      candidate={fill?.candidate.kind === 'create' ? fill.candidate : undefined}
      onCreated={() => { setFill(undefined); setEditorDirty(false); setMode('versions'); }} />}
    {mode === 'versions' && view.detail && <>
      <Select aria-label={t('选择原版本')} placeholder={t('选择原版本')} value={view.selectedVersionId ?? undefined} disabled={locked || dirty}
        options={view.detail.versions.map(row => ({ value: row.id, label: `${row.versionLabel} · ${t(row.status === 'draft' ? '草稿' : row.status === 'published' ? '已发布' : row.status === 'archived' ? '已归档' : '历史基线')}` }))}
        onChange={id => session.selectVersion(view.detail!.code, String(id)).catch(() => undefined)} />
      {version && <>
        <DefinitionFacts definition={version.definition} />
        {view.review && <>
          <p role="status">{t('本次原影响报告')} · {t('草稿修订')}: {view.review.revision}
            {' · '}{t('影响空间数')}: {view.review.affectedSpaces}</p>
          <Differences rows={view.review.differences} />
        </>}
        {view.review && !view.review.valid && <Alert type="warning" title={t('原品类校验未通过。')} description={view.review.errors.join('；')} />}
        {version.status === 'draft' ? <DraftForm key={version.id} version={version} session={session} locked={locked || policyDirty || openingDirty || modelDirty || !!why.trim()}
          candidate={fill?.versionId === version.id && fill.candidate.kind === 'patch' ? fill.candidate : undefined}
          onDirty={setEditorDirty} afterWrite={afterWrite} />
          : ['published', 'legacy_baseline'].includes(version.status) && <CopyForm code={view.detail.code} version={version} session={session}
            locked={locked || policyDirty || openingDirty || modelDirty} onDirty={setEditorDirty} afterWrite={afterWrite} />}
        {['published', 'legacy_baseline'].includes(version.status) && version.policy && auth.hasPermission(P.publish)
          && <PolicyForm key={`${version.id}:${version.policy.revision}`} version={version} session={session}
            locked={locked || editorDirty || openingDirty || modelDirty} onDirty={setPolicyDirty} afterWrite={afterWrite} />}
      </>}
      {auth.hasPermission(P.opening) && <OpeningForm key={`${view.detail.code}:${view.detail.openingRevision}`} session={session}
        locked={locked || editorDirty || policyDirty || modelDirty || !!why.trim()} onDirty={setOpeningDirty} afterWrite={afterWrite} />}
    </>}
    {mode === 'versions' && version?.status === 'draft' && auth.hasPermission(P.publish) && <div className={styles.section}>
      <Form.Item label={t('发布原因')}><Input.TextArea aria-label={t('发布原因')} maxLength={512} value={why} disabled={locked || editorDirty || policyDirty || openingDirty || modelDirty}
        onChange={event => setWhy(event.target.value)} /></Form.Item>
      <ConfirmAction label={t('发布原草稿版本')} prompt={`${t('本次原影响报告')} · ${t('草稿修订')}: ${view.review?.revision ?? '—'} · ${t('影响空间数')}: ${view.review?.affectedSpaces ?? '—'}。${t('确认发布已保存的完整版本？发布后正文不可修改，采用资格默认关闭，已有空间保持原版本。')}`}
        disabled={locked || editorDirty || policyDirty || openingDirty || modelDirty || !why.trim() || !view.review?.valid}
        onConfirm={async () => { await afterWrite(() => session.publish(why, { versionId: version.id, revision: version.revision,
          report: view.review! })); setWhy(''); }} />
      {!!why && <Button disabled={locked} onClick={() => setWhy('')}>{t('清空未提交的发布原因')}</Button>}
    </div>}
    <p className={styles.help}>{t('草稿保存、发布、采用资格和空间采用分别确认。未支持的组合保留原品类治理依赖。')}</p>
  </div>;
}

function ModelProposalPanel({ session, disabled, onDirty, onCandidate }: {
  session: CategoryAssistSession; disabled: boolean; onDirty(value: boolean): void;
  onCandidate(candidate: AiCategoryProposalCandidate): Promise<void>;
}) {
  const { t } = useLocale(), auth = useAuthStore(), view = session.view;
  const [goal, setGoal] = useState(''), [sourceKind, setSourceKind] = useState<'version' | 'template'>('version');
  const [templateId, setTemplateId] = useState<string>(), [policyOpen, setPolicyOpen] = useState(false), [localError, setLocalError] = useState('');
  const [policyDirty, setPolicyDirty] = useState(false), [form] = Form.useForm<{
    enabled: boolean; expiresAt: string; maxSteps: number; maxTotalMs: number; maxStepMs: number;
    maxOutputBytes: number; maxConcurrent: number; maxCalls: number;
  }>();
  useEffect(() => { onDirty(!!goal.trim() || policyDirty); }, [goal, policyDirty]);
  useEffect(() => () => onDirty(false), []);
  const selected = view.detail?.versions.find(row => row.id === view.selectedVersionId);
  const template = view.catalog?.templates.find(row => row.id === templateId);
  const source: AiCategoryProposalSource | undefined = sourceKind === 'version' && selected && ['draft', 'published', 'legacy_baseline'].includes(selected.status)
    ? { kind: 'version', code: selected.categoryCode.toLowerCase(), versionId: selected.id, expectedRevision: selected.revision }
    : sourceKind === 'template' && template ? { kind: 'template', templateId: template.id, templateRevision: template.revision } : undefined;
  const original = view.proposal, result = view.proposalResult, policy = view.proposalPolicy;
  const modelPermission = auth.hasPermission(P.edit) && auth.hasPermission('system:ai-provider:manage');
  const readPermission = auth.hasPermission(P.view) && auth.hasPermission('system:ai-provider:view');
  const unknown = !!original && ['preparing', 'generating', 'read_only'].includes(original.phase);
  const newBlocked = disabled || !!view.policyPending || unknown || original?.phase === 'prepared';
  const policySignature = JSON.stringify(policy);
  useEffect(() => {
    if (policy?.state === 'configured' && !policyDirty) form.setFieldsValue({ enabled: policy.enabled,
      expiresAt: new Date(policy.expiresAt).toISOString().slice(0, 16), ...policy.limits });
  }, [policySignature]);
  const accept = async () => {
    try { const candidate = await session.acceptProposalCandidate(); await onCandidate(candidate); setGoal(''); setLocalError(''); }
    catch (error) { setLocalError(error instanceof Error ? error.message : t('原候选无法采用，请重新核对。')); throw error; }
  };
  return <div className={styles.section}>
    <h4>{t('AI 品类方案')}</h4>
    <p className={styles.help}>{t('先准备原输入，再明确生成待核对方案。采用方案只填写本地草稿，保存和发布仍须分别确认。')}</p>
    {unknown && <Alert type="warning" title={t('原模型操作结果待核对。')}
      description={t('只读取原操作和结果，未确认前不能发起新模型操作。')} />}
    {original?.phase === 'prepared' && <p role="status">{t('原输入已准备，模型尚待明确生成。')}</p>}
    {result?.state === 'stale' && <Alert type="warning" title={t('原方案来源或目录已变化，不能采用。')} />}
    <div className={styles.toolbar}>
      <Button disabled={disabled || unknown || original?.phase === 'prepared'} onClick={() => setPolicyOpen(value => !value)}>{t('模型准入设置')}</Button>
      <ActionButton label={t('读取模型准入政策')} disabled={disabled || !modelPermission} onAction={() => session.readProposalPolicy()} />
      {!!original && <ActionButton label={t('读取原模型结果')} disabled={disabled || !readPermission} onAction={() => session.readProposal()} />}
    </div>
    {policy?.state === 'not_configured' && <p role="status">{t('当前未配置模型准入政策。')}</p>}
    {policy?.state === 'configured' && <p role="status">{t(policy.enabled ? '模型准入已启用' : '模型准入已停用')} · {t('修订')}: {policy.revision} · {policy.expiresAt}</p>}
    {policyOpen && <div className={styles.section}>
      <Form form={form} layout="vertical" disabled={newBlocked || !modelPermission} onValuesChange={() => setPolicyDirty(true)}>
        <Form.Item name="enabled" label={t('启用模型准入')} valuePropName="checked"><Switch aria-label={t('启用模型准入')} /></Form.Item>
        {([
          ['maxSteps', '任务步骤上限', 1000], ['maxCalls', '模型调用上限', 1000], ['maxConcurrent', '任务并发上限', 1],
          ['maxTotalMs', '任务总时长上限（毫秒）', 86400000], ['maxStepMs', '单步时长上限（毫秒）', 86400000],
          ['maxOutputBytes', '结果字节上限', 16777216]
        ] as const).map(([field, label, max]) => <Form.Item key={field} name={field} label={t(label)} rules={[{ required: true }, { type: 'number', min: 1, max }]}>
          <InputNumber aria-label={t(label)} min={1} max={max} precision={0} />
        </Form.Item>)}
        <Form.Item name="expiresAt" label={t('政策截止时间（UTC）')} rules={[{ required: true }]}><Input aria-label={t('政策截止时间（UTC）')} type="datetime-local" /></Form.Item>
      </Form>
      <ConfirmAction label={t('保存模型准入政策')} prompt={t('确认保存这些模型资源上限和截止时间？该政策不授予品类保存、发布或空间采用权限。')}
        disabled={newBlocked || !modelPermission || !policy || !policyDirty} onConfirm={async () => {
          const value = await form.validateFields(); const { enabled, expiresAt, ...limits } = value;
          await session.changeProposalPolicy({ enabled: enabled === true, expiresAt: `${expiresAt}:00.000Z`, limits }); setPolicyDirty(false);
        }} />
      <ConfirmAction label={t('放弃本地模型政策输入')} prompt={t('放弃未提交的模型准入设置？')} disabled={disabled || !!view.policyPending}
        onConfirm={async () => { form.resetFields(); setPolicyDirty(false); setPolicyOpen(false); }} />
    </div>}
    <Form.Item label={t('方案来源')}><Select aria-label={t('方案来源')} value={sourceKind} disabled={newBlocked || policyDirty}
      options={[{ value: 'version', label: t('当前选定的原版本') }, { value: 'template', label: t('正式模板') }]}
      onChange={value => { setSourceKind(value); setLocalError(''); }} /></Form.Item>
    {sourceKind === 'template' && <Select aria-label={t('方案模板')} value={templateId} placeholder={t('选择方案模板')} disabled={newBlocked || policyDirty}
      options={view.catalog?.templates.map(row => ({ value: row.id, label: row.definition.name }))} onChange={value => setTemplateId(String(value))} />}
    {sourceKind === 'version' && <p>{selected ? `${t('来源版本')}: ${selected.versionLabel} · ${t('修订')}: ${selected.revision}` : t('请先选择原品类版本。')}</p>}
    <Form.Item label={t('品类方案目标')}><Input.TextArea aria-label={t('品类方案目标')} maxLength={2000} value={goal}
      disabled={newBlocked || policyDirty} onChange={event => setGoal(event.target.value)} /></Form.Item>
    <div className={styles.actions}>
      <ConfirmAction label={t('准备原方案输入')} prompt={t('确认按此来源和目标准备不可变原输入？准备不会调用模型或写入品类。')}
        disabled={newBlocked || policyDirty || !source || !goal.trim() || !modelPermission || policy?.state !== 'configured'
          || !policy.enabled || Date.parse(policy.expiresAt) <= Date.now()}
        onConfirm={async () => { await session.prepareProposal(goal, source!); setGoal(''); }} />
      <ConfirmAction label={t('明确生成原方案')} prompt={t('确认使用已准备的原输入调用模型？生成只返回待核对候选，不保存或发布品类。')}
        disabled={disabled || !!view.policyPending || original?.phase !== 'prepared' || !modelPermission}
        onConfirm={() => session.generateProposal()} />
      {!!goal && <Button disabled={disabled || unknown} onClick={() => setGoal('')}>{t('清空未提交的方案目标')}</Button>}
    </div>
    {result?.state === 'candidate' && <div className={styles.section}>
      <p>{safeDisplayText(result.candidate.explanation, 1000)}</p>
      {result.candidate.kind === 'patch' ? <>
        <p>{t('建议页签')}: {t(sectionLabels[result.candidate.section])}</p>
        {Object.entries(result.candidate.values).map(([field, value]) => <p key={field}>{t(fieldLabels[field] ?? field)}: {safeDisplayText(typeof value === 'string' ? value : JSON.stringify(value), 4000)}</p>)}
        {!result.candidate.definitionValidation.valid && <Alert type="warning" title={t('候选结构需继续修正。')} description={result.candidate.definitionValidation.errors.join('；')} />}
      </> : <>
        <DefinitionFacts definition={result.candidate.preview.definition} />
        {!result.candidate.preview.valid && <Alert type="warning" title={t('候选新品类预览未通过。')} description={result.candidate.preview.errors.join('；')} />}
      </>}
      <ConfirmAction label={t('采用候选到本地草稿')} prompt={t('确认把这份原候选填入本地表单？此操作不会保存、发布或切换经营空间。')}
        disabled={disabled || !readPermission} onConfirm={accept} />
    </div>}
    {!!localError && <Alert type="warning" title={t(localError)} />}
  </div>;
}

function CreationForm({ session, locked, onDirty, afterWrite, onCreated, candidate }: { session: CategoryAssistSession; locked: boolean;
  onDirty(value: boolean): void; afterWrite(action: () => Promise<unknown>): Promise<unknown>; onCreated(): void;
  candidate?: Extract<AiCategoryProposalCandidate, { kind: 'create' }> }) {
  const { t } = useLocale(), view = session.view, catalog = view.catalog!, [form] = Form.useForm<PreviewRentalCategoryCreationRequest & { reason: string }>();
  useEffect(() => () => onDirty(false), []);
  const [sourceKind, setSourceKind] = useState<'template' | 'version'>(candidate?.input.sourceVersionId ? 'version' : 'template');
  const [templateId, setTemplateId] = useState<string | undefined>(candidate?.input.templateId);
  const [sourceVersionId, setSourceVersionId] = useState<string | undefined>(candidate?.input.sourceVersionId);
  const source = sourceKind === 'template' ? catalog.templates.find(row => row.id === templateId)?.definition
    : view.detail?.versions.find(row => row.id === sourceVersionId && ['published', 'legacy_baseline'].includes(row.status))?.definition;
  const sourceSignature = JSON.stringify([sourceKind, templateId, sourceVersionId, source,
    catalog.capabilities.map(row => [row.code, row.implemented])]);
  useEffect(() => {
    if (!source) return;
    form.setFieldsValue({ inventoryModes: [...source.supportedInventoryModes], pricingUnits: [...source.businessModel.pricingUnits],
      defaultPricingUnit: source.businessModel.defaultPricingUnit, fulfillmentModes: [...source.businessModel.fulfillmentModes],
      capabilityCodes: source.defaultCapabilities.filter(code => catalog.capabilities.some(entry => entry.code === code && entry.implemented
        && entry.applicableCategories === 'all')),
      ...(candidate && (candidate.input.templateId === templateId && sourceKind === 'template'
        || candidate.input.sourceVersionId === sourceVersionId && sourceKind === 'version') ? candidate.input : {}) });
    session.clearCreationReview();
  }, [sourceSignature, form]);
  useEffect(() => {
    if (!candidate) return;
    setSourceKind(candidate.input.templateId ? 'template' : 'version'); setTemplateId(candidate.input.templateId); setSourceVersionId(candidate.input.sourceVersionId);
    form.setFieldsValue(candidate.input); session.clearCreationReview(); onDirty(true);
  }, [JSON.stringify(candidate), form]);
  const prepare = async () => {
    const values = await form.validateFields();
    if (!source) throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
    const input: PreviewRentalCategoryCreationRequest = { code: values.code, name: values.name, versionLabel: values.versionLabel,
      inventoryModes: values.inventoryModes, pricingUnits: values.pricingUnits, defaultPricingUnit: values.defaultPricingUnit,
      fulfillmentModes: values.fulfillmentModes, capabilityCodes: values.capabilityCodes,
      ...(sourceKind === 'template' ? { templateId: templateId as PreviewRentalCategoryCreationRequest['templateId'] } : { sourceVersionId }) };
    await session.previewCreation(input);
  };
  return <div className={styles.stack}>
    <Form form={form} layout="vertical" disabled={locked} onValuesChange={() => { session.clearCreationReview(); onDirty(true); }}>
      <Form.Item label={t('创建来源')}><Select aria-label={t('创建来源')} value={sourceKind} options={[{ value: 'template', label: t('正式模板') }, { value: 'version', label: t('原发布版本') }]}
        onChange={value => { setSourceKind(value); session.clearCreationReview(); onDirty(true); }} /></Form.Item>
      {sourceKind === 'template' ? <Form.Item label={t('选择模板')}><Select aria-label={t('选择模板')} placeholder={t('选择模板')} value={templateId}
        options={catalog.templates.map(row => ({ value: row.id, label: row.definition.name }))} onChange={value => { setTemplateId(String(value)); onDirty(true); }} /></Form.Item>
        : <Form.Item label={t('原发布版本')}><Select aria-label={t('原发布版本')} value={sourceVersionId} placeholder={t('选择原发布版本')}
          options={view.detail?.versions.filter(row => ['published', 'legacy_baseline'].includes(row.status)).map(row => ({ value: row.id, label: row.versionLabel }))}
          onChange={value => { setSourceVersionId(String(value)); onDirty(true); }} /></Form.Item>}
      <Form.Item name="code" label={t('新品类编码')} rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_]{1,63}(?![\s\S])/u }]}><Input aria-label={t('新品类编码')} maxLength={64} /></Form.Item>
      <Form.Item name="name" label={t('品类名称')} rules={[{ required: true, whitespace: true }]}><Input aria-label={t('品类名称')} maxLength={100} /></Form.Item>
      <Form.Item name="versionLabel" label={t('新版本号')} rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?![\s\S])/u }]}><Input aria-label={t('新版本号')} maxLength={64} /></Form.Item>
      <Form.Item name="inventoryModes" label={t('库存模式')} rules={[{ required: true }]}><Select aria-label={t('库存模式')} mode="multiple"
        options={source?.supportedInventoryModes.map(value => ({ value, label: t(inventoryLabels[value] ?? value) }))} /></Form.Item>
      <Form.Item name="pricingUnits" label={t('支持计价单位')} rules={[{ required: true }]}><Select aria-label={t('支持计价单位')} mode="multiple"
        options={source?.businessModel.pricingUnits.map(value => ({ value, label: t(RENTAL_PRICING_UNIT_LABELS[value] ?? value) }))} /></Form.Item>
      <Form.Item name="defaultPricingUnit" label={t('默认计价单位')} rules={[{ required: true }]}><Select aria-label={t('默认计价单位')}
        options={source?.businessModel.pricingUnits.map(value => ({ value, label: t(RENTAL_PRICING_UNIT_LABELS[value] ?? value) }))} /></Form.Item>
      <Form.Item name="fulfillmentModes" label={t('履约方式')} rules={[{ required: true }]}><Select aria-label={t('履约方式')} mode="multiple"
        options={source?.businessModel.fulfillmentModes.map(value => ({ value, label: value }))} /></Form.Item>
      <Form.Item name="capabilityCodes" label={t('能力组合')} rules={[{ required: true }]}><Select aria-label={t('能力组合')} mode="multiple"
        options={catalog.capabilities.filter(row => row.implemented && row.applicableCategories === 'all' && source?.defaultCapabilities.includes(row.code))
          .map(row => ({ value: row.code, label: row.label }))} /></Form.Item>
      <Form.Item name="reason" label={t('创建原因')} rules={[{ required: true, whitespace: true }]}><Input.TextArea aria-label={t('创建原因')} maxLength={512} /></Form.Item>
    </Form>
    <div className={styles.actions}>
      <ActionButton label={t('核对新品类草稿')} disabled={locked || !source} onAction={prepare} />
      <ConfirmAction label={t('创建已核对的草稿')} prompt={t('确认按这份完整预览创建新品类草稿？创建不发布、不开放经营空间。')}
        disabled={locked || !view.creation?.result.valid} onConfirm={async () => { const values = await form.validateFields();
          await afterWrite(() => session.createCategory(values.reason)); onDirty(false); form.resetFields(); onCreated(); }} />
      <ConfirmAction label={t('放弃本地创建输入')} prompt={t('放弃尚未保存的创建输入？')} disabled={locked}
        onConfirm={async () => { form.resetFields(); setTemplateId(undefined); setSourceVersionId(undefined); session.clearCreationReview(); onDirty(false); }} />
    </div>
    {view.creation && <>
      <DefinitionFacts definition={view.creation.result.definition} />
      {!view.creation.result.valid && <Alert type="warning" title={t('新品类预览未通过校验。')} description={view.creation.result.errors.join('；')} />}
      {!!view.creation.result.removedCapabilities.length && <p>{t('本次未保留的来源能力')}: {view.creation.result.removedCapabilities.join('、')}</p>}
    </>}
  </div>;
}

function CopyForm({ code, version, session, locked, onDirty, afterWrite }: { code: string; version: CategoryVersionView;
  session: CategoryAssistSession; locked: boolean; onDirty(value: boolean): void; afterWrite(action: () => Promise<unknown>): Promise<unknown> }) {
  const { t } = useLocale(), auth = useAuthStore(), [versionLabel, setVersionLabel] = useState(''), [why, setWhy] = useState('');
  useEffect(() => () => onDirty(false), []);
  if (!auth.hasPermission(P.edit)) return null;
  return <div className={styles.section}>
    <Form.Item label={t('同品类新版本号')}><Input aria-label={t('同品类新版本号')} value={versionLabel} maxLength={64} disabled={locked}
      onChange={event => { setVersionLabel(event.target.value); onDirty(true); }} /></Form.Item>
    <Form.Item label={t('草稿创建原因')}><Input.TextArea aria-label={t('草稿创建原因')} value={why} maxLength={512} disabled={locked}
      onChange={event => { setWhy(event.target.value); onDirty(true); }} /></Form.Item>
    <div className={styles.actions}>
      <ConfirmAction label={t('复制原版本为草稿')} prompt={t('确认复制这份原发布版本为同品类草稿？原发布版本保持不变。')}
        disabled={locked || !versionLabel || !why.trim()} onConfirm={async () => {
          await afterWrite(() => session.copyVersion(code, version.id, versionLabel, why)); setVersionLabel(''); setWhy(''); onDirty(false);
        }} />
      <ConfirmAction label={t('放弃本地复制输入')} prompt={t('放弃尚未保存的版本号和原因？')} disabled={locked}
        onConfirm={async () => { setVersionLabel(''); setWhy(''); onDirty(false); }} />
    </div>
  </div>;
}

function DraftForm({ version, session, locked, onDirty, afterWrite, candidate }: { version: CategoryVersionView; session: CategoryAssistSession;
  locked: boolean; onDirty(value: boolean): void; afterWrite(action: () => Promise<unknown>): Promise<unknown>;
  candidate?: Extract<AiCategoryProposalCandidate, { kind: 'patch' }> }) {
  const { t } = useLocale(), { modal } = App.useApp(), auth = useAuthStore();
  const [section, setSection] = useState<CategoryDraftSection>('basic'), [drafts, setDrafts] = useState<CategorySectionDrafts>(() => initialCategorySectionDrafts(version));
  useEffect(() => () => onDirty(false), []);
  const current = drafts[section], catalog = session.view.catalog;
  useEffect(() => { setDrafts(previous => reconcileCategorySectionDrafts(previous, version)); }, [version.revision]);
  useEffect(() => {
    if (!candidate) return;
    setSection(candidate.section); setDrafts(previous => ({ ...previous, [candidate.section]: { ...previous[candidate.section],
      values: { ...previous[candidate.section].values, ...structuredClone(candidate.values) }, dirty: true } }));
  }, [JSON.stringify(candidate)]);
  const dirty = CATEGORY_DRAFT_SECTIONS.some(key => drafts[key].dirty || drafts[key].pendingField || !!drafts[key].reason.trim());
  useEffect(() => { onDirty(dirty); }, [dirty]);
  const change = (values: Record<string, unknown>) => setDrafts(previous => ({ ...previous, [section]: { ...previous[section], values, dirty: true } }));
  const localDefinition = categoryDefinitionWithLocalSections(version, drafts);
  const prepareInspection = (code: string) => {
    const capability = catalog?.capabilities.find(row => row.code === code); if (!capability) return;
    const suggestion = categoryInspectionFieldSuggestion(drafts, capability);
    modal.confirm({ title: t('准备所需交接字段？'), content: <p>{suggestion.supported && !suggestion.conflicts.length
      ? suggestion.additions.map(row => String(row.label)).join('、') || t('所需字段已存在。') : t('原字段存在冲突，请在交接页签核对。')}</p>,
      onOk: () => { if (!locked && suggestion.supported && !suggestion.conflicts.length && suggestion.next) {
        setDrafts(previous => ({ ...previous, inspection: { ...previous.inspection,
          values: { ...previous.inspection.values, inspectionFields: suggestion.next }, dirty: true } })); setSection('inspection');
      } } });
  };
  return <div className={styles.stack}>
    <Tabs activeKey={section} onChange={value => { if (!locked) setSection(value as CategoryDraftSection); }}
      items={CATEGORY_DRAFT_SECTIONS.map(key => ({ key, label: `${t(sectionLabels[key])}${drafts[key].dirty ? ` · ${t('未保存')}` : ''}`, disabled: locked }))} />
    {current.conflict && <Alert type="warning" title={t('此页签原修订已变化，本地输入已保留。请先重新核对。')} />}
    <Form layout="vertical" disabled={locked || !auth.hasPermission(P.edit)}>
      {Object.entries(current.values).map(([field, value]) => field === 'conditionalCapabilities'
        ? <CategoryConditionalCapabilitiesEditor key={field} value={value} definition={localDefinition} disabled={locked || !auth.hasPermission(P.edit)}
          change={next => change({ ...current.values, [field]: next })} navigate={setSection} prepareInspectionFields={prepareInspection} />
        : <DraftValue key={field} name={field} value={value} catalog={catalog} definition={localDefinition}
          disabled={locked || !auth.hasPermission(P.edit)} inspection={section === 'inspection'}
          pending={value => setDrafts(previous => ({ ...previous, [section]: { ...previous[section], pendingField: value } }))}
          change={next => change({ ...current.values, [field]: next })} />)}
      <Form.Item label={t('当前页签保存原因')}><Input.TextArea aria-label={t('当前页签保存原因')} maxLength={512} value={current.reason}
        onChange={event => setDrafts(previous => ({ ...previous, [section]: { ...previous[section], reason: event.target.value } }))} /></Form.Item>
    </Form>
    <div className={styles.actions}>
      <ConfirmAction label={t('保存当前页签草稿')} prompt={t('确认只保存当前页签？保存不发布，也不改变经营空间。')}
        disabled={locked || current.conflict || current.pendingField || !current.dirty || !current.reason.trim() || !auth.hasPermission(P.edit)} onConfirm={async () => {
          const captured = structuredClone(current);
          await afterWrite(() => session.patch(section, captured.values, captured.reason, captured.baseRevision));
          const next = session.view.detail?.versions.find(row => row.id === version.id);
          if (next) setDrafts(previous => reconcileCategorySectionDrafts(previous, next, { section, values: captured.values, reason: captured.reason }));
        }} />
      <ConfirmAction label={t('放弃当前页签输入')} prompt={t('放弃此页签未保存的输入，并读取已保存值？')} disabled={locked}
        onConfirm={async () => { const next = await session.selectVersion(version.categoryCode.toLowerCase(), version.id);
          setDrafts(previous => resetCategoryDraftSection(previous, next, section)); }} />
      <ActionButton label={t('核对已保存版本差异')} disabled={locked} onAction={() => session.selectVersion(version.categoryCode.toLowerCase(), version.id)} />
    </div>
  </div>;
}

function DraftValue({ name, value, change, disabled, catalog, definition, inspection = false, pending }: { name: string; value: unknown;
  change(value: unknown): void; disabled: boolean; catalog: CategoryCatalog | null; definition: RentalCategoryDefinition; inspection?: boolean;
  pending?(value: boolean): void }) {
  const { t } = useLocale(), label = t(fieldLabels[name] ?? name);
  const choices: Record<string, readonly string[]> = { icon: RENTAL_CATEGORY_ICON_CODES, supportedInventoryModes: Object.values(RentalInventoryMode),
    fixedInventoryMode: Object.values(RentalInventoryMode), pricingUnits: catalog?.pricingStrategies.map(row => row.unit) ?? [],
    defaultPricingUnit: catalog?.pricingStrategies.map(row => row.unit) ?? [], fulfillmentModes: RENTAL_FULFILLMENT_MODES, locationTypes: RENTAL_LOCATION_TYPES,
    scope: ['item_group', 'asset', 'transaction'], type: inspection ? CATEGORY_INSPECTION_TYPES : CATEGORY_ATTRIBUTE_TYPES,
    deliveryDestination: ['customer_address', 'tenant_location'], timing: ['order', 'confirmation', 'pickup', 'offline_terms'],
    feeMode: ['none', 'hourly', 'next_period', 'multiplier', 'manual_review', 'hourly_to_daily'], lateFeeType: ['none', 'fixed_amount', 'percentage'],
    settingModules: ['pricing', 'discounts', 'coupons', 'value_added_services', 'rental_rules', 'business_calendar', 'membership_rewards', 'notification_templates'] };
  if (name === 'attributeSchema' && record(value)) return <AttributeFields value={value} disabled={disabled} change={change} pending={pending} />;
  if (typeof value === 'boolean') return <Form.Item label={label}><Switch aria-label={label} checked={value} disabled={disabled} onChange={change} /></Form.Item>;
  if (typeof value === 'number') return <Form.Item label={label}><InputNumber aria-label={label} value={value} disabled={disabled} onChange={next => { if (next !== null) change(next); }} /></Form.Item>;
  if (Array.isArray(value)) {
    if (choices[name] || value.every(entry => typeof entry === 'string') && !['assetFields', 'inspectionFields'].includes(name)) {
      const capability = name === 'defaultCapabilities' || name === 'requiredCapabilities';
      const options = capability ? catalog?.capabilities.map(row => ({ value: row.code, label: row.label,
        disabled: !value.includes(row.code) && (!row.implemented || row.applicableCategories !== 'all' && !row.applicableCategories.includes(definition.code)
          || name === 'requiredCapabilities' && !definition.defaultCapabilities.includes(row.code)) }))
        : choices[name]?.map(entry => ({ value: entry, label: t(inventoryLabels[entry] ?? entry) }));
      return <Form.Item label={label}><Select aria-label={label} mode={options ? 'multiple' : 'tags'} disabled={disabled || capability && !catalog}
        value={value as string[]} options={options} onChange={change} /></Form.Item>;
    }
    const template = name === 'assetFields' ? { code: '', label: '', scope: 'asset', type: 'string', required: false, unique: false }
      : name === 'inspectionFields' ? { code: '', label: '', type: 'text', required: false } : value[0];
    return <div className={styles.section}><h4>{label}</h4>{value.map((entry, index) => <div key={index} className={styles.section}>
      <DraftValue name={`${name} ${index + 1}`} value={entry} catalog={catalog} definition={definition} disabled={disabled} inspection={inspection || name === 'inspectionFields'}
        change={next => change(value.map((row, position) => position === index ? next : row))} />
      <Button disabled={disabled} onClick={() => change(value.filter((_, position) => position !== index))}>{t('移除字段')}</Button>
    </div>)}<Button disabled={disabled || !template} onClick={() => change([...value, structuredClone(template)])}>{t('新增字段')}</Button></div>;
  }
  if (record(value)) {
    const fields = { ...value };
    if (typeof fields.code === 'string' && typeof fields.type === 'string') {
      fields.required ??= false;
      if (!inspection && ['asset', 'item_group'].includes(String(fields.scope))) fields.unique ??= false;
    }
    if (fields.type === 'select' && !Array.isArray(fields.options)) fields.options = [];
    if (inspection && fields.appliesToCapability === undefined) fields.appliesToCapability = '';
    return <div className={styles.section}><h4>{label}</h4>{Object.entries(fields).map(([field, entry]) => <DraftValue key={field} name={field}
      value={entry} disabled={disabled} catalog={catalog} definition={definition} inspection={inspection}
      change={next => change(updateCategoryField(fields, field, next, inspection))} />)}</div>;
  }
  if (inspection && name === 'appliesToCapability') return <Form.Item label={label}><Select aria-label={label} allowClear value={value ? String(value) : undefined}
    disabled={disabled || !catalog} options={catalog?.capabilities.filter(row => row.implemented).map(row => ({ value: row.code, label: row.label }))}
    onChange={next => change(next || undefined)} /></Form.Item>;
  return <Form.Item label={label}>{choices[name] ? <Select aria-label={label} value={String(value ?? '')} disabled={disabled}
    options={choices[name].map(entry => ({ value: entry, label: t(inventoryLabels[entry] ?? entry) }))} onChange={change} />
    : <Input aria-label={label} value={String(value ?? '')} maxLength={2048} disabled={disabled} onChange={event => change(event.target.value)} />}</Form.Item>;
}

function AttributeFields({ value, disabled, change, pending }: { value: Record<string, unknown>; disabled: boolean; change(value: unknown): void;
  pending?(value: boolean): void }) {
  const { t } = useLocale(), [code, setCode] = useState(''), [type, setType] = useState<string>('string'), [error, setError] = useState('');
  useEffect(() => { pending?.(!!code.trim()); }, [code]);
  useEffect(() => () => pending?.(false), []);
  return <div className={styles.section}><h4>{t('属性类型')}</h4>{Object.entries(value).map(([field, kind]) => <div className={styles.toolbar} key={field}>
    <span>{field}</span><Select aria-label={`${field} ${t('字段类型')}`} value={String(kind)} disabled={disabled}
      options={CATEGORY_ATTRIBUTE_TYPES.map(entry => ({ value: entry, label: entry }))} onChange={next => change({ ...value, [field]: next })} />
    <Button disabled={disabled} onClick={() => change(Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)))}>{t('移除属性')}</Button>
  </div>)}<div className={styles.toolbar}><Input aria-label={t('新增属性编码')} value={code} maxLength={64} disabled={disabled} onChange={event => setCode(event.target.value)} />
    <Select aria-label={t('新增属性类型')} value={type} disabled={disabled} options={CATEGORY_ATTRIBUTE_TYPES.map(entry => ({ value: entry, label: entry }))} onChange={setType} />
    <Button disabled={disabled || !code.trim()} onClick={() => { try { change(addCategoryAttributeSchemaField(value, code, type)); setCode(''); setError(''); }
      catch { setError(t('属性编码或类型不合法，请核对。')); } }}>{t('新增属性')}</Button></div>{error && <p role="alert">{error}</p>}</div>;
}

function PolicyForm({ version, session, locked, afterWrite, onDirty }: { version: CategoryVersionView; session: CategoryAssistSession; locked: boolean;
  onDirty(value: boolean): void;
  afterWrite(action: () => Promise<unknown>): Promise<unknown> }) {
  const { t } = useLocale(), [form] = Form.useForm<SaveCategoryVersionPolicyRequest>();
  useEffect(() => () => onDirty(false), []);
  return <div className={styles.section}><h4>{t('版本采用资格')}</h4>
    <ActionButton label={t('读取原租户目录')} disabled={locked} onAction={() => session.readTenants()} />
    <Form form={form} layout="vertical" initialValues={{ ...version.policy, reason: '' }} disabled={locked} onValuesChange={() => onDirty(true)}>
      {(['create', 'upgrade', 'restore'] as const).map(operation => <div className={styles.section} key={operation}>
        <Form.Item name={`${operation}Scope`} label={t(operation === 'create' ? '新建采用资格' : operation === 'upgrade' ? '升级采用资格' : '恢复采用资格')} rules={[{ required: true }]}>
          <Select aria-label={t(operation === 'create' ? '新建采用资格' : operation === 'upgrade' ? '升级采用资格' : '恢复采用资格')}
            options={['none', 'pilot', 'all'].map(value => ({ value, label: t(scopeLabels[value]) }))}
            onChange={value => { if (value !== 'pilot') form.setFieldValue(`${operation}TenantIds`, []); }} /></Form.Item>
        <Form.Item name={`${operation}TenantIds`} label={t('明确试点租户')}><Select aria-label={t('明确试点租户')} mode="multiple"
          options={session.view.tenants?.map(row => ({ value: row.id, label: `${row.name} (${row.code})` }))} placeholder={t('请从原租户目录选择')} /></Form.Item>
      </div>)}
      <Form.Item name="reason" label={t('资格变更原因')} rules={[{ required: true, whitespace: true }]}><Input.TextArea aria-label={t('资格变更原因')} maxLength={512} /></Form.Item>
    </Form>
    <ConfirmAction label={t('保存独立采用资格')} prompt={t('确认只修改该版本的采用资格？该操作不切换任何已有空间。')} disabled={locked}
      onConfirm={async () => { const values = await form.validateFields(); const { reason, expectedRevision: _expected, ...policy } = values;
        await afterWrite(() => session.savePolicy(policy, reason, { versionId: version.id, revision: version.policy!.revision })); onDirty(false); }} />
    <ConfirmAction label={t('放弃本地资格输入')} prompt={t('放弃未提交的采用资格和原因？')} disabled={locked}
      onConfirm={async () => { form.resetFields(); onDirty(false); }} />
  </div>;
}

function OpeningForm({ session, locked, afterWrite, onDirty }: { session: CategoryAssistSession; locked: boolean;
  onDirty(value: boolean): void;
  afterWrite(action: () => Promise<unknown>): Promise<unknown> }) {
  const { t } = useLocale(), detail = session.view.detail!, [form] = Form.useForm<SaveCategoryOpeningRequest>();
  useEffect(() => () => onDirty(false), []);
  return <div className={styles.section}><h4>{t('品类新开通政策')}</h4>
    <ActionButton label={t('读取原租户目录')} disabled={locked} onAction={() => session.readTenants()} />
    <Form form={form} layout="vertical" initialValues={{ scope: detail.openingScope, tenantIds: detail.openingTenantIds ?? [],
      recommendedVersionId: detail.recommendedVersionId ?? undefined, reason: '' }} disabled={locked} onValuesChange={() => onDirty(true)}>
      <Form.Item name="scope" label={t('新开通范围')} rules={[{ required: true }]}><Select aria-label={t('新开通范围')}
        options={['unopened', 'stopped', 'pilot', 'all'].map(value => ({ value, label: t(scopeLabels[value]) }))}
        onChange={value => { if (value !== 'pilot') form.setFieldValue('tenantIds', []); }} /></Form.Item>
      <Form.Item name="tenantIds" label={t('明确试点租户')}><Select aria-label={t('明确试点租户')} mode="multiple"
        options={session.view.tenants?.map(row => ({ value: row.id, label: `${row.name} (${row.code})` }))} placeholder={t('请从原租户目录选择')} /></Form.Item>
      <Form.Item name="recommendedVersionId" label={t('默认推荐发布版本')}><Select aria-label={t('默认推荐发布版本')}
        options={detail.versions.filter(row => ['published', 'legacy_baseline'].includes(row.status)).map(row => ({ value: row.id, label: row.versionLabel }))} /></Form.Item>
      <Form.Item name="reason" label={t('开通政策原因')} rules={[{ required: true, whitespace: true }]}><Input.TextArea aria-label={t('开通政策原因')} maxLength={512} /></Form.Item>
    </Form>
    <ConfirmAction label={t('保存新开通政策')} prompt={t('确认修改新空间开通范围？停止新开通不会暂停已有经营。')} disabled={locked}
      onConfirm={async () => { const values = await form.validateFields(); const { reason, expectedRevision: _expected, ...policy } = values;
        await afterWrite(() => session.saveOpening(detail.code, policy, reason, detail.openingRevision)); onDirty(false); }} />
    <ConfirmAction label={t('放弃本地开通政策输入')} prompt={t('放弃未提交的开通政策和原因？')} disabled={locked}
      onConfirm={async () => { form.resetFields(); onDirty(false); }} />
  </div>;
}

function DefinitionFacts({ definition }: { definition: RentalCategoryDefinition }) {
  const { t } = useLocale();
  const labels = (value: unknown, map: Record<string, string> = {}) => Array.isArray(value) && value.every(entry => typeof entry === 'string')
    ? value.map(entry => t(map[entry] ?? entry)).join('、') : t('草稿值待原校验');
  return <div className={styles.section}><h4>{safeDisplayText(definition.name, 100)}</h4><dl className={styles.facts}>
    <div><dt>{t('库存模式')}</dt><dd>{labels(definition.supportedInventoryModes, inventoryLabels)}</dd></div>
    <div><dt>{t('计价单位')}</dt><dd>{labels(definition.businessModel?.pricingUnits, RENTAL_PRICING_UNIT_LABELS)}</dd></div>
    <div><dt>{t('履约方式')}</dt><dd>{labels(definition.businessModel?.fulfillmentModes)}</dd></div>
    <div><dt>{t('已声明能力')}</dt><dd>{labels(definition.defaultCapabilities)}</dd></div>
  </dl></div>;
}

function WorkspaceFlow({ session, locked, dirty, onDirty, scopeKey, afterWrite }: {
  session: CategoryAssistSession; locked: boolean; dirty: boolean; onDirty(value: boolean): void; scopeKey: string;
  afterWrite(action: () => Promise<unknown>): Promise<unknown>;
}) {
  const { t } = useLocale(), auth = useAuthStore(), view = session.view, preview = view.preparation, page = view.entities;
  const [operation, setOperation] = useState<CategoryPreparationOperation>('upgrade');
  const [tab, setTab] = useState<'item_group' | 'asset' | 'capabilities'>('item_group'), [why, setWhy] = useState('');
  const [search, setSearch] = useState(''), [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [edits, setEdits] = useState<Record<string, CategoryEntityPreparationPatch>>({});
  const [capabilities, setCapabilities] = useState<CapabilityPreparationDrafts>({}), [dirtyCapabilities, setDirtyCapabilities] = useState<string[]>([]);
  const [basis, setBasis] = useState<{ sourceVersionId: string; sourceRevision: number; preparationRevision: number }>();
  const canPrepare = auth.hasPermission('rental-os:category:adopt');
  const localInput = Object.keys(edits).length > 0 || dirtyCapabilities.length > 0;
  useEffect(() => { onDirty(localInput || !!why.trim()); }, [localInput, why]);
  const previewSignature = JSON.stringify([preview?.targetVersionId, preview?.sourceVersionId, preview?.sourceRevision,
    preview?.preparation?.revision, preview?.registeredCapabilityVersions]);
  useEffect(() => {
    if (!preview) return;
    const fresh = initialCapabilityDrafts(preview, view.operation);
    setCapabilities(previous => ({ ...fresh, ...Object.fromEntries(Object.entries(previous).filter(([code]) => dirtyCapabilities.includes(code))) }));
  }, [previewSignature]);
  const staleInput = !!basis && !!preview && (basis.sourceVersionId !== preview.sourceVersionId || basis.sourceRevision !== preview.sourceRevision
    || basis.preparationRevision !== (preview.preparation?.revision ?? 0));
  const inputLocked = locked || !canPrepare || !preview || staleInput || preview.stale;
  const captureBasis = () => {
    if (preview) setBasis(current => current ?? { sourceVersionId: preview.sourceVersionId, sourceRevision: preview.sourceRevision,
      preparationRevision: preview.preparation?.revision ?? 0 });
  };
  const clear = () => { setEdits({}); setDirtyCapabilities([]); setCapabilities({}); setBasis(undefined); setWhy(''); setSearch(''); setCursors([undefined]); onDirty(false); };
  const inspect = async (targetId: string) => {
    await session.inspectTarget(targetId);
    if (tab !== 'capabilities') await session.readEntities(tab);
  };
  const edit = (row: NonNullable<typeof page>['rows'][number], code: string, value: string | number | boolean) => {
    if (!page || inputLocked) return;
    captureBasis(); const key = preparationEntityKey(page.entityType, row.id);
    setEdits(previous => ({ ...previous, [key]: { entityType: page.entityType, entityId: row.id,
      expectedUpdatedAt: previous[key]?.expectedUpdatedAt ?? row.updatedAt, values: { ...previous[key]?.values, [code]: value } } }));
  };
  const changeCapability = (code: string, field: string, value: CapabilityPreparationDrafts[string]['fields'][string]) => {
    if (inputLocked || !capabilities[code]) return;
    captureBasis(); setCapabilities(previous => ({ ...previous, [code]: { ...previous[code], fields: { ...previous[code].fields, [field]: value } } }));
    setDirtyCapabilities(previous => [...new Set([...previous, code])]);
  };
  const save = async () => {
    if (!preview || inputLocked) throw Error('AI_CATEGORY_REVIEW_REQUIRED');
    const submitted = nextPreparationBatch(Object.values(edits)).patches;
    const preparedCapabilities = dirtyCapabilities.length
      ? capabilityPreparationPatches(preview, capabilities).filter(patch => dirtyCapabilities.includes(patch.code)) : undefined;
    const retainedCodes = new Set(preparedCapabilities?.map(patch => patch.code) ?? []);
    const removeCapabilityCodes = preview.preparation?.patches.capabilityPatches?.filter(patch => dirtyCapabilities.includes(patch.code)
      && !retainedCodes.has(patch.code)).map(patch => patch.code) ?? [];
    const result = await session.savePreparation(submitted, why, preparedCapabilities, basis,
      removeCapabilityCodes.length ? { removeCapabilityCodes } : undefined);
    setEdits(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !submitted.some(patch =>
      preparationEntityKey(patch.entityType, patch.entityId) === key))));
    setDirtyCapabilities([]); setBasis(current => current ? { ...current, preparationRevision: result.revision } : undefined);
    if (session.view.preparation && tab !== 'capabilities') {
      try { await session.readEntities(tab, cursors.at(-1), search); }
      catch { /* The saved batch receipt remains the result; the page reports the read failure. */ }
    }
  };
  const canAdopt = !inputLocked && !localInput && !!why.trim() && !!preview?.preparation?.revision
    && preview.adoptionImplemented && preview.validation.valid && preview.businessCompatibility.valid
    && preview.businessCompatibility.complete && preview.commercialContext.newBusinessAllowed;
  return <div className={styles.stack}>
    <div className={styles.toolbar}>
      <Select aria-label={t('版本操作')} value={operation} disabled={locked || dirty} options={[{ value: 'upgrade', label: t('升级版本') }, { value: 'restore', label: t('恢复旧版') }]}
        onChange={value => { setOperation(value); session.readWorkspace(value).catch(() => undefined); }} />
      <ActionButton label={t('读取可采用版本')} disabled={locked || dirty || !canPrepare} onAction={() => session.readWorkspace(operation)} />
    </div>
    {view.candidates && <Select aria-label={t('选择目标发布版本')} placeholder={t('选择目标发布版本')} value={preview?.targetVersionId} disabled={locked || dirty}
      options={view.candidates.versions.map(row => ({ value: row.id, label: row.versionLabel, disabled: !row.definitionExecutable }))}
      onChange={value => inspect(String(value)).catch(() => undefined)} />}
    {view.candidates && !view.candidates.versions.length && <p>{t('当前没有获准且可执行的目标版本。')}</p>}
    {staleInput && <Alert type="warning" title={t('原版本或准备修订已变化，本地输入已保留。请放弃或重新核对后准备。')} />}
    {preview && <>
      <p>{t('原空间版本修订')}: {preview.sourceRevision} · {t('目标版本')}: {preview.targetVersionLabel} · {t('准备修订')}: {preview.preparation?.revision ?? 0}</p>
      <DefinitionFacts definition={preview.targetDefinition} />
      <Differences rows={preview.differences} />
      {(!preview.validation.valid || preview.stale) && <Alert type="warning" title={t('原准备校验尚未通过。')} description={preview.validation.errors.join('；')} />}
      {!preview.businessCompatibility.valid && <Alert type="warning" title={t('经营资料尚不兼容目标版本。')}
        description={preview.businessCompatibility.blockers.map(row => row.message).join('；')} />}
      {!preview.adoptionImplemented && <p className={styles.help}>{t('当前部署未开放采用，可继续核对与保存准备资料。')}</p>}
      <Tabs activeKey={tab} items={[{ key: 'item_group', label: t('型号资料') }, { key: 'asset', label: t('资产资料') }, { key: 'capabilities', label: t('能力配置') }]}
        onChange={value => { if (locked) return; const next = value as typeof tab; setTab(next); setCursors([undefined]);
          if (next !== 'capabilities') session.readEntities(next, undefined, search).catch(() => undefined); }} />
      {tab !== 'capabilities' ? <div className={styles.stack}>
        <div className={styles.toolbar}><Input aria-label={t('搜索准备资料')} value={search} disabled={locked} maxLength={100} onChange={event => setSearch(event.target.value)} />
          <ActionButton label={t('读取资料页')} disabled={locked} onAction={() => { setCursors([undefined]); return session.readEntities(tab, undefined, search); }} /></div>
        {page?.entityType === tab && <>
          {page.rows.map(row => <div key={row.id} className={styles.section}>
            <h4>{safeDisplayText(row.name ?? row.assetNo ?? row.id, 200)}</h4>
            {row.preparationStale && <p role="status">{t('此条准备依据已变化，请核对原资料。')}</p>}
            {preview.targetDefinition.businessModel.assetFields.filter(field => field.scope === tab).map(field => {
              const value = edits[preparationEntityKey(tab, row.id)]?.values[field.code] ?? preparationEntityValue(row, tab, field.code);
              return <Form.Item key={field.code} label={`${field.label}${field.required ? ` · ${t('必填')}` : ''}${field.unique ? ` · ${t('唯一')}` : ''}`}>
                {field.type === 'boolean' ? <Select aria-label={field.label} value={typeof value === 'boolean' ? String(value) : undefined} disabled={inputLocked}
                  options={[{ value: 'true', label: t('是') }, { value: 'false', label: t('否') }]} onChange={next => edit(row, field.code, next === 'true')} />
                  : field.type === 'number' ? <InputNumber aria-label={field.label} disabled={inputLocked} value={typeof value === 'number' ? value : null}
                    onChange={next => { if (next !== null) edit(row, field.code, Number(next)); }} />
                    : field.type === 'select' ? <Select aria-label={field.label} disabled={inputLocked} value={typeof value === 'string' ? value : undefined}
                      options={field.options?.map(option => ({ value: option, label: option }))} onChange={next => edit(row, field.code, String(next))} />
                      : <Input aria-label={field.label} disabled={inputLocked} type={field.type === 'date' ? 'date' : 'text'}
                        value={typeof value === 'string' ? value : ''} maxLength={2048} onChange={event => edit(row, field.code, event.target.value)} />}
              </Form.Item>;
            })}
            {!!row.prepared && <ConfirmAction label={t('撤回此条已保存准备')} prompt={t('确认只撤回此条预备资料？当前活动资料保持原状。')}
              disabled={inputLocked || localInput || !why.trim()} onConfirm={async () => {
                await afterWrite(() => session.savePreparation([], why, undefined, undefined,
                  { removals: [{ entityType: tab, entityId: row.id }] }));
                if (session.view.preparation) await session.readEntities(tab, cursors.at(-1), search);
              }} />}
          </div>)}
          {!page.rows.length && <p>{t('当前页没有待准备资料。')}</p>}
          <div className={styles.toolbar}>
            <ActionButton label={t('上一页')} disabled={locked || cursors.length < 2} onAction={async () => { const next = cursors.slice(0, -1);
              await session.readEntities(tab, next.at(-1), search); setCursors(next); }} />
            <ActionButton label={t('下一页')} disabled={locked || !page.nextCursor} onAction={async () => { const cursor = page.nextCursor!;
              await session.readEntities(tab, cursor, search); setCursors(previous => [...previous, cursor]); }} />
          </div>
        </>}
      </div> : <div className={styles.stack}>
        {preparationCapabilityDefinitions(preview).map(definition => {
          const draft = capabilities[definition.code];
          return <div className={styles.section} key={definition.code}>
            <h4>{definition.label}</h4>
            {draft?.intent === 'enable_new' && <Form.Item label={t('准备启用此能力')}><Switch aria-label={`${definition.label} ${t('准备启用')}`}
              checked={!!draft.selected} disabled={inputLocked} onChange={selected => { captureBasis();
                setCapabilities(previous => ({ ...previous, [definition.code]: { ...previous[definition.code], selected } }));
                setDirtyCapabilities(previous => [...new Set([...previous, definition.code])]); }} /></Form.Item>}
            {definition.configSchema.map(field => {
              const value = draft?.fields[field.key], disabled = inputLocked || !draft || draft.intent === 'enable_new' && !draft.selected;
              return <Form.Item label={field.label} key={field.key}>
                {field.type === 'boolean' ? <Select aria-label={field.label} disabled={disabled} value={typeof value === 'boolean' ? String(value) : undefined}
                  options={[{ value: 'true', label: t('是') }, { value: 'false', label: t('否') }]} onChange={next => changeCapability(definition.code, field.key, next === 'true')} />
                  : field.type === 'number' ? <InputNumber aria-label={field.label} disabled={disabled} value={typeof value === 'number' ? value : null}
                    onChange={next => { if (next !== null) changeCapability(definition.code, field.key, Number(next)); }} />
                    : field.type === 'enum' ? <Select aria-label={field.label} disabled={disabled} value={typeof value === 'string' ? value : undefined}
                      options={field.options?.map(option => ({ value: option, label: option }))} onChange={next => changeCapability(definition.code, field.key, String(next))} />
                      : field.type === 'compatibility_relations' ? <CategoryCompatibilityRelationsEditor value={value} disabled={disabled}
                        targetId={preview.targetVersionId} operation={view.operation} scopeKey={scopeKey} preview={preview}
                        onChange={relations => changeCapability(definition.code, field.key, relations)} />
                        : <Input aria-label={field.label} value={typeof value === 'string' ? value : ''} disabled={disabled} maxLength={2048}
                          onChange={event => changeCapability(definition.code, field.key, event.target.value)} />}
                {field.description && <p className={styles.help}>{field.description}</p>}
              </Form.Item>;
            })}
          </div>;
        })}
      </div>}
      <Form.Item label={t('准备或采用原因')}><Input.TextArea aria-label={t('准备或采用原因')} value={why} maxLength={512} disabled={locked}
        onChange={event => setWhy(event.target.value)} /></Form.Item>
      <div className={styles.actions}>
        <ConfirmAction label={t('保存本批准备')} prompt={t('确认保存这一批准备资料？当前活动版本与经营资料保持原状。')}
          disabled={inputLocked || !why.trim() || !localInput && !!preview.preparation} onConfirm={() => afterWrite(save)} />
        <ConfirmAction label={t(operation === 'restore' ? '明确恢复旧版' : '明确采用目标版本')}
          prompt={t('确认仅将本空间切换到已核对的目标版本，并使已保存的准备资料生效？历史订单依据保持原状。')}
          disabled={!canAdopt} onConfirm={async () => { await afterWrite(() => session.adopt(why)); clear(); }} />
        <ConfirmAction label={t('重建原目标准备')} prompt={t('确认清空本目标已保存的预备资料并重新准备？当前活动资料保持原状。')}
          disabled={locked || localInput || !canPrepare || !why.trim()} onConfirm={async () => {
            await afterWrite(() => session.savePreparation([], why, undefined, undefined, { resetPreparation: true }));
            setBasis(undefined); setCapabilities({}); setDirtyCapabilities([]);
            if (session.view.preparation) { await session.inspectTarget(preview.targetVersionId);
              if (tab !== 'capabilities') await session.readEntities(tab); }
          }} />
      </div>
    </>}
    <ConfirmAction label={t('放弃本地准备输入')} prompt={t('放弃尚未保存的本地准备输入？已保存的原批次仍保留。')} disabled={locked || !dirty}
      onConfirm={async () => { clear(); if (preview) await inspect(preview.targetVersionId); }} />
  </div>;
}
function Differences({ rows }: { rows: Array<{ path: string; label: string; kind: string; before: unknown; after: unknown }> }) {
  const { t } = useLocale(), labels: Record<string, string> = { added: '新增', removed: '移除', changed: '修改', required_added: '新增必填要求',
    unique_enabled: '启用唯一要求', type_changed: '字段类型变化', scope_narrowed: '支持范围收窄' };
  const display = (value: unknown) => value === undefined || value === null ? t('未提供') : safeDisplayText(typeof value === 'string' ? value : JSON.stringify(value), 4000);
  return <div className={styles.section}><h4>{t('原配置差异')}</h4>{!rows.length && <p>{t('没有配置差异。')}</p>}
    {rows.map(row => <div key={row.path} className={styles.serviceRow}><div><strong>{safeDisplayText(row.label, 200)} · {t(labels[row.kind] ?? '未知变更')}</strong>
      <p>{t('变更前')}: {display(row.before)} · {t('变更后')}: {display(row.after)}</p></div></div>)}</div>;
}
