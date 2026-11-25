/** 存量 Rental 接入的只读准备入口。读取同一快照中的原身份/空间事实与 Core 记录，
 * 只给出具体 rental 的候选和差异；不执行授权、绑定、初始化或业务迁移。
 * 指纹、prepared、unchanged 都不是授权。后续执行者仍须在原管理事务重新核原身份、
 * 来源事实、当前修订、部署和订阅/业务政策；现有管理 HTTP 尚不接收此来源指纹。 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  CORE_MANAGEMENT_HTTP, CORE_MANAGEMENT_HTTP_BASE, CoreBindingSchema,
  MemberCoreAssignmentSchema, TenantCoreGrantSchema,
  type CoreBinding, type CoreScopeReference, type MemberCoreAssignment, type TenantCoreGrant
} from "@rental-os/core-contracts";
import { coreBindingScopeKey } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { RentalMysqlAuthenticationRepository } from "./mysql-auth-source";
import { RENTAL_CORE_ID, RENTAL_WORKSPACE_CONTAINER_TYPE } from "./core-identity";
import { rentalCorePermissionCodes } from "./permissions";
import { resolveUserBusinessLocationScope } from "./business-location-scope";

/** 私有 MySQL 读快照；不创建 Client，不借管理读取入口的锁表 upsert。 */
export interface RentalLegacyAccessPreparationDatabase {
  $transaction<T>(read: (transaction: Prisma.TransactionClient) => Promise<T>,
    options: { isolationLevel: "RepeatableRead" }): Promise<T>;
}
export interface RentalLegacyAccessPreparationInput {
  database: RentalLegacyAccessPreparationDatabase;
  /** 必须是宿主同库的原仓储。所有读取都显式传入上面的同一事务。 */
  authentication: Pick<RentalMysqlAuthenticationRepository, "findUserById" | "findWorkspaceScopedUser">;
}
export class RentalLegacyAccessPreparationError extends Error {
  constructor(readonly code: "invalid_request" | "source_unavailable" | "inconsistent_source", message: string) {
    super(message); this.name = "RentalLegacyAccessPreparationError";
  }
}

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
function evidence(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (Array.isArray(value)) return value.map(evidence);
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, evidence(item)]));
  }
  throw new RentalLegacyAccessPreparationError("inconsistent_source", "来源包含无法固定的事实");
}
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(evidence(value))).digest("hex");
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RentalLegacyAccessPreparationError("inconsistent_source", message);
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 200)
    throw new RentalLegacyAccessPreparationError("invalid_request", "须提供明确的原租户标识");
}
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
function rowsById<T extends { id: string; tenantId: string }>(rows: T[], tenantId: string, label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    ensure(row.tenantId === tenantId && typeof row.id === "string" && row.id.length && !map.has(row.id), `${label}缺失同租户唯一身份`);
    map.set(row.id, row);
  }
  return map;
}
function originalProjection(user: SystemUserRow) {
  ensure(Array.isArray(user.permissions) && user.permissions.every(code => typeof code === "string")
    && Array.isArray(user.roleIds) && user.roleIds.every(id => typeof id === "string")
    && ["all", "organization", "store", "own"].includes(user.dataScope)
    && ["operator", "car_shop", "store", "station"].includes(user.scope), "原身份投影缺少有效角色/数据范围");
  const locationScope = user.locationScope ?? null;
  if (locationScope) ensure(["all", "selected"].includes(locationScope.mode)
    && Array.isArray(locationScope.locationIds) && locationScope.locationIds.every(id => typeof id === "string"), "原地点范围不完整");
  // 不输出账号名、电话、密码、会话或令牌。原通配只保留为来源，候选不会写权限码。
  return { userId: user.id, tenantId: user.tenantId, organizationId: user.organizationId ?? null,
    roleIds: sorted(user.roleIds), scope: user.scope, dataScope: user.dataScope,
    locationScope: locationScope && { mode: locationScope.mode, locationIds: sorted(locationScope.locationIds) },
    isActive: user.isActive, isPlatformAdmin: user.isPlatformAdmin, isSaasAdmin: user.isSaasAdmin ?? false,
    mustChangePassword: user.mustChangePassword ?? false, permissions: sorted(user.permissions) };
}

