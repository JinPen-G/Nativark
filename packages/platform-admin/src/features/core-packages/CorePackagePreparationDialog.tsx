/** 固定发行与本地引用进入同一候选预览，侧栏复用公共 UIArc 生命周期和主题。 */
import { useId, useState } from "react";
import type { GitHubCoreReleasePin } from "@rental-os/core-contracts/github";
import type { CorePackageCatalogue } from "@rental-os/platform-core-host/core-package-ports";
import type { CorePackagePreparationPlan, CorePackagePreparationRequest } from "@rental-os/platform-core-host/core-package-preparation/protocol";
import { ActionButton, Alert, Button, DataTableStatus, DataTableText, Input, ListSection, Modal, RecordFacts, Table } from "../../components/ui";
import { useLocale } from "../../app/locale";
import type { CorePackagePreparationControls } from "./useCorePackagePreparation";

export type CorePackageUpdateTarget = { kind: "platform" } | { kind: "core"; coreId: string }
  | { kind: "platform-capability"; capabilityId: string };
export type CorePackagePreparationTarget = { kind: "release"; release: GitHubCoreReleasePin }
  | { kind: "reference"; name: string; update?: CorePackageUpdateTarget; reference?: string }
  | { kind: "receipt" };

function Candidate({ plan, hash, en }: { plan: CorePackagePreparationPlan; hash: string; en: boolean }) {
  const rows = [{ id: "platform", name: en ? "Platform" : "底座", current: plan.base.platform.versions.platform,
    candidate: plan.candidate.platform.versions.platform, data: plan.candidate.platform.data.version }, ...plan.candidate.cores.map(core => ({
    id: `core:${core.manifest.id}`, name: core.manifest.name,
    current: plan.base.cores.find(previous => previous.manifest.id === core.manifest.id)?.manifest.version,
    candidate: core.manifest.version, data: core.manifest.data.version
  })), ...(plan.candidate.dataCapabilities ?? []).map(capability => ({
    id: `platform-capability:${capability.id}`, name: en ? "Platform data capability" : "平台数据能力",
    current: plan.base.dataCapabilities?.find(previous => previous.id === capability.id)?.version,
    candidate: capability.version, data: capability.data.version
  }))];
  return <>
    <RecordFacts items={[
      { key: "state", label: en ? "Deployment" : "部署状态", value: <DataTableStatus tone="warning">{en ? "Pending deployment" : "待部署"}</DataTableStatus> },
      { key: "operation", label: en ? "Operation" : "操作", value: plan.request.operation === "install" ? en ? "Install Core" : "安装 Core" : en ? "Update module" : "更新模块" },
      { key: "reference", label: en ? "Package reference" : "包引用", value: plan.request.package.reference, wide: true },
      { key: "hash", label: en ? "Candidate SHA-256" : "候选 SHA-256", value: hash, wide: true }
    ]} />
    <ListSection title={en ? "Candidate combination" : "候选组合"}>
      <Table rowKey="id" dataSource={rows} pagination={false} columns={[
        { key: "module", title: en ? "Module" : "模块", render: (_, row) => <DataTableText primary={row.name} secondary={row.id} /> },
        { key: "current", title: en ? "Current lock" : "当前锁定版本", render: (_, row) => row.current ?? (en ? "New installation" : "新安装") },
        { dataIndex: "candidate", title: en ? "Candidate version" : "候选版本" },
        { dataIndex: "data", title: en ? "Data version" : "数据版本" }
      ]} />
    </ListSection>
    <ListSection title={en ? "Candidate files" : "候选文件"}>
      <Table rowKey="file" dataSource={plan.files} columns={[
        { dataIndex: "file", title: en ? "File" : "文件" },
        { dataIndex: "sizeBytes", title: en ? "Bytes" : "字节数" },
        { dataIndex: "sha256", title: "SHA-256" }
      ]} />
    </ListSection>
  </>;
}

