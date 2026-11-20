/** 存量 Rental 映射的显式单项应用。内建原平台管理服务及同事务来源参加者，
 * 不接收管理员身份、不批量授权、不修改原角色/空间/品类或重新初始化行业事实。
 * 准备指纹只固定待确认来源；当次原 Auth、管理权限、Core版本、收据、审计仍决定能否提交。
 * 提交应答未知沿原 operationId 查询，不换键、不自动重试，不把缺收据解释为未提交。 */
import type { Prisma } from "@prisma/client";
import type { CoreServerRegistration } from "@rental-os/core-contracts";
import { coreBindingScopeKey, type CoreBindingRequest, type CoreManagementRequest,
  type CoreDeploymentAvailability } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import { composePlatformCoreBindings, composePlatformCoreManagement,
  type PlatformCoreAudit, type PlatformCoreTermPolicy } from "@rental-os/platform-core-host";
import { RENTAL_CORE_ID, RENTAL_WORKSPACE_CONTAINER_TYPE } from "./core-identity";
import { readRentalLegacyAccessPreparation, type RentalLegacyAccessPrepared,
  type RentalLegacyAccessPreparationInput } from "./legacy-access-preparation";

type Transaction = Prisma.TransactionClient;
export interface RentalLegacyAccessAdoptionInput {
  database: CoreHostSqlClient<Transaction>;
  authentication: RentalLegacyAccessPreparationInput["authentication"];
  audit: PlatformCoreAudit<Transaction>;
  term: PlatformCoreTermPolicy<Transaction>;
  deployment: CoreDeploymentAvailability;
  registrations: ReadonlyMap<string, CoreServerRegistration>;
  /** 宿主原 Rental 容器授权参加者；必须使用传入的同一事务，不能用 prepared 自证。 */
  authorizeContainer: NonNullable<Parameters<typeof composePlatformCoreBindings<Transaction>>[0]["authorizeContainer"]>;
}
export interface RentalLegacyAccessConfirmation {
  tenantId: string;
  sourceFingerprint: string;
  coreFingerprint: string;
}
interface Operation {
  confirmed: RentalLegacyAccessConfirmation;
  operationId: string;
  expectedRevision: number;
}
export class RentalLegacyAccessAdoptionError extends Error {
  constructor(readonly code: "invalid_request" | "source_changed" | "mapping_not_prepared" | "source_unavailable", message: string) {
    super(message); this.name = "RentalLegacyAccessAdoptionError";
  }
}
type Selection = { kind: "tenant_grant" } | { kind: "member_assignment"; userId: string }
  | { kind: "binding"; workspaceId?: string };

function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 200)
    throw new RentalLegacyAccessAdoptionError("invalid_request", "须提供明确的原对象标识");
}
function confirmation(value: RentalLegacyAccessConfirmation): RentalLegacyAccessConfirmation {
  if (!value || typeof value !== "object") throw new RentalLegacyAccessAdoptionError("invalid_request", "缺少已确认的准备来源");
  identifier(value.tenantId);
  if (![value.sourceFingerprint, value.coreFingerprint].every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash)))
    throw new RentalLegacyAccessAdoptionError("invalid_request", "缺少有效的原来源/记录指纹");
  // 异步开始后不再读取调用者可变的对象。指纹不是管理权限或来源事实。
  return { tenantId: value.tenantId, sourceFingerprint: value.sourceFingerprint, coreFingerprint: value.coreFingerprint };
}
function sameTenant(actual: string, expected: string) {
  if (actual !== expected) throw new RentalLegacyAccessAdoptionError("invalid_request", "映射操作不属于原管理主体的租户");
}

