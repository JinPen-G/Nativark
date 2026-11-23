/** Tenant desktop-data permissions, separate from model connection settings.
 * The original policy service remains the authority for every read and save. */
import { useRentalDesktopContext } from './page-context';
import { DesktopBusinessPolicySettings } from './DesktopBusinessPolicySettings';

export function ClientAuthorizationPage() {
  const { session: { useAuthStore } } = useRentalDesktopContext();
  const auth = useAuthStore();
  const identity = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user]);
  return <DesktopBusinessPolicySettings key={identity} identity={identity} />;
}