export function CorePackagePreparationDialog({ target, open, catalogue, controls, onClose, afterClose }: {
  target: CorePackagePreparationTarget;
  open: boolean;
  catalogue?: CorePackageCatalogue;
  controls: CorePackagePreparationControls;
  onClose: () => void;
  afterClose: () => void;
}) {
  const { locale } = useLocale(), en = locale === "en-US", referenceId = useId();
  const [reference, setReference] = useState(target.kind === "reference" ? target.reference ?? "" : "");
  const fixed = target.kind === "release" ? controls.release?.release ?? target.release : undefined;
  const selected = target.kind === "release" ? controls.selected : undefined;
  const versions = catalogue?.versions.status === "observed" ? catalogue.versions : undefined;
  const updateTarget = target.kind === "reference" ? target.update
    : fixed && versions?.cores.some(core => core.locked.manifest.id === fixed.coreId) ? { kind: "core" as const, coreId: fixed.coreId } : undefined;
  const packageReference = target.kind === "release" ? selected?.reference : reference;
  const request: CorePackagePreparationRequest | undefined = packageReference
    ? updateTarget ? { operation: "update", package: { ...updateTarget, reference: packageReference } }
      : { operation: "install", package: { reference: packageReference } } : undefined;
  const blocked = controls.busy || Boolean(controls.pending) || Boolean(controls.storageError);
  const plan = controls.prepared?.plan ?? controls.preview?.plan;
  const hash = controls.prepared?.sha256 ?? controls.preview?.sha256;
  const title = target.kind === "release" ? `${fixed?.coreId} · ${fixed?.version}`
    : target.kind === "reference" ? target.name : en ? "Original result" : "原操作结果";
  return <Modal presentation="side" title={title} open={open} closable={!controls.busy}
    keyboard={!controls.busy} maskClosable={!controls.busy} onCancel={() => { if (!controls.busy) onClose(); }}
    afterClose={afterClose} footer={<Button disabled={controls.busy} onClick={onClose}>{en ? "Close" : "关闭"}</Button>}>
    {fixed && <>
      <RecordFacts items={[
        { key: "review", label: en ? "Review" : "审核", value: <DataTableStatus tone="warning">{en ? "Unreviewed" : "未审核"}</DataTableStatus> },
        { key: "repository", label: en ? "Repository" : "仓库", value: fixed.repository, wide: true },
        { key: "tag", label: "Tag", value: fixed.tag },
        { key: "commit", label: en ? "Release commit" : "发行提交", value: fixed.commit, wide: true },
        { key: "hash", label: en ? "Package SHA-256" : "包 SHA-256", value: fixed.sha256, wide: true },
        ...(controls.release ? [{ key: "checked", label: en ? "Checked at" : "核对时间", value: controls.release.checkedAt }] : [])
      ]} />
      {!controls.release && <ActionButton label={en ? "Inspect release" : "核对发行"} intent="review" pending={controls.busy}
        disabled={blocked} onAction={() => controls.previewRelease(target.kind === "release" ? target.release : fixed)} />}
      {controls.release && !selected && <ActionButton label={en ? "Save release selection" : "保存发行选择"}
        intent="confirm" pending={controls.busy} disabled={blocked} onAction={controls.selectRelease} />}
      {selected && <RecordFacts items={[
        { key: "selection", label: en ? "Selection" : "发行选择", value: en ? "Recorded, package unchecked" : "已保存，包未校验" },
        { key: "reference", label: en ? "Reference" : "引用", value: selected.reference, wide: true }
      ]} />}
    </>}
    {target.kind === "reference" && <ListSection title={en ? "Downloaded package" : "已下载包"}>
      <label htmlFor={referenceId}>{en ? "Host package reference" : "宿主包引用"}</label>
      <Input id={referenceId} value={reference} maxLength={128} disabled={blocked}
        onChange={event => { setReference(event.target.value); controls.resetPreview(); }} />
      <p>{en ? "Enter the reference registered by this host for a downloaded standard package." : "填写本宿主为已下载标准包登记的引用。"}</p>
    </ListSection>}
    {target.kind !== "receipt" && !versions && <Alert type="warning"
      title={catalogue?.versions.status === "unavailable" ? catalogue.versions.error.message
        : en ? "Current deployment evidence is unavailable" : "当前部署证据尚不可用"} />}
    {target.kind !== "receipt" && !controls.preview && !controls.prepared && <ActionButton
      label={en ? "Preview candidate" : "预览候选"} intent="review" pending={controls.busy}
      disabled={blocked || !versions || !request || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(packageReference ?? "")}
      onAction={async () => { if (!request) throw new Error(en ? "Select a package first" : "请先选择包引用"); await controls.previewPreparation(request); }} />}
    {plan && hash && <Candidate plan={plan} hash={hash} en={en} />}
    {controls.preview && !controls.prepared && !controls.pending && <ActionButton label={en ? "Prepare candidate" : "准备候选"}
      intent="confirm" pending={controls.busy} disabled={blocked} onAction={controls.prepare} />}
    {controls.prepared && <Alert type="info" title={en ? "Candidate prepared, pending deployment" : "候选已准备，待部署"}
      description={en ? "A deployment operator continues with the fixed combination, required backup, compatibility checks, migrations and runtime verification. Registration and tenant/member access follow their management entries."
        : "部署人员按固定组合继续备份、兼容核查、迁移及运行验证，再沿管理入口办理注册、租户授权和成员分配。"} />}
    {controls.pending && <Alert type="warning" title={en ? "Confirm the original result" : "请核对原操作结果"}
      description={controls.pending.kind === "release" ? controls.pending.reference : controls.pending.sha256}
      action={<ActionButton label={en ? "Read original result" : "核对原结果"} intent="review" pending={controls.busy} onAction={controls.reconcile} />} />}
    {controls.storageError && <Alert type="warning" title={controls.storageError} />}
    {controls.error && <Alert type="error" title={controls.error} />}
  </Modal>;
}
