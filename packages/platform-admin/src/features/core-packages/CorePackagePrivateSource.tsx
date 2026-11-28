/** SaaS 私有来源与固定发行表单，凭据仅作一次提交，不进入查询缓存、表单快照或原结果指针。
 * 保存失应答须重新读取修订；固定发行继续由原选择和候选侧栏办理。 */
import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GitHubCoreReleasePin } from "@rental-os/core-contracts/github";
import type { CorePackageSourceSettings, CorePackageSourceSettingsRequest } from "@rental-os/platform-core-host/core-package-source-protocol";
import { ActionButton, Alert, ConfirmAction, Form, Input, ListSection, SaveButton, Switch } from "../../components/ui";
import { QueryState } from "../../shell";
import { useLocale } from "../../app/locale";
import type { CorePackagesApi } from "./client";

function SourceForm({ api, current, updated, blocked, signal }: { api: CorePackagesApi; current: CorePackageSourceSettings;
  updated: (value: CorePackageSourceSettings) => void; blocked: boolean; signal: () => AbortSignal }) {
  const { locale } = useLocale(), en = locale === "en-US";
  const [form] = Form.useForm<{ enabled: boolean; repositories: string }>();
  const [secret, setSecret] = useState(""), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const working = useRef(false);
  const save = async (value: CorePackageSourceSettingsRequest) => {
    const boundary = signal();
    if (working.current || blocked || boundary.aborted || uncertain) throw new Error(en ? "Refresh the configuration first" : "请先重新读取配置");
    working.current = true; setBusy(true); setSecret("");
    try { const result = await api.savePrivateSource(value, boundary); if (!boundary.aborted) updated(result); return result; }
    catch { if (!boundary.aborted) setUncertain(true); throw new Error(en ? "Read the current revision before continuing" : "请先读取当前修订再继续"); }
    finally { working.current = false; if (!boundary.aborted) setBusy(false); }
  };
  return <ListSection title={en ? "GitHub private source" : "GitHub 私有来源"}>
    <p>{current.credentialConfigured ? en ? "Credential configured; never returned." : "凭据已配置，保存后不回显。"
      : en ? "No usable credential configured." : "尚无可用凭据。"}</p>
    {uncertain && <Alert type="warning" title={en ? "Save result needs confirmation. Refresh before another change." : "保存结果待核对，请刷新后再修改。"} />}
    <Form form={form} layout="vertical" autoComplete="off" preserve={false} clearOnDestroy
      disabled={blocked || busy || uncertain} initialValues={{ enabled: current.enabled, repositories: current.repositories.join("\n") }}>
      <Form.Item name="enabled" label={en ? "Allow private package acquisition" : "允许获取私有包"} valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="repositories" label={en ? "Allowed repositories, one HTTPS URL per line" : "允许仓库，每行一个 HTTPS 地址"}>
        <Input.TextArea rows={3} maxLength={24000} placeholder="https://github.com/owner/repository" />
      </Form.Item>
      <Form.Item label={en ? "New token (blank keeps current credential)" : "新凭据（留空保留原值）"}>
        <Input.Password value={secret} maxLength={512} autoComplete="new-password" onChange={event => setSecret(event.target.value)} />
      </Form.Item>
      <SaveButton form={form} label={en ? "Save source" : "保存来源"} pending={busy} disabled={blocked || uncertain}
        onSave={values => save({ expectedRevision: current.revision, enabled: values.enabled,
          repositories: (values.repositories ?? "").split(/\r?\n/).map(value => value.trim()).filter(Boolean),
          ...(secret ? { token: secret } : {}) })} />
    </Form>
    <ConfirmAction label={en ? "Revoke credential" : "撤销凭据"} tone="danger"
      prompt={en ? "Stop new private acquisitions? Installed running rights stay unchanged." : "停止新的私有获取？已安装运行权保持原授权。"}
      disabled={blocked || busy || uncertain || !current.credentialConfigured}
      onConfirm={() => save({ expectedRevision: current.revision, enabled: false, repositories: current.repositories, revokeToken: true })} />
  </ListSection>;
}

export function CorePackagePrivateSource({ api, epoch, blocked, onSelect }: {
  api: CorePackagesApi; epoch: number; blocked: boolean; onSelect: (release: GitHubCoreReleasePin) => void;
}) {
  const { locale } = useLocale(), en = locale === "en-US", client = useQueryClient();
  const lifetime = useRef<AbortController | null>(null);
  const queryKey = ["core-packages", epoch, "private-source"] as const;
  const query = useQuery({ queryKey, queryFn: ({ signal }) => api.privateSource(signal), retry: false,
    refetchOnWindowFocus: false, meta: { liveRefresh: false } });
  const [form] = Form.useForm<{ repository: string; coreId: string; version: string; tag?: string }>();
  const [error, setError] = useState<string>();
  useLayoutEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => { controller.abort(); client.removeQueries({ queryKey: ["core-packages", epoch, "private-source"], exact: true }); };
  }, [client, epoch]);
  const signal = () => {
    if (!lifetime.current || lifetime.current.signal.aborted) throw new DOMException("原私有来源页面已失效", "AbortError");
    return lifetime.current.signal;
  };
  const refresh = async () => { const result = await query.refetch(); if (result.isError) throw result.error; return result; };
  return <>
    <ActionButton label={en ? "Refresh private source" : "刷新私有来源"} intent="refresh" pending={query.isFetching} onAction={refresh} />
    <QueryState loading={query.isPending} error={query.error} onRetry={refresh}>
      {query.data && <SourceForm key={`${query.data.revision}:${query.dataUpdatedAt}`} api={api} current={query.data}
        blocked={blocked || query.isFetching} signal={signal} updated={value => client.setQueryData(queryKey, value)} />}
    </QueryState>
    <ListSection title={en ? "Select a fixed private release" : "选择固定私有发行"}>
      <p>{en ? "Enter a repository allowed above. Private metadata is excluded from public discovery." : "填写上方允许的仓库。私有资料不进入公开发现。"}</p>
      {error && <Alert type="error" title={error} />}
      <Form form={form} layout="vertical" preserve={false} clearOnDestroy disabled={blocked || !query.data?.enabled}>
        <Form.Item name="repository" label={en ? "Repository" : "仓库"} rules={[{ required: true }]}><Input maxLength={240} /></Form.Item>
        <Form.Item name="coreId" label="Core ID" rules={[{ required: true }]}><Input maxLength={80} /></Form.Item>
        <Form.Item name="version" label={en ? "Version" : "版本"} rules={[{ required: true }]}><Input maxLength={80} /></Form.Item>
        <Form.Item name="tag" label="Tag"><Input maxLength={160} placeholder="v<版本>" /></Form.Item>
        <ActionButton label={en ? "Inspect private release" : "核对私有发行"} intent="review" disabled={blocked || !query.data?.enabled}
          onAction={async () => {
            const boundary = signal(), values = await form.validateFields(); setError(undefined);
            try {
              const result = await api.previewRelease({ ...values, tag: values.tag || `v${values.version}`, visibility: "private" }, boundary);
              if (result.status === "unavailable") throw new Error(result.error.message);
              if (!boundary.aborted) onSelect(result.release);
            } catch { if (!boundary.aborted) setError(en ? "Private release unavailable. Check source access and fixed version." : "私有发行不可用，请核对来源权限与固定版本。");
              throw new Error(en ? "Private release unavailable" : "私有发行不可用"); }
          }} />
      </Form>
    </ListSection>
  </>;
}
