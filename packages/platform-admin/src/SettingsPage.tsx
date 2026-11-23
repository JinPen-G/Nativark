/** 公共设置只调用原 API，保留草稿/并发修订和原保存 Promise。业务设置由各 Core 自行贡献。 */
import { AppearancePage } from "./features/appearance";
import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AccountAppearanceProfile, PlatformTenantSummary, SavePlatformSelfProfileRequest,
  SaveTenantAppearanceRequest, SystemUserRow, TenantAppearanceProfile, UpdateTenantRequest } from "@rental-os/platform-contracts";
import { Alert, ColorPicker, ConfirmAction, Form, Input, SaveButton } from "./components/ui";
import { PageHeading, QueryState, useServerFormSync } from "./shell";
import { UnsavedChangesGuard } from "./core";
import { useLocale } from "./app/locale";
import { formSnapshotFingerprint, notifyFormSaved } from "./forms";
import { usePlatformApplication } from "./application-context";

function SettingsEditor<Values extends object>({ path, title, fields, project, payload }: {
  path: string; title: string; fields: ReactNode; project: (response: unknown) => Values;
  payload?: (values: Values) => unknown;
}) {
  const { session, brandName } = usePlatformApplication();
  const { locale } = useLocale(), english = locale === "en-US";
  const [form] = Form.useForm<Values>();
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false), [reload, setReload] = useState(0);
  const pending = useRef<Promise<unknown> | null>(null), baseline = useRef("");
  const key = ["public-settings", session.currentSessionEpoch(), path];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => session.runtime.request<unknown>(path, { signal }) });
  const current = useServerFormSync(form, query.data, () => {
    if (query.data === undefined) return;
    form.setFieldsValue(project(query.data)); baseline.current = formSnapshotFingerprint(form.getFieldsValue(true)); setDirty(false);
  }, `${path}:${reload}`);
  function save(values: Values) {
    if (pending.current) return pending.current;
    if (error) return Promise.reject(new Error(english ? "Read the original settings before saving again." : "请先重新读取原设置核对。"));
    if (!current()) return Promise.reject(new Error(english ? "Settings changed. Reload before saving." : "服务端设置已变化，请重新核对后保存。"));
    setBusy(true);
    const submitted = formSnapshotFingerprint(form.getFieldsValue(true));
    const promise = session.runtime.request<unknown>(path, { method: "put", data: payload ? payload(values) : values, retryAuthentication: false })
      .then(async result => {
        baseline.current = submitted;
        setDirty(formSnapshotFingerprint(form.getFieldsValue(true)) !== submitted);
        notifyFormSaved(form, submitted);
        session.queryClient.setQueryData(key, result);
        await session.bootstrap();
        return result;
      }).catch(failure => { setError(true); throw failure; }).finally(() => { pending.current = null; setBusy(false); });
    pending.current = promise; return promise;
  }
  return <Form form={form} layout="vertical" requiredMark={false} disabled={busy}
    onValuesChange={() => setDirty(formSnapshotFingerprint(form.getFieldsValue(true)) !== baseline.current)}
    onFinish={values => { void save(values).catch(() => undefined); }}>
    <PageHeading brandName={brandName} title={title} extra={<>
      <ConfirmAction label={english ? "Reload" : "重新读取"} prompt={english ? "Discard the local draft and load current settings?" : "放弃本地草稿，重新读取当前设置？"}
        disabled={busy} onConfirm={async () => {
          const result = await query.refetch(); if (result.isError) throw result.error;
          setError(false); setReload(value => value + 1);
        }} />
      <SaveButton form={form} label={english ? "Save" : "保存"}
        onSave={save} pending={busy} disabled={query.data === undefined || Boolean(query.error) || error} />
    </>} />
    <QueryState loading={query.isPending} error={query.error} onRetry={query.refetch}>
      {error && <Alert type="error" showIcon title={english ? "Save failed. Your draft is preserved. Reload the original settings before trying again." : "保存未确认，草稿已保留。请重新读取原设置核对后再操作。"} />}
      {fields}
    </QueryState>
    <UnsavedChangesGuard dirty={dirty} busy={busy} />
  </Form>;
}

export function SelfProfilePage() {
  const { locale } = useLocale(), en = locale === "en-US";
  return <SettingsEditor<SavePlatformSelfProfileRequest> path="/platform/self-profile" title={en ? "My profile" : "本人资料"}
    project={value => { const row = value as SystemUserRow; return { displayName: row.displayName, phone: row.phone ?? "" }; }}
    fields={<><Form.Item name="displayName" label={en ? "Name" : "姓名"} rules={[{ required: true }, { max: 80 }]}><Input /></Form.Item>
      <Form.Item name="phone" label={en ? "Phone" : "电话"}><Input autoComplete="tel" /></Form.Item></>} />;
}

export const AccountAppearancePage = AppearancePage;

export function TenantProfilePage() {
  const { locale } = useLocale(), en = locale === "en-US";
  return <SettingsEditor<UpdateTenantRequest> path="/platform/tenant" title={en ? "Tenant details" : "租户资料"}
    project={value => ({ tenantName: (value as PlatformTenantSummary).tenantName })}
    fields={<Form.Item name="tenantName" label={en ? "Tenant name" : "租户名称"} rules={[{ required: true }, { max: 80 }]}><Input /></Form.Item>} />;
}

export function TenantAppearancePage() {
  const { locale } = useLocale(), en = locale === "en-US";
  return <SettingsEditor<SaveTenantAppearanceRequest> path="/platform/appearance" title={en ? "Tenant appearance" : "租户外观"}
    project={value => { const row = value as TenantAppearanceProfile; return {
      expectedRevision: row.revision, brandName: row.brandName ?? ""
    }; }}
    fields={<><Form.Item name="expectedRevision" hidden><Input type="hidden" /></Form.Item>
      <Form.Item name="brandName" label={en ? "Brand name" : "品牌名称"}><Input /></Form.Item></>} />;
}
