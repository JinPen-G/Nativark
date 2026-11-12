import { AI_STAFF_INSPECTION_HTTP_DRAFT, AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT, AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT } from '@rental-os/shared';
import { AI_AUTOMATION_REVIEW_GRANT_HTTP_DRAFT, AI_AUTOMATION_EVENT_TASK_HTTP_DRAFT } from '@rental-os/shared';
import { STAFF_UPLOAD_OBSERVATION_HTTP } from '@rental-os/shared';
const staffUploadObservationPath = `/${STAFF_UPLOAD_OBSERVATION_HTTP.basePath}/${STAFF_UPLOAD_OBSERVATION_HTTP.observe}`;
const inspectionPolicyPaths = new Set([AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT.read,
  AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT.configure, AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT.clear]
  .map(operation => `/${AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT.basePath}/${operation}`));
const { basePath: inspectionTaskBase, method: inspectionTaskMethod, ...inspectionTaskOperations } = AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT;
const inspectionTaskPaths = new Set(Object.values(inspectionTaskOperations).map(operation => `/${inspectionTaskBase}/${operation}`));
const inspectionAssistPaths = new Set(Object.values(AI_STAFF_INSPECTION_HTTP_DRAFT.operations)
  .map(operation => `/${AI_STAFF_INSPECTION_HTTP_DRAFT.basePath}/${operation}`));
const STAFF_AUTH_PATHS = new Set([
  "/staff/v1/auth/login",
  "/staff/v1/auth/refresh",
  "/staff/v1/auth/logout",
  "/staff/v1/auth/me",
  "/staff/v1/auth/session-context",
  "/staff/v1/auth/change-password",
  "/staff/v1/auth/switch-workspace"
]);

const humanAutomationActions = new Set([
  'candidates/read', 'candidates/prepare', 'candidates/prepare-pending', 'inputs/prepare', 'inputs/read',
  'tasks/create', 'tasks/read-creation', 'reviews/read', 'reviews/for-event', 'reviews/close', 'reviews/feedback', 'reviews/operation', 'reviews/queue',
  AI_AUTOMATION_EVENT_TASK_HTTP_DRAFT.operation,
  ...Object.values(AI_AUTOMATION_REVIEW_GRANT_HTTP_DRAFT.operations)
]);
export function isHumanAutomationRoute(method: string, path: string, audience: 'operator' | 'staff') {
  const prefix = `/ai-native/automation/${audience}/`;
  return method.toUpperCase() === 'POST' && path.startsWith(prefix) && humanAutomationActions.has(path.slice(prefix.length));
}

export function isStaffAuthPath(path: string) {
  return STAFF_AUTH_PATHS.has(path);
}

