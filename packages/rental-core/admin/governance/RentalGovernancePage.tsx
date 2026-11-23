import { CorePage } from "@rental-os/platform-admin/core";
import { RentalGovernancePageProvider, useRentalGovernanceContext, type RentalGovernancePageContext } from "./page-context";
import { CalendarOutlined, NotificationOutlined, SafetyCertificateOutlined, TeamOutlined } from "@rental-os/platform-admin/ui";
import type { SaveTenantRentalBusinessSettingsRequest } from "@rental-os/rental-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "@rental-os/platform-admin/ui";
import { Tabs } from "@rental-os/platform-admin/ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale } from "@rental-os/platform-admin/locale";
import { QueryState } from "@rental-os/platform-admin/ui";
import { CalendarTab } from "./CalendarTab";
import { CategoryTab } from "./CategoryTab";
import { MembershipRewardRulesTab } from "./MembershipRewardRulesTab";
import { NotificationsTab } from "./NotificationsTab";
import { RulesTab } from "./RulesTab";
import {
  useGovernancePermissions,
  type GovernancePermissions,
  type GovernanceTabContext,
} from "./shared";

type TabKey = "category" | "rules" | "calendar" | "membership" | "notifications";

interface GovernanceTabDefinition {
  key: TabKey;
  label: ReactNode;
  permitted: (permissions: GovernancePermissions) => boolean;
  render: (context: GovernanceTabContext) => ReactNode;
}

/**
 * 页签的**唯一**清单：可进入的页签与实际渲染的页签都从这一份派生。
 * 页签与内部查询共用同一权限口径，避免选中空白页或请求注定被原 Guard 拒绝的数据。
 */
const TABS: GovernanceTabDefinition[] = [
  {
    key: "category",
    label: "品类与租赁方式",
    permitted: (permissions) => permissions.canSeeSettings,
    render: ({ category, settings, saveTab, saving }) => <CategoryTab category={category} settings={settings} onSave={saveTab} saving={saving} />,
  },
  {
    key: "rules",
    label: (
      <span>
        <SafetyCertificateOutlined />
        业务规则
      </span>
    ),
    permitted: (permissions) => permissions.canSeeRules,
    render: ({ permissions, category }) => <RulesTab permissions={permissions} category={category} />,
  },
  {
    key: "calendar",
    label: (
      <span>
        <CalendarOutlined />
        营业日历
      </span>
    ),
    permitted: (permissions) => permissions.canSeeCalendar,
    render: ({ permissions }) => <CalendarTab permissions={permissions} />,
  },
  {
    key: "membership",
    label: (
      <span>
        <TeamOutlined />
        会员奖励规则
      </span>
    ),
    permitted: (permissions) => permissions.canSeeSettings,
    render: ({ permissions, settings, saveTab, saving }) => <MembershipRewardRulesTab permissions={permissions} settings={settings} onSave={saveTab} saving={saving} />,
  },
  {
    key: "notifications",
    label: (
      <span>
        <NotificationOutlined />
        通知模板
      </span>
    ),
    permitted: (permissions) => permissions.canManageNotifications,
    render: ({ permissions, settings }) => <NotificationsTab permissions={permissions} settings={settings} />,
  },
];

/**
 * 「品类与业务规则」外壳：页头与页签导航。每个页签自己持有表单和保存动作，
 * 规则、日历、会员奖励与通知不会再被一个页头按钮混成一次提交。
 */
