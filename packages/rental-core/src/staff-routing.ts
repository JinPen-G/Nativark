/** 原员工稳定路径映射。宿主传 Shared 正式常量；staff 标记只由本中间件写入。
 * 映射不授予权限，staff audience、动作、地点及对象仍由原 Rental Guard 核验。 */
import type { RentalGuardContracts } from "./auth-guard-contracts";

export interface StaffRoutableRequest {
  url: string;
  originalUrl?: string;
  staffApiRequest?: boolean;
}

export function createRentalStaffApiRouting(contracts: Pick<RentalGuardContracts,
  "AI_STAFF_INSPECTION_HTTP_DRAFT" | "AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT">) {
  const { AI_STAFF_INSPECTION_HTTP_DRAFT, AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT } = contracts;
  const { basePath: taskBase, method: _method, ...operations } = AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT;
  const taskPaths = new Set(Object.values(operations).map(operation => `/api/${taskBase}/${operation}`));
  const assistPaths = new Set(Object.values(AI_STAFF_INSPECTION_HTTP_DRAFT.operations)
    .map(operation => `/api/${AI_STAFF_INSPECTION_HTTP_DRAFT.basePath}/${operation}`));
  return (request: StaffRoutableRequest, _response: unknown, next: () => void) => {
    const source = request.url || request.originalUrl || "";
    const match = source.match(/^(\/api\/staff\/v1)(?=\/|\?|$)(.*)$/iu);
    if (!match) return next();
    request.staffApiRequest = true;
    const originalPath = source.split("?")[0].toLowerCase().replace(/\/+$/u, "");
    if (assistPaths.has(originalPath)) return next();
    const suffix = match[2] || "/";
    if (/^\/(?:auth|uploads|offline-payments)(?:\/|\?|$)/iu.test(suffix)) return next();
    if (taskPaths.has(originalPath)) return next();
    const queryAt = suffix.indexOf("?");
    const route = queryAt < 0 ? suffix : suffix.slice(0, queryAt);
    const query = queryAt < 0 ? "" : suffix.slice(queryAt);
    request.url = `/api${route.startsWith("/") ? route : `/${route}`}${query}`;
    return next();
  };
}
