/** SaaS 私有包来源复用原集成配置表、SecretBox 和原主体事务。
 * 只管理 GitHub 获取范围与凭据；不修改租户集成目录、已安装组合、准入或业务授权。 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { GitHubCoreRepositorySchema } from "@rental-os/core-contracts/github";
import { CoreAccessError } from "@rental-os/core-host";
import type { CoreHostSqlClient, CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { SecretBox } from "@rental-os/platform-server/secret-box";
import type { StoredTenantIntegration } from "@rental-os/platform-server/integration-store";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "./ports";
import type { CorePackagePrivateSourceAccess } from "./core-package-source-access";

const platformTenant = "tenant_platform", capability = "core-package", provider = "github";
const repositories = z.array(GitHubCoreRepositorySchema).max(100)
  .refine(values => new Set(values.map(value => value.toLowerCase())).size === values.length, "允许仓库不得重复");
const token = z.string().regex(/^[A-Za-z0-9_]{20,512}$(?![\s\S])/, "GitHub token 格式无效");
export const CorePackageSourceSettingsRequestSchema = z.object({
  expectedRevision: z.string().datetime().nullable(), enabled: z.boolean(), repositories,
  token: token.optional(), revokeToken: z.boolean().default(false)
}).strict().refine(value => !(value.token && value.revokeToken) && !(value.enabled && value.revokeToken)
  && (!value.enabled || value.repositories.length > 0), "启用须有允许仓库，轮换与撤销不可同时执行");
export type CorePackageSourceSettingsRequest = z.input<typeof CorePackageSourceSettingsRequestSchema>;
export interface CorePackageSourceSettings {
  provider: "github"; enabled: boolean; repositories: string[]; credentialConfigured: boolean; revision: string | null;
}
export interface CorePackageSourceSettingsApplication {
  read(): Promise<CorePackageSourceSettings>;
  save(input: unknown): Promise<CorePackageSourceSettings>;
}
export { CORE_PACKAGE_SOURCE_HTTP } from "./core-package-source-protocol";

export function composeCorePackageSourceSettings<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>; users: PlatformCoreUsers<Tx>;
  vault: Pick<SecretBox, "encrypt" | "decrypt">; now?: () => number;
}): { settings: CorePackageSourceSettingsApplication; access: CorePackagePrivateSourceAccess } {
  const now = input.now ?? Date.now, principals = new PlatformPrincipalAuthority<Tx>(input.users, now);
  const identity = () => {
    const current = getRequestIdentity();
    return { tenantId: current?.tenantId, userId: current?.userId, audience: current?.audience,
      accessSession: current?.accessSession && { ...current.accessSession } };
  };
  const denied = () => new CoreAccessError("denied", "当前主体或来源配置不允许私有包获取");
  const unavailable = () => new CoreAccessError("core_unavailable", "私有来源配置或凭据不可核定");
  async function locked<T>(original: ReturnType<typeof identity>, work: (tx: Tx) => Promise<T>, tx?: CoreHostSqlTransaction): Promise<T> {
    const run = async (transaction: Tx) => {
      const actor = principals.current();
      if (actor.tenantId !== platformTenant || !isDeepStrictEqual(original, identity())) throw denied();
      const lease = await principals.lock(transaction, actor, platformTenant);
      const check = (user: typeof lease.user) => {
        if (!user.isSaasAdmin || !user.permissions.includes("*") && !user.permissions.includes("system:tenant:manage")) throw denied();
      };
      check(lease.user);
      try { return await work(transaction); }
      finally { check(await lease.revalidate()); if (!isDeepStrictEqual(original, identity())) throw denied(); }
    };
    // 外部传入者只能是正在办理原候选/部署的同一管理事务，不能来自浏览器。
    return tx ? run(tx as Tx) : input.database.$transaction(run, { isolationLevel: "ReadCommitted" });
  }
  async function row(tx: Tx): Promise<StoredTenantIntegration | undefined> {
    const rows = await tx.$queryRaw<StoredTenantIntegration[]>`
      SELECT id, tenantId, capability, provider, enabled, isDefault, settings, credentialsEncrypted,
        secretFields, updatedAt FROM tenant_integration_configs
      WHERE tenantId = ${platformTenant} AND capability = ${capability} AND provider = ${provider} FOR UPDATE`;
    if (!Array.isArray(rows) || rows.length > 1) throw unavailable();
    const value = rows[0];
    if (!value) return undefined;
    if (value.tenantId !== platformTenant || value.capability !== capability || value.provider !== provider
      || !(value.updatedAt instanceof Date) || !Number.isFinite(value.updatedAt.getTime())
      || ![false, true, 0, 1].includes(value.enabled)) throw unavailable();
    return { ...value, enabled: Boolean(value.enabled), isDefault: Boolean(value.isDefault) };
  }
  function allowed(value?: StoredTenantIntegration) {
    if (!value) return [];
    const parsed = z.object({ repositories }).strict().safeParse(value.settings);
    if (!parsed.success) throw unavailable();
    return parsed.data.repositories;
  }
  function credential(value?: StoredTenantIntegration): string | undefined {
    if (!value?.credentialsEncrypted) return undefined;
    try {
      const decoded = input.vault.decrypt(value.credentialsEncrypted);
      if (Object.keys(decoded).length !== 1 || !token.safeParse(decoded.token).success) return undefined;
      return decoded.token;
    } catch { return undefined; }
  }
  function summary(value?: StoredTenantIntegration): CorePackageSourceSettings {
    return { provider, enabled: value?.enabled ?? false, repositories: allowed(value),
      credentialConfigured: credential(value) !== undefined, revision: value?.updatedAt.toISOString() ?? null };
  }
  function requireSource(value: StoredTenantIntegration | undefined, repository: string) {
    if (!value?.enabled || !allowed(value).includes(repository)) throw denied();
    const secret = credential(value);
    if (!secret) throw unavailable();
    return { repository, token: secret };
  }
  return {
    settings: {
      read: () => locked(identity(), async tx => summary(await row(tx))),
      async save(value) {
        const request = CorePackageSourceSettingsRequestSchema.parse(value), original = identity();
        return locked(original, async tx => {
          const current = await row(tx);
          if ((current?.updatedAt.toISOString() ?? null) !== request.expectedRevision)
            throw new CoreAccessError("revision_conflict", "私有来源配置已变化，请重新读取后保存");
          const secret = request.revokeToken ? undefined : request.token ?? credential(current);
          if (request.enabled && !secret) throw unavailable();
          const encrypted = request.revokeToken ? null : request.token ? input.vault.encrypt({ token: request.token })
            : current?.credentialsEncrypted ?? null;
          const updatedAt = new Date(Math.max(now(), (current?.updatedAt.getTime() ?? 0) + 1));
          const settings = JSON.stringify({ repositories: request.repositories });
          const fields = JSON.stringify(encrypted ? ["token"] : []);
          if (current) await tx.$executeRaw`UPDATE tenant_integration_configs SET enabled = ${request.enabled},
            isDefault = 0, settings = ${settings}, credentialsEncrypted = ${encrypted}, secretFields = ${fields},
            updatedAt = ${updatedAt}, updatedBy = ${original.userId}, lastTestStatus = 'not_tested', lastTestMode = 'none',
            lastTestAt = NULL, lastTestError = NULL WHERE id = ${current.id} AND tenantId = ${platformTenant}`;
          else await tx.$executeRaw`INSERT INTO tenant_integration_configs
            (id, tenantId, capability, provider, enabled, isDefault, settings, credentialsEncrypted, secretFields,
             lastTestStatus, lastTestMode, updatedBy, createdAt, updatedAt)
            VALUES (${randomUUID()}, ${platformTenant}, ${capability}, ${provider}, ${request.enabled}, 0,
             ${settings}, ${encrypted}, ${fields}, 'not_tested', 'none', ${original.userId}, ${updatedAt}, ${updatedAt})`;
          // 审计仅记状态及修订，不保存仓库列表、密文或明文。
          const detail = JSON.stringify({ targetType: "core-package-source", targetId: provider,
            metadata: { enabled: request.enabled, revision: updatedAt.toISOString(), credentialAction:
              request.revokeToken ? "revoked" : request.token ? "rotated" : "retained" } });
          await tx.$executeRaw`INSERT INTO OperationLog (id, tenantId, userId, action, detail, createdAt)
            VALUES (${randomUUID()}, ${platformTenant}, ${original.userId}, ${"core.package.source.saved"}, ${detail}, ${updatedAt})`;
          return summary(await row(tx));
        });
      }
    },
    access: {
      async acquire(repository) {
        GitHubCoreRepositorySchema.parse(repository);
        const original = identity();
        const initial = await locked(original, async tx => {
          const value = await row(tx);
          return { row: value!, credential: requireSource(value, repository) };
        });
        return { scope: requestFingerprint({ ...original, configuration: initial.row.id, revision: initial.row.updatedAt.toISOString() }),
          credential: initial.credential,
          async revalidate(transaction) {
            await locked(original, async tx => {
              const current = await row(tx);
              requireSource(current, repository);
              if (!isDeepStrictEqual(current, initial.row)) throw new CoreAccessError("revision_conflict", "私有来源修订已变化，停止使用本次材料权限");
            }, transaction);
          } };
      }
    }
  };
}
