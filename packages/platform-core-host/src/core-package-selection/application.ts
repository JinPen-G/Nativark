/** SaaS 发行预览、固定引用保存和原结果读取共用真实主体事务围栏。
 * 外部资料读取在两次围栏之间完成，保存时锁定当前权限，失应答保留原引用。
 * 引用供原下载、预检与候选准备消费，部署、注册和授权沿各自正式入口维护。 */
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { CoreAccessError } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import {
  GitHubCoreReadError, GitHubCoreReleasePinSchema, gitHubCoreReleaseMatchesSelection, type GitHubCoreReleaseSelection
} from "@rental-os/core-contracts/github";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "../ports";
import type { CorePackagePublicationAudit } from "../core-package-audit";
import {
  CorePackageReleasePreviewRequestSchema, CorePackageReleaseSelectRequestSchema,
  CorePackageReleaseReceiptRequestSchema, CorePackageReleaseReferenceRecordSchema, corePackageReleaseReference,
  type CorePackageReleaseApplication, type CorePackageReleaseReferenceStore, type CorePackageReleaseSource
} from "./ports";
import type {
  CorePackageReleaseReferenceRead, CorePackageReleaseSelectResult, CorePackageReleaseUnavailable
} from "./protocol";

const unavailable = (code: string, message: string): CorePackageReleaseUnavailable => ({ status: "unavailable", error: { code, message } });

function identityReference() {
  const identity = getRequestIdentity();
  return { tenantId: identity?.tenantId, userId: identity?.userId, audience: identity?.audience,
    workspaceId: identity?.workspaceId, accessSession: identity?.accessSession && { ...identity.accessSession } };
}
function requireManager(user: SystemUserRow): void {
  if (user.isSaasAdmin !== true || !user.permissions.includes("*") && !user.permissions.includes("system:tenant:manage"))
    throw new CoreAccessError("denied", "当前主体缺少 SaaS Core 发行管理权限");
}

