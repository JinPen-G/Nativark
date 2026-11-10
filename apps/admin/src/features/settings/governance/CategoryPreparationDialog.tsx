import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InputNumber, Space, Typography } from "antd";
import { ActionButton, Alert, App, Button, ConfirmAction, Form, Input, Modal, SaveButton, Select, Tabs } from "@/components/ui";
import { useEffect, useId, useState } from "react";
import type { CategoryAdoptionResult, CategoryEntityPreparationPatch, CategoryPreparationSaveResult, RentalCompatibilityRelation, SaveCategoryPreparationBatchRequest } from "@rental-os/shared";
import { categoryPreparationApi, type CategoryPreparationOperation } from "@/api/categoryPreparation";
import { useLocale } from "@/app/locale";
import { QueryState } from "@/components/QueryState";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useAuthStore } from "@/features/auth/authStore";
import { CATEGORY_GOVERNANCE_PREVIEW_ENABLED } from "@/app/categoryGovernancePreview";
import { nextPreparationBatch, preparationEntityKey, preparationEntityValue } from "./categoryPreparationFields";
import { capabilityPreparationPatches, initialCapabilityDrafts, preparationCapabilityDefinitions, type CapabilityPreparationDrafts } from "./categoryPreparationCapabilities";
import { preparationErrorMessage, useCategoryPreparationSave } from "./useCategoryPreparationSave";
import { useCategoryAdoption } from "./useCategoryAdoption";
import { canAdoptPreparedCategory, readPendingCategoryAdoption } from "./categoryAdoptionPending";
import { CategoryCompatibilityRelationsEditor } from "./CategoryCompatibilityRelationsEditor";
import { currentSessionEpoch } from "@/app/queryClient";
import { rentalCoreApi } from "@/api/rentalCore";

const sessionKey = (state: ReturnType<typeof useAuthStore.getState>) => JSON.stringify([state.tenant?.tenantId ?? "", state.user?.id ?? "", state.currentWorkspaceId ?? ""]);
interface EditBasis { versionId: string; sourceRevision: number; preparationRevision: number }
interface SavedChanges { entityKeys?: string[]; capabilityCodes?: string[]; reset?: boolean }
const preparationReadPolicy = { staleTime: 0, refetchOnWindowFocus: false, refetchInterval: false, meta: { liveRefresh: false } } as const;

export function CategoryPreparationEntry() {
  const canPrepare = useAuthStore((state) => state.hasPermission("rental-os:category:adopt"));
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const scopeKey = useAuthStore(sessionKey);
  const epoch = useAuthStore(() => currentSessionEpoch());
  let pending = false;
  try { pending = Boolean(readPendingCategoryAdoption(window.sessionStorage, scopeKey)); } catch { pending = true; }
  return workspaceId && (CATEGORY_GOVERNANCE_PREVIEW_ENABLED && canPrepare || pending)
    ? <CategoryPreparationDialog key={`${scopeKey}:${epoch}`} workspaceId={workspaceId} scopeKey={scopeKey} epoch={epoch} canPrepare={canPrepare} /> : null;
}

/** Tenant-owned staged editing. Pages retain unsaved patches by entity identity;
 * only a matching server receipt clears them. Adoption remains a separate action. */
