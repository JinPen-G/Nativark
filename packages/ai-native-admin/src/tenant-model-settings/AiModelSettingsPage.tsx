/** Tenant configuration host. The server remains the permission/CAS authority;
 * this page cannot grant capabilities, initialize quotas or dispatch a model. */
import { useCallback, useState } from "react";
import { useAiManagementLocale as useLocale } from '../ai-native/management-locale';
import { PageHeading as PageHeader, resolveAdminBrandName } from "@rental-os/platform-admin/shell";
import { AnimatedIcon } from "@rental-os/platform-admin/ui";
import { useTenantModelSettingsRuntime } from "./runtime";
import { Alert, Tabs } from "@rental-os/platform-admin/ui";
import { TenantSettingsEditor } from "./TenantSettingsEditor";
import { TenantAiCreditSettings } from '../platform-model-settings/AiCreditSettings';
import { AiCallRecords } from './AiCallRecords';
import type { AiSettingsMode } from './ai-service-settings-model';
import { AiConnectionCheck } from './AiConnectionCheck';
import styles from '../ai-native/AiManagement.module.css';

export function AiModelSettingsPage({ taskCenterPath }: { taskCenterPath?: string }) {
  const { t } = useLocale();
  const { auth, tenantIdentity: contextKey, currentSessionEpoch } = useTenantModelSettingsRuntime();
  const identity = contextKey();
  // Even the same actor/space can receive a new session epoch. Its editors
  // must capture that epoch afresh while original operation locators stay put.
  const workspaceKey = JSON.stringify([identity, currentSessionEpoch()]);
  const [selection, setSelection] = useState<{ identity: string; mode: AiSettingsMode } | null>(null);
  const mode = selection?.identity === workspaceKey ? selection.mode : null;
  const onModeChange = useCallback((mode: AiSettingsMode) => setSelection({ identity: workspaceKey, mode }), [workspaceKey]);
  const allowed = auth.sessionVerified && auth.authenticated && !!auth.tenant?.tenantId && !!auth.currentWorkspaceId && !!auth.user?.id
    && !auth.user.isSaasAdmin && auth.hasPermission("system:params:manage");
  return <>
    <PageHeader brandName={resolveAdminBrandName(auth.tenant, auth.user)} icon={<AnimatedIcon name="rules" />} title={t("AI 服务设置")} />
    {allowed ? <Tabs key={workspaceKey} destroyOnHidden={false} items={[
      { key: 'settings', label: t('服务配置'), children: <>
        <TenantSettingsEditor tenantId={auth.tenant!.tenantId} identity={identity} onModeChange={onModeChange}
          renderConnection={props => <AiConnectionCheck {...props} />} />
      </> },
      { key: 'credits', label: t('平台额度'), children: mode === 'tenant_managed'
        ? <p className={styles.help}>{t('自带供应商直接计费；平台额度仅用于平台 AI。')}</p>
        : <TenantAiCreditSettings identity={identity} /> },
      { key: 'calls', label: t('调用记录'), children: <AiCallRecords identity={identity} taskCenterPath={taskCenterPath} /> }
    ]} />
      : <Alert type="warning" title={t("需要当前经营空间及 AI 配置管理权限。")}/>}
  </>;
}
