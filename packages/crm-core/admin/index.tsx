/** CRM 配置贡献只消费正式平台出口。首次绑定权限由公共服务核定；日常设置沿 CRM 权限。
 * 浏览器仅持久化原操作编号，身份/范围变化后旧请求不得更新新页，未知结果只读核对。 */
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import { Alert, CorePage, Form, Input, QueryState, Select, UnsavedChangesGuard,
  useCoreBinding, useCoreForm, useCorePageHost, useCoreRequest, useLocale, type CoreAdminPageAction } from "@rental-os/platform-admin/core";
import { FormSection } from "@rental-os/platform-admin/ui";
import { useAdminSession } from "@rental-os/platform-admin/runtime";
import { clearSettingsReference, readSettingsReference, retainSettingsReference } from "@rental-os/platform-admin/forms";
import { CRM_CORE_ID, CRM_CORE_VERSION, CrmConfigurationSchema, CrmCurrencySchema, CrmIdSchema,
  CrmReceiptLookupSchema, CrmSettingsInputSchema, CrmSettingsReceiptSchema, CrmTimeZoneSchema,
  UpdateCrmSettingsSchema, initialCrmPipeline, type CrmSettingsInput } from "@rental-os/crm-core/contracts";

const manage = [{ resource: "settings", action: "manage" }];
type Reference = { operationId: string };
const parseReference = (input: unknown): Reference | null => {
  if (!input || typeof input !== "object" || Object.keys(input).length !== 1 || !("operationId" in input)) return null;
  const parsed = CrmIdSchema.safeParse(input.operationId);
  return parsed.success ? { operationId: parsed.data } : null;
};
const storage = () => { try { return window.localStorage; } catch { return undefined; } };
/** 未取得收据、身份请求中止、500 及原键冲突都不证明原操作未提交。 */
function rejectedBeforeCommit(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { code?: string } } } | undefined)?.response;
  return response?.status === 400 && response.data?.code === "input_invalid"
    || response?.status === 403 && response.data?.code === "denied"
    || response?.status === 409 && ["revision_conflict", "not_initialized"].includes(response.data?.code ?? "");
}

function SettingsFields({ disabled }: { disabled: boolean }) {
  const { locale } = useLocale(), english = locale === "en-US";
  return <>
    <Form.Item name="timeZone" label={english ? "Business time zone" : "业务时区"}
      rules={[{ required: true }, { validator: (_rule, value: unknown) => CrmTimeZoneSchema.safeParse(value).success
        ? Promise.resolve() : Promise.reject(new Error(english ? "Enter a valid IANA time zone" : "请输入有效的 IANA 时区")) }]}>
      <Input disabled={disabled} placeholder="Asia/Shanghai" maxLength={80} />
    </Form.Item>
    <Form.Item name="defaultCurrency" label={english ? "Default currency" : "默认币种"} rules={[{ required: true }]}>
      <Select disabled={disabled} options={CrmCurrencySchema.options.map(value => ({ value, label: value }))} />
    </Form.Item>
  </>;
}

export function CrmSetupPage() {
  const host = useCorePageHost(), { tenant, user } = useAdminSession();
  // 仅身份/已登记页面代次变化才重置；输入、查询刷新及语言切换不重挂表单。
  return <CrmSetupContent key={JSON.stringify([host.lifetimeKey, tenant?.tenantId, user?.id])} tenantId={tenant?.tenantId} userId={user?.id} />;
}

