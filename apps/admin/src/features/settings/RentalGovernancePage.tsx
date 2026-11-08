import { CalendarOutlined, NotificationOutlined, SafetyCertificateOutlined, TeamOutlined } from "@/components/ui/icons";
import type { SaveTenantRentalBusinessSettingsRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "@/components/ui";
import { Tabs } from "@/components/ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { CalendarTab } from "./governance/CalendarTab";
import { CategoryTab } from "./governance/CategoryTab";
import { MembershipRewardRulesTab } from "./governance/MembershipRewardRulesTab";
import { NotificationsTab } from "./governance/NotificationsTab";
import { RulesTab } from "./governance/RulesTab";
import { useLocation } from "react-router-dom";
import { navigationTarget } from "@/features/copilot/destinations";
import {
  useGovernancePermissions,
  type GovernancePermissions,
  type GovernanceTabContext,
} from "./governance/shared";

type TabKey = "category" | "rules" | "calendar" | "membership" | "notifications";

interface GovernanceTabDefinition {
  key: TabKey;
  label: ReactNode;
  permitted: (permissions: GovernancePermissions) => boolean;
  render: (context: GovernanceTabContext) => ReactNode;
}

/**
 * 页签的**唯一**清单：可进入的页签与实际渲染的页签都从这一份派生。
 * 此前两处各写一遍判定，通知页签在「可进入」里认 system:params:manage、在「渲染」里不认，
 * 只有平台参数权限的账号会选中一个空白页签。
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
    // 通知模板走 rules:manage，单有发布权限不覆盖它。
    permitted: (permissions) => permissions.canEditRules || permissions.canManagePrice || permissions.canManageParams,
    render: ({ permissions, settings }) => <NotificationsTab permissions={permissions} settings={settings} />,
  },
];

/**
 * 「品类与业务规则」外壳：页头与页签导航。每个页签自己持有表单和保存动作，
 * 规则、日历、会员奖励与通知不会再被一个页头按钮混成一次提交。
 */
export function RentalGovernancePage() {
  const { message } = App.useApp();
  const { t } = useLocale();
  const scope = useListQueryIdentity();
  const queryClient = useQueryClient();
  const permissions = useGovernancePermissions();
  const permittedTabs = useMemo(() => TABS.filter((definition) => definition.permitted(permissions)), [permissions]);
  const [tab, setTab] = useState<TabKey>(permittedTabs[0]?.key ?? "calendar");
  const location = useLocation();
  useEffect(() => {
    const target = navigationTarget(location.state, location.pathname);
    if (target?.tab && permittedTabs.some(item => item.key === target.tab)) setTab(target.tab as TabKey);
  }, [location.key, location.state, location.pathname, permittedTabs]);
  useEffect(() => {
    if (permittedTabs.length && !permittedTabs.some((definition) => definition.key === tab)) setTab(permittedTabs[0].key);
  }, [permittedTabs, tab]);
  const categories = useQuery({
    queryKey: ["rental-core", "categories"],
    queryFn: rentalCoreApi.categories,
  });
  const profile = useQuery({
    queryKey: ["rental-core", "profile"],
    queryFn: rentalCoreApi.profile,
  });
  const settings = useQuery({
    queryKey: ["rental-core", "business-settings"],
    queryFn: rentalCoreApi.businessSettings,
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
    <>
      <PageHeader
        title={t("品类与业务规则")}
      />
      <div data-copilot-anchor="governance-view"><Tabs
        key={scope}
        aria-label={t("品类与业务规则")}
        className="standalone-tabs"
        destroyOnHidden={false}
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={localizedTabs.map(({ key, label, icon, render }) => ({ key, label, icon, children: <QueryState
          transitionKey={scope}
          loading={settings.isLoading || profile.isLoading || categories.isLoading}
          error={settings.error || profile.error || categories.error}
          onRetry={() => Promise.all([settings.refetch({ throwOnError: true }), profile.refetch({ throwOnError: true }), categories.refetch({ throwOnError: true })])}
        >
        {settings.data && category && render({
            permissions,
            category,
            settings: settings.data,
            saveTab,
            saving: saveSettings.isPending,
          })}
        </QueryState> }))}
      /></div>
    </>
  );
}
