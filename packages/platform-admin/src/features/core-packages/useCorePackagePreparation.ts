/** 页面保存唯一核对指针，写入失应答后只读取原结果；本机存储故障仍允许手工核对原回执。
 * 指针按本人和租户隔离，不保存凭据或授予权限，所有请求仍经当前 SaaS 会话围栏。 */
import { useLayoutEffect, useRef, useState } from "react";
import type { GitHubCoreReleasePin } from "@rental-os/core-contracts/github";
import type {
  CorePackageReleasePreview, CorePackageReleaseReferenceRecord
} from "@rental-os/platform-core-host/core-package-selection/protocol";
import type {
  CorePackagePreparationPreview, CorePackagePreparationRequest, CorePackagePreparationRecord
} from "@rental-os/platform-core-host/core-package-preparation/protocol";
import { formSnapshotFingerprint } from "../../app/serverFormSnapshot";
import { canManagePublicResource } from "../../application-access";
import { useAdminRuntime, useAdminSession } from "../../runtime";
import type { CorePackagesApi } from "./client";

export type CorePackagePending = { kind: "release"; reference: string } | { kind: "preparation"; sha256: string };
type ReleasePreview = Extract<CorePackageReleasePreview, { status: "inspected" }>;
type PreparationPreview = Extract<CorePackagePreparationPreview, { status: "ready" }>;
type State = {
  pending?: CorePackagePending;
  storageError?: string;
  error?: string;
  busy: boolean;
  release?: ReleasePreview;
  selected?: CorePackageReleaseReferenceRecord;
  preview?: PreparationPreview;
  prepared?: CorePackagePreparationRecord;
};

const sha256 = /^[a-f0-9]{64}$/;

function storedPending(key: string): CorePackagePending | undefined {
  const raw = window.sessionStorage.getItem(key);
  if (raw === null) return;
  const value = JSON.parse(raw);
  if (value?.kind === "release" && typeof value.reference === "string" && /^github-[a-f0-9]{64}$/.test(value.reference))
    return { kind: "release", reference: value.reference };
  if (value?.kind === "preparation" && typeof value.sha256 === "string" && sha256.test(value.sha256))
    return { kind: "preparation", sha256: value.sha256 };
  throw new Error("本机原操作核对指针不可读取，请保留原记录并核对存储状态");
}

function initialState(key: string): State {
  try { return { busy: false, pending: storedPending(key) }; }
  catch { return { busy: false, storageError: "本机核对记录无法读取，写入暂不可用" }; }
}

function verifyRelease(reference: string, record: CorePackageReleaseReferenceRecord, expected?: GitHubCoreReleasePin): void {
  if (record.format !== "core-release-reference-1" || record.reference !== reference
    || record.review !== "unreviewed" || record.package !== "unchecked"
    || expected && formSnapshotFingerprint(record.release) !== formSnapshotFingerprint(expected))
    throw new Error("原发行记录与固定选择不一致，请继续核对同一引用");
}

function verifyPreparation(hash: string, record: CorePackagePreparationRecord, expected?: PreparationPreview): void {
  if (record.sha256 !== hash || record.plan.format !== "core-preparation-1" || record.plan.deployment !== "pending"
    || expected && formSnapshotFingerprint(record.plan) !== formSnapshotFingerprint(expected.plan))
    throw new Error("原候选回执与固定预览不一致，请继续核对同一摘要");
}