function CrmSetupContent({ tenantId, userId }: { tenantId?: string; userId?: string }) {
  const binding = useCoreBinding(CRM_CORE_ID), host = useCorePageHost(), { locale } = useLocale();
  const [form] = Form.useForm<CrmSettingsInput>();
  const text = (zh: string, en: string) => locale === "en-US" ? en : zh;
  const editor = useCoreForm({ form, onSave: values => binding.initialize(CrmSettingsInputSchema.parse(values)),
    disabled: !binding.canInitialize || binding.busy || binding.loading || Boolean(binding.error || binding.original || host.binding) });
  if (host.binding && !binding.original) {
    if (!host.canAccess(CRM_CORE_ID, manage)) return <CorePage><Alert type="info"
      title={text("CRM 首次设置已完成", "CRM setup is complete")}
      description={text("日常配置需要 CRM 配置管理权限。", "CRM settings management permission is required to edit configuration.")} /></CorePage>;
    if (!tenantId || !userId) return <CorePage><Alert type="error" title={text("当前身份尚未确认", "The current identity is unavailable")} /></CorePage>;
    return <CrmSettingsPage tenantId={tenantId} userId={userId} />;
  }
  const actions: CoreAdminPageAction<CrmSettingsInput>[] = [];
  if (binding.original && binding.canManage) actions.push({ id: "reconcile-setup", kind: "command", intent: "review",
    emphasis: "primary", label: text("核对原设置", "Read original setup"), disabled: binding.busy, execute: binding.reconcile });
  else if (binding.canInitialize) actions.push({ id: "initialize", kind: "save", emphasis: "primary", form,
    label: text("完成 CRM 设置", "Complete CRM setup"), onSave: editor.submit,
    disabled: editor.busy || binding.busy || binding.loading || Boolean(binding.error) });
  return <Form form={form} layout="vertical" initialValues={{ timeZone: "Asia/Shanghai", defaultCurrency: "CNY" }} {...editor.formProps}>
    <UnsavedChangesGuard dirty={editor.dirty || Boolean(binding.original)} busy={editor.busy || binding.busy} />
    <CorePage<CrmSettingsInput> actions={actions}>
      <QueryState loading={binding.loading} error={binding.error} onRetry={binding.refetch}>
        {!binding.canManage ? <Alert type="info" title={text("请联系租户管理员完成 CRM 设置", "Ask your tenant administrator to complete CRM setup")}
          description={text("管理员需先取得自己的 CRM 成员分配，再完成首次设置。", "The administrator must first receive their own CRM member assignment.")} />
          : <FormSection title={text("基础配置", "Basic configuration")}
            description={text("业务日期按此时区记录；默认币种用于新建销售记录。", "Business dates use this time zone. New sales records use the default currency.")}>
            <SettingsFields disabled={editor.busy || binding.busy || Boolean(binding.original)} />
            <p>{text("初始销售流程", "Initial sales pipeline")}：{initialCrmPipeline().stages.map(stage => stage.name).join(" → ")}</p>
          </FormSection>}
      </QueryState>
      {binding.original && <Alert type="warning" title={text("首次设置结果待核对", "The original setup needs confirmation")}
        description={`${text("请核对原操作，暂未取得收据不表示可以重新提交。编号", "Read the original operation before any new submission. Reference")} ${binding.original.operationId}`} />}
      {!binding.original && binding.failure === "rejected" && <Alert type="error"
        title={text("设置被拒绝，请核对当前权限和状态", "Setup was rejected. Check your current access and state")} />}
    </CorePage>
  </Form>;
}

