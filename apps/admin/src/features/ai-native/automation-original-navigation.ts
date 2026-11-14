/** Registered human business navigation only. The original review session
 * verifies its source before this port; the destination keeps all business
 * permissions and confirmations. No AUTOMATION Task, query action or URL is
 * accepted as navigation authority. Opening never establishes resolution. */
import { generatePath } from 'react-router-dom';
import { APP_ROUTES, type AppRouteDefinition } from '@/app/navigation';
import type { AutomationReviewOriginalEntry, AutomationReviewScope } from './automation-review-session';

export function createAutomationOriginalNavigation(input: {
  scope: AutomationReviewScope; current(): boolean;
  hasPermission(permission: string): boolean; navigate(path: string): void;
}): AutomationReviewOriginalEntry {
  const id = (value: unknown): value is string => typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
  const permitted = (route: AppRouteDefinition) => !route.permission || input.hasPermission(route.permission)
    || Boolean(route.legacyPermissions?.some(input.hasPermission));
  return async (target, signal) => {
    const unavailable = { state: 'unavailable' as const };
    if (signal.aborted || !input.current() || target.scope.tenantId !== input.scope.tenantId
      || target.scope.workspaceId !== input.scope.workspaceId || target.scope.actorId !== input.scope.actorId
      || target.scope.audience !== input.scope.audience || !id(target.resource.id)) return unavailable;
    const resource = target.resource;
    let route: AppRouteDefinition | undefined, path: string | undefined;
    if (resource.kind === 'order' || resource.kind === 'inspection' || resource.kind === 'refund') {
      if (!id(resource.orderId) || resource.kind === 'order' && resource.id !== resource.orderId) return unavailable;
      route = APP_ROUTES.orderDetail;
      if (permitted(route)) path = generatePath(route.path, { id: encodeURIComponent(resource.orderId) });
      else if (resource.kind === 'refund' && permitted(APP_ROUTES.paymentReconciliation)) {
        route = APP_ROUTES.paymentReconciliation; path = route.path;
      }
    } else if (resource.kind === 'notification') {
      // The original notification log lives in the governance page. Its tab is
      // selected by the person; an invented query must not imply send/retry.
      route = APP_ROUTES.rentalSettings; path = route.path;
    } else if (resource.kind === 'configuration') {
      // The original readiness page exposes the nine configuration sections.
      // This is a human entry, never an attestation of a field save or publish.
      route = APP_ROUTES.tenantReadiness; path = route.path;
    }
    if (!route || !path || !permitted(route) || signal.aborted || !input.current()) return unavailable;
    input.navigate(path);
    return { state: 'opened' as const };
  };
}