export function useCorePackagePreparation(api: CorePackagesApi) {
  const runtime = useAdminRuntime(), { user, tenant } = useAdminSession();
  const epoch = useRef(runtime.currentSessionEpoch()).current;
  const owner = useRef({ tenantId: tenant?.tenantId, userId: user?.id }).current;
  const journalKey = JSON.stringify(["core-package-operation-1", owner.tenantId, owner.userId]);
  const [state, setState] = useState(() => initialState(journalKey));
  const current = useRef(state);
  const lifetime = useRef<AbortController | null>(null);
  const inFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  function live(): boolean {
    const session = runtime.getSession();
    return Boolean(lifetime.current && !lifetime.current.signal.aborted && runtime.currentSessionEpoch() === epoch
      && session.tenant?.tenantId === owner.tenantId && session.user?.id === owner.userId
      && session.sessionVerified && canManagePublicResource(session.user, "saas", "system:tenant:manage"));
  }
  function controller(signal?: AbortSignal): AbortController {
    if (signal?.aborted || !live()) throw new DOMException("原 Core 包管理页面已失效", "AbortError");
    return lifetime.current!;
  }
  function update(patch: Partial<State>): void {
    current.current = { ...current.current, ...patch };
    setState(current.current);
  }
  function run(action: string, input: unknown, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const boundary = controller();
    // 同动作的不同输入必须先等原请求完成，不能共用另一份预览。
    const key = formSnapshotFingerprint([action, input]);
    if (inFlight.current) return inFlight.current.key === key ? inFlight.current.promise
      : Promise.reject(new Error("请等待当前 Core 包操作完成"));
    if (state !== current.current) return Promise.reject(new Error("Core 包操作视图已变化，请使用当前入口"));
    update({ busy: true, error: undefined });
    // effect 重建只恢复新请求，排队中和失应答的旧请求仍受原 signal 约束。
    const promise = Promise.resolve().then(() => {
      controller(boundary.signal);
      return work(boundary.signal);
    }).catch(error => {
      if (!boundary.signal.aborted && live()) update({ error: error instanceof Error ? error.message : "Core 包操作未完成，请核对原结果" });
      throw error;
    }).finally(() => {
      if (inFlight.current?.promise === promise) {
        inFlight.current = null;
        if (live()) update({ busy: false });
      }
    });
    inFlight.current = { key, promise };
    return promise;
  }
  function requireIdle(): void {
    controller();
    if (current.current.pending || current.current.storageError) throw new Error("请先核对原操作和本机记录");
  }
  function remember(pending: CorePackagePending): void {
    requireIdle();
    try {
      // 先核同一页面可能留下的原指针，防止第二个编辑器覆盖尚未核定的操作。
      const existing = storedPending(journalKey);
      if (existing) {
        update({ pending: existing });
        throw new Error("已有 Core 包操作等待核对");
      }
      const raw = JSON.stringify(pending);
      window.sessionStorage.setItem(journalKey, raw);
      update({ pending });
    } catch (error) {
      update({ storageError: "本机核对指针未可靠保存，写入暂不可用" });
      throw error;
    }
  }
  function forget(pending: CorePackagePending): void {
    controller();
    try {
      const stored = storedPending(journalKey);
      if (stored && formSnapshotFingerprint(stored) !== formSnapshotFingerprint(pending)) {
        update({ pending: stored });
        throw new Error("本机核对指针已变化，不能清除其他操作");
      }
      window.sessionStorage.removeItem(journalKey);
      if (window.sessionStorage.getItem(journalKey) !== null) throw new Error("本机原操作标记未清除");
      update({ pending: undefined, storageError: undefined });
    } catch {
      // 服务端回执已确认，清理本机标记失败单独显示，不能把已确认结果改成写入失败。
      update({ storageError: "原结果已核定，本机核对标记尚未清除，请再次核对" });
    }
  }

  const isCurrent = () => live() && state === current.current;
  const resetPreview = (): boolean => {
    if (!isCurrent() || current.current.busy || current.current.pending || current.current.storageError) return false;
    update({ release: undefined, selected: undefined, preview: undefined, prepared: undefined, error: undefined });
    return true;
  };
  const previewRelease = (expected: GitHubCoreReleasePin) => {
    const pinned = structuredClone(expected);
    return run("preview-release", pinned, async signal => {
      requireIdle();
      update({ release: undefined, selected: undefined, preview: undefined, prepared: undefined });
      const { repository, coreId, version, tag, visibility } = pinned;
      const result = await api.previewRelease({ repository, coreId, version, tag, ...(visibility ? { visibility } : {}) }, signal);
      controller(signal);
      if (result.status === "unavailable") throw new Error(result.error.message);
      if (!/^github-[a-f0-9]{64}$/.test(result.reference)
        || formSnapshotFingerprint(result.release) !== formSnapshotFingerprint(pinned))
        throw new Error("发行内容已变化，请重新读取原仓库及版本");
      update({ release: result });
    });
  };
  // 确认回调固定本次渲染的预览，旧按钮不能提交后来加载的选择。
  const selectRelease = () => run("select-release", state.release, async signal => {
    requireIdle();
    const release = state.release;
    if (!release || release !== current.current.release || current.current.selected)
      throw new Error("发行预览已变化，请核对本次发行");
    const pending: CorePackagePending = { kind: "release", reference: release.reference };
    remember(pending);
    const result = await api.selectRelease({ release: release.release }, signal);
    controller(signal);
    if (result.status === "unavailable") {
      // 该返回由发行应用在未尝试发布时给出，HTTP 错误和 unknown 均保留原指针。
      forget(pending);
      throw new Error(result.error.message);
    }
    if (result.status === "unknown") throw new Error(result.error.message);
    verifyRelease(release.reference, result.record, release.release);
    update({ selected: result.record });
    forget(pending);
  });
  const previewPreparation = (request: CorePackagePreparationRequest) => {
    const expected = structuredClone(request);
    return run("preview-preparation", expected, async signal => {
      requireIdle();
      update({ preview: undefined, prepared: undefined });
      const result = await api.previewPreparation(expected, signal);
      controller(signal);
      if (result.status === "unavailable") throw new Error(result.error.message);
      if (!sha256.test(result.sha256) || result.plan.format !== "core-preparation-1" || result.plan.deployment !== "pending"
        || formSnapshotFingerprint(result.plan.request) !== formSnapshotFingerprint(expected))
        throw new Error("候选预览与原请求不一致，请核对固定引用");
      update({ preview: result });
    });
  };
  const prepare = () => run("prepare", state.preview, async signal => {
    requireIdle();
    const preview = state.preview;
    if (!preview || preview !== current.current.preview || current.current.prepared)
      throw new Error("候选预览已变化，请核对本次候选");
    const pending: CorePackagePending = { kind: "preparation", sha256: preview.sha256 };
    remember(pending);
    const result = await api.prepare({ request: preview.plan.request, expectedSha256: preview.sha256 }, signal);
    controller(signal);
    if (result.status === "unavailable") {
      // 准备应用的 unavailable 位于发布前，发布后的异常只能按原摘要核对。
      forget(pending);
      throw new Error(result.error.message);
    }
    if (result.status === "unknown") throw new Error(result.error.message);
    verifyPreparation(preview.sha256, result.record, preview);
    update({ prepared: result.record });
    forget(pending);
  });
  const reconcile = (original?: CorePackagePending) => {
    const pending = structuredClone(original ?? state.pending);
    return run("receipt", pending, async signal => {
      if (!pending || (pending.kind === "release" ? !/^github-[a-f0-9]{64}$/.test(pending.reference) : !sha256.test(pending.sha256)))
        throw new Error("请填写原发行引用或候选 SHA-256");
      if (current.current.pending && formSnapshotFingerprint(pending) !== formSnapshotFingerprint(current.current.pending))
        throw new Error("已有其他原操作等待核对，请保留当前指针");
      // 本机指针丢失时只登记手工提供的原标识，随后仍仅读取原回执。
      if (!current.current.pending) {
        try { remember(pending); }
        catch (error) {
          controller(signal);
          if (!current.current.storageError || current.current.pending
            && formSnapshotFingerprint(current.current.pending) !== formSnapshotFingerprint(pending)) throw error;
          // 保留存储错误和原存储字节，以内存指针仅读取；新准备仍由 requireIdle 拒绝。
          update({ pending });
        }
        update({ selected: undefined, prepared: undefined });
      }
      if (pending.kind === "release") {
        const result = await api.releaseReceipt({ reference: pending.reference }, signal);
        controller(signal);
        if (result.status === "unavailable") throw new Error(result.error.message);
        // absent 只是当前读取时刻的事实，原失应答请求仍可能尚在发布，不据此重发或解除锁。
        if (result.status === "absent") throw new Error("尚未读到原发行记录，请保留同一引用并稍后核对");
        const expected = current.current.release?.reference === pending.reference ? current.current.release.release : undefined;
        verifyRelease(pending.reference, result.record, expected);
        update({ selected: result.record, prepared: undefined });
      } else {
        const result = await api.preparationReceipt({ sha256: pending.sha256 }, signal);
        controller(signal);
        if (result.status === "unavailable") throw new Error(result.error.message);
        const expected = current.current.preview?.sha256 === pending.sha256 ? current.current.preview : undefined;
        verifyPreparation(pending.sha256, result.record, expected);
        // 只保留这个候选实际使用的发行选择，其他原结果不能占据当前恢复视图。
        const selected = current.current.selected;
        update({ prepared: result.record, selected: selected?.reference === result.record.plan.request.package.reference ? selected : undefined });
      }
      forget(pending);
    });
  };
  return { ...state, isCurrent, resetPreview, previewRelease, selectRelease, previewPreparation, prepare, reconcile };
}

export type CorePackagePreparationControls = ReturnType<typeof useCorePackagePreparation>;