function CrmSettingsPage({ tenantId, userId }: { tenantId: string; userId: string }) {
  const { request, queryKey } = useCoreRequest(), client = useQueryClient(), { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en-US" ? en : zh;
  const [form] = Form.useForm<CrmSettingsInput>();
  const journalKey = JSON.stringify(["core-operation", tenantId, userId, CRM_CORE_ID, "settings.update"]);
  const [journal, setJournal] = useState(() => readSettingsReference(storage(), journalKey, parseReference));
  const original = useRef(journal.pending), active = useRef(false);
  const [reconciling, setReconciling] = useState(false), [confirmed, setConfirmed] = useState(false), [rejected, setRejected] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const hydrated = useRef<number | undefined>(undefined);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const loadJournal = () => {
    const next = readSettingsReference(storage(), journalKey, parseReference);
    original.current = next.pending; setJournal(next); return next;
  };
  useEffect(() => {
    const synchronize = (event: StorageEvent) => { if (event.key === journalKey || event.key === null) loadJournal(); };
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, [journalKey]);
  const query = useQuery({ queryKey: [...queryKey, "settings"], queryFn: async ({ signal }) => {
    const value = CrmConfigurationSchema.parse(await request("/settings", { signal }));
    if (value.settings.tenantId !== tenantId) throw new Error("CRM configuration belongs to another tenant");
    return value;
  }, retry: false, refetchOnWindowFocus: false, meta: { liveRefresh: false } });
  const refresh = async () => {
    const result = await query.refetch();
    if (result.isError) throw result.error;
    return result;
  };
  const clear = (reference: Reference) => {
    clearSettingsReference(storage(), journalKey, reference);
    original.current = null; setJournal({ pending: null, blocked: false });
  };
  const save = async (values: CrmSettingsInput) => {
    if (!navigator.locks) throw new Error(text("当前浏览器无法安全保存，请使用支持 Web Locks 的浏览器。", "Saving requires a browser with Web Locks support."));
    return navigator.locks.request(journalKey, { ifAvailable: true }, async lock => {
      if (!lock || !active.current) throw new Error(text("配置正在另一页面处理，请先核对。", "Settings are being processed in another page."));
      const saved = loadJournal();
      if (saved.blocked || saved.pending || !query.data || query.error || query.isFetching || hydrated.current === undefined)
        throw new Error(text("请先读取当前配置并核对原操作。", "Read the current configuration and resolve the original operation first."));
      const input = UpdateCrmSettingsSchema.parse({ ...values, operationId: crypto.randomUUID(), expectedRevision: hydrated.current });
      const reference = { operationId: input.operationId };
      // 在派发前保存最小引用；跨标签页同一意图在 Web Lock 内核对，不保存表单或凭据。
      retainSettingsReference(storage(), journalKey, reference);
      original.current = reference; setJournal({ pending: reference, blocked: false });
      setConfirmed(false); setRejected(false); setFailure(undefined);
      let receipt;
      try {
        receipt = CrmSettingsReceiptSchema.parse(await request("/settings", { method: "post", data: input, retryAuthentication: false }));
        if (receipt.operationId !== reference.operationId || receipt.settings.tenantId !== tenantId || receipt.settings.updatedBy !== userId)
          throw new Error("CRM receipt does not match the original operation");
      } catch (error) {
        if (active.current) {
          if (rejectedBeforeCommit(error)) { clear(reference); setRejected(true); }
          else loadJournal();
        }
        throw error;
      }
      setConfirmed(true);
      clear(reference);
      hydrated.current = receipt.settings.revision;
      // 后续读取失败不重新定义已确认写入为 unknown，也不重发保存。
      try { await client.invalidateQueries({ queryKey, refetchType: "none" }); await refresh(); }
      catch (error) { if (active.current) setFailure(error); }
      return receipt;
    });
  };
  const blocked = journal.blocked || Boolean(journal.pending) || reconciling || query.isFetching || Boolean(query.error);
  const editor = useCoreForm({ form, onSave: save, permissions: manage, disabled: blocked });
  useEffect(() => {
    if (!query.data || query.error || editor.dirty || editor.busy || journal.pending || hydrated.current === query.data.settings.revision) return;
    hydrated.current = query.data.settings.revision;
    form.setFieldsValue(CrmSettingsInputSchema.parse({ timeZone: query.data.settings.timeZone, defaultCurrency: query.data.settings.defaultCurrency }));
    editor.markClean();
  }, [query.data, query.error, editor.dirty, editor.busy, journal.pending]);
  const reconcile = async () => {
    const reference = original.current;
    if (!reference) throw new Error(text("没有原操作可核对。", "There is no original operation to reconcile."));
    setReconciling(true); setFailure(undefined);
    try {
      const result = CrmReceiptLookupSchema.parse(await request(`/operations/${encodeURIComponent(reference.operationId)}`));
      if (result.status !== "recorded") throw new Error(text("原收据暂不可用，请保留编号稍后核对。", "The original receipt is unavailable. Keep the reference and check again later."));
      const receipt = result.receipt;
      if (receipt.operationId !== reference.operationId || receipt.settings.tenantId !== tenantId || receipt.settings.updatedBy !== userId)
        throw new Error("CRM receipt does not match the original operation");
      clear(reference); setConfirmed(true);
      form.setFieldsValue({ timeZone: receipt.settings.timeZone, defaultCurrency: receipt.settings.defaultCurrency });
      hydrated.current = receipt.settings.revision;
      editor.markClean();
      // 核对成功后另读当前修订；可能已有其他管理员更新，旧收据不是当前配置。
      try { await refresh(); } catch (error) { setFailure(error); }
      return receipt;
    } catch (error) { if (active.current) setFailure(error); throw error; }
    finally { if (active.current) setReconciling(false); }
  };
  const reload = async () => {
    loadJournal();
    const result = await refresh();
    if (result.data && !original.current) {
      form.setFieldsValue({ timeZone: result.data.settings.timeZone, defaultCurrency: result.data.settings.defaultCurrency });
      hydrated.current = result.data.settings.revision; editor.markClean(); setFailure(undefined);
    }
    return result;
  };
  const actions: CoreAdminPageAction<CrmSettingsInput>[] = [{ id: "refresh", kind: "command", intent: "review", permissions: manage,
    label: text("重新读取", "Reload"), disabled: editor.busy || reconciling,
    confirmation: editor.dirty ? text("放弃未保存的修改并读取当前配置？", "Discard unsaved changes and reload the current configuration?") : undefined,
    execute: reload }];
  if (journal.pending) actions.push({ id: "reconcile", kind: "command", intent: "review", permissions: manage, emphasis: "primary",
    label: text("核对原提交", "Read original submission"), disabled: editor.busy || reconciling, execute: reconcile });
  else actions.push({ id: "save", kind: "save", emphasis: "primary", permissions: manage, form, onSave: editor.submit,
    label: text("保存配置", "Save settings"), disabled: editor.busy || blocked || !query.data });
  return <Form form={form} layout="vertical" {...editor.formProps}>
    <UnsavedChangesGuard dirty={editor.dirty || Boolean(journal.pending)} busy={editor.busy || reconciling} />
    <CorePage<CrmSettingsInput> actions={actions}>
      {journal.blocked && <Alert type="error" title={text("无法读取原操作记录，已暂停保存", "Original operation storage is unavailable; saving is paused")}
        description={text("请恢复浏览器存储后重新读取；不要清除未核对的操作。", "Restore browser storage and reload. Do not remove unresolved operation records.")} />}
      {journal.pending && <Alert type="warning" title={text("保存结果待核对", "The save result needs confirmation")}
        description={`${text("刷新或重新进入后仍需先核对原提交。编号", "Resolve the original submission before saving again. Reference")} ${journal.pending.operationId}`} />}
      {confirmed && <Alert type="success" title={text("原保存已确认", "The save was confirmed")} />}
      {rejected && <Alert type="error" title={text("保存被拒绝，请核对输入、权限和当前修订", "Saving was rejected. Check input, access and the current revision")} />}
      {Boolean(editor.error) && !rejected && !journal.pending && <Alert type="error"
        title={text("保存未完成", "Settings could not be saved")}
        description={text("请确认浏览器支持安全存储与 Web Locks，并重新读取当前配置。", "Check that secure storage and Web Locks are available, then reload the current configuration.")} />}
      {Boolean(failure) && <Alert type="warning" title={text("未能完成读取，请稍后重新核对", "Reading could not complete. Try again later")} />}
      <QueryState loading={query.isPending} error={query.error} onRetry={refresh}>
        {query.data && <><FormSection title={text("基础配置", "Basic configuration")}
          description={text("变更只影响后续录入；已有金额、日期和关闭快照保持原依据。", "Changes apply to later input. Existing amounts, dates and closing snapshots retain their original basis.")}>
          <SettingsFields disabled={blocked || editor.busy} />
        </FormSection>
        <FormSection title={text("当前销售流程", "Current sales pipeline")}
          description={`${text("流程版本", "Pipeline version")} ${query.data.pipeline.version}`}>
          <ol>{query.data.pipeline.stages.map(stage => <li key={stage.id}>{stage.name} · {stage.probability}%</li>)}</ol>
        </FormSection></>}
      </QueryState>
    </CorePage>
  </Form>;
}

export function createCrmAdmin(): CoreAdminContribution<ComponentType> {
  return { coreId: CRM_CORE_ID, implementationVersion: CRM_CORE_VERSION, pages: [
    { id: "settings", path: "/settings", title: { default: "CRM 设置", translations: { "en-US": "CRM settings" } },
      purpose: "configuration", menu: { order: 10 }, permissions: [], component: CrmSetupPage }
  ] };
}
