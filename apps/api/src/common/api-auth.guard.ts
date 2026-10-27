import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT, AI_SCENE_ORDER_READ_HTTP_DRAFT, AI_MODEL_SETTINGS_HTTP_DRAFT,
  AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT } from "@rental-os/shared";
import { AI_QUOTE_SELECTION_HTTP_DRAFT, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT, AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT } from '@rental-os/shared';
import { AI_CLIENT_TASK_POLICY_HTTP_DRAFT } from '@rental-os/shared';
import { AI_TASK_CENTER_HTTP_DRAFT, AI_TASK_CENTER_ENTRY_PERMISSIONS } from '@rental-os/shared';
import { AI_COUNTING_HTTP_DRAFT, AI_COUNTING_HTTP_OPERATIONS } from '@rental-os/shared';
import { AI_SCENE_REQUEST_HTTP_DRAFT, AI_SCENE_MODEL_HTTP_DRAFT, AI_MEMORY_MANAGEMENT_HTTP_DRAFT, AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT, AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT, AI_KNOWLEDGE_POLICY_HTTP_DRAFT, AI_TEXT_CAPABILITY_HTTP_DRAFT, AI_BUDGET_MANAGEMENT_HTTP_DRAFT, AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT, AI_SCENE_PLAN_POLICY_HTTP_DRAFT, RentalCategoryCode,
  type RentalCapability, type SystemUserRow } from "@rental-os/shared";
import { AuthService } from "../modules/auth/auth.service";
import { ClientAuthService } from "../modules/client/client-auth.service";
import { ClientApiRateLimitService } from "../modules/client/client-api-rate-limit.service";
import { WorkspaceCapabilityService } from "../modules/rental-core/workspace-capability.service";
import { SubscriptionService } from "../modules/subscription/subscription.service";
import { enterRequestIdentity } from "./request-identity";
import { matchableRequestPath } from "./request-path";
import { isStaffAuthPath, isStaffBusinessRouteAllowed, staffRoutePermissions, isHumanAutomationRoute } from "./staff-api-policy";
import { PrismaService } from "../modules/database/prisma.service";
import { enabledOrganizationSubtreeIds, organizationLocationScope } from "./organization-location-scope";
import { isPlatformAiProviderPath, platformAiProviderPermission, platformCapabilityProbePermission, PLATFORM_AI_PROVIDER_PERMISSIONS } from './platform-ai-access-policy';

const countingRouteAccess = new Map<string, typeof AI_COUNTING_HTTP_OPERATIONS[number][3]>(AI_COUNTING_HTTP_OPERATIONS.map(([action, _request, _response, access]) =>
  [`${AI_COUNTING_HTTP_DRAFT.method} /${AI_COUNTING_HTTP_DRAFT.basePath}/${AI_COUNTING_HTTP_DRAFT[action]}`, access] as const));

interface RequestLike {
  method: string;
  url: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  staffApiRequest?: boolean;
  staffLocationScope?: { mode: "all" | "selected"; locationIds: string[] };
  user?: SystemUserRow;
  client?: import("../modules/client/client-auth.service").ClientRequestContext;
}

function requiredCapability(path: string): RentalCapability | undefined {
  if (path.startsWith("/rental-os/dispatch") || path.startsWith("/rental-os/vehicles/transfer-tasks")) return "dispatch";
  if (path.startsWith("/rental-os/tbox-devices")) return "iot";
  return undefined;
}

/**
 * SUB-04A：SaaS 订阅到期后应停止的「新业务」入口白名单（fail-safe：只拦这些，其余一律放行，
 * 既有订单履约/归还/退款/退押/证据/争议等善后天然不受影响，§4.8）。
 * operator 与 staff 代客下单在守卫处路径均已归一为 /rental/v1（见 staff-api-policy），故一处即覆盖两端；
 * 客户端走独立的 /client/v1。续租/加购、取货后换货（post-pickup-exchange，可能产生差额）按新增收费承诺纳入拦截；
 * 续租付款 /pay、试算 /preview、退款审核 /refund-review、可用量查询等不在此列，照常放行。
 * 注：套装等价替换 substitute-bundle-component 仅限取货前 Reserved 单、同组等价互换、服务层不计差额，
 * 属既有订单调整而非新增收费承诺，故不拦（§4.8；独立审计确认无资金泄漏）。
 */
export function isNewBusinessRoute(method: string, path: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  if (path === "/rental/v1/orders" || path === "/rental/v1/quotes") return true;
  if (path === "/client/v1/orders" || path === "/client/v1/quotes") return true;
  if (/^\/(?:rental|client)\/v1\/orders\/[^/]+\/extensions$/u.test(path)) return true;
  if (/^\/rental\/v1\/orders\/[^/]+\/changes\/post-pickup-exchange$/u.test(path)) return true;
  return false;
}


/**
 * 未匹配任何规则时要求的"权限"。它**不存在于权限目录**，因此任何角色都不可能持有，
 * 等价于默认拒绝。
 *
 * 早前这里是 `return []`，而 `hasAnyPermission` 对空数组直接放行——于是每一个
 * 没被上面任何分支覆盖的路由都是**完全无鉴权**的写接口。这不是理论风险：
 * `/rental-os/marketing/plans` 的增改就落在这里，任何能登录的账号都能改本租户营销方案。
 * 而且这个坑会随每次新增路由复发，靠人记得补分支是不可靠的，
 * 因此改为默认拒绝 + `scripts/validate-route-permissions.cjs` 在标准验收命令里逐路由核对。
 */
export const UNMATCHED_ROUTE_PERMISSION = "__unmatched_route__";

/**
 * 显式公共路由：不需要登录，或登录后不需要任何业务权限的自助端点。
 *
 * 只有这份名单里的路由才允许"零权限放行"。放行范围要能一眼看完——
 * 会话自助操作（我是谁、登出、改密、切空间）本身不授予任何业务数据访问，
 * 它们的隔离由各自的处理器按当前会话完成。
 */
export const PUBLIC_ROUTES = new Set([
  "/health",
  "/openapi.json",
  "/public/demo-requests",
  "/auth/login",
  "/auth/development/reset-demo-password",
  "/auth/refresh",
  "/auth/logout",
  "/auth/me",
  "/auth/change-password",
  "/auth/switch-workspace",
  "/auth/session-context",
  // SUB-MP：员工小程序只读订阅/权益上下文——已登录即可读自身租户（金额脱敏），不挂 RBAC 权限，与 session-context 同类（仍需登录态，非匿名）。
  "/rental/v1/subscription/context",
  "/staff/v1/auth/login",
  "/staff/v1/auth/refresh",
  "/staff/v1/auth/logout",
  "/staff/v1/auth/me",
  "/staff/v1/auth/session-context",
  "/staff/v1/auth/change-password",
  "/staff/v1/auth/switch-workspace",
  "/payments/webhooks/alipay",
  "/payments/webhooks/wechat_pay",
  "/payments/webhooks/stripe",
  "/payments/webhooks/alipay/refund",
  "/payments/webhooks/wechat_pay/refund"
]);

/**
 * 公共前缀：已登录即可访问、不挂业务权限的自助路由（仍由 canActivate 校验会话，匿名一律 401）。
 *
 * - 筛选预设：**租户级列表筛选偏好**，不承载业务数据，服务层对非 SaaS 管理员一律用会话的
 *   `user.tenantId`（忽略请求里的 tenantId），不存在跨租户读写。
 * - 账户级外观：登录账户本人的管理后台主题色，服务层按会话 `user.id` 作用域（忽略请求体 userId），
 *   任何已登录账号只能读写自己的，与租户品牌色相互独立。
 * 给这类自助设置挂具体业务权限，反而会让普通运营存不了自己的偏好。
 */
export const PUBLIC_ROUTE_PREFIXES = ["/platform/filter-presets", "/platform/account-appearance"];

/** 客户端认证域：不走运营角色权限树，但仍由 ApiAuthGuard 校验客户令牌。 */
export const CLIENT_ROUTE_PREFIXES = ["/client/v1"];

