/** SaaS 固定候选预览、准备与原结果读取，复用原预检和当前主体事务。
 * 网络与材料读取先完成，文件发布时持原主体锁，失应答沿同一摘要回读。
 * 宿主存储回包按原 SHA 和完整候选指纹核对，无法核定的发布结果保持 unknown。
 * 新候选一直 pending，实际迁移、运行版本与授权分别由原部署和业务入口维护。 */
import { isDeepStrictEqual } from "node:util";
import { CoreAccessError, type CoreDeployedCatalogue } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import { GitHubCoreReadError } from "@rental-os/core-contracts/github";
import { CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { CorePackageDeploymentSource, CorePackageLegacyApiRoutes } from "../core-package-ports";
import { CorePackageArtifactSchema, type CorePackageArtifact, type CorePackageArtifactSource } from "../core-package-preflight/ports";
import { composePlatformCorePackagePreflight } from "../core-package-preflight/application";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "../ports";
import type { CorePackagePublicationAudit } from "../core-package-audit";
import { createCorePackagePreparationBundle } from "./bundle";
import {
  CorePackagePreparationRequestSchema, CorePackagePrepareRequestSchema, CorePackagePreparationQuerySchema,
  CorePackagePreparationRecordSchema,
  type CorePackagePreparationApplication, type CorePackagePreparationBundle, type CorePackagePreparationMaterialsSource,
  type CorePackagePreparationRequest, type CorePackagePreparationResult, type CorePackagePreparationStore,
  type CorePackagePreparationUnavailable
} from "./ports";

type Snapshot = Awaited<ReturnType<CorePackageDeploymentSource["read"]>>;
// 准备事务须在发布前后重核当前完整安装材料及原主体；与普通业务事务分开设定有界期限。
const PREPARATION_TRANSACTION_TIMEOUT_MS = 30_000;
const unavailable = (code: string, message: string): CorePackagePreparationUnavailable => ({ status: "unavailable", error: { code, message } });
function requireManager(user: SystemUserRow): void {
  if (!user.isSaasAdmin || !user.permissions.includes("*") && !user.permissions.includes("system:tenant:manage"))
    throw new CoreAccessError("denied", "当前主体缺少 SaaS Core 候选准备权限");
}
function identityReference() {
  const identity = getRequestIdentity();
  return { tenantId: identity?.tenantId, userId: identity?.userId, audience: identity?.audience,
    accessSession: identity?.accessSession && { ...identity.accessSession } };
}

function verifiedRecord(sha256: string, value: unknown) {
  const parsed = CorePackagePreparationRecordSchema.safeParse(value);
  if (!parsed.success || parsed.data.sha256 !== sha256 || requestFingerprint(parsed.data.plan) !== sha256)
    return undefined;
  return parsed.data;
}

export function composePlatformCorePackagePreparation<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  audit?: CorePackagePublicationAudit<Tx>;
  catalogue: CoreDeployedCatalogue;
  deployment?: CorePackageDeploymentSource;
  artifacts?: CorePackageArtifactSource;
  materials?: CorePackagePreparationMaterialsSource;
  store?: CorePackagePreparationStore;
  legacyApiRoutes?: CorePackageLegacyApiRoutes;
  now?: () => number;
}): CorePackagePreparationApplication {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users, input.now ?? Date.now);
  const legacyApiRoutes = structuredClone(input.legacyApiRoutes ?? {});

  async function build(request: CorePackagePreparationRequest): Promise<CorePackagePreparationUnavailable
    | { status: "ready"; bundle: CorePackagePreparationBundle; snapshot: NonNullable<Snapshot>; principal: ReturnType<typeof identityReference> }> {
    const principal = identityReference();
    let artifact: CorePackageArtifact | undefined, snapshot: Snapshot, sourceFailure: unknown;
    const preflight = composePlatformCorePackagePreflight({ ...input, legacyApiRoutes,
      artifacts: input.artifacts && { async read(reference) {
        try {
          const value = await input.artifacts!.read(reference), parsed = CorePackageArtifactSchema.safeParse(value);
          if (parsed.success && parsed.data.bytes.length <= CORE_ARCHIVE_LIMITS.totalBytes)
            artifact = { ...parsed.data, bytes: Buffer.from(parsed.data.bytes) };
          return artifact ?? value;
        } catch (error) { sourceFailure = error; throw error; }
      } },
      deployment: input.deployment && { async read() {
        snapshot = structuredClone(await input.deployment!.read());
        return snapshot;
      } }
    });
    const checked = request.operation === "install" ? await preflight.install(request.package) : await preflight.update(request.package);
    if (checked.status === "unavailable") {
      if (sourceFailure instanceof GitHubCoreReadError) return { status: "unavailable", error: {
        code: sourceFailure.code, message: sourceFailure.message,
        ...(sourceFailure.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: sourceFailure.retryAfterSeconds }) } };
      return checked;
    }
    if (checked.plan.status === "unavailable") return checked.plan;
    const result = checked.plan.result;
    if (!result.ok) return unavailable("preflight_rejected", result.issues.map(issue => `[${issue.owner}] ${issue.message}`).join("。"));
    if (!artifact || !snapshot) return unavailable("preparation_unavailable", "缺少原包字节或当前部署材料");
    if (!input.materials) return unavailable("materials_unavailable", "宿主尚未提供原平台迁移及实际 Core 包材料");
    let bundle: CorePackagePreparationBundle;
    try {
      bundle = await createCorePackagePreparationBundle({ request, artifact, base: snapshot.lock, candidate: result.candidate,
        materials: input.materials, legacyApiRoutes });
    } catch (error) {
      if (error instanceof CoreAccessError) throw error;
      return unavailable("materials_invalid", "原包、迁移或目录映射与固定候选不一致，请核对原版本及摘要");
    }
    if (!isDeepStrictEqual(principal, identityReference())) throw new CoreAccessError("denied", "候选准备的原主体或会话已变化");
    return { status: "ready", bundle, snapshot, principal };
  }

  async function locked<T>(work: (transaction: Tx, revalidate: () => Promise<void>) => Promise<T>): Promise<T> {
    const original = identityReference();
    return input.database.$transaction(async transaction => {
      const actor = principals.current(), lease = await principals.lock(transaction, actor, actor.tenantId);
      requireManager(lease.user);
      const revalidate = async () => {
        if (!isDeepStrictEqual(original, identityReference())) throw new CoreAccessError("denied", "原准备会话已变化");
        requireManager(await lease.revalidate());
      };
      try { return await work(transaction, revalidate); }
      finally { await revalidate(); }
    }, { isolationLevel: "ReadCommitted", timeout: PREPARATION_TRANSACTION_TIMEOUT_MS });
  }
  async function sameSnapshot(expected: NonNullable<Snapshot>): Promise<void> {
    let current: Snapshot;
    try { current = await input.deployment?.read(); }
    catch { throw new CoreAccessError("core_unavailable", "当前部署读取失败，请沿同一摘要核对原候选结果"); }
    if (!isDeepStrictEqual(expected, current))
      throw new CoreAccessError("revision_conflict", "部署或原数据已变化，请沿原候选摘要读取结果并重新核对");
  }

  return {
    async preview(value) {
      const request = CorePackagePreparationRequestSchema.parse(value), built = await build(request);
      if (built.status !== "ready") return built;
      return locked(async () => {
        if (!isDeepStrictEqual(built.principal, identityReference())) throw new CoreAccessError("denied", "预览的原主体或会话已变化");
        await sameSnapshot(built.snapshot);
        return { status: "ready" as const, sha256: built.bundle.sha256, plan: built.bundle.plan };
      });
    },
    async prepare(value) {
      const request = CorePackagePrepareRequestSchema.parse(value), built = await build(request.request);
      if (built.status !== "ready") return built;
      if (built.bundle.sha256 !== request.expectedSha256)
        throw new CoreAccessError("revision_conflict", "当前候选与原选择的摘要不同，请核对原结果");
      if (!input.store) return unavailable("preparation_store_unavailable", "宿主尚未提供独占候选准备目录");
      let dispatched = false;
      return locked(async (transaction, revalidate) => {
        if (!isDeepStrictEqual(built.principal, identityReference())) throw new CoreAccessError("denied", "准备的原主体或会话已变化");
        await sameSnapshot(built.snapshot);
        if (input.audit) {
          await input.audit.recordPublicationAttempt(transaction, { kind: "preparation", sha256: request.expectedSha256 });
          await sameSnapshot(built.snapshot);
          await revalidate();
        }
        let result: CorePackagePreparationResult;
        dispatched = true;
        try { result = input.store!.prepare(built.bundle); }
        catch (error) {
          if (error instanceof CoreAccessError) throw error;
          result = { status: "unknown", sha256: request.expectedSha256, error: {
            code: "preparation_unknown", message: "候选准备尚无确定结果，请按同一摘要核对原回执" } };
        }
        await sameSnapshot(built.snapshot);
        if (result.status === "unavailable") {
          // 存储已调用，原目录不可核定时保留本次摘要供回读。
          return { status: "unknown" as const, sha256: request.expectedSha256, error: result.error };
        }
        if (result.status === "prepared" || result.status === "already_prepared") {
          const record = verifiedRecord(request.expectedSha256, result.record);
          if (!record) return { status: "unknown" as const, sha256: request.expectedSha256, error: {
            code: "preparation_unknown", message: "存储结果与原候选摘要或计划不可核定，请读取同一摘要"
          } };
          return { status: result.status, record };
        }
        if (result.status === "unknown" && result.sha256 !== request.expectedSha256)
          throw new CoreAccessError("operation_conflict", "准备失应答必须保留原候选摘要");
        return result;
      }).catch(error => {
        // 文件发布后的数据库失应答保留原摘要，交由原候选回执核对。
        if (!dispatched || error instanceof CoreAccessError && error.code === "operation_conflict") throw error;
        return { status: "unknown" as const, sha256: request.expectedSha256, error: {
          code: "preparation_unknown", message: "候选文件或审计提交尚无确定结果，请读取同一摘要"
        } };
      });
    },
    async receipt(value) {
      const query = CorePackagePreparationQuerySchema.parse(value);
      return locked(async () => {
        if (!input.store) return unavailable("preparation_store_unavailable", "宿主尚未提供原候选结果读取");
        const result = input.store.read(query.sha256);
        if (result.status !== "recorded") return result;
        const record = verifiedRecord(query.sha256, result.record);
        if (!record) throw new CoreAccessError("operation_conflict", "原候选记录与请求摘要或计划指纹不一致");
        return { status: "recorded" as const, record };
      });
    }
  };
}