export function composePlatformCorePackageSelection<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  audit?: CorePackagePublicationAudit<Tx>;
  releases?: CorePackageReleaseSource;
  store?: CorePackageReleaseReferenceStore;
  now?: () => number;
}): CorePackageReleaseApplication {
  const now = input.now ?? Date.now, principals = new PlatformPrincipalAuthority<Tx>(input.users, now);

  function sameIdentity(original: ReturnType<typeof identityReference>): void {
    if (!isDeepStrictEqual(original, identityReference())) throw new CoreAccessError("denied", "发行选择的原主体或会话已变化");
  }
  async function locked<T>(original: ReturnType<typeof identityReference>,
    work: (transaction: Tx, revalidate: () => Promise<void>) => T | Promise<T>): Promise<T> {
    return input.database.$transaction(async transaction => {
      const actor = principals.current(), lease = await principals.lock(transaction, actor, actor.tenantId);
      sameIdentity(original);
      requireManager(lease.user);
      const revalidate = async () => {
        requireManager(await lease.revalidate());
        sameIdentity(original);
      };
      try { return await work(transaction, revalidate); }
      finally { await revalidate(); }
    }, { isolationLevel: "ReadCommitted" });
  }
  async function inspect(selection: GitHubCoreReleaseSelection) {
    if (!input.releases) return unavailable("release_source_unavailable", "宿主尚未提供固定 GitHub 发行读取");
    try {
      const release = GitHubCoreReleasePinSchema.parse(await input.releases.inspect(selection));
      if (!gitHubCoreReleaseMatchesSelection(selection, release))
        return unavailable("release_changed", "读取的发行与原选择不一致，请核对原版本");
      return { status: "inspected" as const, release };
    } catch (error) {
      if (error instanceof GitHubCoreReadError) return { status: "unavailable" as const, error: {
        code: error.code, message: error.message,
        ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds })
      } };
      if (error instanceof z.ZodError) return unavailable("response_invalid", "发行资料不符合原固定版本合同");
      if (error instanceof CoreAccessError) throw error;
      return unavailable("release_read_failed", "固定发行读取未完成，请核对原来源");
    }
  }
  function read(reference: string): CorePackageReleaseReferenceRead {
    if (!input.store) return unavailable("release_store_unavailable", "宿主尚未提供独占发行引用存储");
    let result: CorePackageReleaseReferenceRead;
    try { result = input.store.read(reference); }
    catch (error) {
      if (error instanceof CoreAccessError) throw error;
      return unavailable("release_reference_read_failed", "原发行引用不可核定，请沿同一引用读取");
    }
    if (result.status === "recorded") {
      const parsed = CorePackageReleaseReferenceRecordSchema.safeParse(result.record);
      if (!parsed.success || parsed.data.reference !== reference)
        throw new CoreAccessError("operation_conflict", "原发行引用记录与固定内容不一致");
      if (parsed.data.release.visibility === "private" && getRequestIdentity()?.tenantId !== "tenant_platform")
        throw new CoreAccessError("denied", "私有发行原结果只向平台管理主体开放");
      return { status: "recorded", record: parsed.data };
    }
    if (result.status === "absent" && result.reference !== reference)
      throw new CoreAccessError("operation_conflict", "原发行引用缺失证据与请求不同");
    return result;
  }

  return {
    async preview(value) {
      const selection = CorePackageReleasePreviewRequestSchema.parse(value), original = identityReference();
      await locked(original, () => undefined);
      const result = await inspect(selection);
      return locked(original, () => result.status === "unavailable" ? result : {
        status: "inspected" as const, reference: corePackageReleaseReference(result.release), release: result.release,
        checkedAt: new Date(now()).toISOString(), review: "unreviewed" as const, package: "unchecked" as const
      });
    },
    async select(value) {
      const { release } = CorePackageReleaseSelectRequestSchema.parse(value), original = identityReference();
      const reference = corePackageReleaseReference(release), existing = await locked(original, () => read(reference));
      if (existing.status === "unavailable") return existing;
      if (existing.status === "recorded" && release.visibility !== "private") return { status: "already_selected", record: existing.record };
      const { repository, coreId, version, tag, visibility } = release;
      const inspected = await inspect({ repository, coreId, version, tag, ...(visibility ? { visibility } : {}) });
      if (visibility === "private" && !input.releases?.authorize)
        return unavailable("source_denied", "宿主缺少私有来源的提交复权接点");
      const sourceLease = visibility === "private" && inspected.status === "inspected"
        ? await input.releases!.authorize!(release) : undefined;
      if (visibility === "private" && inspected.status === "inspected" && !sourceLease)
        return unavailable("source_denied", "私有来源未取得当前提交权限");
      let dispatched = false;
      return locked(original, async (transaction, revalidate) => {
        if (inspected.status === "unavailable") return inspected;
        if (!isDeepStrictEqual(release, inspected.release))
          return unavailable("release_changed", "Release、Tag 提交或资产与原预览不同，请核对原引用");
        await sourceLease?.revalidate(transaction);
        const current = read(reference);
        if (current.status === "unavailable") return current;
        if (current.status === "recorded") return { status: "already_selected" as const, record: current.record };
        if (input.audit) {
          await input.audit.recordPublicationAttempt(transaction, { kind: "release", reference });
          await revalidate();
          await sourceLease?.revalidate(transaction);
        }
        let result: CorePackageReleaseSelectResult;
        dispatched = true;
        try { result = input.store!.select(release); }
        catch (error) {
          if (error instanceof CoreAccessError) throw error;
          return { status: "unknown" as const, reference, error: {
            code: "release_reference_unknown", message: "发行引用保存尚无确定结果，请读取同一引用"
          } };
        }
        if (result.status === "selected" || result.status === "already_selected") {
          const parsed = CorePackageReleaseReferenceRecordSchema.safeParse(result.record);
          if (!parsed.success || parsed.data.reference !== reference || !isDeepStrictEqual(parsed.data.release, release))
            return { status: "unknown" as const, reference, error: {
              code: "release_reference_unknown", message: "保存结果与原发行不可核定，请读取同一引用"
            } };
          return { status: result.status, record: parsed.data };
        }
        if (result.status === "unknown" && result.reference !== reference)
          throw new CoreAccessError("operation_conflict", "保存失应答必须保留原发行引用");
        return result;
      }).catch(error => {
        // 原文件发布与审计提交跨介质，提交失应答沿原引用读取。
        if (!dispatched || error instanceof CoreAccessError && error.code === "operation_conflict") throw error;
        return { status: "unknown" as const, reference, error: {
          code: "release_reference_unknown", message: "发行引用或审计提交尚无确定结果，请读取同一引用"
        } };
      });
    },
    async receipt(value) {
      const { reference } = CorePackageReleaseReceiptRequestSchema.parse(value), original = identityReference();
      return locked(original, () => read(reference));
    }
  };
}