export function isClientRoute(path: string) {
  return CLIENT_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

const CLIENT_PUBLIC_ROUTES = new Set([
  "/client/v1/auth/login",
  "/client/v1/auth/refresh",
  "/client/v1/auth/logout",
  "/client/v1/auth/register",
  "/client/v1/auth/registration/challenges",
  // MP-02A/02B：用途化验证码、短信登录与微信手机号登录都是登录前的公开入口（仍受限流）。
  "/client/v1/auth/challenges",
  "/client/v1/auth/sms-login",
  "/client/v1/auth/wechat/phone-login",
  // MP-01/03：渠道启动配置与游客目录只返回已发布的公开投影。
  "/client/v1/public/bootstrap",
  "/client/v1/public/catalog",
  // WEBSITE-CHANNEL-02：官网按 Host 反查租户（只返回 tenantCode 或 null）。
  "/client/v1/public/site-resolve"
]);

export function isClientPublicRoute(method: string, path: string) {
  if (CLIENT_PUBLIC_ROUTES.has(path)) return true;
  if (method === "GET" && /^\/client\/v1\/tenants\/[^/]+\/workspaces$/u.test(path)) return true;
  if (method === "GET" && /^\/client\/v1\/public\/catalog\/items\/[^/]+\/images\/[^/]+$/u.test(path)) return true;
  // WEBSITE-CHANNEL-04：官网品牌图片（Logo/Hero/品类入口图）游客可读。
  if (method === "GET" && /^\/client\/v1\/public\/website-assets\/[^/]+\/[^/]+$/u.test(path)) return true;
  // CLIENT-CHANNEL-01：协议/隐私/帮助正文游客可读。
  if (method === "GET" && /^\/client\/v1\/public\/documents\/[^/]+$/u.test(path)) return true;
  if (method === "POST" && /^\/client\/v1\/auth\/registration\/challenges\/[^/]+\/verify$/u.test(path)) return true;
  return false;
}

export function isTenantMembershipRoute(path: string) {
  if (path === "/membership" || path.startsWith("/membership/")) {
    return !path.startsWith("/membership/qualification-types");
  }
  return path === "/platform/customers" || path.startsWith("/platform/customers/");
}

function isPublicRoute(path: string) {
  return PUBLIC_ROUTES.has(path) || PUBLIC_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// Read consumption shares the existing operator management entry gate, not its
// data authority: each read still needs its exact current resource action policy.
const aiManagementRoutes = new Set([AI_MEMORY_MANAGEMENT_HTTP_DRAFT, AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT, AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT, AI_KNOWLEDGE_POLICY_HTTP_DRAFT, AI_TEXT_CAPABILITY_HTTP_DRAFT, AI_MODEL_SETTINGS_HTTP_DRAFT]
  .flatMap(({ basePath, method, ...operations }) => Object.values(operations).map(operation => `${method} /${basePath}/${operation}`)));
const budgetTenantRoutes = new Set([AI_BUDGET_MANAGEMENT_HTTP_DRAFT.read, AI_BUDGET_MANAGEMENT_HTTP_DRAFT.change,
  AI_BUDGET_MANAGEMENT_HTTP_DRAFT.readOperation,
  AI_BUDGET_MANAGEMENT_HTTP_DRAFT.initialize, AI_BUDGET_MANAGEMENT_HTTP_DRAFT.refreshConfiguration,
  AI_BUDGET_MANAGEMENT_HTTP_DRAFT.priceRead, AI_BUDGET_MANAGEMENT_HTTP_DRAFT.pricePublicationRead,
  AI_BUDGET_MANAGEMENT_HTTP_DRAFT.inputBoundRead, AI_BUDGET_MANAGEMENT_HTTP_DRAFT.readPriceConfiguration,
  AI_BUDGET_MANAGEMENT_HTTP_DRAFT.reviewPrice, AI_BUDGET_MANAGEMENT_HTTP_DRAFT.readPriceReview,
  AI_BUDGET_MANAGEMENT_HTTP_DRAFT.previewPlatformPrice, AI_BUDGET_MANAGEMENT_HTTP_DRAFT.adoptPlatformPrice, AI_BUDGET_MANAGEMENT_HTTP_DRAFT.readPlatformPriceAdoption]
  .map(operation => `POST /${AI_BUDGET_MANAGEMENT_HTTP_DRAFT.basePath}/${operation}`));
const budgetPlatformRoutes = new Set([AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformRead, AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformSave,
  AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformReadOperation,
  AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformReviewPrice, AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformPriceReviewReceipt]
  .map(operation => `POST /${AI_BUDGET_MANAGEMENT_HTTP_DRAFT.basePath}/${operation}`));
const creditTenantRoutes = new Set(['read', 'request', 'receipt', 'allocate', 'allocation-receipt', 'calls'].map(action => `POST /ai-native/credits/${action}`));
const creditPlatformRoutes = new Set(['platform-read', 'platform-decide', 'platform-receipt'].map(action => `POST /ai-native/credits/${action}`));
const isBudgetPlatformRoute = (method: string, path: string) => budgetPlatformRoutes.has(`${method.toUpperCase()} ${path}`)
  || creditPlatformRoutes.has(`${method.toUpperCase()} ${path}`);
// Exact preparation transport only. Each request still verifies its stored
// scene policy, original owner and actual business Guard/ALS. The R1 human
// quote confirmation below has its own create permission, never order approval.
const originalOrderReadRoutes = new Set(['', AI_SCENE_REQUEST_HTTP_DRAFT.read,
  AI_SCENE_REQUEST_HTTP_DRAFT.queryOrders,
  AI_SCENE_REQUEST_HTTP_DRAFT.reconcile, AI_SCENE_REQUEST_HTTP_DRAFT.material,
  AI_SCENE_REQUEST_HTTP_DRAFT.recovery].map(action =>
  `POST /${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}${action ? `/${action}` : ''}`));
const originalQuoteReadRoutes = new Set([AI_SCENE_REQUEST_HTTP_DRAFT.quoteReview, AI_SCENE_REQUEST_HTTP_DRAFT.quoteReceipt,
  AI_SCENE_REQUEST_HTTP_DRAFT.compareOriginalQuotes].map(action => `POST /${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${action}`));
// Fixed quote model execution; the original scene, owner and task policies
// are checked again by the host. No arbitrary model route or tool is accepted.
const originalQuoteModelRoutes = new Set([AI_SCENE_MODEL_HTTP_DRAFT.start, AI_SCENE_MODEL_HTTP_DRAFT.refreshInput, AI_SCENE_MODEL_HTTP_DRAFT.submitAnswer,
  AI_SCENE_MODEL_HTTP_DRAFT.resume, AI_SCENE_MODEL_HTTP_DRAFT.continueAnswer, AI_SCENE_MODEL_HTTP_DRAFT.reconcile,
  AI_SCENE_MODEL_HTTP_DRAFT.recover, AI_SCENE_MODEL_HTTP_DRAFT.takeover, AI_SCENE_MODEL_HTTP_DRAFT.requestCancel,
  AI_SCENE_MODEL_HTTP_DRAFT.readQuotePreparation, AI_SCENE_MODEL_HTTP_DRAFT.confirmClarifiedQuote,
  AI_SCENE_MODEL_HTTP_DRAFT.readClarifiedQuoteReceipt, AI_SCENE_MODEL_HTTP_DRAFT.readExecution]
  .map(action => `POST /${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${action}`));
// Fixed original notification lifecycle still has its independent permission.
const originalSettingsRoutes = new Set(Object.entries(AI_SCENE_MODEL_HTTP_DRAFT)
  .filter(([name]) => /Settings/u.test(name)).map(([, action]) => `POST /${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${action}`));
const selectedQuoteRoutes = new Map<string, string>([AI_QUOTE_SELECTION_HTTP_DRAFT, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT, AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT]
  .flatMap(contract => Object.entries(contract).filter(([name]) => name !== 'basePath').map(([name, action]) =>
    [`POST /${contract.basePath}${action ? `/${action}` : ''}`, name] as const)));
const originalTaskObservationRoutes = new Set([
  AI_SCENE_MODEL_HTTP_DRAFT.readTaskPage, AI_SCENE_MODEL_HTTP_DRAFT.readTaskEvents, AI_SCENE_MODEL_HTTP_DRAFT.readTaskUsage,
  AI_SCENE_MODEL_HTTP_DRAFT.readTaskPerformance,
  AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene,
  AI_SCENE_MODEL_HTTP_DRAFT.readInput,
  AI_SCENE_MODEL_HTTP_DRAFT.readRecoverySnapshot, AI_SCENE_MODEL_HTTP_DRAFT.readTakeoverReceipt,
  AI_SCENE_MODEL_HTTP_DRAFT.readCancellationReceipt, AI_SCENE_MODEL_HTTP_DRAFT.readCancellationSettlementReceipt,
  AI_SCENE_MODEL_HTTP_DRAFT.readAnswer, AI_SCENE_MODEL_HTTP_DRAFT.readModelResult,
  AI_SCENE_MODEL_HTTP_DRAFT.reopenModelSource, AI_SCENE_MODEL_HTTP_DRAFT.reopenOpeningModelSource,
].map(action => `POST /${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${action}`));

// Original AI budget bookkeeping only. The application still verifies the
// original resource, current task action and persisted dispatch/usage evidence.
const originalTaskAccountingRoutes = new Set([
  AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT.read, AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT.releaseUnsent,
  AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT.reconcile, AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT.readOperation
].map(action => `POST /${AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT.basePath}/${action}`));
const originalOpeningModelRoutes = new Set([
  AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT.start, AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT.recover,
  AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT.reconcile, AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT.takeover,
  AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT.requestCancel, AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT.readExecution
].map(action => `POST /${AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT.basePath}/${action}`));

// Only the registered closed order-chain entrypoints. This route permission
// is not a task policy, lease, approval or dispatch grant; the original host
// still checks current owner, original material, plan, capabilities and budget.
const originalOrderExecutionRoutes = new Set(([
  'start', 'recover', 'readPreparation', 'resumePrepared', 'readAnswer',
  'readOrderResult', 'readModelResult', 'readTaskScene', 'readNextSteps',
  'readTaskSnapshot', 'reopenModelSource', 'takeover', 'readTakeoverReceipt',
  'requestCancel', 'readCancellationReceipt', 'settleUnstartedCancellation',
  'readCancellationSettlementReceipt'
] as const).map(action => `POST /${AI_SCENE_ORDER_READ_HTTP_DRAFT.basePath}/${AI_SCENE_ORDER_READ_HTTP_DRAFT[action]}`));

export function requiredPermissions(method: string, path: string) {
  const creditRoute = `${method.toUpperCase()} ${path}`;
  if (creditTenantRoutes.has(creditRoute)) return ['system:params:manage'];
  if (creditPlatformRoutes.has(creditRoute)) return [path.endsWith('/platform-decide') ? 'system:ai-provider:manage' : 'system:ai-provider:view'];
  const counting = countingRouteAccess.get(`${method.toUpperCase()} ${path}`);
  if (counting) return counting === 'management' ? ['system:params:manage'] : [...AI_TASK_CENTER_ENTRY_PERMISSIONS];
  const platformProbePermission = platformCapabilityProbePermission(method, path);
  if (platformProbePermission) return [platformProbePermission];
  if (method.toUpperCase() === 'POST' && path === '/ai-native/desktop-business/catalog')
    return ['rental-core:catalog:view', 'rental-core:catalog:manage', 'rental-os:order:view', 'rental-os:order:create'];
  if (method.toUpperCase() === 'POST' && /^\/ai-native\/desktop-business\/policy(?:\/(?:change|operation))?$/u.test(path))
    return ['system:params:manage'];
  if (method.toUpperCase() === 'POST' && (['list', 'snapshot', 'events', 'result', 'source', 'usage', 'confirmation', 'review', 'decision', 'decisionReceipt', 'business', 'continue', 'stop', 'stopReceipt', 'input', 'resumeInput', 'inputReceipt', 'continueInput'] as const)
    .some(action => path === `/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT[action]}`))
    return [...AI_TASK_CENTER_ENTRY_PERMISSIONS]; // entry alternatives only; original per-task owner/action checks still apply
  if (method.toUpperCase() === 'POST' && (['read', 'change', 'operation', 'readModelPlan', 'changeModelPlan'] as const)
    .some(operation => path === `/${AI_CLIENT_TASK_POLICY_HTTP_DRAFT.basePath}/${AI_CLIENT_TASK_POLICY_HTTP_DRAFT[operation]}`))
    return ['system:params:manage'];
  if (method.toUpperCase() === 'POST' && /^\/ai-native\/category-drafts\/(?:detail|create|patch|validate|review)$/u.test(path)) {
    return [path.endsWith('/create') || path.endsWith('/patch') ? 'system:rental-category:edit' : 'system:rental-category:view'];
  }
  if (method.toUpperCase() === 'POST' && path === `/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene}`) {
    // Entry alternatives only. The selected original reader separately checks
    // THIS task's owner, scene, current action policy and business authority.
    return ['rental-os:order:view', 'rental-os:order:create', 'rental-os:price:manage'];
  }
  if (method.toUpperCase() === 'POST' && path === `/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT.previewOrderExtension}`)
    return ['rental-os:order:extend', 'rental-os:order:operate'];
  if (originalOrderExecutionRoutes.has(`${method.toUpperCase()} ${path}`)) return ['rental-os:order:view'];
  if (originalTaskAccountingRoutes.has(`${method.toUpperCase()} ${path}`)) return ['rental-os:order:view'];
  if (originalOpeningModelRoutes.has(`${method.toUpperCase()} ${path}`)) return ['rental-os:price:manage'];
  if (originalSettingsRoutes.has(`${method.toUpperCase()} ${path}`)) return ['rental-os:price:manage'];
  const selectedQuoteAction = selectedQuoteRoutes.get(`${method.toUpperCase()} ${path}`);
  if (selectedQuoteAction) return ['select', 'start', 'continueConfirmation', 'decideSelectedProposal', 'reprepareSelectedProposal'].includes(selectedQuoteAction)
    ? ['rental-os:order:create'] : ['rental-os:order:view', 'rental-os:order:create'];
  if (method.toUpperCase() === 'POST' && /^\/ai-native\/privacy\/(?:cleanup|receipt|receipts)$/u.test(path)) return ['system:params:manage'];
  if (method.toUpperCase() === 'POST' && path === `/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT.quoteConfirm}`)
    return ['rental-os:order:create'];
  if (originalOrderReadRoutes.has(`${method.toUpperCase()} ${path}`) || originalQuoteReadRoutes.has(`${method.toUpperCase()} ${path}`))
    return ['rental-os:order:view', 'rental-os:order:create'];
  if (originalQuoteModelRoutes.has(`${method.toUpperCase()} ${path}`)) return ['rental-os:order:create'];
  if (originalTaskObservationRoutes.has(`${method.toUpperCase()} ${path}`)) return ['rental-os:order:view'];
  if (method === 'POST' && [AI_SCENE_PLAN_POLICY_HTTP_DRAFT.read, AI_SCENE_PLAN_POLICY_HTTP_DRAFT.change]
    .some(action => path === `/${AI_SCENE_PLAN_POLICY_HTTP_DRAFT.basePath}/${action}`)) return ['system:params:manage'];
  if (method === 'POST' && [AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT.configure, AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT.read,
    AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT.clear]
    .some(action => path === `/${AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT.basePath}/${action}`)) return ['system:params:manage'];
  if (budgetTenantRoutes.has(`${method.toUpperCase()} ${path}`)) return ['system:params:manage'];
  if (method.toUpperCase() === 'POST' && [AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformPriceReviewReceipt,
    AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformRead, AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformReadOperation]
    .some(action => path === `/${AI_BUDGET_MANAGEMENT_HTTP_DRAFT.basePath}/${action}`))
    return ['system:ai-provider:view'];
  if (isBudgetPlatformRoute(method, path)) return ['system:ai-provider:manage'];
  if (aiManagementRoutes.has(`${method.toUpperCase()} ${path}`)) return ['system:params:manage'];
  if (method.toUpperCase() === 'POST'
    && /^\/ai-native\/automation\/operator\/policies\/(?:read|preview|prepare|preparation|review|operation|commit)$/u.test(path)) {
    return ['system:params:manage'];
  }
  if (isHumanAutomationRoute(method, path, 'staff')) return ['rental-os:order:view'];
  if (isHumanAutomationRoute(method, path, 'operator')) {
    // Entry permission does not replace each event's original read authority or review grant.
    return ['rental-os:order:view', 'system:integration:manage', 'rental-os:finance:view', 'rental-os:finance:reconcile'];
  }
  const aiProviderPermission = platformAiProviderPermission(method, path);
  if (aiProviderPermission) return [aiProviderPermission];
  if (path === "/platform/rental-categories" || path.startsWith("/platform/rental-categories/")) {
    if (path.endsWith("/audits")) return ["system:rental-category:audit"];
    if (path.endsWith("/opening-policy")) return ["system:rental-category:opening"];
    if (path.endsWith("/publish") || path.endsWith("/adoption-policy")) return ["system:rental-category:publish"];
    return method === "GET" || path.endsWith("/validate") ? ["system:rental-category:view"] : ["system:rental-category:edit"];
  }
  if (path === "/public/demo-requests") return method.toUpperCase() === "POST" ? [] : [UNMATCHED_ROUTE_PERMISSION];
  if (path === "/platform/demo-requests") return method.toUpperCase() === "GET" ? ["system:demo-request:view"] : [UNMATCHED_ROUTE_PERMISSION];
  if (isClientRoute(path)) return [];
  if (isPublicRoute(path) || method === "OPTIONS") {
    return [];
  }
  if (isStaffAuthPath(path)) return [];
  if (path.startsWith("/staff/v1/uploads/")) {
    // The staff routing layer replaces this static superset with a scene-specific permission.
    return ["rental-os:order:pickup", "rental-os:order:return", "rental-os:order:offline-payment", "rental-core:maintenance:manage"];
  }
  if (path === "/staff/v1/offline-payments") {
    return method === "GET" ? ["rental-os:order:view"] : ["rental-os:order:offline-payment"];
  }
  if (/^\/staff\/v1\/offline-payments\/[^/]+\/confirm$/u.test(path)) return ["rental-os:order:settle"];

  if (path.startsWith("/platform/official-calendars")) {
    // 公共官方日历来源注册表（需求 4.5.2/4.5.8）。仅 SaaS 平台管理员；
    // canActivate 里另有一道 fail-closed 检查，不依赖本权限码单点把关。
    return ["system:calendar-source:manage"];
  }
  if (path.startsWith("/platform/subscriptions")) {
    // SUB-01 平台端：SaaS 管理员跨租户维护订阅/功能目录/标准价（§7.1/§8）。
    // canActivate 里另有一道 fail-closed，不依赖本权限码单点把关。
    return ["system:tenant:subscription:manage"];
  }
  if (method.toUpperCase() === "GET" && path === "/platform/subscription/reminder") return [];
  if (path.startsWith("/platform/subscription")) {
    // SUB-01 租户端：本租户查看/申请（§5.2/§7.2）。GET 只读，写=提交/撤销申请。
    return method.toUpperCase() === "GET" ? ["rental-os:subscription:view"] : ["rental-os:subscription:manage"];
  }
  if (path === "/platform/permission-tree") {
    return ["system:role:manage"];
  }
  if (path.startsWith("/platform/audit-logs")) {
    return ["system:audit:view"];
  }
  if (path.startsWith("/platform/dictionaries")) {
    return ["system:dictionary:manage"];
  }
  if (path.startsWith("/platform/number-rules")) {
    return ["system:number-rule:manage"];
  }
  if (path.startsWith("/platform/tenant-bootstrap")) {
    return ["system:tenant:bootstrap", "system:tenant:manage"];
  }
  if (path.startsWith("/platform/system-rules")) {
    return ["system:params:manage"];
  }
  if (path.startsWith("/platform/security-baseline")) {
    return ["system:params:manage"];
  }
  if (path.startsWith("/platform/data-permission-preview")) {
    return ["system:user:manage", "system:role:manage"];
  }
  if (path.startsWith("/platform/integrations")) {
    return ["system:integration:manage"];
  }
  // MP-01：小程序渠道凭证（AppID/AppSecret）与第三方服务同一权限。
  if (path.startsWith("/platform/mini-program-channel")) {
    return ["system:integration:manage"];
  }
  // CLIENT-CHANNEL-01：租户级客户端渠道配置（品牌/客服/协议/帮助/发布服务），同一权限。
  if (path.startsWith("/platform/client-channel")) {
    return ["system:integration:manage"];
  }
  // APPEARANCE-01：租户级「品牌与外观」（管理后台 UI 身份：品牌标识/主题色/圆角），同一渠道管理员权限。
  if (path.startsWith("/platform/appearance")) {
    return ["system:integration:manage"];
  }
  // WEBSITE-CHANNEL-01：租户级 web 官网渠道配置（官网特有设定项），同一权限。
  if (path.startsWith("/platform/website-channel")) {
    return ["system:integration:manage"];
  }
  // EXT-01D：真实支付退款与查单恢复是高风险资金动作，独立于费用裁定和模拟资金事件。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/payment-intents(?:\/[^/]+\/refunds(?:\/[^/]+\/refresh)?)?$/u)) {
    return method === "GET"
      ? ["rental-os:finance:view", "rental-os:finance:reconcile"]
      : ["rental-os:finance:reconcile"];
  }
  if (
    path === "/rental/v1/payment-reconciliation" ||
    /^\/rental\/v1\/payment-reconciliation\/statements(?:\/[^/]+(?:\/lines\/[^/]+\/review)?)?$/u.test(path)
  ) return ["rental-os:finance:reconcile"];
  if (
    path.startsWith("/integrations") ||
    path.startsWith("/notifications") ||
    path.startsWith("/jobs")
  ) {
    return ["system:integration:manage"];
  }
  // 文件列表、上传会话、完成确认和短时下载都可能触达客户/订单附件，
  // 不能因为拥有系统参数权限就获得文件数据操作能力。
  if (path.startsWith("/files")) {
    if (/^\/files\/rental-orders\/[^/]+\/carrier-evidence(?:\/|$)/u.test(path)) {
      return method === "GET" ? ["rental-os:order:view"] : ["rental-os:order:operate"];
    }
    if (path.startsWith("/files/customer-identity/")) {
      return method === "GET"
        ? ["rental-os:customer:reveal-sensitive"]
        : ["rental-os:member:manage"];
    }
    return ["system:integration:manage"];
  }
  if (path === "/platform/roles") {
    return ["system:user:manage", "system:role:manage"];
  }
  if (path.startsWith("/platform/roles/")) {
    return ["system:role:manage"];
  }
  if (path.startsWith("/platform/organizations")) {
    return ["system:user:manage"];
  }
  if (path.startsWith("/platform/users")) {
    return ["system:user:manage"];
  }
  if (path.startsWith("/platform/workspaces")) {
    if (path.endsWith("/fulfillment-locations")) return ["system:user:manage"];
    // 成员关系直接决定谁能进入哪个空间、以何角色进入，等价于授权操作，
    // 因此读也要求管理权限；空间列表本身按用户管理权限放行读。
    if (path.includes("/members")) {
      return ["system:user:manage"];
    }
    return method === "GET"
      ? ["system:user:manage", "system:tenant:manage"]
      : ["system:tenant:manage"];
  }
  if (path.startsWith("/platform/customers")) {
    if (/\/identity-verifications$/u.test(path)) {
      return method === "GET" ? ["rental-os:customer:reveal-sensitive"] : ["rental-os:member:manage"];
    }
    // CUSTOMER-01B：敏感资料访问审计本身就是一份访问画像（谁在什么时候查过谁），
    // 因此它需要**解密权限**，不能只凭「会员查看」。必须放在下面的通用分支之前，
    // 否则会被 `/platform/customers` 前缀吃掉，退化成只要会员查看权限即可读取。
    if (/\/sensitive-access$/u.test(path)) {
      return ["rental-os:customer:reveal-sensitive"];
    }
    // CUSTOMER-01C：企业开票、合同、授信账期属**企业客户**权限，与个人会员权限分开。
    // 同样必须放在通用分支之前，否则「会员管理」就能改企业授信与账期。
    if (/\/(invoice-profiles|contracts|credit)$/u.test(path)
      || /^\/platform\/customers\/[^/]+\/credit\/(?:account|ledger|payments|maturities(?:\/[^/]+)?)$/u.test(path)) {
      return method === "GET"
        ? ["rental-os:corporate:view", "rental-os:corporate:manage"]
        : ["rental-os:corporate:manage"];
    }
    // CUSTOMER-01D：需求 4.8.14 要求合并与注销**分别授权**。两者都不可逆，
    // 且影响面不同（合并改身份归属、注销终止业务资格），因此不能共用「会员管理」
    // 一个权限——否则任何能改会员等级的人都能合并或注销客户。同样置于通用分支之前。
    if (path === "/platform/customers/merge") {
      return ["rental-os:customer:merge"];
    }
    // 预览与候选是只读的，但它们暴露「哪些主档可能是同一人」，属合并决策信息，
    // 因此同样按合并权限判定，而不是按「会员查看」放行。
    if (/\/(merge-preview|duplicates)$/u.test(path)) {
      return ["rental-os:customer:merge"];
    }
    if (/\/(?:membership-)?closability$/u.test(path)) {
      return ["rental-os:customer:close"];
    }
    if (/\/risk-records\/[^/]+\/decision$/u.test(path)) {
      return ["rental-os:member:risk-action"];
    }
    if (/\/risk-records$/u.test(path)) {
      return method === "GET"
        ? ["rental-os:member:view", "rental-os:member:manage", "rental-os:member:risk-action"]
        : ["rental-os:member:risk-action"];
    }
    if (/\/membership-status$/u.test(path)) {
      return ["rental-os:member:manage", "rental-os:member:risk-action", "rental-os:customer:close"];
    }
    if (/\/account-status$/u.test(path)) {
      return ["rental-os:member:account-manage", "rental-os:customer:close"];
    }
    if (/\/account$/u.test(path)) return ["rental-os:member:account-manage"];
    return method === "GET"
      ? ["rental-os:member:view", "rental-os:member:manage"]
      : ["rental-os:member:manage"];
  }
  if (path.startsWith("/platform/tenants")) {
    return ["system:tenant:manage"];
  }
  if (path.startsWith("/reports")) {
    return ["rental-os:report:view"];
  }
  if (path.startsWith("/membership")) {
    if (path === "/membership/qualification-options" && method === "GET") return ["rental-os:member:view", "rental-os:member:manage"];
    if (path === "/membership/benefit-scope-options" && method === "GET") {
      return ["rental-os:member:view", "rental-os:member:manage", "rental-os:member:review", "rental-os:member:qualification-review", "rental-os:member:plan:manage", "rental-os:member:plan:publish", "rental-os:corporate:view", "rental-os:corporate:manage", "rental-os:corporate:employee-manage"];
    }
    if (path === "/membership/personal-options" && method === "GET") {
      return ["rental-os:member:view", "rental-os:member:manage", "rental-os:corporate:employee-manage"];
    }
    if (path === "/membership/registration-settings") {
      return method === "GET"
        ? ["rental-os:member:view", "rental-os:member:manage"]
        : ["rental-os:member:manage"];
    }
    if (path.startsWith("/membership/reviews")) {
      return method === "GET"
        ? ["rental-os:member:view", "rental-os:member:review", "rental-os:member:qualification-review"]
        : ["rental-os:member:review", "rental-os:member:qualification-review"];
    }
    if (path.startsWith("/membership/qualification-types")) {
      // 证件类型是当前经营空间的业务配置（见 isTenantMembershipRoute 的排除），
      // 与租户级会员资料维护是两种责任：写入只认专属的 qualification-type:manage，
      // 读取兼容会员查看/管理权限，好让过渡期尚未补授新码的角色至少能看到清单。
      return method === "GET"
        ? ["rental-os:qualification-type:manage", "rental-os:member:view", "rental-os:member:manage"]
        : ["rental-os:qualification-type:manage"];
    }
    if (/^\/membership\/personal\/[^/]+\/temporary-password$/u.test(path)) {
      return ["rental-os:member:account-manage"];
    }
    if (path.startsWith("/membership/personal")) {
      return method === "GET"
        ? ["rental-os:member:view", "rental-os:member:manage"]
        : ["rental-os:member:manage"];
    }
    if (/^\/membership\/corporate\/[^/]+\/employees$/u.test(path)) {
      return method === "GET"
        ? ["rental-os:corporate:view", "rental-os:corporate:manage", "rental-os:corporate:employee-manage"]
        : ["rental-os:corporate:employee-manage"];
    }
    if (path.startsWith("/membership/corporate")) {
      return method === "GET"
        ? ["rental-os:corporate:view", "rental-os:corporate:manage", "rental-os:corporate:employee-manage"]
        : ["rental-os:corporate:manage"];
    }
    if (/^\/membership\/plans\/[^/]+\/versions\/[^/]+\/(publish|disable|restore)$/u.test(path)) {
      return ["rental-os:member:plan:publish"];
    }
    if (path === "/membership/plans/assignments") {
      return ["rental-os:member:plan:manage"];
    }
    if (path.startsWith("/membership/plans")) {
      return method === "GET"
        ? ["rental-os:member:view", "rental-os:member:plan:manage", "rental-os:member:plan:publish"]
        : ["rental-os:member:plan:manage"];
    }
    return ["rental-os:member:view"];
  }

  if (method === "GET" && (path === "/rental/v1/booking-members" || /^\/rental\/v1\/booking-members\/[^/]+\/(booking-options|delivery-addresses)$/u.test(path))) {
    return ["rental-os:order:create"];
  }
  if (path === "/rental/v1/categories") {
    return ["system:tenant:manage", "rental-os:order:view", "rental-core:catalog:view", "rental-core:asset:view"];
  }
  if (path.startsWith("/rental/v1/category-adoption/")) return ["rental-os:category:adopt"];
  // REPORT-01A：当前经营空间的经营报表。与旧 `/reports` 同一权限口径
  // （报表查看），但数据只来自 Rental Core 规范化事实且严格按会话空间隔离。
  // 必须放在通用 `/rental/v1` 分支之前，否则会落到经营写权限上。
  if (path.startsWith("/rental/v1/reports")) {
    return ["rental-os:report:view"];
  }
  if (path === "/rental/v1/tenant-profile") {
    return method === "GET" ? ["rental-os:order:view", "rental-core:catalog:view", "rental-core:asset:view"] : ["rental-os:rules:manage", "rental-os:price:manage"];
  }
  if (path === "/rental/v1/business-settings") {
    return method === "GET" ? ["rental-os:rules:manage", "rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"] : ["rental-os:rules:manage", "rental-os:price:manage"];
  }
  if (path === "/rental/v1/tenant-readiness") {
    // 开业配置是多个配置域的只读汇总，不能只绑定订单查看；否则只有账号/角色
    // 管理权限的租户管理员反而看不到自己要补齐的配置清单。
    return ["rental-os:order:view", "rental-os:price:manage", "system:user:manage", "system:role:manage"];
  }
  if (path.startsWith("/rental/v1/official-calendar-sources")) {
    // 空间侧只读引用公共来源版本，用于挑选要应用哪一版（需求 4.5.2）。
    // 只给日历相关角色：它不含业务数据，但也没有理由开放给全部经营角色。
    return [
      "rental-os:calendar:view-history",
      "rental-os:calendar:edit",
      "rental-os:calendar:publish",
      "rental-os:price:manage",
      "rental-os:rules:manage"
    ];
  }
  if (path.startsWith("/rental/v1/calendars")) {
    // 需求 4.5.8：营业日历「编辑」与「发布」使用独立权限，权限模型必须允许
    // 「日历编辑人员只能改草稿、不得发布」。price:manage 作为既有超集保留，
    // 避免存量部署（其价格管理员只有 price:manage）在本次拆分后失去日历能力。
    if (method === "GET") {
      // 发布前影响预览属**发布决策**动作，只给能编辑或发布的人；客服/财务的历史只读
      // 权限不覆盖它——预览的内容是「即将发布的草稿会改什么」，不是历史追溯。
      if (/\/publish-preview$/.test(path)) {
        return ["rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"];
      }
      // 历史版本/差异/覆盖审计属**追溯视图**：需求 4.5.8 要求客服或财务「查看历史版本
      // 及报价命中的日历依据，不得修改」，因此额外接受独立的历史只读权限。
      // 仍不放给纯 order:view 的只读运营——版本详情含未发布草稿内容，与
      // 「普通运营只见已发布」相悖；要开放就必须显式配 view-history。
      if (/\/versions(\/|$)/.test(path) || /\/override-audits$/.test(path)) {
        return [
          "rental-os:calendar:view-history",
          "rental-os:calendar:edit",
          "rental-os:calendar:publish",
          "rental-os:price:manage",
          "rental-os:rules:manage"
        ];
      }
      return [
        "rental-os:calendar:view-history",
        "rental-os:calendar:edit",
        "rental-os:calendar:publish",
        "rental-os:price:manage",
        "rental-os:rules:manage",
        "rental-os:order:view"
      ];
    }
    // 发布与编辑相互独立：发布端点只认发布权限，编辑端点只认编辑权限，
    // 因此「只有发布权限」的账号在编辑端点会被拒、「只有编辑权限」的账号在发布端点会被拒。
    // price:manage 作为既有超集对两类都放行，避免存量部署失去日历能力。
    if (/\/publish$/.test(path)) {
      return ["rental-os:calendar:publish", "rental-os:price:manage"];
    }
    // 其余写操作（导入官方来源、保存日期、移除覆盖、作废草稿）属编辑，只认编辑权限。
    return ["rental-os:calendar:edit", "rental-os:price:manage"];
  }
  // RULE-01A：规则读取（列表、详情、发布预览、历史）manage 或 publish 任一即可；
  // 发布级动作（publish / void）只认 rules:publish，编辑级动作（存草稿、恢复为新草稿）
  // 只认 rules:manage。必须放在下面的合并分支之前，否则会被前缀吃掉退化成共用一个码。
  if (path.startsWith("/rental/v1/rule-versions")) {
    if (method === "GET") {
      return ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"];
    }
    if (/\/(publish|void)$/u.test(path)) {
      return ["rental-os:rules:publish"];
    }
    return ["rental-os:rules:manage"];
  }
  if (path.startsWith("/rental/v1/notification-templates") || path.startsWith("/rental/v1/notification-logs") || path === "/rental/v1/notifications/send") {
    // EXT-02：通知模板、真实短信投递、回执查询和重试属于外部接入操作，
    // 不能被价格/规则人员的权限顺带放行；自动业务事件发送仍由服务端事务链调用，
    // 不经过这条人工管理 API。
    return ["system:integration:manage"];
  }
  if (path.startsWith("/rental/v1/rewards") || path.startsWith("/rental/v1/benefit-accounts")) {
    return ["system:params:manage", "rental-os:rules:manage", "rental-os:price:manage"];
  }
  if (path === "/rental/v1/coupon-templates" || path.startsWith("/rental/v1/coupon-templates/")) {
    return ["rental-os:marketing:manage", "rental-os:price:manage"];
  }
  if (path.startsWith("/rental/v1/discount-plans") || path.startsWith("/rental/v1/customer-coupons")) {
    return method === "GET" ? ["rental-os:marketing:manage", "rental-os:price:manage", "rental-os:order:view"] : ["rental-os:marketing:manage", "rental-os:price:manage", "rental-os:order:operate"];
  }
  if (path.startsWith("/rental/v1/pricing-versions")) {
    return method === "GET"
      ? ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"]
      : ["rental-os:price:manage"];
  }
  // 定价分组与空间调价是价格域写操作，必须显式命中价格权限，不能落入
  // /rental/v1 的订单权限兜底；订单创建/查看仅能读取所需目录数据。
  if (path.startsWith("/rental/v1/pricing-groups") || path.startsWith("/rental/v1/pricing-adjustments")) {
    return method === "GET"
      ? ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"]
      : ["rental-os:price:manage"];
  }
  if (path.startsWith("/rental/v1/pricing-plans")) {
    return method === "GET" ? ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"] : ["rental-os:price:manage"];
  }
  if (path.startsWith("/rental/v1/value-added-services") || path.startsWith("/rental/v1/service-capacities")) {
    return ["rental-os:service:manage"];
  }
  if (path === "/rental/v1/locations" || path.startsWith("/rental/v1/locations/") || path.startsWith("/rental/v1/fulfillment-operators")) {
    return method === "GET" ? ["rental-os:station:view"] : ["rental-os:station:manage"];
  }
  if (path === "/rental/v1/item-groups" || path.startsWith("/rental/v1/item-groups/")) {
    return method === "GET" ? ["rental-core:catalog:view", "rental-core:catalog:manage", "rental-os:order:view", "rental-os:order:create"] : ["rental-core:catalog:manage"];
  }
  if (path === "/rental/v1/work-order-assignees") return ["rental-core:maintenance:view"];
  if (path === "/rental/v1/work-orders" || path.startsWith("/rental/v1/work-orders/")) {
    if (method === "GET") return ["rental-core:maintenance:view"];
    if (/\/review$/u.test(path)) return ["rental-core:maintenance:review"];
    return ["rental-core:maintenance:manage"];
  }
  if (path === "/rental/v1/stock-dispositions" || path.startsWith("/rental/v1/stock-dispositions/")) {
    return method === "GET"
      ? ["rental-core:maintenance:view", "rental-core:asset:view", "rental-core:asset:manage"]
      : ["rental-core:maintenance:review", "rental-core:asset:manage"];
  }
  if (path === "/rental/v1/stock-ledger") {
    return method === "GET" ? ["rental-core:asset:view", "rental-core:asset:manage"] : ["rental-core:asset:manage"];
  }
  if (path === "/rental/v1/stock-operations") {
    return ["rental-core:asset:manage"];
  }
  if (path === "/rental/v1/assets" || path.startsWith("/rental/v1/assets/") || path === "/rental/v1/stock-balances" || path === "/rental/v1/stock-dispositions") {
    return method === "GET" ? ["rental-core:asset:view", "rental-core:asset:manage"] : ["rental-core:asset:manage"];
  }
  if (path === "/rental/v1/availability") {
    return ["rental-os:order:operate", "rental-os:order:create"];
  }
  if (path.startsWith("/rental/v1/quotes")) {
    return method === "GET" ? ["rental-os:order:view"] : ["rental-os:order:operate", "rental-os:order:create"];
  }
  if (path === "/rental/v1/orders") {
    return method === "GET" ? ["rental-os:order:view"] : ["rental-os:order:operate", "rental-os:order:create"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/delivery-address\/reveal$/u)) return ["rental-os:customer:reveal-sensitive"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/carrier-shipment\/events$/u)) {
    return method === "GET" ? ["rental-os:order:view"] : ["rental-os:order:operate"];
  }
  // DOC-PRINT-01：订单客户凭证只读订单历史快照；结算里的资金汇总由控制器
  // 再按 finance:view/reconcile 做字段级裁剪，不能因为下载凭证自动获得资金明细。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/documents\/(quote|delivery|return|settlement)\/versions(?:\/[^/]+)?$/u)) {
    return ["rental-os:order:view"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/documents\/(quote|delivery|return|settlement)$/u)) {
    return ["rental-os:order:view"];
  }
  // RULE-CLOSE-01：待支付超时只能由订单操作权限触发，不能因为静态路径被通用订单详情规则放行。
  if (path === "/rental/v1/orders/expire-pending" || path === "/rental/v1/orders/reconcile-pickup-overdue" || path.match(/^\/rental\/v1\/orders\/[^/]+\/(?:expire-pending|mark-pickup-overdue|no-show-notice|confirm-no-show|resume-pickup)$/u)) {
    return ["rental-os:order:operate"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+$/)) {
    return ["rental-os:order:view"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/internal-notes$/)) {
    return method === "GET" ? ["rental-os:order:view"] : ["rental-os:order:operate"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/changes$/)) {
    return method === "GET" ? ["rental-os:order:view"] : ["rental-os:order:operate"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/changes\/post-pickup-exchange(?:\/preview)?$/)) {
    return ["rental-os:order:operate"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/changes\/partial-cancel\/preview$/)) {
    return ["rental-os:order:operate"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/changes\/partial-cancel$/)) {
    return ["rental-os:order:operate"];
  }
  // MKT-02D：服务实际履约是订单操作，不等同于维护服务目录/容量配置。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/services\/[^/]+\/execution$/)) {
    return ["rental-os:order:operate"];
  }
  // 服务退款是已批准退款的实际资金动作，只认结算权限，不让普通履约操作员动资金。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/services\/[^/]+\/refund$/)) {
    return ["rental-os:order:settle"];
  }
  // 三条费用裁定入口统一收到 order:fee-review：裁定「该收/该退多少」与实际动钱是两件事。
  // 此前它们都认 order:settle，而资金事件也认 order:settle，等于一个权限同时授予
  // 「决定金额」与「收退款」。拆开后只有裁定权的人能定金额但动不了资金台账，
  // 只有资金权的人能收退款但改不了裁定结论。资金事件那条规则保持 order:settle 不变。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/extensions\/[^/]+\/refund-review$/)) return ["rental-os:order:fee-review"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/fee-reviews\/[^/]+\/review$/)) return ["rental-os:order:fee-review"];
  // 试算不落库但会暴露价格，因此和申请同权限，不给只读账号看到续租报价。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/extensions$/)) {
    return method === "GET" ? ["rental-os:order:view"] : ["rental-os:order:extend", "rental-os:order:operate"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/extensions\/(preview|[^/]+\/pay)$/)) {
    return ["rental-os:order:extend", "rental-os:order:operate"];
  }
  if (path.startsWith("/rental/v1/inspection-templates") || path.match(/^\/rental\/v1\/orders\/[^/]+\/inspections$/)) {
    return method === "GET" ? ["rental-os:order:view"] : ["rental-os:order:operate", "rental-os:order:pickup", "rental-os:order:return"];
  }
  if (path.startsWith("/platform/integrations")) {
    return ["system:integration:manage"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/inspections\/[^/]+\/usage-correction$/)) return ["rental-os:order:operate"];
  // 检查异常的建议损失额同样是费用裁定，与上面两条同权限。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/inspections\/[^/]+\/exceptions\/[^/]+\/review$/)) return ["rental-os:order:fee-review"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/inspections\/[^/]+\/exceptions\/[^/]+\/customer-response$/)) return ["rental-os:order:fee-review"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/inspections\/[^/]+\/exceptions\/[^/]+\/re-review$/)) return ["rental-os:order:fee-review"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/cancel$/)) return ["rental-os:order:cancel", "rental-os:order:operate"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/operation-lock$/)) return ["rental-os:order:operate", "rental-os:order:pickup", "rental-os:order:return", "rental-os:order:reassign"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/handover\/pickup$/)) return ["rental-os:order:operate", "rental-os:order:pickup"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/(handover\/return|partial-return)$/)) return ["rental-os:order:operate", "rental-os:order:return"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/(assignments|allocation-candidates)$/)) return ["rental-os:order:operate"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/(confirm|allocate|substitute-bundle-component|partial-return|handover\/[^/]+)$/)) return ["rental-os:order:operate"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/settle$/)) return ["rental-os:order:settle"];
  // RULE-01B：押金/预授权模拟资金事件。读用 order:view 或 order:settle；
  // 发起/追加/抵扣/退款/释放/失败是资金动作，只认 order:settle（订单结算权限）。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/funding-events(\/[^/]+)?$/)) {
    return method === "GET"
      ? ["rental-os:order:view", "rental-os:order:settle"]
      : ["rental-os:order:settle"];
  }
  // R1 工作台待办只读当前会话空间；报表、订单查看和维护人员都需要能进入，
  // 控制器再按维护查看权限决定是否聚合工单摘要，不能让维护人员只能绕到工单页。
  if (path === "/rental/v1/workbench/todos") return ["rental-os:report:view", "rental-os:order:view", "rental-core:maintenance:view"];
  if (
    path === "/rental/v1/capabilities" ||
    path.startsWith("/rental/v1/capabilities/") ||
    path === "/rental/v1/capability-audits"
  ) {
    // CORE-EXT-02A：能力治理是**经营空间级配置**，不是订单动作。
    //
    // 必须显式声明，否则会落进下面的 `/rental/v1` 兜底，拿到
    // `order:view` / `order:operate`——那等于任何能操作订单的门店人员都可以
    // 启用、暂停或停用整个空间的业务能力。菜单与 API 门禁（CORE-EXT-02C）
    // 将以这些实例为准，因此这里放宽一格就是放宽整个门禁。
    return method === "GET"
      ? ["rental-core:capability:view", "rental-core:capability:manage"]
      : ["rental-core:capability:manage"];
  }
  if (path.startsWith("/rental/v1")) {
    return method === "GET"
      ? ["rental-os:order:view"]
      : ["rental-os:order:operate"];
  }

  return [UNMATCHED_ROUTE_PERMISSION];
}