type ManagementOperation = "tenantGrant" | "memberAssignment" | "bind";
function managementEntry(operation: ManagementOperation) {
  const entry = CORE_MANAGEMENT_HTTP[operation];
  return { operation, method: entry.method, path: `/${CORE_MANAGEMENT_HTTP_BASE}/${entry.path}`,
    audience: entry.audience, permission: entry.permission };
}
type Difference = "propose_missing" | "preserve_existing" | "preserve_revocation" | "defer";
function accessDifference(current: TenantCoreGrant | MemberCoreAssignment | null, eligible: boolean, reasons: string[]) {
  return { difference: (current?.state === "disabled" || current?.state === "revoked" ? "preserve_revocation"
    : current ? "preserve_existing" : eligible ? "propose_missing" : "defer") as Difference,
    expectedRevision: current?.revision ?? 0, current, reasons };
}
const roleSelect = { id: true, tenantId: true, isActive: true, fixedAllPermissions: true, scope: true,
  dataScope: true, enabledBusinessScopes: true, buttonPermissions: true, updatedAt: true,
  permissions: { select: { permission: { select: { id: true, code: true } } }, orderBy: { permissionId: "asc" } } } as const;

async function readSource(tx: Prisma.TransactionClient, tenantId: string) {
  // 只作普通读取。独立准备由RR固定快照；应用方先持原管理/来源锁，不在这里改变业务锁序。
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true, updatedAt: true } });
  if (!tenant) throw new RentalLegacyAccessPreparationError("source_unavailable", "原租户不存在，未生成候选");
  ensure(tenant.id === tenantId, "原租户身份不符");
  const users = await tx.user.findMany({ where: { tenantId }, orderBy: { id: "asc" }, select: {
    id: true, tenantId: true, isActive: true, isSaasAdmin: true, isPlatformAdmin: true, mustChangePassword: true,
    roleId: true, organizationId: true, tokenVersion: true, updatedAt: true,
    roleAssignments: { select: { roleId: true, createdAt: true }, orderBy: { roleId: "asc" } }
  } });
  const roles = await tx.role.findMany({ where: { tenantId }, select: roleSelect, orderBy: { id: "asc" } });
  const workspaces = await tx.businessWorkspace.findMany({ where: { tenantId }, orderBy: { id: "asc" }, select: {
    id: true, tenantId: true, status: true, categoryCode: true, categoryVersionId: true, categoryAdoptionRevision: true,
    isDefault: true, runMode: true, updatedAt: true
  } });
  const members = await tx.workspaceMember.findMany({ where: { tenantId }, orderBy: [{ workspaceId: "asc" }, { userId: "asc" }], select: {
    tenantId: true, workspaceId: true, userId: true, roleId: true, isActive: true, dataScope: true, locationScope: true, updatedAt: true
  } });
  const organizations = await tx.organizationUnit.findMany({ where: { tenantId }, orderBy: { id: "asc" }, select: {
    id: true, tenantId: true, parentId: true, status: true, type: true, updatedAt: true
  } });
  const locations = await tx.rentalFulfillmentLocation.findMany({ where: { tenantId }, orderBy: { id: "asc" }, select: {
    id: true, tenantId: true, workspaceId: true, organizationId: true, status: true, updatedAt: true
  } });
  // 原订阅服务保留“到期只停新业务”的分类；准备器仅固定其事实，不计算另一套权益。
  const subscription = await tx.tenantSubscription.findUnique({ where: { tenantId }, select: {
    id: true, tenantId: true, revision: true, plan: true, source: true, startAt: true, endAt: true, updatedAt: true
  } });
  const subscriptionSegments = await tx.tenantSubscriptionSegment.findMany({ where: { tenantId }, orderBy: { id: "asc" }, select: {
    id: true, tenantId: true, status: true, plan: true, source: true, startAt: true, endAt: true, createdAt: true
  } });
  const userMap = rowsById(users, tenantId, "账号"), roleMap = rowsById(roles, tenantId, "角色"),
    workspaceMap = rowsById(workspaces, tenantId, "空间"), organizationMap = rowsById(organizations, tenantId, "组织");
  rowsById(locations, tenantId, "地点"); rowsById(subscriptionSegments, tenantId, "订阅分段");
  ensure(!subscription || subscription.tenantId === tenantId && Number.isSafeInteger(subscription.revision) && subscription.revision > 0,
    "原订阅修订或租户不符");
  for (const user of users) {
    ensure((!user.roleId || roleMap.has(user.roleId)) && (!user.organizationId || organizationMap.has(user.organizationId))
      && user.roleAssignments.every(edge => roleMap.has(edge.roleId)), "原账号引用缺少同租户角色或组织");
  }
  for (const role of roles) {
    ensure(Array.isArray(role.enabledBusinessScopes) && role.enabledBusinessScopes.every(code => typeof code === "string")
      && (role.buttonPermissions === null || Array.isArray(role.buttonPermissions)
        && role.buttonPermissions.every(code => typeof code === "string")), "原角色范围或按钮权限不是有效记录");
  }
  const memberKeys = new Set<string>();
  for (const member of members) {
    const key = JSON.stringify([member.workspaceId, member.userId]);
    ensure(member.tenantId === tenantId && userMap.has(member.userId) && workspaceMap.has(member.workspaceId)
      && (!member.roleId || roleMap.has(member.roleId)) && !memberKeys.has(key), "原空间成员引用不完整或跨租户");
    memberKeys.add(key);
  }
  for (const workspace of workspaces) ensure(Number.isSafeInteger(workspace.categoryAdoptionRevision)
    && workspace.categoryAdoptionRevision >= 0 && typeof workspace.categoryCode === "string" && workspace.categoryCode.length,
  "原空间品类采纳证据不完整");
  for (const organization of organizations) ensure(!organization.parentId || organizationMap.has(organization.parentId), "原组织父级不属于同一租户");
  for (const location of locations) ensure(workspaceMap.has(location.workspaceId)
    && (!location.organizationId || organizationMap.has(location.organizationId)), "原地点引用不属于同租户空间/组织");
  // 同一事务的全量集合已核边界；后续仍调用原仓储投影，不从这些 JSON 重造权限。
  return { tenant, users, roles, workspaces, members, organizations, locations, subscription, subscriptionSegments };
}

