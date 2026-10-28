/** Tenant desktop-data permissions, separate from model connection settings.
 * The original policy service remains the authority for every read and save. */
import { PageHeader } from '@/components/PageHeader';
import { useAuthStore } from '@/features/auth/authStore';
import { useLocale } from '@/app/locale';
import { DesktopBusinessPolicySettings } from './DesktopBusinessPolicySettings';

export function ClientAuthorizationPage() {
  const auth = useAuthStore(), { t } = useLocale();
  const identity = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user]);
  return <>
    <PageHeader title={t('客户端授权')} description={t('管理桌面客户端在当前经营空间可查看的业务资料。')} />
    <DesktopBusinessPolicySettings key={identity} identity={identity} />
  </>;
}