function hasAnyPermission(user: SystemUserRow, permissions: string[]) {
  if (permissions.length === 0) {
    return true;
  }
  if (user.isSaasAdmin) {
    if (permissions.some(permission => Object.values(PLATFORM_AI_PROVIDER_PERMISSIONS).some(code => code === permission))) {
      return permissions.some(permission => user.permissions.includes(permission) || user.permissions.includes('*'));
    }
    if (permissions.some((permission) => permission.startsWith("system:rental-category:"))) {
      return permissions.some((permission) => user.permissions.includes(permission) || user.permissions.includes("*"));
    }
    // SaaS 平台管理员只拿到跨租户的平台能力：租户管理，以及公共官方日历来源注册表
    // （需求 4.5.8：「导入和维护公共官方日历来源」）。后者是跨租户的公共基础数据、
    // 不含任何空间业务数据，因此不违反同款「不得借此查看空间业务数据」。
    return permissions.some(
      (permission) => permission.startsWith("system:tenant:") || permission.startsWith("system:calendar-source:") || permission === "system:demo-request:view"
    );
  }
  if (user.isPlatformAdmin || user.permissions.includes("*")) {
    return true;
  }
  return permissions.some((permission) => user.permissions.includes(permission));
}

@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    // CORE-EXT-02C：能力门禁的判定依据。可选是为了让既有单测继续用一个假 AuthService
    // 直接构造守卫；缺失时能力门禁**拒绝**而不是放行（见 canActivate 内注释）。
    @Optional() private readonly capabilities?: WorkspaceCapabilityService,
    @Optional() private readonly clientAuth?: ClientAuthService,
    @Optional() private readonly clientRateLimit?: ClientApiRateLimitService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly subscription?: SubscriptionService
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestLike>();
    // 判定一律用归一化 + 小写化后的路径：Express 的路由匹配对大小写与尾斜杠都不敏感，
    // 而本文件全是字符串前缀与正则判定。两者语义不一致时，变体路径会落到
    // requiredPermissions 末尾的 `return []` 并被当作"无需权限"放行。详见 request-path.ts。
    const path = matchableRequestPath(request.url);
    const staffApiRequest = Boolean(request.staffApiRequest || /^\/api\/staff\/v1(?:\/|\?|$)/iu.test(request.originalUrl ?? "")
      || isHumanAutomationRoute(request.method, path, 'staff'));
    if (staffApiRequest && !isStaffBusinessRouteAllowed(request.method, path)) {
      throw new ForbiddenException("该接口未向员工小程序开放");
    }
    const permissions = staffApiRequest && isStaffAuthPath(path) ? [] : requiredPermissions(request.method, path);

    if (request.method === "POST" && path === "/public/demo-requests") {
      if (!this.clientRateLimit) throw new UnauthorizedException("预约提交安全策略未就绪");
      await this.clientRateLimit.assertAllowed({ method: request.method, path, ip: request.ip });
      return true;
    }

    if (
      path === "/health" ||
      path === "/openapi.json" ||
      path === "/auth/login" ||
      path === "/auth/development/reset-demo-password" ||
      path === "/auth/refresh" ||
      // 支付/退款回调无运营登录态,必须匿名放行到控制器;安全边界是各平台的签名/商户/金额/事件幂等校验。
      // PUBLIC_ROUTES 只把它们标为"无需权限",并不等于"免鉴权",因此这里显式匿名放行(POST)。
      (request.method === "POST" && path.startsWith("/payments/webhooks/")) ||
      (staffApiRequest && ["/staff/v1/auth/login", "/staff/v1/auth/refresh", "/staff/v1/auth/logout"].includes(path)) ||
      request.method === "OPTIONS"
    ) {
      return true;
    }

    if (isClientRoute(path)) {
      if (!this.clientRateLimit) throw new UnauthorizedException("客户端安全策略未就绪");
      await this.clientRateLimit.assertAllowed({ method: request.method, path, ip: request.ip });
      if (isClientPublicRoute(request.method, path)) return true;
      const authorization = request.headers.authorization;
      const raw = Array.isArray(authorization) ? authorization[0] : authorization;
      const token = typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice(7).trim() : undefined;
      if (!token) throw new UnauthorizedException("请先登录客户端账号");
      if (!this.clientAuth) throw new UnauthorizedException("客户端认证服务未就绪");
      const client = await this.clientAuth.authenticate(token);
      await this.clientRateLimit.assertAllowed({
        method: request.method,
        path,
        ip: request.ip,
        tenantId: client.tenantId,
        workspaceId: client.workspaceId,
        sessionId: client.sessionId
      });
      request.client = client;
      enterRequestIdentity({
        tenantId: client.tenantId,
        userId: client.customerId,
        isSaasAdmin: false,
        workspaceId: client.workspaceId
      });
      await this.gateNewBusiness(request.method, path, client.tenantId);
      return true;
    }

    const authorization = request.headers.authorization;
    const token = Array.isArray(authorization) ? authorization[0] : authorization;
    const tenantMembershipRoute = isTenantMembershipRoute(path);
    const accessContext = await this.authService.resolveAccessContext(token, {
      allowInvalidWorkspace: tenantMembershipRoute || path.startsWith("/auth/") || path.startsWith("/staff/v1/auth/") || path.startsWith("/platform/")
        || platformCapabilityProbePermission(request.method, path) !== undefined,
      audience: staffApiRequest ? "staff" : "operator"
    });
    const user = tenantMembershipRoute ? accessContext?.tenantUser : accessContext?.user;
    const workspaceId = accessContext?.workspaceId;
    if (tenantMembershipRoute && user && !user.isSaasAdmin && !user.isPlatformAdmin && user.dataScope !== "all") {
      throw new ForbiddenException("管理租户统一会员需要租户级全量数据范围和对应会员权限");
    }
    if (tenantMembershipRoute && (path === "/membership/qualification-options" || /^\/membership\/personal\/[^/]+\/(qualifications|benefits|booking-options)$/u.test(path)) && !accessContext?.workspaceValid) {
      throw new ForbiddenException("该操作需要已授权且启用的经营空间上下文");
    }
    if (path.startsWith("/files") && user && !user.isSaasAdmin) {
      const tenantUser = accessContext?.tenantUser;
      if (!tenantUser || (!tenantUser.isPlatformAdmin && (tenantUser.dataScope !== "all" || !hasAnyPermission(tenantUser, ["system:integration:manage"])))) {
        throw new ForbiddenException("共享文件访问需要租户级文件管理权限");
      }
    }

    // ACCESS-ACCEPT-01：撤销空间访问后，经营数据接口必须立即 fail-closed。
    // allowInvalidWorkspace 允许被撤销者进入切换入口与账号自助，但不能让他们
    // 拿旧会话的 workspaceId 继续读旧空间的客户/会员/经营事实。
    // workspaceValid=false 表示会话指向的空间成员关系已失效（撤销/停用）。
    // /rental、/rental-os、/reports 本身不允许租户级 fallback，通常会先以
    // 401 拒绝；这里保留这些前缀，是为了即使将来调整 fallback，也仍显式守住
    // 经营数据边界。/platform 下的客户与会员接口则在这里明确返回 403。
    if (
      workspaceId &&
      !tenantMembershipRoute &&
      accessContext.workspaceValid === false &&
      !path.startsWith("/auth/") &&
      (path.startsWith("/platform/workspace-customers") ||
        path.startsWith("/platform/customers") ||
        path.startsWith("/rental/v1") ||
        path.startsWith("/rental-os/") ||
        path.startsWith("/reports"))
    ) {
      throw new ForbiddenException("当前经营空间的访问权已被撤销，请重新登录或联系管理员");
    }

    if (!user) {
      throw new UnauthorizedException("请先登录");
    }
    if (isBudgetPlatformRoute(request.method, path) && !user.isSaasAdmin) {
      throw new ForbiddenException('仅 SaaS 平台管理员可以管理平台 AI 预算');
    }
    const platformProbePermission = platformCapabilityProbePermission(request.method, path);
    if ((path === '/ai-native/credits' || path.startsWith('/ai-native/credits/'))
      && !creditTenantRoutes.has(`${request.method.toUpperCase()} ${path}`)
      && !creditPlatformRoutes.has(`${request.method.toUpperCase()} ${path}`)) {
      throw new ForbiddenException('AI 额度入口未登记该操作');
    }
    if ((path === `/${AI_COUNTING_HTTP_DRAFT.basePath}` || path.startsWith(`/${AI_COUNTING_HTTP_DRAFT.basePath}/`))
      && !countingRouteAccess.has(`${request.method.toUpperCase()} ${path}`)) throw new ForbiddenException('计数入口未登记该操作');
    if (path === '/ai-native/platform-capability' || path.startsWith('/ai-native/platform-capability/')) {
      if (!platformProbePermission || !user.isSaasAdmin) throw new ForbiddenException('平台能力验证仅向 SaaS 管理员开放已登记操作');
    }
    // An explicit wildcard role cannot make a not-yet-defined AI action ready.
    // Keep the reserved platform-AI namespace closed beyond this exact policy.
    if ((path === '/platform/ai' || path.startsWith('/platform/ai/'))
      && !platformAiProviderPermission(request.method, path)) {
      throw new ForbiddenException('平台 AI 操作尚未提供或不支持该请求方式');
    }
    if (
      user.isSaasAdmin &&
      ![
        "/auth/me",
        "/auth/session-context",
        "/auth/change-password",
        "/auth/logout",
        "/rental/v1/categories"
      ].includes(path) &&
      !path.startsWith("/platform/tenants") &&
      !path.startsWith("/platform/tenant-bootstrap") &&
      !path.startsWith("/platform/official-calendars") &&
      !path.startsWith("/platform/subscriptions") &&
      !path.startsWith("/platform/account-appearance") &&
      !path.startsWith("/platform/rental-categories") &&
      !isPlatformAiProviderPath(path) &&
      !isBudgetPlatformRoute(request.method, path) &&
      !platformProbePermission &&
      path !== "/platform/demo-requests"
    ) {
      throw new ForbiddenException("SaaS 平台管理员只能访问租户管理能力");
    }
    if (
      user.mustChangePassword &&
      !["/auth/me", "/auth/session-context", "/auth/change-password", "/auth/logout"].includes(path)
    ) {
      throw new ForbiddenException("首次登录或密码重置后必须先修改密码");
    }
    if (
      (path.startsWith("/platform/tenants") || path.startsWith("/platform/tenant-bootstrap")) &&
      !user.isSaasAdmin
    ) {
      throw new ForbiddenException("仅 SaaS 平台管理员可以管理租户");
    }
    // 公共官方日历来源是跨租户的公共基础数据（需求 4.5.8）。必须显式 fail-closed：
    // 租户内的 isPlatformAdmin 在 hasAnyPermission 里对任何权限都放行，
    // 不加这一道的话任一租户管理员都能改所有租户共用的官方节假日数据。
    if (path.startsWith("/platform/official-calendars") && !user.isSaasAdmin) {
      throw new ForbiddenException("仅 SaaS 平台管理员可以维护公共官方日历来源");
    }
    // SUB-01：租户订阅的跨租户管理是平台能力。租户内 isPlatformAdmin 在 hasAnyPermission 里
    // 对任何权限都放行，不加这道 fail-closed，任一租户管理员都能管理所有租户的订阅。
    if (path.startsWith("/platform/subscriptions") && !user.isSaasAdmin) {
      throw new ForbiddenException("仅 SaaS 平台管理员可以管理租户订阅");
    }
    if (path.startsWith("/platform/rental-categories") && !user.isSaasAdmin) {
      throw new ForbiddenException("仅 SaaS 平台管理员可以治理租赁品类");
    }
    if (isPlatformAiProviderPath(path) && !user.isSaasAdmin) {
      throw new ForbiddenException('仅显式获权的 SaaS 平台管理员可以管理平台 AI 供应商配置');
    }
    if (path === "/platform/demo-requests" && !user.isSaasAdmin) {
      throw new ForbiddenException("仅 SaaS 平台管理员可以查看演示预约");
    }
    const staffPermissionOverride = staffApiRequest ? staffRoutePermissions(request.method, path, request.body) : undefined;
    if (!hasAnyPermission(user, staffPermissionOverride ?? permissions)) {
      throw new ForbiddenException("当前账号无权访问该功能");
    }
    // SUB-04A：到期租户停止新业务（operator 与 staff 代客共用 /rental/v1，一处覆盖两端；client 分支另有一处）。
    await this.gateNewBusiness(request.method, path, user.tenantId);
    const requestBody = request.body && typeof request.body === "object"
      ? request.body as Record<string, unknown>
      : undefined;
    const locationConfigurationRoute = /^\/rental\/v1\/locations(?:\/[^/]+)?$/u.test(path);
    const tenantWideDataScope = user.isSaasAdmin || user.isPlatformAdmin || user.permissions.includes("*") || user.dataScope === "all";
    const unrestrictedLocationScope = user.locationScope?.mode !== "selected";
    const tenantAccessConfigurationRoute =
      path.startsWith("/platform/users") ||
      path.startsWith("/platform/roles") ||
      path.startsWith("/platform/workspaces") ||
      path.startsWith("/platform/organizations");
    const requiresTenantWideDataScope =
      path.startsWith("/platform/roles") ||
      path.startsWith("/platform/workspaces") ||
      (path.startsWith("/platform/users") && request.method.toUpperCase() !== "GET") ||
      (path.startsWith("/platform/organizations") && request.method.toUpperCase() !== "GET");
    if (
      tenantAccessConfigurationRoute &&
      requiresTenantWideDataScope &&
      (!tenantWideDataScope || !unrestrictedLocationScope)
    ) {
      throw new ForbiddenException("管理租户级账号、角色、组织和空间授权需要全租户数据范围及全部履约地点范围");
    }
    if (
      request.method.toUpperCase() !== "GET" &&
      locationConfigurationRoute &&
      requestBody && Object.prototype.hasOwnProperty.call(requestBody, "organizationId") &&
      (!hasAnyPermission(user, ["system:user:manage"]) || !tenantWideDataScope || !unrestrictedLocationScope)
    ) {
      throw new ForbiddenException("调整履约地点组织归属需要全租户数据范围、全部履约地点范围和账号管理权限");
    }
    const capability = requiredCapability(path);
    if (capability && !user.isSaasAdmin) {
      // SPACE-03：品类与能力按**当前经营空间**判定，不能用租户级档案——
      // 同租户多个空间品类不同时，那会让 camping 空间按 camera 的能力集放行。
      const scope = await this.authService.getCategoryContext(user.tenantId, workspaceId);
      if (capability) {
        // CORE-EXT-02C：扩展能力门禁只认 enabled 实例；Rental Core 内建能力按当前
        // 空间品类声明直接可用，不创建重复实例。两类判定统一由 isEnabled 封装。
        //
        // 早前判据是 `scope.capabilities?.includes(capability)`，即品类定义的
        // `defaultCapabilities` 数组——那等于「品类声明了这个 code」== 「该空间启用了它」，
        // 是 fail-open：只有 code、没有可执行模块的能力照样放行，而暂停与停用
        // 根本无法表达（数组里永远有它）。现在改为查该空间的能力实例，
        // 只有 `status === "enabled"` 才放行，因此暂停即刻生效。
        //
        // 三处 fail-closed，缺一不可：
        //   1. 没有会话空间 → 拒绝。绝不回退到租户默认空间：那会让一个本该被拒的
        //      无空间会话拿到某个空间的能力集（与 P0-01 的默认租户回退同型）。
        //   2. 没有注入能力服务 → 拒绝。装配被改坏时应当失败，而不是静默放行。
        //   3. 扩展实例不是 enabled，或当前品类未声明对应 Core 能力 → 拒绝。
        if (!workspaceId) {
          throw new ForbiddenException("当前会话没有经营空间，请先选择经营空间");
        }
        if (!this.capabilities) {
          throw new ForbiddenException("能力门禁未就绪，已拒绝该请求");
        }
        if (!(await this.capabilities.isEnabled(user.tenantId, capability, workspaceId))) {
          throw new ForbiddenException("当前经营空间未启用该业务能力");
        }
      }
    }

    // SPACE-02 fail-closed：经营域接口必须有已验证的当前经营空间。
    //
    // 只拦经营域（/rental/v1 与 /rental-os），不拦 /auth 与 /platform：
    // 登录、切换空间、以及租户管理员维护空间本身，都发生在"还没有空间"的时刻。
    //
    // 这里刻意不回退到默认空间：默认空间只是升级兼容层，回退会让一个本该被拒绝的
    // 无空间会话静默拿到某个空间的数据——与 P0-01 的默认租户回退同型。
    // 例外：品类定义是全局参考数据（且 SaaS 平台管理员被显式允许访问），
    // 它不属于某个经营空间，要求空间会让平台管理员无法读取品类目录。
    const workspaceExemptPath = path === "/rental/v1/categories";
    // 刻意**不**附加 `accessContext.hasWorkspaces` 条件。
    //
    // 曾经加过，理由是「一个空间都没有的账号不该被空间检查拦住」——那是错的：
    // 无空间会话继续往下走时，仓储层的 resolveScopeWorkspaceId 会回退到租户
    // 默认空间，于是**成员关系为零的账号拿到了默认空间的完整读写权**，
    // 「账号通过成员关系进入空间」被整条绕过。saveUser 不建成员关系，
    // 所以新建账号天然处于这个状态，不需要任何数据库直改就能复现。
    //
    // 正确语义是一致的 403：没有可进入的空间，就不能访问经营域。
    // 该账号需要管理员先把它加入某个空间，这正是成员关系存在的意义。
    if (
      !workspaceId &&
      !tenantMembershipRoute &&
      !workspaceExemptPath &&
      (path.startsWith("/rental/") ||
        // SPACE-04：这两条按当前空间读写业务关系，缺空间同样必须 fail-closed。
        // 不加进来的话，服务层的 requireRequestWorkspaceId() 会抛成 500，
        // 而正确语义是「请先选择经营空间」的 403。
        path === "/platform/workspace-customers" ||
        path.startsWith("/platform/workspace-customers/") ||
        path === "/platform/customers" ||
        path.startsWith("/platform/customers/") ||
        path === "/membership" ||
        path.startsWith("/membership/"))
    ) {
      throw new ForbiddenException("当前会话没有经营空间，请先选择经营空间");
    }

    const configuredLocationScope = accessContext?.user.locationScope ?? { mode: "all" as const, locationIds: [] };
    const canManageOrganizationMapping = !staffApiRequest && locationConfigurationRoute &&
      tenantWideDataScope && unrestrictedLocationScope && hasAnyPermission(user, ["system:user:manage"]);
    const needsLocationScope =
      (path.startsWith("/rental/v1/") && path !== "/rental/v1/categories") ||
      (path.startsWith("/staff/v1/") && !isStaffAuthPath(path)) ||
      path.startsWith("/reports") ||
      path === "/platform/workspace-customers" ||
      path.startsWith("/platform/workspace-customers/");
    const locationScope = canManageOrganizationMapping
      ? { mode: "all" as const, locationIds: [] }
      : needsLocationScope
        ? await this.resolveLocationScope(user, workspaceId, configuredLocationScope)
        : configuredLocationScope;
    const operationalRentalPath = path.startsWith("/rental/v1/") || path.startsWith("/staff/v1/");
    const scopedRentalPath = operationalRentalPath && path !== "/rental/v1/categories" && path !== "/rental/v1/subscription/context";
    const restrictedRentalRequest = scopedRentalPath && (
      staffApiRequest ||
      locationScope.mode === "selected" ||
      user.dataScope !== "all"
    );
    const customerRoute = path.match(/^\/(?:platform\/customers|rental\/v1\/booking-members)\/([^/]+)/u);
    const customerId = customerRoute?.[1];
    const customerOptionsRoute = /^\/rental\/v1\/booking-members\/[^/]+\/(booking-options|delivery-addresses)$/u.test(path);
    const customerDetailRoute = path.startsWith("/platform/customers/") && !["search", "merge"].includes(customerId ?? "");
    const customerScopeRestricted = user.dataScope !== "all" || locationScope.mode === "selected";
    if (customerId && customerScopeRestricted && (customerDetailRoute || customerOptionsRoute)) {
      await this.assertCustomerRecordAccess(user, workspaceId, locationScope, customerId);
    }
    if (staffApiRequest) request.staffLocationScope = locationScope;
    if (restrictedRentalRequest && !isStaffAuthPath(path)) {
      await this.assertStaffLocationAccess(request, path, user, workspaceId, locationScope);
    }
    enterRequestIdentity({
      tenantId: user.tenantId,
      userId: user.id,
      operationToken: typeof request.headers["x-operation-token"] === "string" ? request.headers["x-operation-token"] : undefined,
      isSaasAdmin: Boolean(user.isSaasAdmin),
      // 只从会话写入，绝不读取请求体或查询参数里的 workspaceId。
      workspaceId,
      dataScope: user.dataScope,
      organizationId: user.organizationId,
      locationScope,
      staffApi: staffApiRequest,
      staffLocationScope: locationScope
    });
    request.user = user;
    return true;
  }

  /** SUB-04A：命中新业务白名单则校验订阅在有效期内（仅 Expired 拒）；单测未注入 SubscriptionService 时跳过（生产恒注入）。 */
  private async gateNewBusiness(method: string, path: string, tenantId: string): Promise<void> {
    if (!this.subscription) return;
    if (!isNewBusinessRoute(method, path)) return;
    await this.subscription.assertTenantWithinTerm(tenantId);
  }

  private async resolveLocationScope(
    user: SystemUserRow,
    workspaceId: string | undefined,
    configuredScope: { mode: "all" | "selected"; locationIds: string[] }
  ) {
    if (user.dataScope !== "organization") return configuredScope;
    if (!this.prisma || !workspaceId || !user.organizationId) {
      throw new ForbiddenException("组织数据范围缺少有效组织、经营空间或数据库上下文，已拒绝访问");
    }

    const organizations = await this.prisma.organizationUnit.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, parentId: true, status: true }
    });
    const organizationIds = enabledOrganizationSubtreeIds(organizations, user.organizationId);
    if (!organizationIds.length) {
      throw new ForbiddenException("当前账号所属组织不存在或已停用，已拒绝访问");
    }

    const locations = await this.prisma.rentalFulfillmentLocation.findMany({
      where: {
        tenantId: user.tenantId,
        workspaceId,
        organizationId: { in: organizationIds }
      },
      select: { id: true }
    });
    return organizationLocationScope(locations.map((location) => location.id), configuredScope);
  }

  private async assertStaffLocationAccess(
    request: RequestLike,
    path: string,
    user: SystemUserRow,
    workspaceId: string | undefined,
    scope: { mode: "all" | "selected"; locationIds: string[] }
  ) {
    const locationRestricted = scope.mode === "selected";
    const ownScope = user.dataScope === "own";
    const prisma = this.prisma;
    if (locationRestricted && (!prisma || !workspaceId || !Array.isArray(scope.locationIds) || !scope.locationIds.length)) {
      throw new ForbiddenException("当前账号的履约地点范围未就绪，已拒绝访问");
    }
    const allowed = new Set(scope.locationIds);
    const organizationLocationAdmin = !request.staffApiRequest &&
      /^\/rental\/v1\/locations(?:\/[^/]+)?$/u.test(path) &&
      (user.isSaasAdmin || user.isPlatformAdmin || user.permissions.includes("*") || user.dataScope === "all") &&
      user.locationScope?.mode !== "selected" &&
      hasAnyPermission(user, ["system:user:manage"]);
    if (user.dataScope === "organization" && !locationRestricted && !organizationLocationAdmin) {
      throw new ForbiddenException("组织数据范围未解析为授权履约地点，已拒绝访问");
    }
    if (!locationRestricted && !ownScope) return;
    if (!prisma || !workspaceId) throw new ForbiddenException("当前账号的数据范围未就绪，已拒绝访问");
    if (ownScope && (
      path.startsWith("/rental/v1/stock-") ||
      path === "/rental/v1/stock-balances" ||
      path.startsWith("/rental/v1/locations") ||
      path.startsWith("/rental/v1/fulfillment-operators")
    )) {
      throw new ForbiddenException("本人数据范围不适用于共享库存和地点资料，请使用地点或更高数据范围");
    }
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const query = request.query ?? {};
    const ensureLocations = (values: unknown[]) => {
      if (!locationRestricted) return;
      const ids = values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (values.some((value) => typeof value !== "string" || !allowed.has(value))) throw new ForbiddenException("所选履约地点不在当前账号授权范围内");
      for (const id of ids) if (!allowed.has(id)) throw new ForbiddenException("所选履约地点不在当前账号授权范围内");
    };
    const explicitLocations = [body.locationId, body.fulfillmentLocationId, body.returnLocationId, body.serviceLocationId, body.fromLocationId, body.toLocationId, query.locationId]
      .filter((value) => value !== undefined && value !== null && value !== "");
    if (explicitLocations.length) ensureLocations(explicitLocations);

    const locationRecordMatch = path.match(/^\/rental\/v1\/locations\/([^/]+)$/u);
    if (locationRestricted && locationRecordMatch) {
      const location = await prisma.rentalFulfillmentLocation.findFirst({
        where: {
          tenantId: user.tenantId,
          workspaceId,
          AND: [{ id: locationRecordMatch[1] }, { id: { in: scope.locationIds } }]
        },
        select: { id: true }
      });
      if (!location) throw new ForbiddenException("履约地点不存在或不在当前账号授权范围内");
    }
    if (locationRestricted && path === "/rental/v1/locations" && request.method.toUpperCase() === "POST") {
      throw new ForbiddenException("受限地点范围账号不能新建履约地点；请由租户管理员授权或创建");
    }

    if (ownScope && ["/rental/v1/quotes", "/rental/v1/orders"].includes(path) && request.method.toUpperCase() === "POST") {
      await this.assertOwnBookingCustomers(body, user, workspaceId, scope);
    }

    const orderMatch = path.match(/^\/rental\/v1\/orders\/([^/]+)/u);
    if (path === "/rental/v1/orders" && request.method.toUpperCase() === "POST") {
      if (locationRestricted && typeof body.fulfillmentLocationId !== "string") throw new ForbiddenException("当前账号创建订单必须指定已授权的履约地点");
      ensureLocations([body.fulfillmentLocationId, ...(body.returnLocationId ? [body.returnLocationId] : [])]);
    } else if (path === "/rental/v1/quotes" && request.method.toUpperCase() === "POST") {
      if (locationRestricted && typeof body.locationId !== "string") throw new ForbiddenException("当前账号报价必须指定已授权的履约地点");
      ensureLocations([body.locationId]);
    } else if (orderMatch && orderMatch[1] !== "expire-pending" && orderMatch[1] !== "reconcile-pickup-overdue") {
      const clauses: Prisma.RentalOrderWhereInput[] = [];
      if (locationRestricted) clauses.push({ OR: [
        { fulfillmentLocationId: { in: scope.locationIds } },
        { returnLocationId: { in: scope.locationIds } }
      ] });
      if (ownScope) clauses.push({ OR: [
        { createdBy: user.id },
        { workOrders: { some: { OR: [{ createdBy: user.id }, { assigneeId: user.id }] } } }
      ] });
      const order = await prisma.rentalOrder.findFirst({
        where: { id: orderMatch[1], tenantId: user.tenantId, workspaceId, ...(clauses.length ? { AND: clauses } : {}) },
        select: { id: true }
      });
      if (!order) throw new ForbiddenException("订单不存在或不在当前账号的数据范围内");
      const assetIds = this.extractAssetIds(body);
      if (locationRestricted && assetIds.length) {
        const assets = await prisma.rentalAsset.findMany({ where: { id: { in: assetIds }, tenantId: user.tenantId, workspaceId, locationId: { in: scope.locationIds } }, select: { id: true } });
        if (assets.length !== new Set(assetIds).size) throw new ForbiddenException("订单分配的资产不在当前账号授权地点范围内");
      }
    }

    const workOrderMatch = path.match(/^\/rental\/v1\/work-orders\/([^/]+)/u);
    if (workOrderMatch) {
      const row = await prisma.rentalWorkOrder.findFirst({ where: {
        id: workOrderMatch[1], tenantId: user.tenantId, workspaceId,
        ...(locationRestricted ? { locationId: { in: scope.locationIds } } : {}),
        ...(ownScope ? { OR: [{ createdBy: user.id }, { assigneeId: user.id }] } : {})
      }, select: { id: true } });
      if (!row) throw new ForbiddenException("工单不存在或不在当前账号的数据范围内");
    }
    const assetMatch = path.match(/^\/rental\/v1\/assets\/([^/]+)/u);
    if (assetMatch) {
      const row = await prisma.rentalAsset.findFirst({ where: {
        id: assetMatch[1], tenantId: user.tenantId, workspaceId,
        ...(locationRestricted ? { locationId: { in: scope.locationIds } } : {}),
        ...(ownScope ? { id: { in: (await prisma.rentalWorkOrder.findMany({
          where: { tenantId: user.tenantId, workspaceId, assetId: { not: null }, OR: [{ createdBy: user.id }, { assigneeId: user.id }] },
          select: { assetId: true }, distinct: ["assetId"]
        })).map((workOrder) => workOrder.assetId!).filter(Boolean) } } : {})
      }, select: { id: true } });
      if (!row) throw new ForbiddenException("资产不存在或不在当前账号的数据范围内");
    }
    if (path === "/rental/v1/assets" && request.method.toUpperCase() !== "GET") {
      if (ownScope) throw new ForbiddenException("本人数据范围不能登记或修改共享资产资料");
      if (typeof body.locationId !== "string") throw new ForbiddenException("资产必须绑定已授权履约地点");
      ensureLocations([body.locationId]);
    }
    if (path === "/rental/v1/stock-operations" || path === "/rental/v1/stock-balances") {
      const values = Array.isArray(body.operations) ? body.operations : Array.isArray(body.lines) ? body.lines : [];
      const rowLocations = values.flatMap((value) => value && typeof value === "object" ? [(value as Record<string, unknown>).locationId] : []);
      if (request.method.toUpperCase() !== "GET" && !body.locationId && !rowLocations.length) throw new ForbiddenException("库存作业必须绑定已授权履约地点");
      if (rowLocations.length) ensureLocations(rowLocations);
    }
    const dispositionMatch = path.match(/^\/rental\/v1\/stock-dispositions\/([^/]+)\/(?:restore|write-off)$/u);
    if (dispositionMatch) {
      const row = await prisma.rentalStockDisposition.findFirst({
        where: { id: dispositionMatch[1], tenantId: user.tenantId, workspaceId, order: { is: { OR: [
          { fulfillmentLocationId: { in: scope.locationIds } },
          { returnLocationId: { in: scope.locationIds } }
        ] } } }, select: { id: true }
      });
      if (!row) throw new ForbiddenException("库存处置不存在或不在当前员工授权地点范围内");
    }
    const uploadMatch = path.match(/^\/staff\/v1\/uploads\/sessions(?:\/([^/]+)\/complete)?$/u);
    if (uploadMatch) {
      let ownerType = String(body.businessType ?? "");
      let ownerId = String(body.businessId ?? "");
      if (uploadMatch[1]) {
        const session = await prisma.fileUploadSession.findFirst({ where: { id: uploadMatch[1], tenantId: user.tenantId }, include: { fileAsset: true } });
        ownerType = session?.fileAsset.businessType ?? "";
        ownerId = session?.fileAsset.businessId ?? "";
      }
      if (ownerType === "rental_order") {
        const row = await prisma.rentalOrder.findFirst({ where: { id: ownerId, tenantId: user.tenantId, workspaceId, OR: [
          { fulfillmentLocationId: { in: scope.locationIds } },
          { returnLocationId: { in: scope.locationIds } }
        ] }, select: { id: true } });
        if (!row) throw new ForbiddenException("附件所关联订单不在当前员工授权地点范围内");
      } else if (ownerType === "rental_work_order") {
        const row = await prisma.rentalWorkOrder.findFirst({ where: { id: ownerId, tenantId: user.tenantId, workspaceId, locationId: { in: scope.locationIds } }, select: { id: true } });
        if (!row) throw new ForbiddenException("附件所关联工单不在当前员工授权地点范围内");
      } else throw new ForbiddenException("员工附件必须绑定当前范围内的订单或工单");
    }
  }

  private async assertCustomerRecordAccess(
    user: SystemUserRow,
    workspaceId: string | undefined,
    scope: { mode: "all" | "selected"; locationIds: string[] },
    customerId: string
  ) {
    if (!this.prisma || !workspaceId) throw new ForbiddenException("当前账号的客户数据范围未就绪，已拒绝访问");
    const ownScope = user.dataScope === "own";
    const locationRestricted = scope.mode === "selected";
    if (user.dataScope === "organization" && !locationRestricted) {
      throw new ForbiddenException("组织客户范围未解析为授权履约地点，已拒绝访问");
    }
    const orderScope: Prisma.RentalOrderWhereInput[] = [];
    if (locationRestricted) {
      const locationIds = scope.locationIds.length ? scope.locationIds : ["__no_authorized_location__"];
      orderScope.push({ OR: [
        { fulfillmentLocationId: { in: locationIds } },
        { returnLocationId: { in: locationIds } }
      ] });
    }
    if (ownScope) {
      orderScope.push({ OR: [
        { createdBy: user.id },
        { workOrders: { some: { OR: [{ createdBy: user.id }, { assigneeId: user.id }] } } }
      ] });
    }
    if (!locationRestricted && (ownScope || user.dataScope === "store")) {
      const profile = await this.prisma.customerProfile.findFirst({
        where: {
          id: customerId,
          tenantId: user.tenantId,
          createdInWorkspaceId: workspaceId,
          ...(ownScope ? { createdByUserId: user.id } : {})
        },
        select: { id: true }
      });
      if (profile) return;
    }
    const order = await this.prisma.rentalOrder.findFirst({
      where: {
        tenantId: user.tenantId,
        workspaceId,
        AND: [
          ...orderScope,
          { OR: [
          { customerId },
          { contractSubjectCustomerId: customerId },
          { payerSubjectCustomerId: customerId },
          { userSubjectCustomerId: customerId }
          ] }
        ]
      },
      select: { id: true }
    });
    if (!order) throw new ForbiddenException("客户不存在或不在当前账号的数据范围内");
  }

  private async assertOwnBookingCustomers(
    body: Record<string, unknown>,
    user: SystemUserRow,
    workspaceId: string | undefined,
    scope: { mode: "all" | "selected"; locationIds: string[] }
  ) {
    if (!workspaceId) throw new ForbiddenException("本人预约数据范围未就绪，已拒绝操作");
    const customerId = typeof body.customerId === "string" ? body.customerId : undefined;
    if (!customerId) return; // 临时客户不读取会员主档。
    await this.assertCustomerRecordAccess(user, workspaceId, scope, customerId);
    const identity = body.bookingIdentity && typeof body.bookingIdentity === "object"
      ? body.bookingIdentity as Record<string, unknown>
      : {};
    const corporateCustomerId = typeof identity.corporateCustomerId === "string" ? identity.corporateCustomerId : undefined;
    if (corporateCustomerId) {
      const now = new Date();
      const relation = await this.prisma?.customerCorporateMembership.findFirst({
        where: {
          tenantId: user.tenantId,
          personalCustomerId: customerId,
          corporateCustomerId,
          status: "active",
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
        },
        select: { id: true }
      });
      if (!relation) throw new ForbiddenException("所选企业会员关系不在当前账号的数据范围内");
    }
    const subjects = body.subjects && typeof body.subjects === "object"
      ? body.subjects as Record<string, unknown>
      : {};
    for (const key of ["contractSubjectCustomerId", "payerSubjectCustomerId", "userSubjectCustomerId"] as const) {
      const subjectId = typeof subjects[key] === "string" ? subjects[key] as string : undefined;
      if (!subjectId || subjectId === customerId || subjectId === corporateCustomerId) continue;
      await this.assertCustomerRecordAccess(user, workspaceId, scope, subjectId);
    }
  }

  private extractAssetIds(value: unknown): string[] {
    if (!value || typeof value !== "object") return [];
    const found = new Set<string>();
    const visit = (item: unknown) => {
      if (!item || typeof item !== "object") return;
      if (Array.isArray(item)) { item.forEach(visit); return; }
      for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
        if ((key === "assetId" || key === "assetIds") && typeof child === "string") found.add(child);
        else visit(child);
      }
    };
    visit(value);
    return [...found];
  }
}