async function readCoreRecords(tx: Prisma.TransactionClient, tenantId: string) {
  const grants = await tx.$queryRaw<Array<{ tenantId: string; coreId: string; state: string; revision: number | bigint; operationId: string }>>`
    SELECT tenant_id AS tenantId, core_id AS coreId, state, revision, operation_id AS operationId
    FROM platform_tenant_core_grants WHERE tenant_id = ${tenantId} AND core_id = ${RENTAL_CORE_ID}`;
  const assignments = await tx.$queryRaw<Array<{ tenantId: string; coreId: string; userId: string; state: string; revision: number | bigint; operationId: string }>>`
    SELECT tenant_id AS tenantId, core_id AS coreId, user_id AS userId, state, revision, operation_id AS operationId
    FROM platform_member_core_assignments WHERE tenant_id = ${tenantId} AND core_id = ${RENTAL_CORE_ID} ORDER BY user_id`;
  const bindings = await tx.$queryRaw<Array<{ tenantId: string; coreId: string; scopeHash: string; bindingId: string;
    revision: number | bigint; dataVersion: string; containerType: string | null; containerId: string | null }>>`
    SELECT tenant_id AS tenantId, core_id AS coreId, scope_hash AS scopeHash, binding_id AS bindingId, revision,
      data_version AS dataVersion, container_type AS containerType, container_id AS containerId
    FROM platform_core_bindings WHERE tenant_id = ${tenantId} AND core_id = ${RENTAL_CORE_ID} ORDER BY scope_hash`;
  const own = (row: { tenantId: string; coreId: string }) => ensure(row.tenantId === tenantId && row.coreId === RENTAL_CORE_ID, "Core记录不属于原租户 Rental");
  ensure(grants.length <= 1, "原Core授权记录不唯一");
  const grant = grants.map(row => { own(row); return TenantCoreGrantSchema.parse({ ...row, revision: Number(row.revision) }); })[0] ?? null;
  const assignmentMap = new Map<string, MemberCoreAssignment>();
  for (const row of assignments) {
    own(row); ensure(!assignmentMap.has(row.userId), "原Core成员记录不唯一");
    assignmentMap.set(row.userId, MemberCoreAssignmentSchema.parse({ ...row, revision: Number(row.revision) }));
  }
  const bindingMap = new Map<string, CoreBinding>();
  for (const row of bindings) {
    own(row);
    const value = CoreBindingSchema.parse({ tenantId: row.tenantId, coreId: row.coreId, bindingId: row.bindingId,
      revision: Number(row.revision), dataVersion: row.dataVersion,
      ...(row.containerType !== null || row.containerId !== null ? { container: { type: row.containerType, id: row.containerId } } : {}) });
    const key = coreBindingScopeKey(value);
    ensure(createHash("sha256").update(key).digest("hex") === row.scopeHash && !bindingMap.has(key)
      && (!value.container || value.container.type === RENTAL_WORKSPACE_CONTAINER_TYPE), "原绑定范围或指纹不符");
    bindingMap.set(key, value);
  }
  return { grant, assignments: [...assignmentMap.values()], bindings: [...bindingMap.values()] };
}

