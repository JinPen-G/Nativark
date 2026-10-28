import { useQuery } from "@tanstack/react-query";
import { InputNumber, Space, Typography } from "antd";
import { App, Modal } from "@/components/ui";
import { Alert, Button, Input, Select, Tabs } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import { categoryPreparationApi, type CategoryPreparationOperation } from "@/api/categoryPreparation";
import { useLocale } from "@/app/locale";
import { QueryState } from "@/components/QueryState";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useAuthStore } from "@/features/auth/authStore";
import { CATEGORY_GOVERNANCE_PREVIEW_ENABLED } from "@/app/categoryGovernancePreview";
import { categoryPreparationInitialValues, categoryPreparationPatches, preparationEntityKey, type CategoryPreparationValues } from "./categoryPreparationFields";
import { capabilityPreparationPatches, initialCapabilityDrafts, preparationCapabilityDefinitions, type CapabilityPreparationDrafts } from "./categoryPreparationCapabilities";

export function CategoryPreparationEntry() {
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  return CATEGORY_GOVERNANCE_PREVIEW_ENABLED && workspaceId && hasPermission("rental-os:category:adopt") ? <CategoryPreparationDialog key={workspaceId} workspaceId={workspaceId} /> : null;
}
function CategoryPreparationDialog({ workspaceId }: { workspaceId: string }) {
  const { t } = useLocale();
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState<CategoryPreparationOperation>("upgrade");
  const [targetId, setTargetId] = useState<string>();
  const [scope, setScope] = useState<"item_group" | "asset">("item_group");
  const [tab, setTab] = useState("item_group");
  const [capabilityDrafts, setCapabilityDrafts] = useState<CapabilityPreparationDrafts>({});
  const [entityId, setEntityId] = useState<string>();
  const [values, setValues] = useState<CategoryPreparationValues>({});
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const candidates = useQuery({ queryKey: ["category-preparation", workspaceId, operation], queryFn: () => categoryPreparationApi.candidates(operation), enabled: open, refetchOnWindowFocus: false });
  const preview = useQuery({ queryKey: ["category-preparation-preview", workspaceId, operation, targetId], queryFn: () => categoryPreparationApi.preview(targetId!, operation), enabled: open && Boolean(targetId), refetchOnWindowFocus: false });
  useEffect(() => {
    if (!preview.data || dirty) return;
    setValues(categoryPreparationInitialValues(preview.data, operation));
    setCapabilityDrafts(initialCapabilityDrafts(preview.data, operation));
    setReason(preview.data.preparation?.patches.operation === operation ? preview.data.preparation.patches.reason ?? "" : "");
  }, [preview.data, operation, dirty]);
  const guarded = (action: () => void) => {
    if (busy) return;
    if (!dirty) { action(); return; }
    modal.confirm({ title: t("放弃未保存的预备资料？"), onOk: () => { setDirty(false); action(); } });
  };
  const rows = scope === "item_group" ? preview.data?.entities.itemGroups ?? [] : preview.data?.entities.assets ?? [];
  const entity = rows.find((row) => row.id === entityId) ?? rows[0];
  const fields = preview.data?.targetDefinition.businessModel.assetFields.filter((field) => field.scope === scope) ?? [];
  const change = (code: string, value: string | number | boolean) => {
    if (!entity) return;
    const key = preparationEntityKey(scope, entity.id);
    setValues((previous) => ({ ...previous, [key]: { ...previous[key], [code]: value } }));
    setDirty(true);
  };
  const save = async () => {
    if (!preview.data || !targetId || !reason.trim()) { message.warning(t("请填写准备原因")); return; }
    setBusy(true);
    try {
      const capabilityPatches = capabilityPreparationPatches(preview.data, capabilityDrafts);
      await categoryPreparationApi.save(targetId, { expectedSourceVersionId: preview.data.sourceVersionId, expectedSourceRevision: preview.data.sourceRevision, expectedPreparationRevision: preview.data.preparation?.revision ?? 0, operation, reason, patches: categoryPreparationPatches(preview.data, values), capabilityPatches });
      if (!mounted.current) return;
      const refreshed = await preview.refetch();
      if (!mounted.current) return;
      if (refreshed.isError) { message.warning(t("预备资料已保存，但刷新失败，输入已保留")); return; }
      setDirty(false); message.success(t("预备资料已保存，当前营业版本未改变"));
    } catch (error) {
      if (!mounted.current) return;
      const response = error as { response?: { status?: number; data?: { message?: string } } };
      message.error(response.response?.status === 409 ? t("来源或准备修订已变化，输入已保留，请重新核对") : response.response?.data?.message ?? (error instanceof Error ? t(error.message) : t("保存失败，输入已保留")));
    } finally { if (mounted.current) setBusy(false); }
  };
  const loading = busy || preview.isFetching;
  return <>
    <UnsavedChangesGuard dirty={open && dirty} busy={busy} />
    <Button onClick={() => setOpen(true)}>{t("准备品类版本资料")}</Button>
    <Modal presentation="side" title={t("品类版本预备资料")} open={open} footer={null} width={960} mask={{ closable: false }} onCancel={() => guarded(() => setOpen(false))}>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Alert type="info" showIcon title={t("这里只保存候选资料，不切换品类版本、不修改当前价格与规则。正式采用尚未开放。")} />
        <Select aria-label={t("版本操作")} disabled={busy} value={operation} options={[{ value: "upgrade", label: t("升级") }, { value: "restore", label: t("恢复旧版") }]} onChange={(next) => guarded(() => { setOperation(next); setTargetId(undefined); setEntityId(undefined); })} />
        <QueryState loading={candidates.isLoading} error={candidates.error}>
          <Select aria-label={t("目标版本")} placeholder={t("选择目标版本")} disabled={busy} value={targetId} showSearch={{ optionFilterProp: "label" }} options={candidates.data?.versions.map((row) => ({ value: row.id, label: `${row.versionLabel}${row.definitionExecutable ? "" : ` · ${row.unavailableReason ?? t("无法执行")}`}`, disabled: !row.definitionExecutable }))} onChange={(next) => guarded(() => { setTargetId(next); setEntityId(undefined); })} style={{ width: "100%" }} />
          {candidates.data?.versions.length === 0 && <Typography.Text type="secondary">{t("暂无获授权的目标版本")}</Typography.Text>}
        </QueryState>
        {targetId && <QueryState loading={preview.isLoading} error={preview.error}>
          {preview.data && <>
            {(!preview.data.validation.valid || preview.data.stale) && <Alert type="warning" showIcon title={t("预备资料需补齐或重新核对")} description={preview.data.validation.errors.join("；")} />}
            {!preview.data.businessCompatibility.valid && <Alert type="warning" showIcon title={t("经营配置尚不兼容目标版本")} description={preview.data.businessCompatibility.blockers.map((row) => `${row.id}: ${row.message}`).join("；")} />}
            <Tabs className="standalone-tabs" activeKey={tab} items={[{ key: "item_group", label: t("型号资料") }, { key: "asset", label: t("资产资料") }, { key: "capabilities", label: t("能力配置") }]} onChange={(key) => { setTab(key); if (key !== "capabilities") setScope(key as typeof scope); setEntityId(undefined); }} />
            <ContentTransition value={tab}>{tab === "capabilities" ? <>
              <Typography.Text type="secondary">{t("准备配置不会改变当前营业；新增必选能力须明确选择准备启用，仅在采用成功时生效。")}</Typography.Text>
              {preparationCapabilityDefinitions(preview.data).map((definition) => {
                const draft = capabilityDrafts[definition.code];
                const current = preview.data!.entities.capabilities?.find((row) => row.code === definition.code);
                const newCapability = draft?.intent === "enable_new";
                const changeConfig = (key: string, value: string | number | boolean | undefined) => {
                  if (!draft) return;
                  setCapabilityDrafts((previous) => ({ ...previous, [definition.code]: { ...draft, fields: { ...draft.fields, [key]: value ?? "" } } }));
                  setDirty(true);
                };
                return <Space key={definition.code} orientation="vertical" style={{ width: "100%" }}>
                  <Typography.Text strong>{t(definition.label)} · {draft?.expectedImplementationVersion} · r{draft?.expectedRevision}</Typography.Text>
                  {draft && current && (newCapability || draft.expectedRevision !== current.revision || draft.expectedImplementationVersion !== current.implementationVersion) && <Alert type="warning" showIcon title={t("来源或准备修订已变化，输入已保留，请重新核对")} />}
                  {newCapability && <Button disabled={loading} onClick={() => {
                    setCapabilityDrafts((previous) => ({ ...previous, [definition.code]: { ...draft, selected: !draft.selected } })); setDirty(true);
                  }}>{t(draft.selected ? "取消准备启用" : "准备启用新增必选能力")}</Button>}
                  {newCapability && <Typography.Text type="secondary">{t(draft.selected ? "已选择准备启用，保存不立即启用" : "尚未选择准备启用")}</Typography.Text>}
                  {definition.configSchema.map((field) => {
                    const value = draft?.fields[field.key]; const label = `${t(field.label)}${field.required ? " *" : ""}`;
                    return <Space key={field.key} orientation="vertical" style={{ width: "100%" }}>
                      <Typography.Text>{label}</Typography.Text>
                      {field.type === "number" ? <InputNumber aria-label={label} disabled={loading || !draft} min={field.min} max={field.max} value={typeof value === "number" ? value : null} onChange={(next) => changeConfig(field.key, next ?? undefined)} />
                        : field.type === "boolean" ? <Select aria-label={label} disabled={loading || !draft} allowClear value={typeof value === "boolean" ? String(value) : undefined} options={[{ value: "true", label: t("是") }, { value: "false", label: t("否") }]} onChange={(next) => changeConfig(field.key, next === undefined ? undefined : next === "true")} />
                          : field.type === "enum" ? <Select aria-label={label} disabled={loading || !draft} allowClear value={typeof value === "string" && value ? value : undefined} options={field.options?.map((option) => ({ value: option, label: t(option) }))} onChange={(next) => changeConfig(field.key, next)} />
                            : field.type === "compatibility_relations" ? <Input.TextArea aria-label={label} disabled={loading || !draft} rows={8} maxLength={200000} value={typeof value === "string" ? value : ""} onChange={(event) => changeConfig(field.key, event.target.value)} />
                              : <Input aria-label={label} disabled={loading || !draft} value={typeof value === "string" ? value : ""} onChange={(event) => changeConfig(field.key, event.target.value)} />}
                      {field.description && <Typography.Text type="secondary">{t(field.description)}</Typography.Text>}
                    </Space>;
                  })}
                  {current && <Button disabled={loading} onClick={() => modal.confirm({ title: t("放弃未保存的预备资料？"), onOk: () => {
                    const fresh = initialCapabilityDrafts({ ...preview.data!, preparation: null }, operation)[definition.code];
                    setCapabilityDrafts((previous) => ({ ...previous, [definition.code]: fresh })); setDirty(true);
                  } })}>{t("使用当前活动配置重新准备")}</Button>}
                </Space>;
              })}
              {!preparationCapabilityDefinitions(preview.data).length && <Typography.Text type="secondary">{t("暂无需要准备的资料")}</Typography.Text>}
            </> : <>
            <Select aria-label={t("选择待准备的资料")} value={entity?.id} disabled={loading} showSearch={{ optionFilterProp: "label" }} options={rows.map((row) => ({ value: row.id, label: row.name ?? row.assetNo ?? row.id }))} onChange={setEntityId} style={{ width: "100%" }} />
            {entity && fields.map((field) => {
              const value = values[preparationEntityKey(scope, entity.id)]?.[field.code];
              const label = `${field.label}${field.required ? " *" : ""}${field.unit ? ` (${field.unit})` : ""}`;
              return <Space key={`${entity.id}:${field.code}`} orientation="vertical" style={{ width: "100%" }}>
                <Typography.Text>{label}</Typography.Text>
                {field.type === "number" ? <InputNumber aria-label={label} disabled={loading} value={typeof value === "number" ? value : null} onChange={(next) => change(field.code, next ?? "")} />
                  : field.type === "boolean" ? <Select aria-label={label} disabled={loading} value={typeof value === "boolean" ? String(value) : undefined} options={[{ value: "true", label: t("是") }, { value: "false", label: t("否") }]} onChange={(next) => change(field.code, next === "true")} />
                    : field.type === "select" ? <Select aria-label={label} disabled={loading} value={typeof value === "string" && value ? value : undefined} allowClear options={field.options?.map((option) => ({ value: option, label: option }))} onChange={(next) => change(field.code, next ?? "")} style={{ width: "100%" }} />
                      : <Input aria-label={label} disabled={loading} type={field.type === "date" ? "date" : "text"} value={typeof value === "string" ? value : ""} onChange={(event) => change(field.code, event.target.value)} />}
              </Space>;
            })}
            {!rows.length && <Typography.Text type="secondary">{t("暂无需要准备的资料")}</Typography.Text>}
            </>}</ContentTransition>
            <Input.TextArea aria-label={t("准备原因")} placeholder={t("准备原因")} value={reason} maxLength={512} disabled={loading} onChange={(event) => { setReason(event.target.value); setDirty(true); }} />
            <Space wrap>
              <Button disabled={loading} onClick={() => guarded(() => { void preview.refetch(); })}>{t("重新读取并核对")}</Button>
              <Button type="primary" loading={busy} disabled={preview.isFetching || !reason.trim()} onClick={save}>{t("保存预备资料")}</Button>
            </Space>
          </>}
        </QueryState>}
      </Space>
    </Modal>
  </>;
}
