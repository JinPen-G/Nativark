import {
  CalendarOutlined,
  NotificationOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { DEFAULT_RENTAL_PAYMENT_METHODS } from "@rental-os/shared";
import type { TenantRentalBusinessSettings } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Tabs } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { CalendarTab } from "./governance/CalendarTab";
import { CategoryTab } from "./governance/CategoryTab";
import { MembershipRewardRulesTab } from "./governance/MembershipRewardRulesTab";
import { NotificationsTab } from "./governance/NotificationsTab";
import { RulesTab } from "./governance/RulesTab";
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
    render: ({ category }) => <CategoryTab category={category} />,
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
    render: ({ permissions }) => <MembershipRewardRulesTab permissions={permissions} />,
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
 * 「品类与业务规则」外壳：页头保存按钮、页签导航，以及承载各页签设置字段的租户经营设置表单。
 * 每个页签的查询、状态、抽屉与弹窗都在 `./governance/*Tab.tsx` 各自持有。
 */
export function RentalGovernancePage() {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const permissions = useGovernancePermissions();
  const permittedTabs = useMemo(() => TABS.filter((definition) => definition.permitted(permissions)), [permissions]);
  const [tab, setTab] = useState<TabKey>(permittedTabs[0]?.key ?? "calendar");
  useEffect(() => {
    if (permittedTabs.length && !permittedTabs.some((definition) => definition.key === tab)) setTab(permittedTabs[0].key);
  }, [permittedTabs, tab]);
  const [settingsForm] = Form.useForm<TenantRentalBusinessSettings>();
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
  useEffect(() => {
    // 设置表单挂载在品类档案与设置数据都准备好之后；避免设置请求先返回时
    // 提前调用未连接的 Form 实例，触发 Ant Design 告警并丢掉首次回填。
    if (settings.data && category) {
      settingsForm.setFieldsValue({
        ...settings.data,
        payment: {
          ...settings.data.payment,
          enabledMethods: settings.data.payment.enabledMethods?.length
            ? settings.data.payment.enabledMethods
            : [...DEFAULT_RENTAL_PAYMENT_METHODS],
        },
        allocation: settings.data.allocation ?? {
          autoPreassign: false,
          preassignDays: 7,
          autoLock: false,
          lockMinutes: 120,
          protectManual: true,
        },
      });
    }
  }, [category, settings.data, settingsForm]);

  const saveSettings = useMutation({
    mutationFn: (values: TenantRentalBusinessSettings) => {
      const {
        tenantId: _tenant,
        categoryCode: _category,
        configVersion: _version,
        updatedAt: _updatedAt,
        updatedBy: _updatedBy,
        ...body
      } = values;
      return rentalCoreApi.saveBusinessSettings(body);
    },
    onSuccess: async (result) => {
      settingsForm.setFieldsValue(result);
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "business-settings"],
      });
      message.success(t("租户经营设置已保存"));
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          t("保存租户设置失败，请检查填写内容"),
      ),
  });

  const activeTab = permittedTabs.find((definition) => definition.key === tab);
  const localizedTabs = permittedTabs.map((definition) => ({
    ...definition,
    label: definition.key === "category"
      ? t("品类与租赁方式")
      : definition.key === "rules"
        ? <span><SafetyCertificateOutlined />{t("业务规则")}</span>
        : definition.key === "calendar"
          ? <span><CalendarOutlined />{t("营业日历")}</span>
          : definition.key === "membership"
            ? <span><TeamOutlined />{t("会员奖励规则")}</span>
            : <span><NotificationOutlined />{t("通知模板")}</span>
  }));
  return (
    <>
      <PageHeader
        title={t("品类与业务规则")}
        description={t("租户经营品类决定允许范围；价格、日历、规则、奖励与通知均按版本留痕。")}
        extra={
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saveSettings.isPending}
            onClick={() => settingsForm.submit()}
          >
            {t("保存租户设置")}
          </Button>
        }
      />
      <Tabs
        className="standalone-tabs"
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={localizedTabs.map(({ key, label }) => ({ key, label }))}
      />
      {!(settings.data && category) && <Form form={settingsForm} style={{ display: "none" }} />}
      <QueryState
        loading={settings.isLoading || profile.isLoading}
        error={settings.error || profile.error}
      >
        {settings.data && category && (
          <Form<TenantRentalBusinessSettings>
            form={settingsForm}
            layout="vertical"
            // 不渲染原生 <form> 元素：页签内还嵌着各自独立的表单（规则草稿、日历覆盖、
            // 通知模板等），外层若是真正的 <form>，内层 <form> 就成了非法嵌套并触发
            // React hydration 警告。保存按钮走 settingsForm.submit()（显式 onClick），
            // component={false} 下仍会触发 onFinish。
            component={false}
            onFinish={() =>
              // 提交整个 store 而非仅当前 tab 已注册的字段：设置分 tab 条件渲染，未挂载
              // 分组（如另一 tab 的 calendar/notifications）以及无 Form.Item 的字段（timeZone、
              // weeklyHours）都只在 store 里。只交已注册字段会让 PUT 缺组而整体 400，
              // 还会把时区与每周时段静默抹掉。getFieldsValue(true) 取回随 setFieldsValue 载入的全量。
              saveSettings.mutate(settingsForm.getFieldsValue(true))
            }
          >
            {activeTab?.render({ permissions, category, settings: settings.data })}
          </Form>
        )}
      </QueryState>
    </>
  );
}
