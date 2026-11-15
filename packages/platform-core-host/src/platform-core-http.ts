/** 公共Guard只准入受控模块的标准管理/范围/业务HTTP。最终对象及提交点仍由所属服务核验。 */
import { ForbiddenException, HttpException } from "@nestjs/common";
import { CoreAccessError } from "@rental-os/core-host";
import { CORE_SCOPE_HTTP, CORE_SESSION_HTTP, coreManagementHttpPolicy,
  createCoreManagementOpenApi, createCoreScopeOpenApi, createCoreSessionOpenApi, composeCoreOpenApi,
  type CoreOpenApiSource, type PlatformOpenApiDocument } from "@rental-os/core-contracts";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import type { CoreHostHttpApplication } from "./core-host.module";

export function createPlatformCoreHttpAccess(application: CoreHostHttpApplication): RegisteredCoreHttpAccess {
  const method = (verb: string) => verb.toUpperCase() === "HEAD" ? "GET" : verb.toUpperCase();
  const selfRoute = (verb: string, path: string) => method(verb) === CORE_SESSION_HTTP.method && path === `/${CORE_SESSION_HTTP.path}`
    || method(verb) === CORE_SCOPE_HTTP.method && path === `/${CORE_SCOPE_HTTP.path}`;
  return {
    registered(verb, path, audience) {
      return Boolean(coreManagementHttpPolicy(method(verb), path) || selfRoute(verb, path)
        || application.http.resolve(verb, path, audience));
    },
    async authorize(verb, path) {
      const identity = getRequestIdentity();
      if (!identity?.userId || identity.audience !== "operator") throw new ForbiddenException("缺少当前Core操作身份");
      const policy = coreManagementHttpPolicy(method(verb), path);
      if (policy) {
        const permissions = identity.permissions ?? [];
        const canManage = policy.audience === "saas" ? identity.isSaasAdmin && (permissions.includes("*") || permissions.includes(policy.permission))
          : !identity.isSaasAdmin && (identity.isPlatformAdmin || identity.dataScope === "all" && permissions.includes(policy.permission));
        if (!canManage) throw new ForbiddenException("当前主体缺少对应Core管理权限");
        return;
      }
      if (selfRoute(verb, path)) return;
      try { await application.authorizeHttp(verb, path); }
      catch (error) {
        if (error instanceof CoreAccessError) throw new HttpException({ code: error.code, message: error.message },
          error.code === "denied" ? 403 : error.code === "core_unavailable" ? 503 : 409);
        throw error;
      }
    }
  };
}

export function createPlatformCoreOpenApi(platform: PlatformOpenApiDocument, sources: readonly CoreOpenApiSource[] = []) {
  const document = structuredClone(platform);
  // 标准管理片段属于平台；Core片段仍通过其命名空间和公共schema引用校验。
  for (const contribution of [createCoreManagementOpenApi(), createCoreSessionOpenApi(), createCoreScopeOpenApi()]) {
    for (const [path, operations] of Object.entries(contribution.paths)) {
      if (document.paths[path]) throw new Error("公共Core接口文档路径与平台重复");
      document.paths[path] = operations;
    }
    for (const [name, schema] of Object.entries(contribution.schemas)) {
      if (document.components.schemas[name]) throw new Error("公共Core接口文档schema与平台重复");
      document.components.schemas[name] = schema;
    }
  }
  const composed = composeCoreOpenApi(document, sources);
  if (!composed.document) throw new Error(composed.issues.map(issue => `${issue.field}: ${issue.message}`).join("\n"));
  return composed.document;
}