/** Closed allowlist: new operator routes are not automatically exposed through the staff facade. */
export function isStaffBusinessRouteAllowed(method: string, path: string) {
  const verb = method.toUpperCase();
  if (path.startsWith("/staff/v1/auth/")) return isStaffAuthPath(path);
  if (isHumanAutomationRoute(verb, path, 'staff')) return true;
  if (inspectionAssistPaths.has(path)) return verb === "POST";
  if (inspectionPolicyPaths.has(path)) return verb === 'POST';
  // Exact opt-in AI recognition task routes. Original order/attachment/action
  // authorities still recheck ownership, location and the current stage.
  if (inspectionTaskPaths.has(path)) return verb === inspectionTaskMethod;
  if (path === "/staff/v1/uploads/sessions" && verb === "POST") return true;
  if (path === staffUploadObservationPath && verb === 'POST') return true;
  if (/^\/staff\/v1\/uploads\/sessions\/[^/]+\/complete$/u.test(path) && verb === "POST") return true;
  if (/^\/staff\/v1\/uploads\/[^/]+\/download-url$/u.test(path) && verb === "GET") return true;
  if (path === "/staff/v1/offline-payments") return verb === "GET" || verb === "POST";
  if (/^\/staff\/v1\/offline-payments\/[^/]+\/confirm$/u.test(path)) return verb === "POST";
  if (/^\/rental\/v1\/orders\/[^/]+\/internal-notes$/u.test(path)) return verb === "GET" || verb === "POST";

  if (path === "/rental/v1/categories" || path === "/rental/v1/locations" || path === "/rental/v1/item-groups" || path === "/rental/v1/inspection-templates") return verb === "GET";
  // SUB-MP：员工小程序只读订阅/权益上下文（§4.4）。任意已登录员工可读自身租户，金额脱敏。
  if (path === "/rental/v1/subscription/context") return verb === "GET";
  // 型号封面图（受保护图片）：员工端列表/详情缩略图需要，只读。
  if (/^\/rental\/v1\/item-groups\/[^/]+\/images\/[^/]+$/u.test(path)) return verb === "GET";
  if (path === "/rental/v1/orders") return verb === "GET" || verb === "POST";
  if (path === "/rental/v1/quotes") return verb === "POST";
  if (path === "/rental/v1/workbench/todos" || path === "/rental/v1/assets" || path === "/rental/v1/stock-balances" || path === "/rental/v1/stock-ledger" || path === "/rental/v1/stock-dispositions" || path === "/rental/v1/work-orders" || path === "/rental/v1/work-order-assignees") {
    if (path === "/rental/v1/workbench/todos") return verb === "GET";
    if (path === "/rental/v1/assets") return verb === "GET" || verb === "POST";
    if (path === "/rental/v1/stock-balances") return verb === "GET" || verb === "PUT";
    if (path === "/rental/v1/stock-dispositions" || path === "/rental/v1/work-orders") return verb === "GET" || (path === "/rental/v1/work-orders" && verb === "POST");
    return verb === "GET";
  }
  if (path === "/rental/v1/stock-operations") return verb === "POST";
  if (/^\/rental\/v1\/assets\/[^/]+(?:\/status-history)?$/u.test(path)) return verb === "GET" || (verb === "PUT" && !path.endsWith("/status-history"));
  if (/^\/rental\/v1\/stock-dispositions\/[^/]+\/restore$/u.test(path)) return verb === "POST";
  if (/^\/rental\/v1\/stock-dispositions\/[^/]+\/write-off$/u.test(path)) return verb === "POST";
  if (/^\/rental\/v1\/work-orders\/[^/]+(?:\/(?:history|assign|start|submit|review|cancel))?$/u.test(path)) {
    if (/\/history$/u.test(path)) return verb === "GET";
    if (/\/assign$/u.test(path)) return verb === "PUT";
    if (/\/(?:start|submit|review|cancel)$/u.test(path)) return verb === "POST";
    return verb === "GET";
  }

  if (/^\/rental\/v1\/orders\/[^/]+(?:\/.*)?$/u.test(path)) {
    // Read/detail + staff workflow actions only. Money release/refund/final settlement,
    // provider refunds, configuration, and business exceptions stay on the operator API.
    if (/^\/rental\/v1\/orders\/[^/]+$/u.test(path)) return verb === "GET";
    if (/^\/rental\/v1\/orders\/[^/]+\/(?:funding-events(?:\/(?:initiate|append|capture))?)$/u.test(path)) {
      if (/\/funding-events$/u.test(path)) return verb === "GET";
      return verb === "POST";
    }
    if (verb === "GET") return /^\/rental\/v1\/orders\/[^/]+\/(?:allocation-candidates|inspections|extensions|funding-events|internal-notes)$/u.test(path);
    return verb === "POST" && /^\/rental\/v1\/orders\/[^/]+\/(?:confirm|cancel|expire-pending|mark-pickup-overdue|no-show-notice|confirm-no-show|resume-pickup|allocate|assignments|operation-lock|inspections|handover\/(?:pickup|return)|partial-return|extensions|extensions\/preview|extensions\/[^/]+\/refund-review|inspections\/[^/]+\/(?:usage-correction|exceptions\/[^/]+\/(?:review|customer-response|re-review)))$/u.test(path);
  }

  if (path === "/platform/customers" || /^\/platform\/customers\/[^/]+$/u.test(path)) return verb === "GET" || (path === "/platform/customers" && verb === "POST");
  if (/^\/membership\/(?:personal\/[^/]+|corporate)$/u.test(path)) return verb === "PUT";
  // 会员注册审核 / 证件审核（S14）：租户级动作，守卫另强制 dataScope=all + 对应审核权限。
  if (path === "/membership/reviews") return verb === "GET";
  if (/^\/membership\/reviews\/[^/]+\/decision$/u.test(path)) return verb === "POST";
  return false;
}