/** 复用同一来源读取与投影。调用者拥有事务；本函数不取得锁、不授予权限。
 * 独立准备由下方RR事务承载，应用参加者必须先持原管理父锁及完整来源锁。 */
export async function readRentalLegacyAccessPreparation(transaction: Prisma.TransactionClient,
  authentication: RentalLegacyAccessPreparationInput["authentication"], tenantId: string) {
  identifier(tenantId);
  const tx = transaction;
  const source = await readSource(tx, tenantId), core = await readCoreRecords(tx, tenantId);
  const scope = (workspaceId?: string): CoreScopeReference => ({ coreId: RENTAL_CORE_ID, tenantId,
    ...(workspaceId ? { container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: workspaceId } } : {}) });
  const prepareMember = async (user: typeof source.users[number]) => {
    const current = core.assignments.find(row => row.userId === user.id) ?? null;
    const original = await authentication.findUserById(user.id, tx);
    ensure(!original || original.id === user.id && original.tenantId === tenantId, "原身份仓储返回另一租户/账号");
    ensure(Boolean(original) === (source.tenant.status === "ACTIVE" && user.isActive), "原身份有效性与同事务事实不符");
    const reasons: string[] = [];
    if (source.tenant.status !== "ACTIVE") reasons.push("tenant_inactive");
    if (!user.isActive) reasons.push("user_inactive");
    if (user.isSaasAdmin) reasons.push("saas_identity_not_rental_member");
    // 改密是当次使用门槛，不是永久撤销：已有 assignment 无论状态均原样保留。
    if (user.mustChangePassword) reasons.push("password_change_required_reprepare_later");
    const tenantProjection = original ? originalProjection(original) : null;
    const tenantCodes = original ? rentalCorePermissionCodes({ audience: "operator", tenantUser: original }) : [];
    const workspaces = [];
    for (const member of source.members.filter(row => row.userId === user.id)) {
      const workspace = source.workspaces.find(row => row.id === member.workspaceId)!;
      const scoped = original ? await authentication.findWorkspaceScopedUser(user.id, workspace.id, original, tx) : undefined;
      ensure(!scoped || scoped.id === user.id && scoped.tenantId === tenantId, "原空间投影返回另一租户/账号");
      ensure(Boolean(scoped) === Boolean(original && member.isActive && workspace.status === "ACTIVE"), "原空间成员投影与同事务事实不符");
      let businessLocationScope = null;
      if (scoped) {
        businessLocationScope = await resolveUserBusinessLocationScope(scoped, workspace.id,
          scoped.locationScope ?? { mode: "all", locationIds: [] }, tx);
      }
      const projected = scoped ? originalProjection(scoped) : null;
      const codes = original && scoped ? rentalCorePermissionCodes({ audience: "operator", tenantUser: original,
        workspaceUser: scoped, workspaceId: workspace.id }).filter(code => !tenantCodes.includes(code)) : [];
      workspaces.push({ workspaceId: workspace.id, memberActive: member.isActive, workspaceStatus: workspace.status,
        roleId: member.roleId, original: projected, businessLocationScope, operatorDirectoryCodes: codes });
    }
    const eligible = reasons.length === 0 && (tenantCodes.length > 0 || workspaces.some(row => row.operatorDirectoryCodes.length > 0));
    if (!eligible && !reasons.length) reasons.push("no_current_registered_rental_permission");
    if (core.grant?.state === "disabled") reasons.push("current_core_disabled_preserved");
    if (current?.state === "revoked") reasons.push("current_assignment_revoked_preserved");
    const difference = accessDifference(current, eligible && core.grant?.state !== "disabled", reasons);
    return { userId: user.id, original: tenantProjection, tenantDirectoryCodes: tenantCodes, workspaces, ...difference,
      management: managementEntry("memberAssignment"),
      proposal: difference.difference === "propose_missing" ? { coreId: RENTAL_CORE_ID, userId: user.id,
        state: "assigned" as const, expectedRevision: 0 } : null };
  };
  const members: Awaited<ReturnType<typeof prepareMember>>[] = [];
  for (const user of source.users) members.push(await prepareMember(user));
  // 不因缺失/停用账号自动撤销历史 assignment；孤立记录只列为待核证据。
  const unlocatedAssignments = core.assignments.filter(row => !source.users.some(user => user.id === row.userId));
  const tenantEligible = source.tenant.status === "ACTIVE" && members.some(member =>
    member.difference === "propose_missing" || member.current?.state === "assigned"
      && (member.tenantDirectoryCodes.length > 0 || member.workspaces.some(row => row.operatorDirectoryCodes.length > 0)));
  const grant = { ...accessDifference(core.grant, tenantEligible, tenantEligible ? [] : ["no_current_legacy_rental_authority"]),
    management: managementEntry("tenantGrant"),
    proposal: !core.grant && tenantEligible ? { tenantId, coreId: RENTAL_CORE_ID, state: "enabled" as const, expectedRevision: 0 } : null };
  const scopes = [scope(), ...source.workspaces.map(workspace => scope(workspace.id))];
  const bindings = scopes.map(target => {
    const current = core.bindings.find(binding => coreBindingScopeKey(binding) === coreBindingScopeKey(target)) ?? null;
    const eligible = core.grant?.state !== "disabled" && members.some(member => member.current?.state !== "revoked"
      && (target.container ? member.workspaces.some(row => row.workspaceId === target.container?.id && row.operatorDirectoryCodes.length)
        : member.tenantDirectoryCodes.length));
    return { scope: target, current, expectedRevision: current?.revision ?? 0,
      difference: (current ? "preserve_existing" : eligible ? "propose_missing" : "defer") as Difference,
      management: managementEntry("bind"),
      // 不提供 configuration 或新的品类；原空间及其采纳修订已在 source 中固定。
      proposal: !current && eligible ? { coreId: RENTAL_CORE_ID, ...(target.container ? { container: target.container } : {}), expectedRevision: 0 } : null };
  });
  const comparisons = members.flatMap(member => [
    { scope: scope(), codes: member.tenantDirectoryCodes, original: member.original },
    ...member.workspaces.map(workspace => ({ scope: scope(workspace.workspaceId), codes: workspace.operatorDirectoryCodes,
      original: { user: workspace.original, businessLocationScope: workspace.businessLocationScope } }))
  ].map(item => {
    const binding = bindings.find(row => coreBindingScopeKey(row.scope) === coreBindingScopeKey(item.scope))!;
    const currentOpen = grant.current?.state === "enabled" && member.current?.state === "assigned" && Boolean(binding.current);
    const proposedOpen = (grant.current?.state === "enabled" || Boolean(grant.proposal))
      && (member.current?.state === "assigned" || Boolean(member.proposal)) && Boolean(binding.current || binding.proposal);
    return { userId: member.userId, scope: item.scope, originalScopeFingerprint: fingerprint(item.original),
      originalDirectoryCodes: item.codes, currentMappingCodes: currentOpen ? item.codes : [],
      conditionalPreparedMappingCodes: proposedOpen ? item.codes : [],
      difference: item.codes.length === 0 || currentOpen ? "unchanged" : proposedOpen ? "missing_mapping_candidate" : "restricted_preserved" };
  }));
  const originalEvidence = evidence(source), currentCoreEvidence = evidence(core);
  // 投影也进入原事实指纹，原投影算法/范围变化同样使旧候选失效。
  const sourceFingerprint = fingerprint({ source: originalEvidence, projections: members.map(member => ({ userId: member.userId,
    original: member.original, tenantDirectoryCodes: member.tenantDirectoryCodes, workspaces: member.workspaces })) });
  const coreFingerprint = fingerprint(currentCoreEvidence);
  return { status: "prepared" as const, formatVersion: 1 as const, coreId: RENTAL_CORE_ID, tenantId,
    sourceFingerprint, coreFingerprint, originalEvidence, currentCoreEvidence, grant, members, bindings, unlocatedAssignments,
    unlocatedBindings: core.bindings.filter(binding => !scopes.some(target => coreBindingScopeKey(target) === coreBindingScopeKey(binding))),
    comparison: { scope: "grant_assignment_binding_only" as const, projection: "original_operator_directory" as const,
      // 每行比较的只是附加 Core 映射；不把 operator 目录当 staff/client 路由的准入证据。
      routeAuthorizationVerified: false as const, rows: comparisons },
    execution: { supported: false as const, runtimeAuthority: false as const,
      required: ["original_management_identity_and_same_transaction_source_revalidation", "current_expected_revision_and_original_operation_receipt",
        "registered_core_deployment_data_version_and_readiness", "original_auth_guard_audience_resource_and_subscription_policy"] as const } };
}

