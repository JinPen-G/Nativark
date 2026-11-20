/** 可选 Rental + AI Native 的同实例组合。只复用原 AI factories、Gateway/账、ACL 和请求工厂。
 * 本入口不导入旧 AppModule、不启动业务生命周期，也不把数据锁声明当作物理部署就绪。
 * 当前 AI 数据有 Rental 外键，仍使用公共 40 + Rental 121 + AI 86 模型；
 * 额外 Core 沿原宿主固定包/raw SQL 接点核验，不提供 Rental AI 的身份或权限。 */
import { Global, Module, type DynamicModule, type FactoryProvider, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PrismaClient } from "@prisma/client";
import { CoreDeploymentLockSchema, checkCoreCombination, checkPlatformDataCapabilities,
  coreDeploymentHostVersions, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { AI_NATIVE_DATA_PACKAGE_VERSION } from "@rental-os/ai-native-data/data-package";
import { AI_NATIVE_DATA_PREREQUISITES } from "@rental-os/ai-native-data/preparation";
import { PrismaBusinessFailureOutbox, BUSINESS_FAILURE_OUTBOX, type BusinessFailureResourcePorts } from "@rental-os/ai-native-server/business-events/prisma-business-failure-outbox";
import { createNotificationDraftBodyRetentionReader, notificationDraftRetentionState,
  notificationDraftRetentionReceiptId } from "@rental-os/ai-native-server/privacy/notification-draft-reader";
import type { RentalApplication, RentalApplicationParticipants } from "@rental-os/rental-core/application";
import type { RentalAuthorizationGuard } from "@rental-os/rental-core/http-auth";
import type { RentalCustomerManagementApplication } from "@rental-os/rental-core/customer-management";
import type { FileBusinessOwner } from "@rental-os/rental-core/file-application-runtime";
import { assertRentalBusinessTenantAccessAfterLock, hasRentalBusinessTenantFence, lockRentalBusinessTenant } from "@rental-os/rental-core/mysql-business-fence";
import { resolveUserBusinessLocationScope } from "@rental-os/rental-core/business-location-scope";
import { captureRentalInternalAuthority } from "@rental-os/rental-core/application-internal-authority";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { FileStoragePrimitives } from "@rental-os/platform-server/files";
import { PlatformOperationLogService } from "@rental-os/platform-server/operation-log";
import * as original from "@rental-os/ai-native-server/runtime/ai-native-application.providers";
import { createAiBodyStorageDatabase } from "@rental-os/ai-native-server/runtime/privacy/prisma-ai-body-storage";
import { CoreBusinessFailureResourceSource } from "@rental-os/ai-native-server/runtime/business-events/core-business-failure-resource.source";
import { RuntimeBusinessFailureConfigurationSource } from "@rental-os/ai-native-server/runtime/business-events/business-failure-configuration";
import { StaffInspectionRequestFactory } from "@rental-os/ai-native-server/runtime/inspection-assist/inspection-assist.composition";
import { AI_STAFF_INSPECTION_REQUESTS, AI_STAFF_INSPECTION_OPERATIONS } from "@rental-os/ai-native-server/runtime/inspection-assist/staff-inspection-assist.controller";
import { InspectionAssistError } from "@rental-os/ai-native-server/runtime/inspection-assist/inspection-assist.validation";
import { readInspectionMedia } from "@rental-os/ai-native-server/runtime/inspection-assist/inspection-media.reader";
import { FileAiRetentionParticipant } from "@rental-os/ai-native-server/runtime/integrations/file-ai-retention.participant";
import { AiCreditService } from "@rental-os/ai-native-server/runtime/budget/ai-credit.service";
import { PrismaService } from "@rental-os/ai-native-server/runtime/rental-adapters/prisma.service";
import { SecretBox } from "@rental-os/platform-server/secret-box";
import { OperationLogService } from "@rental-os/ai-native-server/runtime/rental-adapters/operation-log.service";
import { ApiAuthGuard } from "@rental-os/ai-native-server/runtime/rental-adapters/api-auth.guard";
import { AuthService } from "@rental-os/ai-native-server/runtime/rental-adapters/auth.service";
import { SubscriptionService } from "@rental-os/platform-server/subscription";
import { ClientApiService } from "@rental-os/rental-core/mysql-client-application";
import { ClientAuthService } from "@rental-os/rental-core/mysql-client-auth";
import { ClientDeliveryAddressService } from "@rental-os/rental-core/mysql-client-delivery-address";
import { RentalCoreService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-core.service";
import { RentalBusinessService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-business.service";
import { RentalCoreFactRepository } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-core-fact.repository";
import { RentalBusinessFactRepository } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-business-fact.repository";
import { RentalCoreConfigRepository } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-core-config.repository";
import { RentalBusinessConfigRepository } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-business-config.repository";
import { RentalAllocationService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-allocation.service";
import { RentalFundingService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-funding.service";
import { RentalIdempotencyRepository } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-idempotency.repository";
import { RentalOrderConfirmationService } from "@rental-os/ai-native-server/runtime/rental-adapters/rental-order-confirmation.service";
import { RentalWorkspaceReportRepository } from "@rental-os/rental-core/mysql-reports";
import { WorkspaceCapabilityService } from "@rental-os/ai-native-server/runtime/rental-adapters/workspace-capability.service";
import { EnterpriseMerchantDelegationService } from "@rental-os/rental-core/mysql-enterprise-merchant-delegation";
import { MembershipService } from "@rental-os/rental-core/mysql-membership";
import { PlatformService } from "@rental-os/ai-native-server/runtime/rental-adapters/platform.service";
import { PaymentRuntimeService } from "@rental-os/ai-native-server/runtime/rental-adapters/payment.runtime.service";
import { FileStorageRuntimeService } from "@rental-os/ai-native-server/runtime/rental-adapters/file-storage.runtime.service";
import { TenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import { KnowledgeCurrentSession } from "@rental-os/ai-native-server/runtime/knowledge/knowledge-current-session";
import { PrismaKnowledgeFileAccess } from "@rental-os/ai-native-server/runtime/knowledge/prisma-knowledge-file-access";
import { PrismaKnowledgeActionPolicySource } from "@rental-os/ai-native-server/runtime/knowledge/prisma-knowledge-policy.source";
import { FormalKnowledgeAuthorizationAdapter } from "@rental-os/ai-native-server/runtime/knowledge/formal-knowledge-authorization.adapter";
import { KnowledgeCommitUnknownError, KnowledgeError } from "@rental-os/ai-native-server/runtime/knowledge/knowledge-errors";
import { knowledgeReadHash } from "@rental-os/ai-native-server/runtime/knowledge/knowledge-sensitive-read.audit";
import { knowledgeUploadRevisionSchema, knowledgeUploadKey } from "@rental-os/ai-native-server/runtime/knowledge/human-knowledge-upload.service";
import { parse as parseKnowledge } from "@rental-os/ai-native-server/runtime/knowledge/knowledge-validation";
import { TenantKnowledgeObjectReader } from "@rental-os/ai-native-server/runtime/integrations/knowledge-object-reader";
import { createNativeModelEgressTransport } from "@rental-os/ai-native-server/runtime/model-egress.transport";
import { AI_NATIVE_HTTP_HOST_PUBLICATION, type AiNativeHttpHostPublication } from "@rental-os/ai-native-server/runtime/http-host-publication";

type Lifecycle = "onModuleInit" | "onApplicationBootstrap" | "beforeApplicationShutdown" | "onModuleDestroy" | "onApplicationShutdown";
type ServiceView<T> = Omit<T, Lifecycle>;
const lifecycle = new Set<PropertyKey>(["onModuleInit", "onApplicationBootstrap", "beforeApplicationShutdown", "onModuleDestroy", "onApplicationShutdown"]);

/** Nest 只持有原实例的方法视图。this、私有票据和缓存仍在原对象，生命周期只由 Rental 宿主管理。 */
function serviceView<T extends object>(source: T): ServiceView<T> {
  return new Proxy(source, { get(target, name) {
    if (lifecycle.has(name)) return undefined;
    const value = Reflect.get(target, name, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

/** 原无状态对象存储原语；不创建文件仓储/计时器，不绕过保留参加者自己的原收据和 recheck。 */
class RentalAiRetentionStorage extends FileStoragePrimitives {
  readonly operations: ConstructorParameters<typeof FileAiRetentionParticipant>[2] = {
    presign: (...args) => this.presign(...args), deleteObject: (...args) => this.deleteObject(...args),
  };
}

/** 同一所选 Client；类型检查必须使用本宿主真实 247 模型生成声明，不能拿原整库声明代证。 */
export type RentalAiDatabase = PrismaClient & RentalApplication["database"];
export interface RentalAiBindingInput {
  rental: RentalApplication;
  guard: RentalAuthorizationGuard;
  customers: Pick<RentalCustomerManagementApplication, "getCustomerDetail">;
}

export interface RentalAiAuthenticatedRequest {
  method: string;
  url: string;
  originalUrl?: string;
  staffApiRequest?: boolean;
  headers: { authorization?: unknown };
  aborted?: boolean;
}

type Identity = NonNullable<ReturnType<typeof getRequestIdentity>>;
type KnowledgeScope = { active: boolean; record: OperationLogService["record"];
  read<T>(consume: (access: PrismaKnowledgeFileAccess) => Promise<T>, body: boolean): Promise<T> };
const deniedKnowledge = () => new KnowledgeError("unavailable");
// Only the original KnowledgeSensitiveReadAudit vocabulary may restore the
// bound identity. Other AI logs neither inherit this bridge nor authorize it.
const knowledgeReadActions = new Set([
  "ai.knowledge.document.read", "ai.knowledge.source.read", "ai.memory.read", "ai.memory.preferences.read",
  "ai.knowledge.input.collect", "ai.knowledge.input.revalidate", "ai.memory.preferences.select",
  "ai.memory.preferences.revalidate", "ai.memory.confirmation.read",
]);
function identityEvidence(identity: Identity) {
  return { tenantId: identity.tenantId, userId: identity.userId, workspaceId: identity.workspaceId,
    audience: identity.audience, accessSession: identity.accessSession, isSaasAdmin: identity.isSaasAdmin,
    isPlatformAdmin: Boolean(identity.isPlatformAdmin), dataScope: identity.dataScope, organizationId: identity.organizationId,
    permissions: identity.permissions && [...identity.permissions].sort(),
    locationScope: identity.locationScope && { mode: identity.locationScope.mode, locationIds: [...identity.locationScope.locationIds].sort() },
    staffApi: Boolean(identity.staffApi),
    staffLocationScope: identity.staffLocationScope && { mode: identity.staffLocationScope.mode,
      locationIds: [...identity.staffLocationScope.locationIds].sort() } };
}

function requireKnowledgeOwner(value: FileBusinessOwner | undefined) {
  if (!value) return value;
  // File 原公共端口只知道两项修订目标；AI 必须继续验证原完整修订，不能强转缺字段输入。
  const { knowledgeRevision, ...owner } = value;
  return { ...owner, ...(knowledgeRevision === undefined ? {} : {
    knowledgeRevision: parseKnowledge(knowledgeUploadRevisionSchema, knowledgeRevision)
  }) };
}

/** 只核选择合同；宿主仍须校验实际固定包字节、迁移账和物理结构，并在每次准入检查当前部署。 */
export function requireRentalAiSelection(value: CoreDeploymentLock): CoreDeploymentLock {
  const lock = CoreDeploymentLockSchema.parse(value), rentals = lock.cores.filter(pin => pin.manifest.id === "rental");
  const rental = rentals[0], ai = lock.dataCapabilities?.[0];
  const required = AI_NATIVE_DATA_PREREQUISITES;
  if (rentals.length !== 1 || lock.dataCapabilities?.length !== 1
    || ai?.id !== "ai-native" || ai.version !== AI_NATIVE_DATA_PACKAGE_VERSION
    || lock.platform.data.version !== required.platform.dataVersion
    || rental.manifest.data.version !== required.rental.dataVersion
    || !rental.manifest.data.migrations.some(item => item.id === required.rental.migrationId && item.sha256 === required.rental.migrationSha256)
    || checkPlatformDataCapabilities(lock).length
    || checkCoreCombination(lock.cores.map(pin => pin.manifest), coreDeploymentHostVersions(lock)).issues.length) {
    throw new Error("AI 组合须选择本版公共、Rental 与 ai-native 固定数据贡献");
  }
  return lock;
}

/** 首阶段在 Rental 构造前建立真实出箱；只允许一次绑定同一数据库/配置的 enabled Rental。
 * 延迟源在绑定前拒绝，不能让循环依赖变成空成功或临时另建业务实例。 */
export function createRentalAiParticipants(input: {
  database: RentalAiDatabase; configuration: ConfigService; lock: CoreDeploymentLock;
}) {
  const lock = requireRentalAiSelection(input.lock), { database, configuration } = input;
  if (typeof database?.$transaction !== "function" || typeof database.aiBusinessFailureOutbox?.create !== "function"
    || typeof database.aiDataErasure?.findUnique !== "function" || typeof configuration?.get !== "function") {
    throw new Error("AI 组合缺少所选数据库或原配置读取器");
  }
  let bound: RentalAiBinding | undefined;
  const knowledgeScopes = new AsyncLocalStorage<KnowledgeScope>();
  const current = () => {
    if (!bound) throw new Error("AI 业务参加者尚未绑定同一 Rental 应用");
    return bound;
  };
  const resources: BusinessFailureResourcePorts = {
    readFulfillment: (...args) => current().resources.readFulfillment(...args),
    readOpening: (...args) => current().resources.readOpening(...args),
    readBinding: (...args) => current().resources.readBinding(...args),
    assertStorage: (...args) => current().resources.assertStorage(...args),
    append: (...args) => current().resources.append(...args),
  };
  const failures = new PrismaBusinessFailureOutbox(undefined, resources);
  const publication = new RuntimeBusinessFailureConfigurationSource(configuration);
  const eligible = (scope: { tenantId: string; workspaceId: string }) => {
    current();
    const identity = getRequestIdentity();
    return publication.current().enabled && identity?.tenantId === scope.tenantId && identity.workspaceId === scope.workspaceId
      && typeof identity.userId === "string" && Boolean(identity.userId) && identity.isSaasAdmin !== true;
  };
  // 原客户检查本就使用直接出箱。enabled 的必需业务事件保留其同事务写入，不能用可选发布包装器吞掉。
  const events = Object.freeze({
    inspection: failures.inspection.bind(failures), notification: failures.notification.bind(failures),
    openingConfiguration: (...args: Parameters<PrismaBusinessFailureOutbox["openingConfiguration"]>) => eligible(args[1])
      ? failures.openingConfiguration(...args) : Promise.resolve([{ state: "not_captured" as const, reason: "source_unavailable" as const }]),
  });
  const knowledge = <T>(consume: (access: PrismaKnowledgeFileAccess) => Promise<T>, body = false) => {
    const scope = knowledgeScopes.getStore();
    if (!scope?.active) throw deniedKnowledge();
    return scope.read(consume, body);
  };
  const participants = Object.freeze({ readInspectionMedia, failures, events,
    allocationFailures: { fulfillment: (...args: Parameters<PrismaBusinessFailureOutbox["fulfillment"]>) => eligible(args[1])
      ? failures.fulfillment(...args) : Promise.resolve({ state: "not_captured" as const, reason: "source_unavailable" as const }) },
    notificationDraftRetention: Object.freeze({ createReader: createNotificationDraftBodyRetentionReader,
      state: notificationDraftRetentionState, receiptId: notificationDraftRetentionReceiptId }),
    knowledge: { parseKnowledgeUploadRevision: value => knowledgeUploadRevisionSchema.safeParse(value), knowledgeUploadKey,
      knowledgeCommitUnknown: () => new KnowledgeCommitUnknownError(),
      knowledgeFiles: {
        authorizeUpload: (tenantId, input, owner) => knowledge(access => access.authorizeUpload(tenantId, input, requireKnowledgeOwner(owner))),
        authorizeUploadObservation: (tenantId, owner) => knowledge(access => access.authorizeUploadObservation(tenantId, requireKnowledgeOwner(owner)!)),
        assertBound: (tenantId, fileId, owner, target) => knowledge(access => access.assertBound(tenantId, fileId, requireKnowledgeOwner(owner)!, target)),
        readUploadContent: (tenantId, fileId, owner) => knowledge(access => access.readUploadContent(tenantId, fileId, requireKnowledgeOwner(owner)!), true),
        read: (tenantId, fileId, owner, maxBytes, signal) => knowledge(access => access.read(tenantId, fileId, requireKnowledgeOwner(owner)!, maxBytes, signal), true),
      }
    },
  } satisfies RentalApplicationParticipants);

  return Object.freeze({ participants, bind(value: RentalAiBindingInput): RentalAiBinding {
    if (bound) throw new Error("AI 组合已经绑定，不能替换 Rental/Guard 或重建运行实例");
    const { rental, guard, customers } = value;
    if (rental.aiMode !== "enabled" || rental.database !== database || rental.configuration !== configuration
      || rental.failureEvents !== failures || typeof guard?.canActivate !== "function"
      || typeof customers?.getCustomerDetail !== "function") throw new Error("AI 组合必须绑定原 enabled Rental、Guard 与客户应用");
    const bodyDatabase = createAiBodyStorageDatabase(database, rental.secrets);
    const source = new CoreBusinessFailureResourceSource({ db: bodyDatabase, nearPolicy: publication,
      allocation: rental.workers.allocation, facts: rental.foundation.coreFacts, business: rental.primary.business,
      coreConfiguration: rental.foundation.coreConfiguration, businessConfiguration: rental.foundation.businessConfiguration,
      memberships: rental.customers.memberships });
    const observe = async <T>(read: () => Promise<T>) => {
      if (!publication.current().enabled) return undefined;
      const result = await read();
      return publication.current().enabled ? result : undefined;
    };
    const resourceView = Object.freeze({
      readFulfillment: (...args) => observe(() => source.readFulfillment(...args)),
      readOpening: (...args) => observe(() => source.readOpening(...args)),
      readBinding: (...args) => source.readBinding(...args), assertStorage: (...args) => source.assertStorage(...args),
      append: (...args) => source.append(...args),
    } satisfies BusinessFailureResourcePorts);
    const storage = rental.integrations.files;
    const retention = new FileAiRetentionParticipant(bodyDatabase, rental.integrations.integrations,
      new RentalAiRetentionStorage().operations);
    const files = Object.freeze({ readInspectionBytes: storage.readInspectionBytes.bind(storage),
      readKnowledgeBytes: storage.readKnowledgeBytes.bind(storage), assertKnowledgeBinding: storage.assertKnowledgeBinding.bind(storage),
      eraseAiRetentionObject: retention.eraseAiRetentionObject.bind(retention),
    } satisfies Pick<FileStorageRuntimeService, "readInspectionBytes" | "readKnowledgeBytes" | "assertKnowledgeBinding" | "eraseAiRetentionObject">);
    const operationLogs: Pick<OperationLogService, "record"> = { async record(input) {
      if (input.targetType !== "ai-sensitive-read" && !knowledgeReadActions.has(input.action))
        return rental.operationLog.record(input);
      const scope = knowledgeScopes.getStore();
      if (!scope?.active) throw deniedKnowledge();
      return scope.record(input);
    } };
    bound = Object.freeze({ rental, guard, customers, database, configuration, lock, bodyDatabase,
      resources: resourceView, failures, files, operationLogs,
      async withRequest<T>(request: RentalAiAuthenticatedRequest, consume: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        const sourceIdentity = getRequestIdentity(), header = request?.headers?.authorization;
        if (knowledgeScopes.getStore() || !hasRentalBusinessTenantFence() || !captureRentalInternalAuthority()
          || !sourceIdentity?.tenantId || !sourceIdentity.userId || !sourceIdentity.workspaceId
          || sourceIdentity.isSaasAdmin !== false || !["operator", "staff"].includes(sourceIdentity.audience ?? "")
          || !sourceIdentity.accessSession?.sessionId || !Number.isSafeInteger(sourceIdentity.accessSession.expiresAt)
          || !Array.isArray(sourceIdentity.permissions) || !sourceIdentity.locationScope
          || typeof request.method !== "string" || !request.method || typeof request.url !== "string" || !request.url
          || typeof header !== "string" || header.length > 8192 || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(header)) throw deniedKnowledge();
        const audience = sourceIdentity.audience;
        if (audience !== "operator" && audience !== "staff") throw deniedKnowledge();
        const requestEvidence = () => ({ method: request.method, url: request.url, originalUrl: request.originalUrl,
          staff: request.staffApiRequest === true });
        const evidence = structuredClone(identityEvidence(sourceIdentity)), route = requestEvidence(), requestId = randomUUID();
        let authorization: string | undefined = header, active = true;
        const check = () => {
          if (!active || !authorization || request.aborted || signal?.aborted
            || request.headers.authorization !== authorization || evidence.accessSession!.expiresAt <= Date.now() / 1000
            || getRequestIdentity() !== sourceIdentity || !captureRentalInternalAuthority()
            || !isDeepStrictEqual(requestEvidence(), route)
            || !isDeepStrictEqual(identityEvidence(sourceIdentity), evidence)) throw deniedKnowledge();
        };
        const credentials = { current: async () => { check(); return { authorization: authorization!, audience, requestId }; } };
        const auth: Pick<AuthService, "resolveAccessContext"> = { resolveAccessContext: async (...args) => {
          check();
          if (args[0] !== authorization || args[1]?.audience !== audience || args[1]?.businessScope !== true) throw deniedKnowledge();
          const access = await rental.auth.resolveAccessContext(...args);
          check();
          const user = access?.user, location = access?.businessLocationScope ?? user?.locationScope;
          if (!access || !user?.isActive || user.mustChangePassword || user.isSaasAdmin || !access.workspaceValid || access.workspaceId !== evidence.workspaceId
            || user.id !== evidence.userId || user.tenantId !== evidence.tenantId || access.tenantUser.id !== user.id
            || access.tenantUser.tenantId !== user.tenantId || access.accessSession.sessionId !== evidence.accessSession!.sessionId
            || !isDeepStrictEqual(access.accessSession, evidence.accessSession) || user.dataScope !== evidence.dataScope
            || user.organizationId !== evidence.organizationId || Boolean(user.isPlatformAdmin) !== evidence.isPlatformAdmin
            || !isDeepStrictEqual([...user.permissions].sort(), evidence.permissions)
            || !location || !isDeepStrictEqual({ mode: location.mode, locationIds: [...location.locationIds].sort() }, evidence.locationScope)) throw deniedKnowledge();
          return access;
        } };
        const session = new KnowledgeCurrentSession(auth, credentials, { now: () => Date.now() });
        const policies = new PrismaKnowledgeActionPolicySource(bodyDatabase);
        const authority = session.bind(new FormalKnowledgeAuthorizationAdapter(auth, credentials, policies.knowledge));
        const coreCheck = () => database.$transaction(async tx => {
          check();
          await lockRentalBusinessTenant(tx, evidence.tenantId!);
          check();
        }, { isolationLevel: "ReadCommitted" });
        const transport = createNativeModelEgressTransport();
        const objects = new TenantKnowledgeObjectReader(bodyDatabase, rental.integrations.integrations, {
          async get(input) {
            // 原对象读取仍在事务外且只派发一次；DNS/签名准备之后、真实运输之前复核当前 Core。
            await coreCheck();
            await session.current();
            check();
            return transport.get(input);
          }
        });
        // 原审计临时使用投影 ALS。本适配恢复已绑定的实际 store，并把 Core 门禁和原日志提交放在同一短事务。
        const restore = AsyncLocalStorage.snapshot();
        const logs: Pick<OperationLogService, "record"> = { record: async value => {
          const input = structuredClone(value), projection = structuredClone(getRequestIdentity());
          return restore(async () => {
          check();
          if (input.tenantId !== evidence.tenantId || input.userId !== evidence.userId || input.requireSuccess !== true
            || input.targetType !== "ai-sensitive-read" || !knowledgeReadActions.has(input.action)
            || input.metadata?.version !== "ain-knowledge-sensitive-read-1"
            || input.metadata.delivery !== "pending_final_source_recheck")
            throw deniedKnowledge();
          const context = await session.current();
          if (context.actor.kind !== "user" || context.scope.kind !== "workspace" || !("access" in context)
            || !isDeepStrictEqual(input.metadata.scope, context.scope)
            || input.metadata.authorityHash !== knowledgeReadHash({ actor: context.actor, audience: context.audience,
              scope: context.scope, access: context.access })
            || !isDeepStrictEqual(projection, { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
              userId: context.actor.userId, audience: context.audience, isSaasAdmin: false,
              dataScope: context.access.dataScope, locationScope: context.access.locationScope,
              ...("organizationId" in context.access ? { organizationId: context.access.organizationId } : {}) }))
            throw deniedKnowledge();
          await database.$transaction(async tx => {
            check();
            // Original Auth owns Tenant X before Core. The projected audit
            // identity is never used as a principal or as session evidence.
            const lease = await rental.auth.lockRequestWorkspaceAccess(tx);
            const current = async (user: typeof lease.user) => {
              check();
              const location = await resolveUserBusinessLocationScope(user, evidence.workspaceId,
                user.locationScope ?? { mode: "all", locationIds: [] }, tx);
              if (!user.isActive || user.mustChangePassword || user.isSaasAdmin || user.id !== evidence.userId
                || user.tenantId !== evidence.tenantId || Boolean(user.isPlatformAdmin) !== evidence.isPlatformAdmin
                || user.dataScope !== evidence.dataScope || user.organizationId !== evidence.organizationId
                || !isDeepStrictEqual([...user.permissions].sort(), evidence.permissions)
                || !isDeepStrictEqual({ mode: location.mode, locationIds: [...location.locationIds].sort() }, evidence.locationScope))
                throw deniedKnowledge();
              await assertRentalBusinessTenantAccessAfterLock(tx, evidence.tenantId!);
              check();
            };
            await current(lease.user);
            await new PlatformOperationLogService(tx).record(input);
            await current(await lease.revalidate());
          }, { isolationLevel: "ReadCommitted" });
          });
        } };
        const access = new PrismaKnowledgeFileAccess(bodyDatabase, session, authority, objects, logs, rental.integrations.integrations);
        const close = () => { active = false; authorization = undefined; scope.active = false; };
        // 保存实际已选中请求的 ALS；原 AI 自己隔离 identity 时，文件仍回到这个经 Auth 复核的同一请求。
        const scope: KnowledgeScope = { active: true, record: logs.record, read: (consumeAccess, body) => restore(async () => {
          check();
          await session.current();
          const result = await consumeAccess(access);
          // 只对正文交付复查；上传授权/原冻结结果等仍由原文件事务负责，不制造嵌套事务或遮蔽收据。
          if (body) await coreCheck();
          check();
          return result;
        }) };
        signal?.addEventListener("abort", close, { once: true });
        try {
          check();
          await session.current();
          return await knowledgeScopes.run(scope, consume);
        } finally { close(); signal?.removeEventListener("abort", close); }
      }
    });
    return bound;
  } });
}

export interface RentalAiBinding extends RentalAiBindingInput {
  database: RentalAiDatabase;
  configuration: ConfigService;
  lock: CoreDeploymentLock;
  bodyDatabase: RentalAiDatabase;
  resources: BusinessFailureResourcePorts;
  failures: PrismaBusinessFailureOutbox;
  files: Pick<FileStorageRuntimeService, "readInspectionBytes" | "readKnowledgeBytes" | "assertKnowledgeBinding" | "eraseAiRetentionObject">;
  /** Only original sensitive knowledge reads use the active request audit bridge; other logs retain their original service. */
  operationLogs: Pick<OperationLogService, "record">;
  /** 仅已通过原 Guard 和 selected access 的 operator/staff AI 请求；不适用于匿名、客户或平台管理面。 */
  withRequest<T>(request: RentalAiAuthenticatedRequest, consume: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export const RENTAL_AI_BINDING = Symbol("RENTAL_AI_BINDING");
export const RENTAL_AI_INSPECTION_BINDING = Symbol("RENTAL_AI_INSPECTION_BINDING");

/** 原手工 evidence-bind operation 的真实请求入口。请求工厂复制并清除凭据，内部仍重跑原 Guard。
 * req 必须由 HTTP 宿主原 @Req 传入，不能从 ALS/DTO 合成 authorization。 */
export function createRentalInspectionEvidenceBinding(requests: StaffInspectionRequestFactory, operations: readonly string[]) {
  if (!(requests instanceof StaffInspectionRequestFactory) || !Array.isArray(operations))
    throw new Error("检查证据绑定缺少原请求工厂或已发布操作集合");
  return Object.freeze({ async bindInspectionEvidence(request: Parameters<StaffInspectionRequestFactory["withRequest"]>[0], value: unknown) {
    if (!operations.includes("evidence-bind")) throw new InspectionAssistError("STORAGE_UNAVAILABLE");
    const command = structuredClone(value);
    return requests.withRequest(request, async services => {
      if (!services.evidence) throw new InspectionAssistError("STORAGE_UNAVAILABLE");
      return services.evidence.bind(command);
    });
  } });
}

export type RentalAiInspectionBinding = ReturnType<typeof createRentalInspectionEvidenceBinding>;

/** 唯一原 provider 集合。前三个基础参加者由上面的同实例组合供给，禁止旧 factory 重新创建或返回 undefined。 */
const originalProviders: FactoryProvider[] = [
  original.AI_NATIVE_AUTOMATION_EXPLANATION_PROVIDER, original.AI_NATIVE_TASK_OPENING_PROPOSAL_PROVIDER,
  ...original.AI_NATIVE_STAFF_RECOGNITION_PROVIDERS, original.AI_NATIVE_CLIENT_POLICY_PROVIDER,
  original.AI_NATIVE_CATEGORY_DRAFT_PROVIDER, original.AI_NATIVE_CATEGORY_PROPOSAL_PROVIDER,
  ...original.AI_NATIVE_RUNTIME_CONFIGURATION_PROVIDERS, ...original.AI_NATIVE_SCENE_CATALOG_PROVIDERS,
  ...original.AI_NATIVE_ENTRY_ACTION_PROVIDERS, original.AI_NATIVE_CONVERSATION_PROVIDER, original.AI_NATIVE_MEMBER_NAME_PROVIDER,
  original.AI_NATIVE_ORIGINAL_REQUEST_PROVIDER, original.AI_NATIVE_ORIGINAL_ACCOUNTING_PROVIDER,
  original.AI_NATIVE_BUDGET_MANAGEMENT_PROVIDER, original.AI_NATIVE_GATEWAY_PRICING_HISTORY_PROVIDER,
  original.AI_NATIVE_MODEL_SETTINGS_PROVIDER, original.AI_NATIVE_TASK_CENTER_PROVIDER, original.AI_NATIVE_TASK_CENTER_RECOVERY_PROVIDER,
  original.AI_NATIVE_TASK_RULE_DRAFT_PROVIDER, original.AI_NATIVE_TASK_CALENDAR_DRAFT_PROVIDER, original.AI_NATIVE_TASK_ORDER_HANDOFF_PROVIDER,
  original.AI_NATIVE_TASK_READ_POLICY_PROVIDER, original.AI_NATIVE_TASK_ORIGINAL_READ_POLICY_PROVIDER,
  original.AI_NATIVE_PLATFORM_MODEL_SETTINGS_PROVIDER, original.AI_NATIVE_MEMORY_MANAGEMENT_PROVIDER,
  original.AI_NATIVE_KNOWLEDGE_POLICY_PROVIDER, original.AI_NATIVE_KNOWLEDGE_MANAGEMENT_PROVIDER, original.AI_NATIVE_KNOWLEDGE_CONSUMPTION_PROVIDER,
  ...original.AI_NATIVE_BUSINESS_FAILURE_PROVIDERS.filter(provider => provider.provide !== BUSINESS_FAILURE_OUTBOX
    && provider.provide !== original.AI_NATIVE_BUSINESS_FAILURE_RESOURCES),
  ...original.AI_NATIVE_SETTINGS_LIFECYCLE_PROVIDERS, ...original.AI_NATIVE_QUOTE_ORDER_PROVIDERS,
  original.AI_NATIVE_CLARIFIED_QUOTE_SELECTION_PROVIDER, original.AI_NATIVE_CAPABILITY_PROBE_PROVIDER,
  original.AI_NATIVE_INPUT_COUNTING_PROVIDER, original.AI_NATIVE_PLATFORM_PROBE_PROVIDER,
  original.AI_NATIVE_ORIGINAL_ORDER_EXECUTION_PROVIDER, original.AI_NATIVE_ORIGINAL_ORDER_ANSWER_PROVIDER,
  original.AI_NATIVE_QUOTE_MODEL_EXECUTION_PROVIDER, original.AI_NATIVE_OPENING_MODEL_EXECUTION_PROVIDER,
  original.AI_NATIVE_WORKBENCH_MODEL_CONTROL_PROVIDER, original.AI_NATIVE_ORIGINAL_PLAN_POLICY_PROVIDER,
  ...original.AI_NATIVE_STAFF_RECEIPT_PROVIDERS, ...original.AI_NATIVE_CLIENT_ENTRY_PROVIDERS, ...original.AI_NATIVE_CLIENT_PUBLIC_PROVIDERS,
  original.AI_NATIVE_RETENTION_PROVIDER, original.AI_NATIVE_PLATFORM_RETENTION_PROVIDER,
  original.AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER, original.AI_NATIVE_ORIGINAL_READ_POLICY_PROVIDER,
];

function alias<T extends object>(token: Type<T>, source: (binding: RentalAiBinding) => ServiceView<NoInfer<T>>): Provider {
  return { provide: token, inject: [RENTAL_AI_BINDING], useFactory: (binding: RentalAiBinding) => serviceView(source(binding)) };
}

const serviceAliases: Provider[] = [
  alias(PrismaService, b => b.database), alias(ConfigService, b => b.configuration), alias(SecretBox, b => b.rental.secrets),
  alias(AuthService, b => b.rental.auth), alias(ApiAuthGuard, b => b.guard), alias(ClientApiService, b => b.rental.client.api),
  alias(ClientAuthService, b => b.rental.client.auth),
  alias(ClientDeliveryAddressService, b => b.rental.client.addresses), alias(RentalCoreService, b => b.rental.primary.core),
  alias(RentalBusinessService, b => b.rental.primary.business), alias(RentalCoreFactRepository, b => b.rental.foundation.coreFacts),
  alias(RentalBusinessFactRepository, b => b.rental.foundation.businessFacts), alias(RentalCoreConfigRepository, b => b.rental.foundation.coreConfiguration),
  alias(RentalBusinessConfigRepository, b => b.rental.foundation.businessConfiguration), alias(RentalAllocationService, b => b.rental.workers.allocation),
  alias(RentalFundingService, b => b.rental.foundation.funding), alias(RentalIdempotencyRepository, b => b.rental.foundation.receipts),
  alias(RentalOrderConfirmationService, b => b.rental.orderConfirmation), alias(RentalWorkspaceReportRepository, b => b.rental.integrations.reports),
  alias(WorkspaceCapabilityService, b => b.rental.foundation.capabilities), alias(EnterpriseMerchantDelegationService, b => b.rental.enterprise.delegations),
  alias(MembershipService, b => b.rental.customers.memberships), alias(PaymentRuntimeService, b => b.rental.integrations.payments),
  alias(TenantIntegrationService, b => b.rental.integrations.integrations),
  // AI 订阅消费者使用原公共权益/配额方法；旧 HTTP 品类标签别名不进入这些 factories。
  { provide: SubscriptionService, inject: [RENTAL_AI_BINDING], useFactory: (b: RentalAiBinding) =>
    serviceView(b.rental.subscriptions satisfies Omit<ServiceView<SubscriptionService>, "rentalCategoryLabels">) },
  { provide: OperationLogService, inject: [RENTAL_AI_BINDING], useFactory: (b: RentalAiBinding) =>
    serviceView(b.operationLogs) },
  // 这两个原令牌的 AI 消费者只依赖列出的窄方法，不能因此构造旧 Platform 或文件 Runtime。
  { provide: PlatformService, inject: [RENTAL_AI_BINDING], useFactory: (b: RentalAiBinding) => serviceView(b.customers satisfies Pick<PlatformService, "getCustomerDetail">) },
  { provide: FileStorageRuntimeService, inject: [RENTAL_AI_BINDING], useFactory: (b: RentalAiBinding) => b.files },
  { provide: original.AI_NATIVE_BODY_DATABASE, inject: [RENTAL_AI_BINDING], useFactory: (b: RentalAiBinding) => b.bodyDatabase },
  { provide: original.AI_NATIVE_BUSINESS_FAILURE_RESOURCES, inject: [RENTAL_AI_BINDING], useFactory: (b: RentalAiBinding) => b.resources },
  { provide: BUSINESS_FAILURE_OUTBOX, inject: [RENTAL_AI_BINDING], useFactory: (b: RentalAiBinding) => b.failures },
];

/** 只提供原 AI 请求工厂。HTTP Controller 由父宿主单点登记，ModuleRef 解析父宿主已挂载的原 Controller。
 * 禁止同时导入旧 ApplicationServicesModule；它会创建另一组 Guard、业务服务与生命周期。 */
@Global()
@Module({})
export class RentalAiCompositionModule {
  static registerFactory(input: {
    imports?: ModuleMetadata["imports"];
    inject: NonNullable<FactoryProvider["inject"]>;
    useFactory: (...dependencies: any[]) => RentalAiBinding | Promise<RentalAiBinding>;
    httpPublication?: AiNativeHttpHostPublication;
    inspectionOperations?: readonly string[];
  }): DynamicModule {
    const requests = originalProviders.map(provider => provider.provide !== AI_STAFF_INSPECTION_OPERATIONS || !input.inspectionOperations
      ? provider : { ...provider, useFactory: async (...dependencies: unknown[]) => {
        const published: readonly string[] = await provider.useFactory(...dependencies);
        return Object.freeze(published.filter(operation => input.inspectionOperations!.includes(operation)));
      } });
    const providers: Provider[] = [{ provide: RENTAL_AI_BINDING, inject: input.inject, useFactory: input.useFactory },
      ...serviceAliases, ...requests, AiCreditService,
      ...(input.httpPublication ? [{ provide: AI_NATIVE_HTTP_HOST_PUBLICATION, useValue: input.httpPublication }] : []),
      { provide: RENTAL_AI_INSPECTION_BINDING, inject: [AI_STAFF_INSPECTION_REQUESTS, AI_STAFF_INSPECTION_OPERATIONS],
        useFactory: createRentalInspectionEvidenceBinding }];
    const tokens = providers.map(provider => typeof provider === "function" ? provider : provider.provide);
    if (new Set(tokens).size !== tokens.length) throw new Error("AI 原 provider 重复登记");
    // ModuleRef 由 Nest 提供；其它非 optional 注入必须来自本组合，不能隐式掉入旧全局模块。
    for (const provider of originalProviders) for (const dependency of provider.inject ?? []) {
      const optional = typeof dependency === "object" && "token" in dependency;
      const token = optional ? dependency.token : dependency;
      if (token !== ModuleRef && !tokens.includes(token) && !(optional && dependency.optional))
        throw new Error("AI 原 provider 缺少同实例依赖令牌");
    }
    return { module: RentalAiCompositionModule, global: true, imports: input.imports ?? [], providers, exports: tokens };
  }
}
