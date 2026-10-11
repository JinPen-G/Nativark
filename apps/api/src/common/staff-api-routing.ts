/**
 * 员工端稳定版本路径。认证路由由 StaffAuthController 原生处理；业务路由映射到
 * 已有 Rental Core handler，但保留 staffApiRequest 标记供 Guard、脱敏和范围过滤使用。
 */
import { AI_STAFF_INSPECTION_HTTP_DRAFT, AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT } from '@rental-os/shared';
const { basePath: inspectionTaskBase, method: _inspectionTaskMethod, ...inspectionTaskOperations } = AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT;
const inspectionTaskPaths = new Set(Object.values(inspectionTaskOperations).map(operation => `/api/${inspectionTaskBase}/${operation}`));
const inspectionAssistPaths = new Set(Object.values(AI_STAFF_INSPECTION_HTTP_DRAFT.operations)
  .map(operation => `/api/${AI_STAFF_INSPECTION_HTTP_DRAFT.basePath}/${operation}`));
interface StaffRoutableRequest {
  url: string;
  originalUrl?: string;
  staffApiRequest?: boolean;
}

export function staffApiRoutingMiddleware(req: StaffRoutableRequest, _res: unknown, next: () => void) {
  const source = req.url || req.originalUrl || "";
  const match = source.match(/^(\/api\/staff\/v1)(?=\/|\?|$)(.*)$/iu);
  if (!match) return next();

  req.staffApiRequest = true;
  if (inspectionAssistPaths.has(source.split('?')[0].toLowerCase().replace(/\/+$/u, ''))) return next();
  const suffix = match[2] || "/";
  if (/^\/(?:auth|uploads|offline-payments)(?:\/|\?|$)/iu.test(suffix)) return next();
  // Native opt-in controller; preserve only its closed operation set. Unknown
  // AI paths still go through the ordinary facade and fail its allowlist.
  if (inspectionTaskPaths.has(source.split('?')[0].toLowerCase().replace(/\/+$/u, ''))) return next();

  const queryAt = suffix.indexOf("?");
  const route = queryAt < 0 ? suffix : suffix.slice(0, queryAt);
  const query = queryAt < 0 ? "" : suffix.slice(queryAt);
  req.url = `/api${route.startsWith("/") ? route : `/${route}`}${query}`;
  return next();
}