export function createRentalLegacyAccessAdoption(input: RentalLegacyAccessAdoptionInput) {
  const registration = input.registrations.get(RENTAL_CORE_ID);
  const registrations = new Map<string, CoreServerRegistration>(registration ? [[RENTAL_CORE_ID, registration]] : []);

  function precondition(confirmed: RentalLegacyAccessConfirmation, selection: Selection, expectedRevision: number) {
    return async (tx: Transaction, request: CoreManagementRequest | CoreBindingRequest) => {
      const scope = { tenantId: confirmed.tenantId, coreId: RENTAL_CORE_ID,
        ...(selection.kind === "binding" && selection.workspaceId
          ? { container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: selection.workspaceId } } : {}) };
      const requestMatches = selection.kind === "binding"
        ? "scope" in request && request.purpose === "initialize" && coreBindingScopeKey(request.scope) === coreBindingScopeKey(scope)
        : "kind" in request && request.kind === selection.kind && request.tenantId === confirmed.tenantId
          && request.coreId === RENTAL_CORE_ID && request.enabling && request.purpose !== "original_receipt"
          && request.targetMemberId === (selection.kind === "member_assignment" ? selection.userId : undefined);
      if (!requestMatches) throw new RentalLegacyAccessAdoptionError("invalid_request", "来源参加者与原管理操作不一致");

      // 原 principal 已按序持有 Tenant X → actor/target User → Session/Role → Core。
      // management.run/邀请/订阅写方持 Tenant X；空间/成员/地点/品类写方持 Tenant S。
      // 登录和本人/本地demo改密可直接写User，因此完整来源还需锁住其余User行。
      // demo改密跨租户循环且不持父锁；NOWAIT避免在已持actor锁后新增逆序等待，失败不重试。
      // 不新增Workspace锁，保持原订单/空间锁序。新增User由原管理父锁/FK父锁排斥。
      const locked = await tx.$queryRaw<Array<{ id: string; tenantId: string }>>`
        SELECT id, tenantId FROM \`User\` WHERE tenantId = ${confirmed.tenantId} ORDER BY id FOR UPDATE NOWAIT`;
      if (locked.some(row => row.tenantId !== confirmed.tenantId || typeof row.id !== "string")
        || new Set(locked.map(row => row.id)).size !== locked.length)
        throw new RentalLegacyAccessAdoptionError("source_unavailable", "来源账号锁缺少同租户唯一身份");
      const current = await readRentalLegacyAccessPreparation(tx, input.authentication, confirmed.tenantId);
      if (JSON.stringify(locked.map(row => row.id).sort()) !== JSON.stringify(current.members.map(row => row.userId).sort()))
        throw new RentalLegacyAccessAdoptionError("source_unavailable", "来源账号集合未完整锁定");
      if (current.sourceFingerprint !== confirmed.sourceFingerprint || current.coreFingerprint !== confirmed.coreFingerprint)
        throw new RentalLegacyAccessAdoptionError("source_changed", "准备后的原授权或Core记录已变化，请重新核对");
      requireCandidate(current, selection, expectedRevision);
      return { async revalidate() {
        // Core写入是本次原服务的预期结果，不与旧Core指纹作比较；原来源全程受锁保护。
        const latest = await readRentalLegacyAccessPreparation(tx, input.authentication, confirmed.tenantId);
        if (latest.sourceFingerprint !== current.sourceFingerprint)
          throw new RentalLegacyAccessAdoptionError("source_changed", "提交前原授权来源发生变化");
      } };
    };
  }

  function requireCandidate(prepared: RentalLegacyAccessPrepared, selection: Selection, revision: number) {
    const reject = () => { throw new RentalLegacyAccessAdoptionError("mapping_not_prepared", "当前原事实不支持该单项映射，停用/撤回记录不会自动恢复"); };
    if (selection.kind === "tenant_grant") {
      if (prepared.grant.difference !== "propose_missing" || !prepared.grant.proposal || revision !== prepared.grant.expectedRevision) reject();
    } else if (selection.kind === "member_assignment") {
      const member = prepared.members.find(row => row.userId === selection.userId);
      if (!member || member.difference !== "propose_missing" || !member.proposal || revision !== member.expectedRevision) reject();
    } else {
      const binding = prepared.bindings.find(row => row.scope.container?.id === selection.workspaceId);
      if (!binding || revision !== binding.expectedRevision
        || binding.difference !== "propose_missing" && binding.difference !== "preserve_existing") reject();
      // 存量接入只建立标准映射。现行Rental server没有initialize；未来加入新初始化器须另核，
      // 不能在存量绑定缺失时把行业初始化混入应用。原existing分支仍由原服务复用且不init。
      if (binding && !binding.current && registration?.server.initialization)
        throw new RentalLegacyAccessAdoptionError("source_unavailable", "存量映射不能执行新增的行业初始化器");
    }
  }
  const receiptOnly = async () => { throw new RentalLegacyAccessAdoptionError("invalid_request", "原收据读取不能执行新映射"); };
  const management = (hook: ReturnType<typeof precondition> | typeof receiptOnly) => composePlatformCoreManagement<Transaction>({
    database: input.database, users: input.authentication, audit: input.audit, deployment: input.deployment, mutationPrecondition: hook
  });
  const bindings = (hook: ReturnType<typeof precondition> | typeof receiptOnly) => composePlatformCoreBindings<Transaction>({
    database: input.database, users: input.authentication, audit: input.audit, deployment: input.deployment,
    term: input.term, registrations, authorizeContainer: input.authorizeContainer, mutationPrecondition: hook
  });
  return {
    /** 只能补缺失Rental grant，SaaS管理权限仍由原principal从当前ALS/会话核定。 */
    grantTenant(operation: Operation) {
      const confirmed = confirmation(operation.confirmed), original = management(precondition(confirmed, { kind: "tenant_grant" }, operation.expectedRevision));
      return original.service.changeTenantGrant(original.principals.current(), { tenantId: confirmed.tenantId, coreId: RENTAL_CORE_ID,
        state: "enabled", operationId: operation.operationId, expectedRevision: operation.expectedRevision });
    },
    assignMember(operation: Operation & { userId: string }) {
      identifier(operation.userId);
      const confirmed = confirmation(operation.confirmed), original = management(precondition(confirmed,
        { kind: "member_assignment", userId: operation.userId }, operation.expectedRevision)), actor = original.principals.current();
      sameTenant(actor.tenantId, confirmed.tenantId);
      return original.service.changeMemberAssignment(actor, { coreId: RENTAL_CORE_ID, userId: operation.userId,
        state: "assigned", operationId: operation.operationId, expectedRevision: operation.expectedRevision });
    },
    bindScope(operation: Operation & { workspaceId?: string }) {
      if (operation.workspaceId !== undefined) identifier(operation.workspaceId);
      const confirmed = confirmation(operation.confirmed), original = bindings(precondition(confirmed,
        { kind: "binding", workspaceId: operation.workspaceId }, operation.expectedRevision)), actor = original.principals.current();
      sameTenant(actor.tenantId, confirmed.tenantId);
      return original.service.bind(actor, { coreId: RENTAL_CORE_ID, operationId: operation.operationId, expectedRevision: operation.expectedRevision,
        ...(operation.workspaceId ? { container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: operation.workspaceId } } : {}) });
    },
    readTenantGrantOperation(query: { tenantId: string; operationId: string }) {
      const original = management(receiptOnly);
      return original.service.readTenantGrantOperation(original.principals.current(), { ...query, coreId: RENTAL_CORE_ID });
    },
    readMemberAssignmentOperation(query: { userId: string; operationId: string }) {
      const original = management(receiptOnly);
      return original.service.readMemberAssignmentOperation(original.principals.current(), { ...query, coreId: RENTAL_CORE_ID });
    },
    readBindingOperation(query: { workspaceId?: string; operationId: string }) {
      if (query.workspaceId !== undefined) identifier(query.workspaceId);
      const original = bindings(receiptOnly);
      return original.service.readOperation(original.principals.current(), { coreId: RENTAL_CORE_ID, operationId: query.operationId,
        ...(query.workspaceId ? { container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: query.workspaceId } } : {}) });
    }
  };
}

export type RentalLegacyAccessAdoption = ReturnType<typeof createRentalLegacyAccessAdoption>;