function RentalGovernanceBody() {
  const { api: rentalCoreApi, session: auth, getSession, runtime, scopeKey, currentScopeKey, queryScope: scope, navigationTarget, components } = useRentalGovernanceContext();
  const { CategoryAssistFlow } = components;
  const { message } = App.useApp();
  const { t } = useLocale();
  const assistIdentity = JSON.stringify([scope, runtime.currentSessionEpoch()]);
  const [assistScope, setAssistScope] = useState<string>();
  const assistAllowed = auth.sessionVerified && auth.authenticated && !!auth.tenant?.tenantId && !!auth.user
    && !auth.user.isSaasAdmin && !!auth.currentWorkspaceId && auth.hasPermission("rental-os:category:adopt");
  const queryClient = useQueryClient();
  const permissions = useGovernancePermissions(permission => auth.hasPermission(permission));
  const permittedTabs = useMemo(() => TABS.filter((definition) => definition.permitted(permissions)), [permissions]);
  const [tab, setTab] = useState<TabKey>(permittedTabs[0]?.key ?? "calendar");
  useEffect(() => {
    if (navigationTarget?.tab && permittedTabs.some(item => item.key === navigationTarget.tab)) setTab(navigationTarget.tab as TabKey);
  }, [navigationTarget?.key, navigationTarget?.tab, permittedTabs]);
  useEffect(() => {
    if (permittedTabs.length && !permittedTabs.some((definition) => definition.key === tab)) setTab(permittedTabs[0].key);
  }, [permittedTabs, tab]);
  const categories = useQuery({
    queryKey: ["rental-core", "categories", scopeKey],
    queryFn: rentalCoreApi.categories,
    enabled: permittedTabs.some(definition => definition.key !== 'calendar'),
  });
  const profile = useQuery({
    queryKey: ["rental-core", "profile", scopeKey],
    queryFn: rentalCoreApi.profile,
    enabled: permittedTabs.some(definition => definition.key !== 'calendar'),
  });
  const settings = useQuery({
    queryKey: ["rental-core", "business-settings", scopeKey],
    queryFn: rentalCoreApi.businessSettings,
    enabled: permittedTabs.some(definition => definition.key !== 'calendar'),
  });
  const category = useMemo(
    () =>
      categories.data?.find((item) => item.code === profile.data?.categoryCode),
    [categories.data, profile.data?.categoryCode],
  );
  const saveSettings = useMutation({
    mutationFn: (body: SaveTenantRentalBusinessSettingsRequest) => rentalCoreApi.saveBusinessSettings(body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "business-settings"],
      });
      message.success(t("本页配置已保存"));
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          t("本页配置保存失败，请检查填写内容"),
      ),
  });

  /**
   * business-settings 仍是服务端的整体快照接口，不能只发一个嵌套分组；
   * 但 UI 的提交边界按当前页签拆开。每个页签只传自己的 patch，其他分组
   * 从最近一次服务端快照合并，避免切换页签或保存一个页签时覆盖另一页签。
   */
  const saveTab = (patch: Partial<SaveTenantRentalBusinessSettingsRequest>) => {
    if (!settings.data) return Promise.reject(new Error("Settings unavailable"));
    const {
      tenantId: _tenant,
      categoryCode: _category,
      configVersion: _version,
      updatedAt: _updatedAt,
      updatedBy: _updatedBy,
      ...current
    } = settings.data;
    return saveSettings.mutateAsync({ ...current, ...patch });
  };

  const localizedTabs = permittedTabs.map((definition) => ({
    ...definition,
    label: definition.key === "category"
      ? t("品类与租赁方式")
      : definition.key === "rules"
        ? t("业务规则")
        : definition.key === "calendar"
          ? t("营业日历")
          : definition.key === "membership"
            ? t("会员奖励规则")
            : t("通知模板"),
    icon: definition.key === "rules" ? <SafetyCertificateOutlined /> : definition.key === "calendar" ? <CalendarOutlined /> : definition.key === "membership" ? <TeamOutlined /> : definition.key === "notifications" ? <NotificationOutlined /> : undefined
  }));
  return (
    <CorePage actions={tab === "category" && assistAllowed && CategoryAssistFlow ? [{
      id: "category-assist", kind: "open", label: t("品类版本助手"), emphasis: "secondary",
      ariaExpanded: assistScope === assistIdentity,
      open: () => {
        const current = getSession();
        // 采用沿原权限检查；它不是普通治理查看权，也不是新增的 Core 权限。
        if (currentScopeKey() !== scopeKey || !current.sessionVerified || !current.authenticated
          || !current.tenant?.tenantId || !current.user || current.user.isSaasAdmin
          || !current.currentWorkspaceId || !current.hasPermission("rental-os:category:adopt"))
          throw new Error(t("当前操作不可用"));
        setAssistScope(assistIdentity);
      }
    }] : []}>

      <div data-copilot-anchor="governance-view"><Tabs
        key={scope}
        aria-label={t("品类与业务规则")}
        className="standalone-tabs"
        destroyOnHidden={false}
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={localizedTabs.map(({ key, label, icon, render }) => ({ key, label, icon, children: key === 'calendar'
          ? <CalendarTab permissions={permissions} /> : <QueryState
          transitionKey={scope}
          loading={settings.isLoading || profile.isLoading || categories.isLoading}
          error={settings.error || profile.error || categories.error}
          onRetry={() => Promise.all([settings.refetch({ throwOnError: true }), profile.refetch({ throwOnError: true }), categories.refetch({ throwOnError: true })])}
        >
        {settings.data && category && <>{render({
            permissions,
            category,
            settings: settings.data,
            saveTab,
            saving: saveSettings.isPending,
          })}
          {key === "category" && tab === "category" && assistAllowed && assistScope === assistIdentity
            && CategoryAssistFlow && <CategoryAssistFlow key={assistIdentity} mode="workspace" code={category.code} identity={assistIdentity}
              current={() => tab === "category" && assistScope === assistIdentity}
              onChanged={async () => {
                await queryClient.invalidateQueries({ queryKey: ["category-adoption"] });
                await queryClient.invalidateQueries({ queryKey: ["rental-core", "profile"] });
                await queryClient.invalidateQueries({ queryKey: ["rental-core", "business-settings"] });
                await queryClient.invalidateQueries({ queryKey: ["rental-core", "categories"] });
              }} />}
        </>}
        </QueryState> }))}
      /></div>
    </CorePage>
  );
}

/** 已验证会话、AI 插槽与单次请求由宿主供给，业务页签共用此正文。 */
export function RentalGovernancePage(context: RentalGovernancePageContext) {
  return <RentalGovernancePageProvider context={context}><RentalGovernanceBody /></RentalGovernancePageProvider>;
}