function CategoryPreparationDialog({ workspaceId, scopeKey, epoch, canPrepare }: { workspaceId: string; scopeKey: string; epoch: number; canPrepare: boolean }) {
  const { t } = useLocale();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ reason: string }>();
  const watchedReason = Form.useWatch("reason", form);
  const reason = typeof watchedReason === "string" ? watchedReason : "";
  const [reasonDirty, setReasonDirty] = useState(false);
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState<CategoryPreparationOperation>("upgrade");
  const [targetId, setTargetId] = useState<string>();
  const [tab, setTab] = useState("item_group");
  const [scope, setScope] = useState<"item_group" | "asset">("item_group");
  const [entityId, setEntityId] = useState<string>();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [edits, setEdits] = useState<Record<string, CategoryEntityPreparationPatch>>({});
  const [capabilityDrafts, setCapabilityDrafts] = useState<CapabilityPreparationDrafts>({});
  const [dirtyCapabilities, setDirtyCapabilities] = useState<Set<string>>(new Set());
  const [basis, setBasis] = useState<EditBasis>();
  const [readBusy, setReadBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const inputPrefix = useId();
  const isCurrent = () => sessionKey(useAuthStore.getState()) === scopeKey && currentSessionEpoch() === epoch && useAuthStore.getState().sessionVerified;
  async function refreshAfterAdoption(result: CategoryAdoptionResult) {
    if (!isCurrent()) throw new Error("会话或经营空间已变化，请重新进入");
    await useAuthStore.getState().bootstrap();
    if (!isCurrent()) throw new Error("会话或经营空间已变化，请重新进入");
    const current = await rentalCoreApi.profile();
    if (!isCurrent() || current.categoryAdoptionRevision === undefined || current.categoryAdoptionRevision < result.adoptionRevision ||
        current.categoryAdoptionRevision === result.adoptionRevision && current.categoryVersionId !== result.targetVersionId) {
      throw new Error("当前资料尚未读取到已确认的采用版本，请重新读取");
    }
    await Promise.all(["profile", "business-settings", "categories", "capabilities", "item-groups", "pricing-groups", "inspection-templates"].map(key =>
      queryClient.invalidateQueries({ queryKey: ["rental-core", key] }, { throwOnError: true })));
  }
  const adoption = useCategoryAdoption(scopeKey, isCurrent, refreshAfterAdoption);
  const batch = useCategoryPreparationSave(isCurrent);
  const locked = batch.phase !== "idle" || adoption.locked || readBusy;
  const dirty = Object.keys(edits).length > 0 || dirtyCapabilities.size > 0 || reasonDirty;
  const candidates = useQuery({ ...preparationReadPolicy, queryKey: ["category-preparation", scopeKey, operation], queryFn: () => categoryPreparationApi.candidates(operation), enabled: open && canPrepare && !adoption.locked });
  const preview = useQuery({ ...preparationReadPolicy, queryKey: ["category-preparation-metadata", scopeKey, operation, targetId], queryFn: ({ signal }) => categoryPreparationApi.preview(targetId!, operation, { metadataOnly: true, signal }), enabled: open && canPrepare && !adoption.locked && Boolean(targetId) });
  const page = useQuery({ ...preparationReadPolicy, queryKey: ["category-preparation-entities", scopeKey, operation, targetId, scope, search, cursors.at(-1)], queryFn: ({ signal }) => categoryPreparationApi.entities(targetId!, { operation, entityType: scope, search: search || undefined, after: cursors.at(-1), limit: 20 }, signal), enabled: open && canPrepare && !adoption.locked && Boolean(targetId) && Boolean(preview.data) && tab !== "capabilities" });
  const rows = page.data?.rows ?? [];
  const entity = rows.find((row) => row.id === entityId) ?? rows[0];
  const entityKey = entity ? preparationEntityKey(scope, entity.id) : "";
  const fields = preview.data?.targetDefinition.businessModel.assetFields.filter((field) => field.scope === scope) ?? [];
  const sourceChanged = Boolean(basis && preview.data && (basis.versionId !== preview.data.sourceVersionId || basis.sourceRevision !== preview.data.sourceRevision));
  const revisionChanged = Boolean(basis && preview.data && basis.preparationRevision !== (preview.data.preparation?.revision ?? 0));
  const pageChanged = tab !== "capabilities" && Boolean(page.data && preview.data && (page.data.sourceVersionId !== preview.data.sourceVersionId || page.data.sourceRevision !== preview.data.sourceRevision || page.data.preparationRevision !== (preview.data.preparation?.revision ?? 0)));
  const inputLocked = locked || !canPrepare || !CATEGORY_GOVERNANCE_PREVIEW_ENABLED || preview.isFetching || (tab !== "capabilities" && (page.isFetching || page.isError || pageChanged));
  const pendingCount = Object.keys(edits).length;
  const savedCount = preview.data?.preparation ? preview.data.preparation.entityCount ?? preview.data.preparation.patches.items?.length : 0;

  useEffect(() => {
    if (!preview.data) return;
    if (!reasonDirty) form.setFieldValue("reason", preview.data.preparation?.patches.operation === operation ? preview.data.preparation.patches.reason ?? "" : "");
    const fresh = initialCapabilityDrafts(preview.data, operation);
    setCapabilityDrafts((previous) => ({ ...fresh, ...Object.fromEntries(Object.entries(previous).filter(([code]) => dirtyCapabilities.has(code))) }));
  }, [preview.data, operation, form, reasonDirty, dirtyCapabilities]);

  function resetLocal() {
    setEdits({}); setDirtyCapabilities(new Set()); setCapabilityDrafts({}); setBasis(undefined);
    setReasonDirty(false); setLocalError(""); setEntityId(undefined); setCursors([undefined]); setSearch(""); setSearchInput("");
    form.resetFields();
  }
  function guarded(action: () => void) {
    if (batch.phase === "sending" || batch.phase === "unknown" || adoption.locked || readBusy) return;
    const proceed = () => { batch.clearSettled(); resetLocal(); action(); };
    if (dirty) modal.confirm({ title: t("放弃未保存的预备资料？"), onOk: proceed });
    else proceed();
  }
  function closeDialog() {
    if (batch.phase === "sending" || batch.phase === "unknown" || adoption.locked || readBusy) return;
    if (dirty) modal.confirm({ title: t("放弃未保存的预备资料？"), onOk: () => setOpen(false) });
    else setOpen(false);
  }
  function captureBasis() {
    if (!preview.data) return;
    setBasis((current) => current ?? { versionId: preview.data!.sourceVersionId, sourceRevision: preview.data!.sourceRevision, preparationRevision: preview.data!.preparation?.revision ?? 0 });
  }
  function change(code: string, value: string | number | boolean) {
    if (!entity || inputLocked) return;
    captureBasis(); setLocalError("");
    setEdits((previous) => ({ ...previous, [entityKey]: {
      entityType: scope, entityId: entity.id, expectedUpdatedAt: previous[entityKey]?.expectedUpdatedAt ?? entity.updatedAt,
      values: { ...previous[entityKey]?.values, [code]: value }
    } }));
  }
  function markCapability(code: string) { captureBasis(); setDirtyCapabilities((previous) => new Set([...previous, code])); setLocalError(""); }

  async function reread(advanceBasis = true) {
    if (!isCurrent()) throw new Error("会话或经营空间已变化，请重新进入");
    setReadBusy(true); setLocalError("");
    try {
      const [metadata, entities] = await Promise.all([preview.refetch(), tab === "capabilities" ? Promise.resolve(undefined) : page.refetch()]);
      if (metadata.isError || entities?.isError || !metadata.data) throw new Error("资料读取失败，当前输入已保留");
      if (!isCurrent()) throw new Error("会话或经营空间已变化，请重新进入");
      if (advanceBasis) setBasis((current) => current && current.versionId === metadata.data!.sourceVersionId && current.sourceRevision === metadata.data!.sourceRevision
        ? { ...current, preparationRevision: metadata.data!.preparation?.revision ?? 0 } : current);
    } catch (error) { if (isCurrent() && !(error && typeof error === "object" && "errorFields" in error)) setLocalError(preparationErrorMessage(error)); throw error; }
    finally { if (isCurrent()) setReadBusy(false); }
  }

  async function submit(request: SaveCategoryPreparationBatchRequest, changes: SavedChanges) {
    if (!targetId || !isCurrent()) throw new Error("会话或目标版本已变化");
    setLocalError("");
    return batch.start(targetId, request, async (receipt: CategoryPreparationSaveResult) => {
      await reread(false);
      if (!isCurrent()) throw new Error("会话或经营空间已变化，请重新进入");
      const submittedEntities = new Set(changes.entityKeys ?? []);
      const submittedCapabilities = new Set(changes.capabilityCodes ?? []);
      const remaining = !changes.reset && (Object.keys(edits).some((key) => !submittedEntities.has(key)) || [...dirtyCapabilities].some((code) => !submittedCapabilities.has(code)));
      setEdits((previous) => changes.reset ? {} : Object.fromEntries(Object.entries(previous).filter(([key]) => !submittedEntities.has(key))));
      setDirtyCapabilities((previous) => changes.reset ? new Set() : new Set([...previous].filter((code) => !submittedCapabilities.has(code))));
      setReasonDirty(false);
      setBasis(remaining ? { versionId: request.expectedSourceVersionId, sourceRevision: request.expectedSourceRevision, preparationRevision: receipt.revision } : undefined);
      message.success(t("本批预备资料已保存，当前营业版本未改变"));
    });
  }
  function requestBase(values: { reason: string }, useCurrent = false) {
    if (!preview.data) throw new Error("请先读取目标版本资料");
    return {
      batchId: crypto.randomUUID(), expectedSourceVersionId: useCurrent ? preview.data.sourceVersionId : basis?.versionId ?? preview.data.sourceVersionId,
      expectedSourceRevision: useCurrent ? preview.data.sourceRevision : basis?.sourceRevision ?? preview.data.sourceRevision,
      expectedPreparationRevision: useCurrent ? preview.data.preparation?.revision ?? 0 : basis?.preparationRevision ?? preview.data.preparation?.revision ?? 0,
      operation, reason: values.reason
    };
  }
  async function save() {
    try {
      const values = await form.validateFields();
      if (!preview.data || locked || sourceChanged || revisionChanged || pageChanged || preview.data.stale) throw new Error("请先重新读取并核对准备资料");
      if (tab === "capabilities") {
        const selected = dirtyCapabilities.size ? capabilityPreparationPatches(preview.data, capabilityDrafts).filter((patch) => dirtyCapabilities.has(patch.code)) : [];
        const selectedCodes = new Set(selected.map((patch) => patch.code));
        const removed = (preview.data.preparation?.patches.capabilityPatches ?? []).filter((patch) => dirtyCapabilities.has(patch.code) && !selectedCodes.has(patch.code)).map((patch) => patch.code);
        return await submit({ ...requestBase(values), patches: [], capabilityPatches: selected, removeCapabilityCodes: removed }, { capabilityCodes: [...dirtyCapabilities] });
      }
      const next = nextPreparationBatch(Object.values(edits));
      return await submit({ ...requestBase(values), patches: next.patches }, { entityKeys: next.patches.map((patch) => preparationEntityKey(patch.entityType, patch.entityId)) });
    } catch (error) { if (isCurrent() && !(error && typeof error === "object" && "errorFields" in error)) setLocalError(preparationErrorMessage(error)); throw error; }
  }
  async function withdrawEntity() {
    if (!entity) return;
    const values = await form.validateFields();
    await submit({ ...requestBase(values, true), patches: [], removals: [{ entityType: scope, entityId: entity.id }] }, { entityKeys: [entityKey] });
  }
  async function resetPreparation() {
    const values = await form.validateFields();
    await submit({ ...requestBase(values, true), patches: [], resetPreparation: true }, { reset: true });
  }
  function applySearch() { setSearch(searchInput.trim()); setCursors([undefined]); setEntityId(undefined); }
  async function adopt() {
    if (!targetId || inputLocked || !isCurrent() || !canAdoptPreparedCategory(preview.data, dirty) || sourceChanged || revisionChanged || pageChanged) {
      throw new Error("请先保存准备并重新核对目标版本");
    }
    const values = await form.validateFields(), data = preview.data!;
    await adoption.start(targetId, { expectedSourceVersionId: data.sourceVersionId, expectedSourceRevision: data.sourceRevision,
      expectedPreparationRevision: data.preparation!.revision, expectedTargetPolicyRevision: data.targetPolicyRevision!, operation,
      idempotencyKey: crypto.randomUUID(), reason: values.reason });
    message.success(t(operation === "restore" ? "旧版已明确恢复，历史资料已保留" : "目标品类版本已明确采用")); setOpen(false);
  }
  const hasChangesForTab = reasonDirty || (tab === "capabilities" ? dirtyCapabilities.size > 0 : pendingCount > 0);
  const footer = adoption.locked ? <Space wrap>
    <ActionButton label={adoption.phase === "adopted_unread" ? "刷新当前资料" : "核对采用结果"} intent="review" disabled={!canPrepare || adoption.phase === "sending"} onAction={async () => {
      await adoption.reconcile(); message.success(t("原采用结果已确认，当前资料已刷新")); setOpen(false);
    }} />
  </Space> : preview.data ? <Space wrap>
    {batch.phase === "unknown" || batch.phase === "saved_unread" ? <>
      <ActionButton label={batch.phase === "unknown" ? "核对保存结果" : "重新读取"} intent={batch.phase === "unknown" ? "review" : "refresh"} onAction={batch.reconcile} />
      {batch.phase === "unknown" && <ActionButton label="重试原请求" intent="retry" variant="secondary" onAction={batch.retry} />}
    </> : <>
      <ActionButton label="重新读取并核对" intent="refresh" variant="secondary" disabled={locked} onAction={() => reread()} />
      <SaveButton form={form} label="保存本批" onSave={save} pending={batch.phase === "sending"} disabled={inputLocked || !reason.trim() || !hasChangesForTab || sourceChanged || revisionChanged || pageChanged || preview.data.stale} />
      <ConfirmAction label={t("重建准备")} prompt={t("清空本目标的预备资料和本地改动，按当前资料重新准备？")} disabled={locked || !reason.trim()} onConfirm={resetPreparation} />
      {preview.data.adoptionImplemented && <ConfirmAction label={t(operation === "restore" ? "恢复旧版" : "采用目标版本")}
        prompt={t("将本空间明确切换到 {version}，已保存的准备资料一并生效？", { version: preview.data.targetVersionLabel })}
        disabled={inputLocked || !reason.trim() || !canAdoptPreparedCategory(preview.data, dirty) || sourceChanged || revisionChanged || pageChanged} onConfirm={adopt} />}
    </>}
  </Space> : null;

  return <>
    <UnsavedChangesGuard dirty={open && dirty} busy={batch.phase === "sending" || batch.phase === "unknown" || adoption.locked || readBusy} />
    <Button onClick={() => setOpen(true)}>{t(adoption.locked ? "核对品类采用结果" : "准备品类版本资料")}</Button>
    <Modal presentation="side" title={t("品类版本预备资料")} open={open} footer={footer} width={960} mask={{ closable: false }} onCancel={closeDialog} afterClose={() => { if (!adoption.locked && (batch.phase === "idle" || batch.phase === "saved_unread")) { batch.clearSettled(); resetLocal(); } }}>
      <Form form={form} name={`category-preparation-${workspaceId}`} layout="vertical" aria-busy={locked} onValuesChange={() => setReasonDirty(true)} onFinish={() => { void save().catch(() => undefined); }}>
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Alert type="info" showIcon title={t("保存准备不会改变当前营业版本；明确采用后，已保存的候选资料一并生效。")}/>
          {adoption.error && <Alert type={adoption.phase === "idle" ? "error" : "warning"} showIcon title={t(adoption.error)} />}
          {!canPrepare && <Alert type="warning" title={t("当前权限不足，原操作标识已保留，恢复权限后可核对原结果")} />}
          <Select aria-label={t("版本操作")} disabled={locked} value={operation} options={[{ value: "upgrade", label: t("升级") }, { value: "restore", label: t("恢复旧版") }]} onChange={(next) => guarded(() => { setOperation(next); setTargetId(undefined); })} />
          <QueryState loading={candidates.isLoading} error={candidates.error}>
            <Select aria-label={t("目标版本")} placeholder={t("选择目标版本")} disabled={locked} value={targetId} showSearch={{ optionFilterProp: "label" }} options={candidates.data?.versions.map((row) => ({ value: row.id, label: `${row.versionLabel}${row.definitionExecutable ? "" : ` · ${row.unavailableReason ?? t("无法执行")}`}`, disabled: !row.definitionExecutable }))} onChange={(next) => guarded(() => setTargetId(next))} style={{ width: "100%" }} />
            {candidates.data?.versions.length === 0 && <Typography.Text type="secondary">{t("暂无获授权的目标版本")}</Typography.Text>}
          </QueryState>
          {targetId && <QueryState loading={preview.isLoading} error={preview.error ?? (preview.isSuccess && !preview.data ? new Error(t("资料读取失败，当前输入已保留")) : undefined)}>
            {preview.data && <>
              {(!preview.data.validation.valid || preview.data.stale) && <Alert type="warning" showIcon title={t("预备资料需补齐或重新核对")} description={preview.data.validation.errors.join("；")} />}
              {!preview.data.adoptionImplemented && <Typography.Text type="secondary">{t("采用入口尚未开放，可继续保存准备资料")}</Typography.Text>}
              {!preview.data.businessCompatibility.valid && <Alert type="warning" showIcon title={t("经营配置尚不兼容目标版本")} description={preview.data.businessCompatibility.blockers.map((row) => row.message).join("；")} />}
              {(sourceChanged || revisionChanged || pageChanged) && <Alert type="warning" showIcon title={t("资料或准备集合已变化，请重新读取并核对")} />}
              {(batch.error || localError) && <Alert type="error" showIcon title={t(batch.error || localError)} />}
              {batch.phase === "unknown" && <Alert type="warning" showIcon title={t("保存结果待核对，原请求和输入已保留")} description={t("请核对结果或重试原请求，暂不能继续编辑或切换目标。")} />}
              <Typography.Text type="secondary">{t("已准备 {saved} 条，本地待保存 {pending} 条", { saved: savedCount ?? t("待核实"), pending: pendingCount })}</Typography.Text>
              <Tabs className="standalone-tabs" activeKey={tab} items={[{ key: "item_group", label: t("型号资料") }, { key: "asset", label: t("资产资料") }, { key: "capabilities", label: t("能力配置") }]} onChange={(key) => { if (locked) return; setTab(key); if (key !== "capabilities") setScope(key as typeof scope); setEntityId(undefined); setCursors([undefined]); setSearch(""); setSearchInput(""); }} />
              <ContentTransition value={tab}>{tab === "capabilities" ? <>
                <Typography.Text type="secondary">{t("准备配置不会改变当前营业；新增必选能力须明确选择准备启用，仅在采用成功时生效。")}</Typography.Text>
                {preparationCapabilityDefinitions(preview.data).map((definition) => {
                  const draft = capabilityDrafts[definition.code];
                  const current = preview.data!.entities.capabilities?.find((row) => row.code === definition.code);
                  const newCapability = draft?.intent === "enable_new";
                  const changeConfig = (key: string, value: string | number | boolean | RentalCompatibilityRelation[] | undefined) => {
                    if (!draft || inputLocked) return;
                    setCapabilityDrafts((previous) => ({ ...previous, [definition.code]: { ...draft, fields: { ...draft.fields, [key]: value ?? "" } } }));
                    markCapability(definition.code);
                  };
                  return <Space key={definition.code} orientation="vertical" style={{ width: "100%" }}>
                    <Typography.Text strong>{t(definition.label)}</Typography.Text>
                    {draft && current && (newCapability || draft.expectedRevision !== current.revision || draft.expectedImplementationVersion !== current.implementationVersion) && <Alert type="warning" showIcon title={t("来源或准备修订已变化，输入已保留，请重新核对")} />}
                    {newCapability && <Button disabled={inputLocked} onClick={() => {
                      setCapabilityDrafts((previous) => ({ ...previous, [definition.code]: { ...draft, selected: !draft.selected } })); markCapability(definition.code);
                    }}>{t(draft.selected ? "取消准备启用" : "准备启用新增必选能力")}</Button>}
                    {newCapability && <Typography.Text type="secondary">{t(draft.selected ? "已选择准备启用，保存不立即启用" : "尚未选择准备启用")}</Typography.Text>}
                    {definition.configSchema.map((field) => {
                      const value = draft?.fields[field.key]; const label = `${t(field.label)}${field.required ? " *" : ""}`;
                      const id = `${inputPrefix}-cap-${definition.code}-${field.key}`;
                      return <Space key={field.key} orientation="vertical" style={{ width: "100%" }}>
                        <label htmlFor={id}>{label}</label>
                        {field.type === "number" ? <InputNumber id={id} aria-label={label} disabled={inputLocked || !draft} min={field.min} max={field.max} value={typeof value === "number" ? value : null} onChange={(next) => changeConfig(field.key, next ?? undefined)} />
                          : field.type === "boolean" ? <Select id={id} aria-label={label} disabled={inputLocked || !draft} allowClear value={typeof value === "boolean" ? String(value) : undefined} options={[{ value: "true", label: t("是") }, { value: "false", label: t("否") }]} onChange={(next) => changeConfig(field.key, next === undefined ? undefined : next === "true")} />
                            : field.type === "enum" ? <Select id={id} aria-label={label} disabled={inputLocked || !draft} allowClear value={typeof value === "string" && value ? value : undefined} options={field.options?.map((option) => ({ value: option, label: t(option) }))} onChange={(next) => changeConfig(field.key, next)} />
                              : field.type === "compatibility_relations" ? <CategoryCompatibilityRelationsEditor value={value} disabled={inputLocked || !draft} targetId={targetId!} operation={operation} scopeKey={scopeKey} preview={preview.data!} onChange={relations => changeConfig(field.key, relations)} />
                                : <Input id={id} aria-label={label} disabled={inputLocked || !draft} value={typeof value === "string" ? value : ""} onChange={(event) => changeConfig(field.key, event.target.value)} />}
                        {field.description && <Typography.Text type="secondary">{t(field.description)}</Typography.Text>}
                      </Space>;
                    })}
                    {current && <Button disabled={inputLocked} onClick={() => modal.confirm({ title: t("放弃未保存的预备资料？"), onOk: () => {
                      const fresh = initialCapabilityDrafts({ ...preview.data!, preparation: null }, operation)[definition.code];
                      setCapabilityDrafts((previous) => ({ ...previous, [definition.code]: fresh })); markCapability(definition.code);
                    } })}>{t("使用当前活动配置重新准备")}</Button>}
                    {preview.data!.preparation?.patches.capabilityPatches?.some((patch) => patch.code === definition.code) && <ConfirmAction label={t("撤回该能力准备")} prompt={t("撤回该能力的预备配置和本地改动？")} disabled={inputLocked || !reason.trim()} onConfirm={async () => {
                      const values = await form.validateFields();
                      await submit({ ...requestBase(values, true), patches: [], removeCapabilityCodes: [definition.code] }, { capabilityCodes: [definition.code] });
                    }} />}
                  </Space>;
                })}
                {!preparationCapabilityDefinitions(preview.data).length && <Typography.Text type="secondary">{t("暂无需要准备的资料")}</Typography.Text>}
              </> : <>
                <Space wrap style={{ width: "100%" }}>
                  <Input aria-label={t("查找待准备资料")} placeholder={t("按名称或编号查找，回车查询")} maxLength={100} value={searchInput} disabled={locked} onChange={(event) => setSearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applySearch(); } }} />
                  <Button disabled={locked} onClick={applySearch}>{t("查找")}</Button>
                </Space>
                <QueryState loading={page.isLoading} error={page.error ?? (page.isSuccess && !page.data ? new Error(t("资料读取失败，当前输入已保留")) : undefined)}>
                  <Select aria-label={t("选择待准备的资料")} value={entity?.id} disabled={inputLocked} options={rows.map((row) => ({ value: row.id, label: row.name ?? row.assetNo ?? row.id }))} onChange={setEntityId} style={{ width: "100%" }} />
                  <Space wrap>
                    <Button disabled={locked || page.isFetching || cursors.length <= 1} onClick={() => { setCursors((previous) => previous.slice(0, -1)); setEntityId(undefined); }}>{t("上一页")}</Button>
                    <Typography.Text type="secondary">{t("第 {page} 页，共 {total} 条", { page: cursors.length, total: page.data?.total ?? 0 })}</Typography.Text>
                    <Button disabled={locked || page.isFetching || !page.data?.nextCursor} onClick={() => { setCursors((previous) => [...previous, page.data!.nextCursor]); setEntityId(undefined); }}>{t("下一页")}</Button>
                  </Space>
                  {entity && (entity.preparationStale || (edits[entityKey] && edits[entityKey].expectedUpdatedAt !== entity.updatedAt)) && <Alert type="warning" showIcon title={t("本条资料已变化，请撤回旧准备后重新填写")} />}
                  {entity && fields.map((field) => {
                    const savedValue = preparationEntityValue(entity, scope, field.code);
                    const value = edits[entityKey]?.values[field.code] ?? savedValue;
                    const label = `${field.label}${field.required ? " *" : ""}${field.unit ? ` (${field.unit})` : ""}`;
                    const id = `${inputPrefix}-${scope}-${entity.id}-${field.code}`;
                    return <Space key={`${entity.id}:${field.code}`} orientation="vertical" style={{ width: "100%" }}>
                      <label htmlFor={id}>{label}</label>
                      {field.type === "number" ? <InputNumber id={id} aria-label={label} disabled={inputLocked} value={typeof value === "number" ? value : null} onChange={(next) => change(field.code, next ?? "")} />
                        : field.type === "boolean" ? <Select id={id} aria-label={label} disabled={inputLocked} allowClear value={typeof value === "boolean" ? String(value) : undefined} options={[{ value: "true", label: t("是") }, { value: "false", label: t("否") }]} onChange={(next) => change(field.code, next === undefined ? "" : next === "true")} />
                          : field.type === "select" ? <Select id={id} aria-label={label} disabled={inputLocked} value={typeof value === "string" && value ? value : undefined} allowClear options={field.options?.map((option) => ({ value: option, label: option }))} onChange={(next) => change(field.code, next ?? "")} style={{ width: "100%" }} />
                            : <Input id={id} aria-label={label} disabled={inputLocked} type={field.type === "date" ? "date" : "text"} value={typeof value === "string" ? value : ""} onChange={(event) => change(field.code, event.target.value)} />}
                      {edits[entityKey]?.values[field.code] !== undefined && value !== savedValue && <Typography.Text type="secondary">{t("当前已保存值：{value}", { value: savedValue === undefined ? t("未填写") : String(savedValue) })}</Typography.Text>}
                    </Space>;
                  })}
                  {entity && (entity.prepared || edits[entityKey]) && <ConfirmAction key={entityKey} label={t("撤回本条准备")} prompt={t("撤回本条已保存的准备和本地改动？当前经营资料不变。")} disabled={inputLocked || !reason.trim()} onConfirm={withdrawEntity} />}
                  {!rows.length && <Typography.Text type="secondary">{t(search ? "没有匹配的资料，请调整查找条件" : "暂无需要准备的资料")}</Typography.Text>}
                </QueryState>
              </>}</ContentTransition>
              <Form.Item name="reason" label={t("准备原因")} rules={[{ required: true, whitespace: true, message: t("请填写准备原因") }, { max: 512 }]}>
                <Input.TextArea maxLength={512} disabled={locked} />
              </Form.Item>
            </>}
          </QueryState>}
        </Space>
      </Form>
    </Modal>
  </>;
}
