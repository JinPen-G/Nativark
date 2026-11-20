/** SaaS Core 发现、实际注册目录和独立版本复用当前 AdminRuntime，品牌由宿主显式传入。
 * 未授权租户在挂载查询前拒绝。 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CoreRegisteredSummary } from "@rental-os/core-contracts";
import { GitHubCoreDiscoveryQuerySchema, type GitHubCoreDiscoveryPage } from "@rental-os/core-contracts/github-discovery";
import type { GitHubRepositoryCore } from "@rental-os/core-contracts/github-repository";
import type { GitHubCoreReleasePin } from "@rental-os/core-contracts/github";
import type { CorePackageAvailability, CorePackageCatalogue, CorePackageRepositoryRead } from "@rental-os/platform-core-host/core-package-ports";
import {
  ActionButton, Alert, Button, ContentTransition, DataTableStatus, DataTableText, Empty, ListFilterBar, ListFilterItem, ListSection, RecordFacts,
  Result, SearchField, Table, Tabs, type DataTableStatusTone
} from "../../components/ui";
import { PageHeading, QueryState } from "../../shell";
import { useLocale } from "../../app/locale";
import { isTransientRefreshError, useAdminRuntime, useAdminSession } from "../../runtime";
import { canManagePublicResource } from "../../application-access";
import { createCorePackagesApi } from "./client";
import { CorePackagePreparationDialog, type CorePackagePreparationTarget, type CorePackageUpdateTarget } from "./CorePackagePreparationDialog";
import { useCorePackagePreparation } from "./useCorePackagePreparation";

type PackageApi = ReturnType<typeof createCorePackagesApi>;
type VersionRow = {
  id: string; name: string; current: string | null; locked: string; contract: string; data: string;
  availability: CorePackageAvailability;
  update: CorePackageUpdateTarget;
};

function Availability({ value, en }: { value?: CorePackageAvailability; en: boolean }) {
  const ready = value?.status === "available";
  return <DataTableText primary={<DataTableStatus tone={ready ? "success" : "warning"}>
    {ready ? en ? "Ready" : "就绪" : en ? "Unavailable" : "不可用"}</DataTableStatus>}
    secondary={value?.status === "unavailable" ? value.issues.map(issue => issue.message).join(" · ")
      : !value ? en ? "Deployment evidence is missing" : "缺少部署证据" : undefined} />;
}

function Catalogue({ data, busy, refresh }: { data: CorePackageCatalogue; busy: boolean; refresh: () => Promise<unknown> }) {
  const { locale } = useLocale(), en = locale === "en-US";
  const versions = data.versions.status === "observed" ? data.versions.cores : [];
  return <ListSection>
    {data.versions.status === "unavailable" && <Alert type="warning" title={data.versions.error.message} />}
    <Table<CoreRegisteredSummary> rowKey="id" dataSource={data.registered} refreshing={busy} onRefresh={refresh}
      columns={[
        { key: "core", title: "Core", render: (_, core) => <DataTableText primary={core.name} secondary={core.id} /> },
        { dataIndex: "version", title: en ? "Registered version" : "注册版本" },
        { key: "source", title: en ? "Source" : "来源", render: (_, core) => <DataTableText primary={core.source.repository} secondary={core.source.commit} /> },
        { dataIndex: "license", title: en ? "License" : "许可" },
        { key: "installation", title: en ? "Package" : "实际包", render: (_, core) => {
          const version = versions.find(item => item.locked.manifest.id === core.id);
          return version?.current ? <DataTableText primary={en ? "Verified" : "已校验"} secondary={version.current.sha256} />
            : <DataTableStatus tone="warning">{en ? "Unverified" : "待核验"}</DataTableStatus>;
        } },
        { key: "availability", title: en ? "Availability" : "可用状态", render: (_, core) =>
          <Availability value={versions.find(item => item.locked.manifest.id === core.id)?.availability} en={en} /> }
      ]}
      locale={{ emptyText: <Empty description={en ? "No Core is registered in this deployment." : "当前部署尚未注册业务 Core。"} /> }} />
  </ListSection>;
}

function Versions({ data, busy, refresh, blocked, onPrepare }: {
  data: CorePackageCatalogue; busy: boolean; refresh: () => Promise<unknown>; blocked: boolean;
  onPrepare: (name: string, target: CorePackageUpdateTarget) => void;
}) {
  const { locale } = useLocale(), en = locale === "en-US";
  if (data.versions.status === "unavailable") return <Alert type="warning" title={data.versions.error.message}
    action={<ActionButton label={en ? "Refresh" : "刷新"} intent="refresh" pending={busy} onAction={refresh} />} />;
  const { platform, cores, dataCapabilities = [] } = data.versions;
  const rows: VersionRow[] = [{ id: "platform", name: en ? "Platform" : "底座", current: platform.current?.versions.platform ?? null,
    locked: platform.locked.versions.platform, contract: platform.locked.versions.contract,
    data: platform.locked.data.version, availability: platform.availability, update: { kind: "platform" as const } }, ...cores.map(core => ({
    id: `core:${core.locked.manifest.id}`, name: core.locked.manifest.name, current: core.current?.manifest.version ?? null,
    locked: core.locked.manifest.version,
    contract: `${core.locked.manifest.compatibility.contract.minInclusive} ≤ v < ${core.locked.manifest.compatibility.contract.maxExclusive}`,
    data: core.locked.manifest.data.version, availability: core.availability,
    update: { kind: "core" as const, coreId: core.locked.manifest.id }
  })), ...dataCapabilities.map(capability => ({
    id: `platform-capability:${capability.locked.id}`, name: en ? "Platform data capability" : "平台数据能力",
    current: capability.current?.version ?? null, locked: capability.locked.version,
    contract: `${capability.locked.compatibility.contract.minInclusive} ≤ v < ${capability.locked.compatibility.contract.maxExclusive}`,
    data: capability.locked.data.version, availability: capability.availability,
    update: { kind: "platform-capability" as const, capabilityId: capability.locked.id }
  }))];
  return <ListSection>
    <Table<VersionRow> rowKey="id" dataSource={rows} refreshing={busy} onRefresh={refresh} columns={[
      { key: "module", title: en ? "Module" : "模块", render: (_, row) => <DataTableText primary={row.name} secondary={row.id} /> },
      { key: "current", title: en ? "Actual package version" : "实际包版本", render: (_, row) => row.current ?? (en ? "Unavailable" : "不可用") },
      { dataIndex: "locked", title: en ? "Locked version" : "锁定版本" },
      { dataIndex: "contract", title: en ? "Contract version or range" : "合同版本或兼容范围" },
      { dataIndex: "data", title: en ? "Required data version" : "所需数据版本" },
      { key: "availability", title: en ? "Availability" : "可用状态", render: (_, row) => <Availability value={row.availability} en={en} /> },
      { key: "actions", title: en ? "Actions" : "操作", render: (_, row) => <Button disabled={busy || blocked}
        onClick={() => onPrepare(row.name, row.update)}>{en ? "Prepare update" : "准备更新"}</Button> }
    ]} />
  </ListSection>;
}

function RepositoryCore({ core, compatibility, en, blocked, onSelect }: {
  core: GitHubRepositoryCore;
  compatibility: Extract<CorePackageRepositoryRead, { status: "observed" }>["compatibility"][number] | undefined;
  en: boolean;
  blocked: boolean;
  onSelect: (release: GitHubCoreReleasePin) => void;
}) {
  const labels: Record<GitHubRepositoryCore["state"], { text: string; tone: DataTableStatusTone }> = {
    metadata_only: { text: en ? "Release unchecked" : "发行未核对", tone: "neutral" },
    release_available: { text: en ? "Release metadata pinned" : "发行元数据已固定", tone: "info" },
    source_only: { text: en ? "Source only" : "仅源码，发布包未就绪", tone: "warning" },
    invalid: { text: en ? "Invalid manifest" : "清单不符合要求", tone: "error" },
    unavailable: { text: en ? "Unavailable" : "不可用", tone: "warning" }
  };
  const state = labels[core.state], manifest = core.manifest;
  return <ListSection title={manifest?.name ?? core.manifestFile} extra={core.state === "release_available" && core.release
    ? <Button disabled={blocked} onClick={() => { if (core.release) onSelect(core.release); }}>{en ? "Select version" : "选择版本"}</Button> : undefined}>
    <RecordFacts items={[
      { key: "identity", label: "Core", value: manifest?.id ?? (en ? "Unidentified" : "未识别") },
      { key: "version", label: en ? "Version" : "版本", value: manifest?.version ?? (en ? "Unavailable" : "不可用") },
      { key: "license", label: en ? "License" : "许可", value: manifest?.license ?? (en ? "Unavailable" : "不可用") },
      { key: "review", label: en ? "Review" : "审核", value: <DataTableStatus tone="warning">{en ? "Unreviewed" : "未审核"}</DataTableStatus> },
      { key: "release", label: en ? "Release" : "发行", value: <DataTableStatus tone={state.tone}>{state.text}</DataTableStatus> },
      { key: "package", label: en ? "Package" : "发布包", value: en ? "Unchecked" : "未校验" },
      ...(manifest ? [
        { key: "platform", label: en ? "Platform range" : "底座兼容范围", value: `${manifest.compatibility.platform.minInclusive} ≤ v < ${manifest.compatibility.platform.maxExclusive}` },
        { key: "contract", label: en ? "Contract range" : "合同兼容范围", value: `${manifest.compatibility.contract.minInclusive} ≤ v < ${manifest.compatibility.contract.maxExclusive}` }
      ] : []),
      ...(core.release ? [
        { key: "commit", label: en ? "Release commit" : "发行提交", value: core.release.commit, wide: true },
        { key: "digest", label: en ? "Package SHA-256" : "包 SHA-256", value: core.release.sha256, wide: true }
      ] : [])
    ]} />
    {core.issues.map((issue, index) => <Alert key={`${issue.code}:${issue.field ?? ""}:${index}`} type="warning" title={issue.message} />)}
    {compatibility?.status === "checked" ? compatibility.issues.length
      ? <Alert type="warning" title={en ? "Declared requirements are incompatible" : "声明的前置条件不兼容"}
          description={compatibility.issues.map(issue => issue.message).join(" · ")} />
      : <p>{en ? "Declared version requirements match the current platform package." : "声明的版本前置与当前底座包匹配。"}</p>
      : <p>{en ? "Compatibility is unavailable without a verified current platform package." : "缺少当前底座包证据，兼容性不可用。"}</p>}
  </ListSection>;
}

function Repository({ api, repository, epoch, blocked, onSelect }: {
  api: PackageApi; repository: string; epoch: number; blocked: boolean; onSelect: (release: GitHubCoreReleasePin) => void;
}) {
  const { locale } = useLocale(), en = locale === "en-US";
  const query = useQuery({ queryKey: ["core-packages", epoch, "repository", repository],
    queryFn: ({ signal }) => api.repository({ repository, includeReleases: true }, signal),
    retry: false, refetchOnWindowFocus: false, meta: { liveRefresh: false } });
  const result = query.data;
  const refresh = async () => {
    const response = await query.refetch();
    if (response.isError) throw response.error;
    if (response.data?.status === "unavailable") throw new Error(response.data.error.message);
    return response;
  };
  return <ListSection title={repository} extra={<ActionButton label={en ? "Refresh repository" : "刷新仓库"}
    intent="refresh" pending={query.isFetching} onAction={refresh} />}>
    <QueryState loading={query.isPending} error={query.error} onRetry={refresh}>
      {result?.status === "unavailable" ? <Alert type="warning" title={result.error.message}
        action={<ActionButton label={en ? "Retry" : "重试"} intent="refresh" pending={query.isFetching} onAction={refresh} />} /> : result?.status === "observed" ? <>
        <RecordFacts items={[
          { key: "commit", label: en ? "Repository commit" : "仓库提交", value: result.inspection.commit, wide: true },
          { key: "checkedAt", label: en ? "Checked at" : "查询时间", value: result.inspection.checkedAt }
        ]} />
        {result.inspection.cores.map(core => <RepositoryCore key={core.manifestFile} core={core} en={en}
          blocked={blocked || query.isFetching} onSelect={onSelect}
          compatibility={result.compatibility.find(item => item.manifestFile === core.manifestFile)} />)}
        <p>{en ? "The package needs validation and deployment before registration, tenant access and business activation." : "发布包须经过校验和部署，随后办理注册、租户授权与业务启用。"}</p>
      </> : null}
    </QueryState>
  </ListSection>;
}

function Discovery({ api, epoch, blocked, onSelect }: {
  api: PackageApi; epoch: number; blocked: boolean; onSelect: (release: GitHubCoreReleasePin) => void;
}) {
  const { locale } = useLocale(), en = locale === "en-US";
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(""), [text, setText] = useState(""), [page, setPage] = useState(1);
  const [inputError, setInputError] = useState<string>();
  const [repositoryDraft, setRepositoryDraft] = useState("");
  const [repository, setRepository] = useState<string>();
  const query = useQuery({ queryKey: ["core-packages", epoch, "discover", text, page],
    queryFn: ({ signal }) => api.discover({ query: { text, page } }, signal),
    retry: false, refetchOnWindowFocus: false, meta: { liveRefresh: false } });
  const result = query.data;
  const blocking = query.error && !isTransientRefreshError(query.error);
  const source = blocking ? undefined : result?.status === "unavailable" ? result.stale : result?.page;
  const failed = Boolean(query.error) || result?.status === "unavailable";
  const refresh = async () => {
    const response = await queryClient.fetchQuery({ queryKey: ["core-packages", epoch, "discover", text, page],
      queryFn: ({ signal }) => api.discover({ query: { text, page }, refresh: true }, signal), staleTime: 0, retry: false,
      meta: { liveRefresh: false } });
    if (response.status === "unavailable") throw new Error(response.error.message);
    return response;
  };
  const search = (value: string) => {
    const parsed = GitHubCoreDiscoveryQuerySchema.safeParse({ text: value, page: 1 });
    if (!parsed.success) {
      setInputError(en ? "Use up to 80 letters, numbers, spaces, dots, underscores or hyphens."
        : "关键词须在80字符以内，使用文字、数字、空格或 . _ -");
      return;
    }
    setInputError(undefined);
    setText(parsed.data.text);
    setPage(1);
  };
  const selectRepository = (value: string) => {
    const selected = value.trim();
    setRepositoryDraft(selected);
    setRepository(selected || undefined);
  };
  const retry = <ActionButton label={en ? "Retry" : "重试"} intent="refresh" pending={query.isFetching} onAction={refresh} />;
  return <>
    <ListFilterBar>
      <ListFilterItem kind="search" width="search" label={en ? "GitHub repository URL" : "GitHub 仓库地址"}>
        <SearchField label={en ? "GitHub repository URL" : "GitHub 仓库地址"}
          placeholder="https://github.com/owner/repository"
          value={repositoryDraft} onValueChange={setRepositoryDraft} onSearch={selectRepository}
          onClear={() => selectRepository("")} />
      </ListFilterItem>
    </ListFilterBar>
    <ListSection controls={<ListFilterItem width="search" label={en ? "Core name or description" : "Core 名称或简介"}>
      <SearchField label={en ? "Core name or description" : "Core 名称或简介"}
        placeholder={en ? "Name or description, press Enter" : "名称或简介关键词，回车查询"}
        value={draft} onValueChange={setDraft} onSearch={search} onClear={() => search("")} />
    </ListFilterItem>}>
      {inputError && <Alert type="error" title={inputError} />}
      {source && result?.status === "unavailable" && <Alert type="warning" title={result.error.message}
        description={`${en ? "Previous query" : "原查询时间"} ${source.checkedAt}`} action={retry} />}
      {source && query.error && result?.status !== "unavailable" && <Alert type="warning"
        title={en ? "The previous query is shown. Retry to refresh it." : "当前显示原查询结果，请重试更新。"} action={retry} />}
      {source && (source.incomplete || source.total > 1000) && <Alert type="info"
        title={en ? "GitHub returned a limited result. Refine the keywords to continue." : "GitHub 返回结果受限，请缩小关键词后查询。"} />}
      <Table<GitHubCoreDiscoveryPage["repositories"][number]> rowKey="id" dataSource={source?.repositories ?? []}
          sorting={false} loading={query.isPending} refreshing={query.isFetching} onRefresh={refresh}
          toolbarNote={source && `${source.topic} · ${source.checkedAt} · ${failed ? en ? "Stale" : "已过期" : result?.status === "cached" ? en ? "Cached" : "缓存" : en ? "Queried" : "已查询"}`}
          pagination={source ? { current: source.query.page, pageSize: source.pageSize, total: Math.min(source.total, 1000), showSizeChanger: false,
            disabled: query.isFetching || failed, onChange: setPage } : false}
          columns={[
            { key: "repository", title: en ? "Repository" : "仓库", render: (_, row) => <DataTableText primary={row.name} secondary={row.description} /> },
            { key: "review", title: en ? "Review" : "审核", render: () => <DataTableStatus tone="warning">{en ? "Unreviewed" : "未审核"}</DataTableStatus> },
            { key: "license", title: en ? "License" : "许可", render: (_, row) => row.license ?? (en ? "Unavailable" : "不可用") },
            { key: "package", title: en ? "Package" : "发布包", render: () => en ? "Unchecked" : "未校验" },
            { key: "actions", title: en ? "Actions" : "操作", render: (_, row) => <Button disabled={query.isFetching || failed}
              onClick={() => selectRepository(row.repository)}>{en ? "View release" : "查看发行"}</Button> }
          ]} locale={{ emptyText: <QueryState loading={false} error={!source ? query.error : undefined} onRetry={refresh}>
            {!source && result?.status === "unavailable" && <Alert type="warning" title={result.error.message} action={retry} />}
            {!failed && <Empty description={en ? "No matching public repositories." : "没有匹配的公开仓库。"} />}
          </QueryState> }} />
    </ListSection>
    {repository && <Repository key={repository} api={api} repository={repository} epoch={epoch}
      blocked={blocked} onSelect={onSelect} />}
  </>;
}

function CorePackagesContent({ brandName }: { brandName: string }) {
  const runtime = useAdminRuntime(), { locale } = useLocale(), en = locale === "en-US";
  const [view, setView] = useState("catalogue"), epoch = runtime.currentSessionEpoch();
  const api = useMemo(() => createCorePackagesApi(runtime), [runtime]);
  const preparation = useCorePackagePreparation(api);
  const [dialog, setDialog] = useState<{ target: CorePackagePreparationTarget; open: boolean }>();
  const blocked = preparation.busy || Boolean(preparation.pending) || Boolean(preparation.storageError);
  const showPreparation = (target: CorePackagePreparationTarget) => {
    if (blocked) return;
    preparation.resetPreview();
    setDialog({ target, open: true });
  };
  const showReceipt = () => { if (!preparation.busy) setDialog({ target: { kind: "receipt" }, open: true }); };
  const catalogue = useQuery({ queryKey: ["core-packages", epoch, "catalogue"], queryFn: ({ signal }) => api.catalogue(signal),
    retry: false, refetchOnWindowFocus: false, meta: { liveRefresh: false } });
  const refresh = async () => {
    const result = await catalogue.refetch();
    if (result.isError) throw result.error;
    return result;
  };
  return <><PageHeading title={en ? "Core packages" : "Core 包管理"} brandName={brandName}
    extra={<Button disabled={blocked} onClick={() => showPreparation({ kind: "reference", name: en ? "Install local Core package" : "准备本地 Core 包" })}>
      {en ? "Use downloaded package" : "使用已下载包"}</Button>} />
    <Tabs activeKey={view} onChange={setView} items={[
      { key: "catalogue", label: en ? "Registered Cores" : "当前目录" },
      { key: "discover", label: en ? "Discover" : "发现 Core" },
      { key: "versions", label: en ? "Versions" : "独立版本" }
    ]} />
    {preparation.pending && <Alert type="warning" title={en ? "The original operation needs confirmation" : "原操作等待核对"}
      description={preparation.pending.kind === "release" ? preparation.pending.reference : preparation.pending.sha256}
      action={<ActionButton label={en ? "Read original result" : "核对原结果"} intent="review" pending={preparation.busy} onAction={preparation.reconcile} />} />}
    {preparation.storageError && <Alert type="warning" title={preparation.storageError} />}
    {preparation.error && !dialog?.open && <Alert type="error" title={preparation.error} />}
    {preparation.prepared && <Alert type="info" title={en ? "Candidate prepared, pending deployment" : "候选已准备，待部署"}
      description={preparation.prepared.sha256} action={<Button disabled={preparation.busy} onClick={showReceipt}>{en ? "View candidate" : "查看候选"}</Button>} />}
    {preparation.selected && !preparation.prepared && !dialog?.open && <Alert type="info"
      title={en ? "Release selection recorded" : "发行选择已保存"} description={preparation.selected.reference}
      action={<Button disabled={blocked} onClick={() => {
        const selected = preparation.selected;
        if (!selected) return;
        const installed = catalogue.data?.versions.status === "observed"
          && catalogue.data.versions.cores.some(core => core.locked.manifest.id === selected.release.coreId);
        showPreparation({ kind: "reference", name: selected.release.coreId, reference: selected.reference,
          update: installed ? { kind: "core", coreId: selected.release.coreId } : undefined });
      }}>{en ? "Continue preparation" : "继续准备"}</Button>} />}
    <ContentTransition value={view}>
    {view === "discover" ? <Discovery api={api} epoch={epoch} blocked={blocked}
      onSelect={release => showPreparation({ kind: "release", release })} /> : <QueryState loading={catalogue.isPending} error={catalogue.error}
      onRetry={refresh}>
      {catalogue.data && (view === "versions" ? <Versions data={catalogue.data} busy={catalogue.isFetching} refresh={refresh} blocked={blocked}
        onPrepare={(name, update) => showPreparation({ kind: "reference", name, update })} />
        : <Catalogue data={catalogue.data} busy={catalogue.isFetching} refresh={refresh} />)}
    </QueryState>}
    </ContentTransition>
    {dialog && <CorePackagePreparationDialog key={JSON.stringify(dialog.target)} target={dialog.target} open={dialog.open}
      catalogue={catalogue.error ? undefined : catalogue.data} controls={preparation}
      onClose={() => setDialog(current => current && { ...current, open: false })}
      afterClose={() => setDialog(current => current?.open ? current : undefined)} />}
  </>;
}

export function CorePackagesPage({ brandName }: { brandName: string }) {
  const { user, sessionVerified } = useAdminSession(), runtime = useAdminRuntime();
  if (!sessionVerified || !canManagePublicResource(user, "saas", "system:tenant:manage")) return <Result status="403" title="403" />;
  return <CorePackagesContent key={runtime.currentSessionEpoch()} brandName={brandName} />;
}