export function createRentalLegacyAccessPreparation(input: RentalLegacyAccessPreparationInput) {
  async function prepare(tenantId: string) {
    identifier(tenantId);
    return input.database.$transaction(tx => readRentalLegacyAccessPreparation(tx, input.authentication, tenantId), { isolationLevel: "RepeatableRead" });
  }
  return {
    prepare,
    /** 比较只是另一个只读快照；即使 unchanged，管理事务仍必须当次复验，不能直接 apply。 */
    async compare(previous: { tenantId: string; sourceFingerprint: string; coreFingerprint: string }) {
      identifier(previous.tenantId);
      if (![previous.sourceFingerprint, previous.coreFingerprint].every(value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)))
        throw new RentalLegacyAccessPreparationError("invalid_request", "缺少原准备快照指纹");
      const current = await prepare(previous.tenantId);
      const changed = [current.sourceFingerprint !== previous.sourceFingerprint ? "original_facts" : null,
        current.coreFingerprint !== previous.coreFingerprint ? "core_records" : null].filter((value): value is string => value !== null);
      return { status: changed.length ? "stale" as const : "unchanged" as const, changed, current, runtimeAuthority: false as const };
    }
  };
}

export type RentalLegacyAccessPreparation = ReturnType<typeof createRentalLegacyAccessPreparation>;
export type RentalLegacyAccessPrepared = Awaited<ReturnType<RentalLegacyAccessPreparation["prepare"]>>;