export function staffRoutePermissions(method: string, path: string, body?: unknown) {
  if (path === staffUploadObservationPath) {
    const file = body && typeof body === 'object' ? (body as { file?: unknown }).file : undefined;
    const scene = file && typeof file === 'object' ? (file as { uploadScene?: unknown }).uploadScene : undefined;
    if (scene === 'pickup-evidence') return ['rental-os:order:pickup'];
    if (scene === 'return-evidence') return ['rental-os:order:return'];
    if (scene === 'handover-signature') return ['rental-os:order:pickup', 'rental-os:order:return'];
    if (scene === 'work-order-evidence') return ['rental-core:maintenance:manage'];
    if (scene === 'offline-payment-proof') return ['rental-os:order:offline-payment'];
    return ['__unmatched_staff_upload_observation__'];
  }
  if (method.toUpperCase() === 'POST' && inspectionPolicyPaths.has(path)) return ['rental-os:order:view'];
  if (isHumanAutomationRoute(method, path, 'staff')) return ['rental-os:order:view'];
  if (method.toUpperCase() === 'POST' && inspectionAssistPaths.has(path)) return ['rental-os:order:view'];
  if (method.toUpperCase() === inspectionTaskMethod && inspectionTaskPaths.has(path)) {
    // Entry permission only, not model execution or inspection submission.
    return ["rental-os:order:view"];
  }
  if (/^\/rental\/v1\/orders\/[^/]+\/internal-notes$/u.test(path)) return method.toUpperCase() === "GET" ? ["rental-os:order:view"] : ["rental-os:order:operate"];
  if (/^\/rental\/v1\/orders\/[^/]+\/operation-lock$/u.test(path) && method.toUpperCase() === "POST") {
    const action = body && typeof body === "object" ? String((body as { action?: unknown }).action ?? "") : "";
    return action === "force-release" ? ["rental-os:order:reassign"] : ["rental-os:order:operate", "rental-os:order:pickup", "rental-os:order:return"];
  }
  if (/^\/rental\/v1\/orders\/[^/]+\/funding-events\/(?:initiate|append)$/u.test(path) && method.toUpperCase() === "POST") {
    return ["rental-os:order:offline-payment"];
  }
  if (/^\/rental\/v1\/orders\/[^/]+\/funding-events\/capture$/u.test(path) && method.toUpperCase() === "POST") {
    return ["rental-os:order:settle"];
  }
  if (path === "/staff/v1/offline-payments" && method.toUpperCase() === "GET") return ["rental-os:order:view"];
  if (path === "/staff/v1/offline-payments" && method.toUpperCase() === "POST") return ["rental-os:order:offline-payment"];
  if (/^\/staff\/v1\/offline-payments\/[^/]+\/confirm$/u.test(path) && method.toUpperCase() === "POST") return ["rental-os:order:settle"];
  if (path === "/staff/v1/uploads/sessions" || /^\/staff\/v1\/uploads\/sessions\/[^/]+\/complete$/u.test(path)) {
    const scene = body && typeof body === "object" ? String((body as { uploadScene?: unknown }).uploadScene ?? "") : "";
    if (scene === "offline-payment-proof") return ["rental-os:order:offline-payment"];
    if (scene === "work-order-evidence") return ["rental-core:maintenance:manage"];
    return ["rental-os:order:pickup", "rental-os:order:return", "rental-core:maintenance:manage", "rental-os:order:offline-payment"];
  }
  if (/^\/staff\/v1\/uploads\/[^/]+\/download-url$/u.test(path)) {
    return ["rental-os:order:pickup", "rental-os:order:return", "rental-core:maintenance:manage", "rental-os:order:offline-payment"];
  }
  // 续租代办试算/申请（order:extend）；负差额/逾时退款审核（order:fee-review）。
  if (/^\/rental\/v1\/orders\/[^/]+\/extensions(?:\/preview)?$/u.test(path) && method.toUpperCase() === "POST") return ["rental-os:order:extend"];
  if (/^\/rental\/v1\/orders\/[^/]+\/extensions\/[^/]+\/refund-review$/u.test(path) && method.toUpperCase() === "POST") return ["rental-os:order:fee-review"];
  // 检查异常费用复核/再复核/客户申诉处理（order:fee-review）。
  if (/^\/rental\/v1\/orders\/[^/]+\/inspections\/[^/]+\/exceptions\/[^/]+\/(?:review|re-review|customer-response)$/u.test(path) && method.toUpperCase() === "POST") return ["rental-os:order:fee-review"];
  // 会员注册审核 / 证件审核：任一审核权限可进入列表，决策时服务端按 review 类型再校验对应权限。
  if (path === "/membership/reviews" && method.toUpperCase() === "GET") return ["rental-os:member:review", "rental-os:member:qualification-review"];
  if (/^\/membership\/reviews\/[^/]+\/decision$/u.test(path) && method.toUpperCase() === "POST") return ["rental-os:member:review", "rental-os:member:qualification-review"];
  return undefined;
}
