import {
  CalendarOutlined,
  NotificationOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { RENTAL_PRICING_UNIT_LABELS } from "@store-rental/shared";
import type {
  GrantRentalRewardRequest,
  RentalCalendarDay,
  RentalCalendarVersionSummary,
  RentalDepositRule,
  SaveRentalCalendarDayRequest,
  RentalNotificationTemplateV1,
  RentalPreauthorizationRule,
  RentalRuleVersion,
  SaveRentalNotificationTemplateRequest,
  SendRentalNotificationRequest,
  TenantRentalBusinessSettings,
} from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { CalendarMonthGrid } from "@/features/settings/CalendarMonthGrid";
import { CalendarRangeModal } from "@/features/settings/CalendarRangeModal";

type TabKey =
  | "category"
  | "rules"
  | "calendar"
  | "membership"
  | "notifications";
type TemplateForm = Omit<
  SaveRentalNotificationTemplateRequest,
  "variableSchema"
> & { variableSchemaText: string };
type SendForm = Omit<SendRentalNotificationRequest, "variables"> & {
  variablesText: string;
};
const pricingUnitLabels = RENTAL_PRICING_UNIT_LABELS;
const currentYear = new Date().getFullYear();
/** 四态营业状态（需求 4.5.4）。界面必须能看出限时/自助，否则状态翻转是不可见的。 */
const businessStatusLabels: Record<string, string> = {
  open: "正常营业",
  limited: "限时营业",
  closed: "停止营业",
  self_service: "自助营业",
};
/** 覆盖审计动作。 */
const auditActionLabels: Record<string, string> = {
  override: "建立覆盖",
  revert: "移除覆盖",
};
/** 版本状态（需求 4.5.7 的四态）。 */
const calendarStatusLabels: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  superseded: "已被替代",
  void: "已作废",
};
/** 规则版本五态（需求 4.6.1）。服务端按当前时间现算，前端只负责显示。 */
const ruleStatusLabels: Record<string, string> = {
  draft: "草稿",
  pending: "待生效",
  published: "已生效",
  superseded: "已被替代",
  void: "已作废",
};
const ruleStatusColors: Record<string, string> = {
  draft: "default",
  pending: "processing",
  published: "success",
  superseded: "warning",
  void: "error",
};
/** 规则版本审计动作（需求 4.6.14）。 */
const ruleAuditActionLabels: Record<string, string> = {
  publish: "发布",
  restore: "恢复为草稿",
  void: "作废",
};
/** 发布预览里的变化维度标签（需求 4.5.8 要求按停业/时段/价格分别展示）。 */
const previewFieldLabels: Record<string, string> = {
  dayType: "日期类型",
  name: "名称",
  businessStatus: "营业状态",
  closed: "停业",
  hours: "营业时段",
  pricingMultiplier: "特殊价格",
  source: "来源",
};
const modeLabels: Record<string, string> = {  store_pickup_return: "门店取还",
  partner_pickup_return: "合作商取还",
  warehouse_pickup_return: "仓库取还",
  locker_pickup_return: "自提柜取还",
  delivery: "配送",
  onsite_delivery: "现场交付",
};
const securityRuleLabels: Record<RentalDepositRule["mode"], string> = {
  none: "不需要",
  fixed: "按商品固定金额",
  price_multiple: "按商品行租金倍数",
  order_fixed: "每单固定金额",
};
const preauthorizationRuleLabels: Record<RentalPreauthorizationRule["mode"], string> = {
  ...securityRuleLabels,
  risk_surcharge: "租金倍数 + 风险附加",
};

/** 规则链的冲突信息（时点重叠、已发布不可改）必须原样透出，否则用户无从改正。 */
function errorText(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
  );
}

/** 旧规则只有 payment.depositMode；打开编辑器时显式派生为新的两组独立规则。 */
function ruleSecurityGroups(config: RentalRuleVersion["config"]): {
  deposit: RentalDepositRule;
  preauthorization: RentalPreauthorizationRule;
} {
  const legacyMode = config.payment.depositMode;
  return {
    deposit:
      config.deposit ??
      (legacyMode === "none" || legacyMode === "preauthorization"
        ? { mode: "none" }
        : { mode: legacyMode }),
    preauthorization:
      config.preauthorization ??
      (legacyMode === "preauthorization" ? { mode: "fixed" } : { mode: "none" }),
  };
}

export function RentalGovernancePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // 需求 4.5.8 的角色矩阵要在界面上成立：日历编辑人员不该看到「发布」，发布人员不该
  // 看到「导入/覆盖/移除覆盖」，而且不该发出注定 403 的请求（页面会满屏报错，
  // 专门配置的日历角色拿不到一个能用的工作界面）。
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canManagePrice = hasPermission("store-rental:price:manage");
  // 需求 4.6.14：「权限分为规则编辑、规则发布……」。编辑草稿与对客户生效是两个责任，
  // 因此按钮分别判权；读取（列表、详情、预览、审计）两者任一即可，与后端 guard 同口径。
  const canEditRules = hasPermission("store-rental:rules:manage");
  const canPublishRules = hasPermission("store-rental:rules:publish");
  const canSeeRules = canEditRules || canPublishRules || canManagePrice;
  const canEditCalendar = canManagePrice || hasPermission("store-rental:calendar:edit");
  const canPublishCalendar = canManagePrice || hasPermission("store-rental:calendar:publish");
  // 需求 4.5.8：客服或财务「查看历史版本及报价命中的日历依据，不得修改」——独立的
  // 历史只读权限，不必顺带授予编辑/发布/规则管理。与后端 guard 同一口径。
  const canViewCalendarHistory =
    canEditCalendar ||
    canPublishCalendar ||
    canEditRules ||
    hasPermission("store-rental:calendar:view-history");
  const canSeeCalendar = canViewCalendarHistory;
  const canSeeSettings = canManagePrice || canEditRules;
  const permittedTabs = useMemo<TabKey[]>(
    () =>
      [
        canSeeSettings ? ("category" as const) : undefined,
        canSeeRules ? ("rules" as const) : undefined,
        canSeeCalendar ? ("calendar" as const) : undefined,
        canSeeSettings ? ("membership" as const) : undefined,
        // 通知模板走 rules:manage，单有发布权限不覆盖它。
        canEditRules || canManagePrice ? ("notifications" as const) : undefined
      ].filter((key): key is TabKey => Boolean(key)),
    [canSeeSettings, canSeeRules, canEditRules, canManagePrice, canSeeCalendar]
  );
  const [tab, setTab] = useState<TabKey>(permittedTabs[0] ?? "calendar");
  useEffect(() => {
    if (permittedTabs.length && !permittedTabs.includes(tab)) setTab(permittedTabs[0]);
  }, [permittedTabs, tab]);
  const [year, setYear] = useState(currentYear);
  // PRICE-02A（需求 4.5.9）：默认按自然月运营日历；全年列表仅作为可选视图保留。
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1);
  const [calendarListView, setCalendarListView] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeMode, setRangeMode] = useState<"override" | "remove">("override");
  const [ruleEditor, setRuleEditor] = useState<RentalRuleVersion>();
  /** 待发布的草稿。发布原因必填、生效时点可选，因此走独立弹窗并带影响预览。 */
  const [rulePublishTarget, setRulePublishTarget] = useState<RentalRuleVersion>();
  /** 预览用的生效时点（ISO）。与表单分开存，表单值变化才好触发重新预览。 */
  const [rulePublishEffectiveFrom, setRulePublishEffectiveFrom] = useState<string>();
  /** 待恢复的历史规则版本（需求 4.6.1：只能生成新草稿，不得原地改回）。 */
  const [ruleRestoreTarget, setRuleRestoreTarget] = useState<RentalRuleVersion>();
  /** 待作废的待生效或已生效规则版本。 */
  const [ruleVoidTarget, setRuleVoidTarget] = useState<RentalRuleVersion>();
  const [calendarDay, setCalendarDay] = useState<RentalCalendarDay>();
  const [importOpen, setImportOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  /** 历史版本抽屉。选中版本后展开逐日差异与覆盖审计（需求 4.5.7/4.5.8）。 */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState<string>();
  /** 待作废的草稿版本。原因必填，因此走确认弹窗。 */
  const [voidTarget, setVoidTarget] = useState<RentalCalendarVersionSummary>();
  /** 待恢复的历史版本（需求 4.5.7：以旧内容生成新草稿，不得原地改回）。原因必填。 */
  const [restoreTarget, setRestoreTarget] = useState<RentalCalendarVersionSummary>();
  /** 待移除覆盖的日期。撤销原因必填，因此走确认弹窗而不是直接 DELETE。 */
  const [revertTarget, setRevertTarget] = useState<RentalCalendarDay>();
  const [templateEditor, setTemplateEditor] =
    useState<RentalNotificationTemplateV1 | null>();
  const [sendTemplate, setSendTemplate] =
    useState<RentalNotificationTemplateV1>();
  const [settingsForm] = Form.useForm<TenantRentalBusinessSettings>();
  const [ruleForm] = Form.useForm<
    RentalRuleVersion["config"] & { changeReason: string }
  >();
  const [calendarDayForm] = Form.useForm<SaveRentalCalendarDayRequest>();
  const [publishForm] = Form.useForm<{ changeReason: string }>();
  const [rulePublishForm] = Form.useForm<{ reason: string; effectiveFrom?: dayjs.Dayjs }>();
  const [ruleRestoreForm] = Form.useForm<{ reason: string }>();
  const [ruleVoidForm] = Form.useForm<{ reason: string }>();
  const [revertForm] = Form.useForm<{ overrideReason: string }>();
  const [voidForm] = Form.useForm<{ reason: string }>();
  const [restoreForm] = Form.useForm<{ reason: string }>();
  const [rewardForm] = Form.useForm<GrantRentalRewardRequest>();
  const [templateForm] = Form.useForm<TemplateForm>();
  const [sendForm] = Form.useForm<SendForm>();
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
  // 每个查询都按权限 gate：日历角色没有规则/奖励/通知权限，无条件发请求会让页面
  // 满屏 403，专门配置的角色拿不到一个能用的界面（需求 4.5.8 的角色矩阵）。
  const rules = useQuery({
    queryKey: ["rental-core", "rule-versions"],
    queryFn: rentalCoreApi.ruleVersions,
    enabled: canSeeRules,
  });
  /** 规则版本审计（需求 4.6.14）：发布、恢复、作废的原因与操作者。 */
  const ruleAudits = useQuery({
    queryKey: ["rental-core", "rule-version-audits"],
    queryFn: () => rentalCoreApi.ruleVersionAudits(),
    enabled: canSeeRules && tab === "rules",
  });
  /** 发布影响预览。只在发布弹窗打开时拉，随生效时点变化重取。 */
  const rulePublishPreview = useQuery({
    queryKey: [
      "rental-core",
      "rule-publish-preview",
      rulePublishTarget?.version,
      rulePublishEffectiveFrom,
    ],
    queryFn: () =>
      rentalCoreApi.ruleVersionPublishPreview(
        rulePublishTarget!.version,
        rulePublishEffectiveFrom,
      ),
    enabled: !!rulePublishTarget && canPublishRules,
  });
  const calendar = useQuery({
    queryKey: ["rental-core", "calendar", year],
    queryFn: () => rentalCoreApi.calendar(year),
    enabled: canSeeCalendar,
  });
  /** 版本历史只在抽屉打开时拉，且属管理视图。 */
  const calendarVersions = useQuery({
    queryKey: ["rental-core", "calendar-versions", year],
    queryFn: () => rentalCoreApi.calendarVersions(year),
    enabled: historyOpen && canViewCalendarHistory,
  });
  const calendarVersionDetail = useQuery({
    queryKey: ["rental-core", "calendar-version", year, historyVersion],
    queryFn: () => rentalCoreApi.calendarVersion(year, historyVersion!),
    enabled: Boolean(historyOpen && historyVersion && canViewCalendarHistory),
  });
  const calendarAudits = useQuery({
    queryKey: ["rental-core", "calendar-audits", year, historyVersion],
    queryFn: () => rentalCoreApi.calendarOverrideAudits(year, historyVersion),
    enabled: historyOpen && canViewCalendarHistory,
  });
  /** 可引用的公共官方来源版本：只在「应用官方来源」抽屉打开时拉。 */
  const officialSourceVersions = useQuery({
    queryKey: ["rental-core", "official-calendar-sources", year],
    queryFn: () => rentalCoreApi.officialCalendarSourceVersions(year),
    enabled: importOpen && canEditCalendar,
  });
  /** 发布前影响预览：只在发布抽屉打开时拉一次（需求 4.5.8）。 */
  const publishPreview = useQuery({
    queryKey: ["rental-core", "calendar-publish-preview", year],
    queryFn: () => rentalCoreApi.calendarPublishPreview(year),
    enabled: publishOpen && canPublishCalendar,
  });
  const rewards = useQuery({
    queryKey: ["rental-core", "rewards"],
    queryFn: () => rentalCoreApi.rewards(),
    enabled: canSeeSettings,
  });
  const benefitAccounts = useQuery({
    queryKey: ["rental-core", "benefit-accounts"],
    queryFn: () => rentalCoreApi.benefitAccounts(),
    enabled: canSeeSettings,
  });
  const couponTemplates = useQuery({
    queryKey: ["rental-core", "coupon-templates"],
    queryFn: rentalCoreApi.couponTemplates,
    enabled: canSeeSettings,
  });
  const templates = useQuery({
    queryKey: ["rental-core", "notification-templates"],
    queryFn: rentalCoreApi.notificationTemplates,
    enabled: canEditRules || canManagePrice,
  });
  const logs = useQuery({
    queryKey: ["rental-core", "notification-logs"],
    queryFn: rentalCoreApi.notificationLogs,
    enabled: canEditRules || canManagePrice,
  });
  const category = useMemo(
    () =>
      categories.data?.find((item) => item.code === profile.data?.categoryCode),
    [categories.data, profile.data?.categoryCode],
  );
  useEffect(() => {
    if (settings.data) settingsForm.setFieldsValue(settings.data);
  }, [settings.data, settingsForm]);

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
      message.success("租户经营设置已保存");
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "保存租户设置失败，请检查填写内容",
      ),
  });
  const saveRule = useMutation({
    mutationFn: (
      values: RentalRuleVersion["config"] & { changeReason: string },
    ) => {
      const { changeReason, ...config } = values;
      const deposit = config.deposit ?? { mode: "none" as const };
      // 不支持预授权的品类只能保存 none。即使历史快照或缓存表单残留了旧值，
      // 也要给用户一条可恢复路径，不能让禁用控件与后端能力校验形成死锁。
      const preauthorization = category?.businessModel.supportsPreauthorization === false
        ? { mode: "none" as const }
        : config.preauthorization ?? { mode: "none" as const };
      return rentalCoreApi.saveRuleVersion({
        config: {
          ...config,
          deposit,
          preauthorization,
          payment: {
            ...config.payment,
            depositMode:
              deposit.mode !== "none"
                ? deposit.mode === "order_fixed" ? "fixed" : deposit.mode
                : preauthorization.mode !== "none"
                  ? "preauthorization"
                  : "none",
            preauthorizationRequired: preauthorization.mode !== "none",
          },
        },
        changeReason,
        // 只存草稿：已发布版本不可修改（需求 4.6.1），发布是独立的、需要发布权限的动作。
        versionId: ruleEditor?.status === "draft" ? ruleEditor.id : undefined,
      });
    },
    onSuccess: async () => {
      setRuleEditor(undefined);
      ruleForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "rule-versions"],
      });
      message.success("规则草稿已保存，仍需具备发布权限的人发布后才对客户生效");
    },
    onError: () => message.error("草稿保存失败，请检查品类能力和租户设置"),
  });
  const publishRule = useMutation({
    mutationFn: (values: { reason: string; effectiveFrom?: dayjs.Dayjs }) =>
      rentalCoreApi.publishRuleVersion(rulePublishTarget!.version, {
        reason: values.reason,
        effectiveFrom: values.effectiveFrom?.toISOString(),
      }),
    onSuccess: async (row) => {
      setRulePublishTarget(undefined);
      setRulePublishEffectiveFrom(undefined);
      rulePublishForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-versions"] });
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-version-audits"] });
      message.success(
        row.status === "pending" ? "已安排生效，到点后自动按新版本报价" : "新版本已生效",
      );
    },
    onError: (error) => message.error(errorText(error, "发布失败")),
  });
  const restoreRule = useMutation({
    mutationFn: (values: { reason: string }) =>
      rentalCoreApi.restoreRuleVersion(ruleRestoreTarget!.version, values.reason),
    onSuccess: async () => {
      setRuleRestoreTarget(undefined);
      ruleRestoreForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-versions"] });
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-version-audits"] });
      message.success("已按历史版本生成新草稿，原版本保持不变");
    },
    onError: (error) => message.error(errorText(error, "恢复失败")),
  });
  const voidRule = useMutation({
    mutationFn: (values: { reason: string }) =>
      rentalCoreApi.voidRuleVersion(ruleVoidTarget!.version, values.reason),
    onSuccess: async () => {
      setRuleVoidTarget(undefined);
      ruleVoidForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-versions"] });
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-version-audits"] });
      message.success("版本已作废");
    },
    onError: (error) => message.error(errorText(error, "作废失败")),
  });
  const saveDay = useMutation({
    mutationFn: (value: SaveRentalCalendarDayRequest) =>
      rentalCoreApi.saveCalendarDay(year, value),
    onSuccess: async () => {
      setCalendarDay(undefined);
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      message.success("租户日历覆盖已保存");
    },
    onError: () => message.error("日期或价格系数无效"),
  });
  /**
   * 引用公共官方来源版本生成/更新本空间年度草稿（需求 4.5.2）。
   *
   * 空间侧不再提交原始官方日期：公共官方数据由 SaaS 平台管理员在注册表里维护并形成
   * 来源版本，空间只能挑一版应用，再自行确认发布——否则「租户自行编造公共数据」
   * 且「导入即影响全部经营空间」。
   */
  const applyOfficialSource = useMutation({
    mutationFn: (sourceVersionId: string) =>
      rentalCoreApi.applyOfficialCalendarSource(year, { sourceVersionId }),
    onSuccess: async (result) => {
      setImportOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar-versions", year],
      });
      // 保留的人工覆盖必须显式告知：应用来源时静默跳过这些日期，运营会以为官方值已生效。
      const preserved = result?.importPreservedOverrides ?? [];
      if (preserved.length) {
        message.warning(
          `官方来源已应用到草稿。${preserved.length} 个日期存在人工覆盖，已保留原覆盖：${preserved.join("、")}`,
        );
      } else {
        message.success("官方来源已应用到草稿，请核对后发布");
      }
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "应用官方来源失败",
      ),
  });
  const publishCalendar = useMutation({
    mutationFn: (changeReason: string) =>
      rentalCoreApi.publishCalendar(year, { changeReason }),
    onSuccess: async () => {
      setPublishOpen(false);
      publishForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar-versions", year],
      });
      message.success("年度营业日历已发布，后续报价将记录该版本");
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "发布失败：需填写变更原因",
      ),
  });
  /** 作废草稿版本（需求 4.5.7）。原因必填，作废后该草稿不再进入编辑视图。 */
  /**
   * 以某个历史版本的内容生成新草稿（需求 4.5.7）。只产生草稿：被恢复的版本与当前
   * 已发布版本都不改动，后续仍要走发布前预检 → 填变更原因 → 发布。
   */
  const restoreVersion = useMutation({
    mutationFn: ({ version, reason }: { version: string; reason: string }) =>
      rentalCoreApi.restoreCalendarVersion(year, version, { reason }),
    onSuccess: async (created) => {
      setRestoreTarget(undefined);
      restoreForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar-versions", year],
      });
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      message.success(`已按该版本生成新草稿 v${created.version}，请核对后发布`);
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "恢复失败：必须填写原因，且不能恢复当前正在编辑的版本",
      ),
  });
  const voidVersion = useMutation({
    mutationFn: ({ version, reason }: { version: string; reason: string }) =>
      rentalCoreApi.voidCalendarVersion(year, version, { reason }),
    onSuccess: async () => {
      setVoidTarget(undefined);
      voidForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar-versions", year],
      });
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      message.success("草稿版本已作废，并记录了作废原因");
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "作废失败：只能作废草稿版本，且必须填写原因",
      ),
  });
  const removeDayOverride = useMutation({
    mutationFn: ({ date, overrideReason }: { date: string; overrideReason: string }) =>
      rentalCoreApi.removeCalendarDayOverride(year, date, { overrideReason }),
    onSuccess: async () => {
      setRevertTarget(undefined);
      revertForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      message.success("人工覆盖已移除，该日期恢复为官方日历或每周模板");
    },
    onError: () => message.error("移除失败：该日期没有人工覆盖，或未填写调整原因"),
  });
  const grantReward = useMutation({
    mutationFn: rentalCoreApi.grantReward,
    onSuccess: async () => {
      rewardForm.resetFields();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "rewards"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "benefit-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }),
      ]);
      message.success("奖励流水已按幂等键生成");
    },
    onError: () =>
      message.error("生成失败：规则未启用、触发条件不匹配或参数不完整"),
  });
  const reverseReward = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rentalCoreApi.reverseReward(id, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "rewards"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "benefit-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }),
      ]);
      message.success("奖励已撤销并保留流水");
    },
  });
  const saveTemplate = useMutation({
    mutationFn: (values: TemplateForm) => {
      const { variableSchemaText, ...rest } = values;
      return rentalCoreApi.saveNotificationTemplate({
        ...rest,
        variableSchema: JSON.parse(variableSchemaText),
      });
    },
    onSuccess: async () => {
      setTemplateEditor(null);
      templateForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "notification-templates"],
      });
      message.success("通知模板新版本已保存");
    },
    onError: () =>
      message.error("模板保存失败，请检查事件、渠道、变量 schema 和占位符"),
  });
  const sendNotification = useMutation({
    mutationFn: (values: SendForm) => {
      const { variablesText, ...rest } = values;
      return rentalCoreApi.sendNotification({
        ...rest,
        variables: JSON.parse(variablesText),
      });
    },
    onSuccess: async () => {
      setSendTemplate(undefined);
      sendForm.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "notification-logs"],
      });
      message.success("通知已通过 Mock 适配器发送并记录回执");
    },
    onError: () => message.error("发送失败，请检查必填变量和接收人"),
  });

  /**
   * 打开规则编辑器。传入草稿即继续编辑该草稿；不传则以当前生效版本的内容开一份新草稿。
   * 已发布版本不能直接编辑（需求 4.6.1），要改它须先恢复为新草稿。
   */
  function openRule(row?: RentalRuleVersion) {
    const source =
      row ??
      rules.data?.find((item) => item.status === "draft") ??
      rules.data?.find((item) => item.status === "published") ??
      rules.data?.[0];
    if (!source) return;
    const config = structuredClone(source.config);
    const security = ruleSecurityGroups(config);
    if (category?.businessModel.supportsPreauthorization === false) {
      security.preauthorization = { mode: "none" };
    }
    ruleForm.setFieldsValue({
      ...config,
      ...security,
      changeReason: source.status === "draft" ? source.changeReason : "调整租赁业务规则",
    });
    setRuleEditor(source);
  }
  function openRulePublish(row: RentalRuleVersion) {
    rulePublishForm.resetFields();
    setRulePublishEffectiveFrom(undefined);
    setRulePublishTarget(row);
  }
  function openDay(row: RentalCalendarDay) {
    // source 由服务端固定为 tenant_override，不作为表单字段提交。
    // hours 也不进表单（结构化对象，无编辑器），提交时从 calendarDay 原样带回。
    const {
      source: _source,
      overrideBy: _by,
      overrideAt: _at,
      overriddenFrom: _from,
      hours: _hours,
      ...editable
    } = row;
    calendarDayForm.setFieldsValue({ ...editable, overrideReason: row.overrideReason ?? "" });
    setCalendarDay(row);
  }
  function openTemplate(row?: RentalNotificationTemplateV1) {
    templateForm.setFieldsValue(
      row
        ? {
            ...row,
            variableSchemaText: JSON.stringify(row.variableSchema, null, 2),
          }
        : {
            eventCode:
              settings.data?.notifications.enabledEvents[0] ?? "order.created",
            channel:
              settings.data?.notifications.editableChannels[0] ?? "app_push",
            name: "",
            title: "",
            body: "",
            variableSchemaText: JSON.stringify(
              {
                customerName: { label: "客户名称", required: true },
                orderNo: { label: "订单号", required: true },
              },
              null,
              2,
            ),
            status: "enabled",
          },
    );
    setTemplateEditor(row ?? ({} as RentalNotificationTemplateV1));
  }
  function openSend(row: RentalNotificationTemplateV1) {
    sendForm.setFieldsValue({
      templateId: row.id,
      recipient: "demo-recipient",
      variablesText: JSON.stringify(
        Object.fromEntries(
          Object.keys(row.variableSchema).map((key) => [
            key,
            key === "orderNo" ? "RC-DEMO-001" : "演示客户",
          ]),
        ),
        null,
        2,
      ),
    });
    setSendTemplate(row);
  }

  // 服务端已按当前时间现算展示状态，因此 published 就是「此刻生效」的唯一一条。
  const currentRule = rules.data?.find((item) => item.status === "published");
  const pendingRules = (rules.data ?? []).filter((item) => item.status === "pending");
  return (
    <>
      <PageHeader
        title="品类与业务规则"
        description="租户经营品类决定允许范围；价格、日历、规则、奖励与通知均按版本留痕。"
        extra={
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saveSettings.isPending}
            onClick={() => settingsForm.submit()}
          >
            保存租户设置
          </Button>
        }
      />
      <Tabs
        className="standalone-tabs"
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          ...(canSeeSettings ? [{ key: "category", label: "品类与租赁方式" }] : []),
          ...(canSeeRules
            ? [
                {
                  key: "rules",
                  label: (
                    <span>
                      <SafetyCertificateOutlined />
                      业务规则
                    </span>
                  ),
                },
              ]
            : []),
          ...(canSeeCalendar
            ? [
                {
                  key: "calendar",
                  label: (
                    <span>
                      <CalendarOutlined />
                      营业日历
                    </span>
                  ),
                },
              ]
            : []),
          ...(canSeeSettings
            ? [
                {
                  key: "membership",
                  label: (
                    <span>
                      <TeamOutlined />
                      会员激励
                    </span>
                  ),
                },
              ]
            : []),
          ...(canEditRules || canManagePrice
            ? [
                {
                  key: "notifications",
                  label: (
                    <span>
                      <NotificationOutlined />
                      通知模板
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      <QueryState
        loading={settings.isLoading || profile.isLoading}
        error={settings.error || profile.error}
      >
        {settings.data && category && (
          <Form<TenantRentalBusinessSettings>
            form={settingsForm}
            layout="vertical"
            // 不渲染原生 <form> 元素：会员激励 tab 里嵌着独立的「人工补发奖励」表单，
            // 外层若是真正的 <form>，内层 <form> 就成了非法嵌套并触发 React hydration 警告。
            // 保存按钮走 settingsForm.submit()（显式 onClick），component={false} 下仍会触发 onFinish。
            component={false}
            onFinish={() =>
              // 提交整个 store 而非仅当前 tab 已注册的字段：设置分 tab 条件渲染，未挂载
              // 分组（如另一 tab 的 calendar/notifications）以及无 Form.Item 的字段（timeZone、
              // weeklyHours）都只在 store 里。只交已注册字段会让 PUT 缺组而整体 400，
              // 还会把时区与每周时段静默抹掉。getFieldsValue(true) 取回随 setFieldsValue 载入的全量。
              saveSettings.mutate(settingsForm.getFieldsValue(true))
            }
          >
            {tab === "category" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  message={`${category.name} · 模型 ${category.version}`}
                  description="经营品类创建后固定；租户只能在品类支持的计价、履约、库存、预授权和资质能力内配置。"
                />
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={12}>
                    <Card title="计价方式">
                      <Form.Item
                        name={["pricing", "enabledUnits"]}
                        label="启用计价单位"
                      >
                        <Select
                          mode="multiple"
                          options={category.businessModel.pricingUnits.map(
                            (value) => ({
                              value,
                              label: pricingUnitLabels[value] ?? value,
                            }),
                          )}
                        />
                      </Form.Item>
                      <Form.Item
                        name={["pricing", "defaultUnit"]}
                        label="默认单位"
                      >
                        <Select
                          options={category.businessModel.pricingUnits.map(
                            (value) => ({
                              value,
                              label: pricingUnitLabels[value] ?? value,
                            }),
                          )}
                        />
                      </Form.Item>
                      <Form.Item
                        name={["pricing", "holidayPricingEnabled"]}
                        label="启用旧版周末/节假日倍率"
                        tooltip="兼容开关，只作用于价格里的旧字段「周末系数」「节假日系数」。关闭后这两个系数不再参与计价，落回商品基础价；逐商品配置的日期类型价格、周期性计价时段与一次性日期时间覆盖不受影响，照常生效。"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card title="租赁与履约方式">
                      <Form.Item
                        name={["fulfillment", "enabledModes"]}
                        label="启用方式"
                      >
                        <Select
                          mode="multiple"
                          options={category.businessModel.fulfillmentModes.map(
                            (value) => ({
                              value,
                              label: modeLabels[value] ?? value,
                            }),
                          )}
                        />
                      </Form.Item>
                      <Form.Item
                        name={["fulfillment", "allowDifferentReturnLocation"]}
                        label="允许异地归还"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Space wrap>
                        {category.businessModel.locationTypes.map((value) => (
                          <Tag key={value}>{value}</Tag>
                        ))}
                      </Space>
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card title="支付、押金和预授权">
                      <Row gutter={12}>
                        <Col span={12}>
                          <Form.Item
                            name={["payment", "timing"]}
                            label="支付时点"
                          >
                            <Select
                              options={[
                                { value: "order", label: "下单" },
                                { value: "confirmation", label: "确认" },
                                { value: "pickup", label: "领取" },
                                { value: "offline_terms", label: "线下账期" },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item
                            name={["payment", "depositMode"]}
                            label="押金方式"
                          >
                            <Select
                              options={[
                                { value: "none", label: "无" },
                                { value: "fixed", label: "固定" },
                                { value: "price_multiple", label: "价格倍数" },
                                ...(category.businessModel
                                  .supportsPreauthorization
                                  ? [
                                      {
                                        value: "preauthorization",
                                        label: "预授权",
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item
                        name={["payment", "preauthorizationRequired"]}
                        label="必须预授权"
                        valuePropName="checked"
                      >
                        <Switch
                          disabled={
                            !category.businessModel.supportsPreauthorization
                          }
                        />
                      </Form.Item>
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card title="逾期基础设置">
                      <Row gutter={12}>
                        <Col span={8}>
                          <Form.Item
                            name={["overdue", "graceMinutes"]}
                            label="宽限分钟"
                          >
                            <InputNumber min={0} />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            name={["overdue", "feeMode"]}
                            label="收费方式"
                          >
                            <Select
                              options={[
                                "none",
                                "hourly",
                                "next_period",
                                "multiplier",
                                "manual_review",
                              ].map((value) => ({ value, label: value }))}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            name={["overdue", "feeMultiplier"]}
                            label="费用系数"
                          >
                            <InputNumber min={0} step={0.1} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                </Row>
              </Space>
            )}
            {tab === "rules" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div className="table-toolbar">
                  <Space>
                    {currentRule ? (
                      <Tag color="success">
                        已生效 v{currentRule.version}
                        {currentRule.effectiveFrom
                          ? ` · ${dayjs(currentRule.effectiveFrom).format("YYYY-MM-DD HH:mm")} 起`
                          : ""}
                      </Tag>
                    ) : (
                      <Tag color="error">当前没有生效版本</Tag>
                    )}
                    <Typography.Text type="secondary">
                      报价按租期开始时间匹配版本，未来租期使用覆盖其开始时点的版本
                    </Typography.Text>
                  </Space>
                  {canEditRules && (
                    <Button type="primary" onClick={() => openRule()}>
                      新建草稿
                    </Button>
                  )}
                </div>
                {pendingRules.length > 0 && (
                  <Alert
                    type="info"
                    showIcon
                    message={`有 ${pendingRules.length} 个待生效版本`}
                    description={pendingRules
                      .map(
                        (row) =>
                          `v${row.version} 自 ${dayjs(row.effectiveFrom).format("YYYY-MM-DD HH:mm")} 起生效`,
                      )
                      .join("；")}
                  />
                )}
                {currentRule && (
                  <Card>
                    <Descriptions
                      column={{ xs: 1, md: 2, xl: 3 }}
                      items={[
                        {
                          key: "payment",
                          label: "支付与占位",
                          children: `${currentRule.config.payment.timing} · ${currentRule.config.payment.unpaidHoldMinutes} 分钟`,
                        },
                        {
                          key: "deposit",
                          label: "押金/预授权",
                          children: (() => {
                            const security = ruleSecurityGroups(currentRule.config);
                            return `押金：${securityRuleLabels[security.deposit.mode]} · 预授权：${preauthorizationRuleLabels[security.preauthorization.mode]}`;
                          })(),
                        },
                        {
                          key: "inspection",
                          label: "交接检查",
                          children: `${currentRule.config.fulfillment.pickupInspectionRequired ? "领取必检" : "领取选检"} / ${currentRule.config.fulfillment.returnInspectionRequired ? "归还必检" : "归还选检"}`,
                        },
                        {
                          key: "overdue",
                          label: "逾期",
                          children: `${currentRule.config.overdue.graceMinutes} 分钟 · ${currentRule.config.overdue.feeMode}`,
                        },
                        {
                          key: "cancel",
                          label: "取消",
                          children: `${currentRule.config.cancellation.freeBeforeHours} 小时前免费`,
                        },
                        {
                          key: "qualification",
                          label: "资质",
                          children: currentRule.config.qualification.required
                            ? currentRule.config.qualification.documentTypes.join(
                                "、",
                              )
                            : "不要求",
                        },
                      ]}
                    />
                  </Card>
                )}
                <Card title="版本历史">
                  <Table<RentalRuleVersion>
                    rowKey="id"
                    pagination={false}
                    dataSource={rules.data ?? []}
                    columns={[
                      { title: "版本", dataIndex: "version" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (value: string) => (
                          <Tag color={ruleStatusColors[value]}>
                            {ruleStatusLabels[value] ?? value}
                          </Tag>
                        ),
                      },
                      {
                        title: "生效时点",
                        dataIndex: "effectiveFrom",
                        render: (value?: string) =>
                          value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—",
                      },
                      { title: "变更原因", dataIndex: "changeReason" },
                      {
                        title: "来源",
                        dataIndex: "restoredFromVersion",
                        render: (value?: string) => (value ? `恢复自 v${value}` : "—"),
                      },
                      { title: "操作人", dataIndex: "createdBy" },
                      {
                        title: "创建时间",
                        dataIndex: "createdAt",
                        render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm"),
                      },
                      {
                        title: "操作",
                        key: "actions",
                        render: (_, row) => (
                          <Space size={4}>
                            {row.status === "draft" && canEditRules && (
                              <Button type="link" size="small" onClick={() => openRule(row)}>
                                编辑
                              </Button>
                            )}
                            {row.status === "draft" && canPublishRules && (
                              <Button type="link" size="small" onClick={() => openRulePublish(row)}>
                                发布
                              </Button>
                            )}
                            {row.status !== "draft" && canEditRules && (
                              <Button
                                type="link"
                                size="small"
                                onClick={() => {
                                  ruleRestoreForm.resetFields();
                                  setRuleRestoreTarget(row);
                                }}
                              >
                                恢复为草稿
                              </Button>
                            )}
                            {(row.status === "pending" || row.status === "published") &&
                              canPublishRules && (
                                <Button
                                  type="link"
                                  size="small"
                                  danger
                                  onClick={() => {
                                    ruleVoidForm.resetFields();
                                    setRuleVoidTarget(row);
                                  }}
                                >
                                  作废
                                </Button>
                              )}
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card title="发布与作废审计">
                  <QueryState loading={ruleAudits.isLoading} error={ruleAudits.error}>
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={ruleAudits.data ?? []}
                      columns={[
                        { title: "版本", dataIndex: "version" },
                        {
                          title: "动作",
                          dataIndex: "action",
                          render: (value: string) => ruleAuditActionLabels[value] ?? value,
                        },
                        {
                          title: "状态变化",
                          key: "status",
                          render: (_, row) =>
                            `${row.fromStatus ? (ruleStatusLabels[row.fromStatus] ?? row.fromStatus) : "—"} → ${ruleStatusLabels[row.toStatus] ?? row.toStatus}`,
                        },
                        { title: "原因", dataIndex: "reason" },
                        { title: "操作人", dataIndex: "operator" },
                        {
                          title: "时间",
                          dataIndex: "at",
                          render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm"),
                        },
                      ]}
                    />
                  </QueryState>
                </Card>
              </Space>
            )}
            {tab === "calendar" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div className="table-toolbar">
                  <Space>
                    <Select
                      value={year}
                      onChange={setYear}
                      options={[
                        currentYear - 1,
                        currentYear,
                        currentYear + 1,
                      ].map((value) => ({ value, label: `${value} 年` }))}
                    />
                    <Tag
                      color={
                        calendar.data?.status === "published"
                          ? "success"
                          : "warning"
                      }
                    >
                      {calendar.data?.status} · v{calendar.data?.version}
                    </Tag>
                    <Typography.Text type="secondary">
                      {calendar.data?.sourceName ?? "未引用官方来源"}
                    </Typography.Text>
                  </Space>
                  <Space>
                    {/* 需求 4.5.9：默认月历视图，全年逐日长列表仅作为可选视图保留。 */}
                    <Switch
                      checkedChildren="列表"
                      unCheckedChildren="月历"
                      checked={calendarListView}
                      onChange={setCalendarListView}
                    />
                    <Button
                      onClick={() => {
                        setHistoryVersion(undefined);
                        setHistoryOpen(true);
                      }}
                    >
                      历史版本
                    </Button>
                    {canEditCalendar && (
                      <Button
                        type="primary"
                        onClick={() => {
                          setRangeMode("override");
                          setRangeOpen(true);
                        }}
                      >
                        新增日期范围覆盖
                      </Button>
                    )}
                    {canEditCalendar && (
                      <Button
                        onClick={() => {
                          setRangeMode("remove");
                          setRangeOpen(true);
                        }}
                      >
                        移除日期范围覆盖
                      </Button>
                    )}
                    {canEditCalendar && (
                      <Button onClick={() => setImportOpen(true)}>应用官方来源</Button>
                    )}
                    {canPublishCalendar && (
                      <Button
                        type="primary"
                        loading={publishCalendar.isPending}
                        onClick={() => {
                          publishForm.resetFields();
                          setPublishOpen(true);
                        }}
                      >
                        发布年度版本
                      </Button>
                    )}
                  </Space>
                </div>
                {/* 需求 4.5.2：平台登记官方来源后必须为空间生成「更新/可选择」提示，
                    而不只是把状态放在 API 响应里。三态互斥：当前来源有新版 > 有来源可选择 >
                    平台尚未登记。应用属编辑动作，只读/历史角色看得到提示但没有应用入口。 */}
                {calendar.data?.officialSourceUpdateAvailable ? (
                  <Alert
                    type="warning"
                    showIcon
                    message={`当前引用的官方来源有新版本 v${calendar.data.latestOfficialSourceVersion}`}
                    description="平台已登记该年度更新的官方节假日数据。应用后会在草稿上生成新的一版，仍需发布才生效，且不会改动已有报价与订单。"
                    action={
                      canEditCalendar ? (
                        <Button size="small" onClick={() => setImportOpen(true)}>
                          查看 / 应用
                        </Button>
                      ) : undefined
                    }
                  />
                ) : calendar.data?.officialSourceAvailableToSelect ? (
                  <Alert
                    type="info"
                    showIcon
                    message={`平台已登记该年度可用的官方来源（${calendar.data.availableOfficialSourceCount ?? 0} 个），可选择应用`}
                    description="本经营空间尚未引用任何官方来源版本；当前日历按每周默认模板与人工覆盖生成。选择来源时可查看各来源的公告日期与版本。"
                    action={
                      canEditCalendar ? (
                        <Button size="small" onClick={() => setImportOpen(true)}>
                          选择官方来源
                        </Button>
                      ) : undefined
                    }
                  />
                ) : calendar.data?.officialSourceRegisteredButUnavailable ? (
                  <Alert
                    type="info"
                    showIcon
                    message="当前没有可用的官方来源"
                    description="平台登记过该年度官方来源，但目前全部已停用；如需应用请联系平台管理员恢复来源。"
                  />
                ) : !calendar.data?.sourceName ? (
                  <Alert
                    type="info"
                    showIcon
                    message="平台尚未登记该年度公共官方来源"
                    description="官方节假日来源由 SaaS 平台管理员维护；登记后这里会提示可选择应用。"
                  />
                ) : null}
                <Alert
                  type="info"
                  showIcon
                  message="法定节假日与调休工作日必须来自有来源记录的年度数据"
                  description="租户可以覆盖特殊营业日、停业日和营业时段；特殊价格只在价格模块维护，日历保存规则引用。报价会记录命中的年度日历与价格版本。"
                />
                {/* 需求 4.5.9：默认渲染自然月七列月历，点击日期查看/编辑；全年长列表按需切换。 */}
                {!calendarListView && (
                  <CalendarMonthGrid
                    year={year}
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    days={calendar.data?.days ?? []}
                    timePriceSummary={calendar.data?.timePriceSummary ?? []}
                    onDayClick={(day) => openDay(day)}
                  />
                )}
                {calendarListView && (
                <Card className="data-panel" title="全年逐日列表（可选视图）">
                  <Table<RentalCalendarDay>
                    rowKey="date"
                    size="small"
                    dataSource={calendar.data?.days ?? []}
                    pagination={{ pageSize: 31, showSizeChanger: false }}
                    columns={[
                      { title: "日期", dataIndex: "date" },
                      {
                        title: "类型",
                        dataIndex: "dayType",
                        render: (value) => <Tag>{value}</Tag>,
                      },
                      { title: "名称", dataIndex: "name" },
                      { title: "历史系数（兼容）", dataIndex: "pricingMultiplier" },
                      {
                        title: "停业",
                        dataIndex: "closed",
                        render: (value) => (value ? "是" : "否"),
                      },
                      {
                        // 四态营业状态与营业时段此前在表格上完全不可见，于是「限时营业 →
                        // 正常营业」这种翻转在界面上看不出来（需求 4.5.4/4.5.1）。
                        title: "营业状态",
                        dataIndex: "businessStatus",
                        render: (value, row) => (
                          <Tag>{businessStatusLabels[(value as string) ?? (row.closed ? "closed" : "open")] ?? value}</Tag>
                        ),
                      },
                      {
                        title: "营业时段",
                        render: (_, row) =>
                          row.hours?.windows?.length ? (
                            <Space direction="vertical" size={0}>
                              <Typography.Text style={{ fontSize: 12 }}>
                                {row.hours.windows.map((w) => `${w.start}-${w.end}`).join("、")}
                              </Typography.Text>
                              {(row.hours.pickup?.length || row.hours.return?.length) && (
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  {row.hours.pickup?.length
                                    ? `取 ${row.hours.pickup.map((w) => `${w.start}-${w.end}`).join("、")}`
                                    : ""}
                                  {row.hours.return?.length
                                    ? ` 还 ${row.hours.return.map((w) => `${w.start}-${w.end}`).join("、")}`
                                    : ""}
                                </Typography.Text>
                              )}
                            </Space>
                          ) : (
                            <Typography.Text type="secondary">沿用每周模板</Typography.Text>
                          ),
                      },
                      { title: "来源", dataIndex: "source" },
                      {
                        title: "被覆盖的原始值",
                        // 需求 4.5.3：日期详情必须能说明当前结果的来源并展示被覆盖的原始值。
                        // 只显示"来源=人工覆盖"而不显示原值，运营无法判断撤销后会恢复成什么。
                        render: (_, row) =>
                          row.source === "tenant_override" ? (
                            <Space direction="vertical" size={0}>
                              <Typography.Text style={{ fontSize: 12 }}>
                                {row.overriddenFrom
                                  ? `${row.overriddenFrom.name} · ${row.overriddenFrom.dayType} · ×${row.overriddenFrom.pricingMultiplier}`
                                  : "每周模板"}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {row.overrideReason ?? "未记录原因"}
                                {row.overrideBy ? ` · ${row.overrideBy}` : ""}
                              </Typography.Text>
                            </Space>
                          ) : (
                            <Typography.Text type="secondary">—</Typography.Text>
                          ),
                      },
                      {
                        title: "操作",
                        render: (_, row) =>
                          canEditCalendar ? (
                            <Space size={0}>
                              <Button type="link" onClick={() => openDay(row)}>
                                租户覆盖
                              </Button>
                              {row.source === "tenant_override" && (
                                <Button
                                  type="link"
                                  danger
                                  onClick={() => {
                                    revertForm.resetFields();
                                    setRevertTarget(row);
                                  }}
                                >
                                  移除覆盖
                                </Button>
                              )}
                            </Space>
                          ) : (
                            <Typography.Text type="secondary">只读</Typography.Text>
                          ),
                      },
                    ]}
                  />
                </Card>
                )}
                {/* PRICE-02A（需求 4.5.9）：范围覆盖/移除的统一抽屉（预览 → 确认 → 原子应用）。 */}
                <CalendarRangeModal
                  mode={rangeMode}
                  year={year}
                  currentRevision={calendar.data?.revision}
                  open={rangeOpen}
                  onClose={() => setRangeOpen(false)}
                  onApplied={() => setRangeOpen(false)}
                />
              </Space>
            )}
            {tab === "membership" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  message="注册、实名审核和首单完成会自动触发奖励判断"
                  description="下方人工入口只用于补偿与联调；自动事件使用客户事件幂等键。积分、营销余额和奖励券会进入 Rental Core 权益账户；营销余额不是支付机构资金账户。"
                />
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={12}>
                    <Card title="注册赠礼">
                      <Form.Item
                        name={["membership", "signupRewardEnabled"]}
                        label="启用"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Row gutter={12}>
                        <Col span={12}>
                          <Form.Item
                            name={["membership", "signupRewardType"]}
                            label="奖励类型"
                          >
                            <Select
                              options={["points", "balance", "coupon"].map(
                                (value) => ({ value, label: value }),
                              )}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item
                            name={["membership", "signupRewardAmount"]}
                            label="数量"
                          >
                            <InputNumber min={0} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item
                        name={["membership", "signupRewardCouponTemplateId"]}
                        label="赠送券模板（奖励类型为优惠券时必选）"
                      >
                        <Select
                          allowClear
                          options={(couponTemplates.data ?? [])
                            .filter((item) => item.status === "active")
                            .map((item) => ({ value: item.id, label: item.name }))}
                        />
                      </Form.Item>
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card title="邀请奖励">
                      <Form.Item
                        name={["membership", "referralRewardEnabled"]}
                        label="启用"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        name={["membership", "referralTrigger"]}
                        label="奖励触发节点"
                      >
                        <Select
                          options={[
                            {
                              value: "registration",
                              label: "被邀请人完成注册",
                            },
                            {
                              value: "identity_verified",
                              label: "被邀请人通过实名审核",
                            },
                            {
                              value: "first_order_completed",
                              label: "被邀请人完成首单",
                            },
                          ]}
                        />
                      </Form.Item>
                      <Row gutter={12}>
                        <Col span={8}>
                          <Form.Item
                            name={["membership", "referralRewardType"]}
                            label="类型"
                          >
                            <Select
                              options={["points", "balance", "coupon"].map(
                                (value) => ({ value, label: value }),
                              )}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            name={["membership", "referrerRewardAmount"]}
                            label="邀请人"
                          >
                            <InputNumber min={0} />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            name={["membership", "inviteeRewardAmount"]}
                            label="被邀请人"
                          >
                            <InputNumber min={0} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item
                        name={["membership", "referralRewardCouponTemplateId"]}
                        label="邀请奖励券模板（奖励类型为优惠券时必选）"
                      >
                        <Select
                          allowClear
                          options={(couponTemplates.data ?? [])
                            .filter((item) => item.status === "active")
                            .map((item) => ({ value: item.id, label: item.name }))}
                        />
                      </Form.Item>
                    </Card>
                  </Col>
                </Row>
                <Card title="人工补发奖励流水">
                  <Form
                    form={rewardForm}
                    layout="inline"
                    onFinish={(values) => grantReward.mutate(values)}
                  >
                    <Form.Item
                      name="customerId"
                      label="客户"
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item name="triggerType" label="触发">
                      <Select
                        style={{ width: 180 }}
                        options={[
                          { value: "registration", label: "注册赠礼" },
                          { value: "identity_verified", label: "实名通过" },
                          { value: "first_order_completed", label: "首单完成" },
                          { value: "referral", label: "直接邀请补发" },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="relatedCustomerId" label="关联客户">
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name="idempotencyKey"
                      label="业务幂等键"
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Button
                      htmlType="submit"
                      type="primary"
                      loading={grantReward.isPending}
                    >
                      生成并入账
                    </Button>
                  </Form>
                </Card>
                <Card title="客户权益账户">
                  <Table
                    rowKey="customerId"
                    dataSource={benefitAccounts.data ?? []}
                    columns={[
                      { title: "客户", dataIndex: "customerId" },
                      { title: "积分", dataIndex: "pointsBalance" },
                      { title: "营销余额", dataIndex: "marketingBalance", render: (value) => `¥${Number(value).toFixed(2)}` },
                      { title: "可用奖励券", dataIndex: "availableRewardCouponCount" },
                      { title: "更新时间", dataIndex: "updatedAt" },
                    ]}
                  />
                </Card>
                <Card title="奖励流水">
                  <Table
                    rowKey="id"
                    dataSource={rewards.data ?? []}
                    columns={[
                      { title: "客户", dataIndex: "customerId" },
                      {
                        title: "奖励",
                        render: (_, row) => `${row.rewardType} ${row.amount}`,
                      },
                      { title: "触发", dataIndex: "triggerType" },
                      { title: "幂等键", dataIndex: "idempotencyKey" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (value) => <Tag>{value}</Tag>,
                      },
                      { title: "原因", dataIndex: "reason" },
                      {
                        title: "操作",
                        render: (_, row) =>
                          row.status === "granted" ? (
                            <Button
                              danger
                              type="link"
                              onClick={() =>
                                Modal.confirm({
                                  title: "撤销奖励",
                                  content: "撤销会保留原流水与撤销时间。",
                                  onOk: () =>
                                    reverseReward.mutate({
                                      id: row.id,
                                      reason: "运营人工撤销",
                                    }),
                                })
                              }
                            >
                              撤销
                            </Button>
                          ) : (
                            "-"
                          ),
                      },
                    ]}
                  />
                </Card>
              </Space>
            )}
            {tab === "notifications" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div className="table-toolbar">
                  <Typography.Text type="secondary">
                    只有租户设置已启用的事件与渠道可以保存模板；发送时严格校验变量
                    schema。
                  </Typography.Text>
                  <Button type="primary" onClick={() => openTemplate()}>
                    新增模板
                  </Button>
                </div>
                <Card title="通知模板">
                  <Table<RentalNotificationTemplateV1>
                    rowKey="id"
                    dataSource={templates.data ?? []}
                    columns={[
                      {
                        title: "模板",
                        render: (_, row) => (
                          <>
                            <b>{row.name}</b>
                            <br />
                            <span className="muted">
                              {row.eventCode} · v{row.version}
                            </span>
                          </>
                        ),
                      },
                      {
                        title: "渠道",
                        dataIndex: "channel",
                        render: (value) => <Tag>{value}</Tag>,
                      },
                      { title: "标题", dataIndex: "title" },
                      {
                        title: "变量",
                        render: (_, row) =>
                          Object.keys(row.variableSchema).join("、"),
                      },
                      { title: "状态", dataIndex: "status" },
                      {
                        title: "操作",
                        render: (_, row) => (
                          <Space>
                            <Button
                              type="link"
                              onClick={() => openTemplate(row)}
                            >
                              编辑
                            </Button>
                            <Button type="link" onClick={() => openSend(row)}>
                              模拟发送
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Card>
                <Card title="通知记录（未接真实供应商时仅模拟）">
                  <Table
                    rowKey="id"
                    dataSource={logs.data ?? []}
                    columns={[
                      { title: "事件", dataIndex: "eventCode" },
                      {
                        title: "渠道/接收人",
                        render: (_, row) => `${row.channel} · ${row.recipient}`,
                      },
                      { title: "模板版本", dataIndex: "templateVersion" },
                      { title: "提供商", dataIndex: "provider" },
                      { title: "外部回执", dataIndex: "providerMessageId", render: (value) => value || "—" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (value) => (
                          <Tag color={value === "sent" ? "success" : value === "simulated" ? "processing" : "error"}>
                            {value}
                          </Tag>
                        ),
                      },
                      { title: "时间", dataIndex: "createdAt" },
                    ]}
                  />
                </Card>
              </Space>
            )}
          </Form>
        )}
      </QueryState>

      <Drawer
        title={
          ruleEditor?.status === "draft"
            ? `编辑规则草稿 v${ruleEditor.version}`
            : `新建规则草稿 · 基于 v${ruleEditor?.version ?? ""}`
        }
        width={760}
        open={Boolean(ruleEditor)}
        onClose={() => setRuleEditor(undefined)}
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={saveRule.isPending}
            onClick={() => ruleForm.submit()}
          >
            保存草稿
          </Button>
        }
      >
        <Form
          form={ruleForm}
          layout="vertical"
          onFinish={(values) => saveRule.mutate(values)}
        >
          <Card size="small" title="计价规则">
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item
                  name={["pricing", "shiftHours"]}
                  label="班次时长（小时）"
                  tooltip="仅按班次计价时生效。留空按 8 小时。"
                >
                  <InputNumber min={0.5} max={24} step={0.5} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item
                  name={["pricing", "shiftStartHours"]}
                  label="班次起始小时"
                  tooltip="按营业时区的当地小时，例如 0、8、16 表示三班制。填了边界就按「跨过几个班次窗口」计费；留空则按班次时长整除。"
                >
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="留空表示不按边界计费"
                    options={Array.from({ length: 24 }, (_, hour) => ({
                      value: hour,
                      label: `${String(hour).padStart(2, "0")}:00`,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card size="small" title="支付与履约">
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name={["payment", "timing"]} label="支付时点">
                  <Select
                    options={[
                      "order",
                      "confirmation",
                      "pickup",
                      "offline_terms",
                    ].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["payment", "unpaidHoldMinutes"]}
                  label="待支付保留分钟"
                >
                  <InputNumber min={1} />
                </Form.Item>
              </Col>
              <Form.Item name={["payment", "depositMode"]} hidden><Input /></Form.Item>
              <Form.Item name={["payment", "preauthorizationRequired"]} valuePropName="checked" hidden><Switch /></Form.Item>
              <Col span={8}>
                <Form.Item name={["deposit", "mode"]} label="押金规则" rules={[{ required: true }]}>
                  <Select options={Object.entries(securityRuleLabels).map(([value, label]) => ({ value, label }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["deposit", "maxAmount"]} label="订单押金上限" tooltip="留空表示不设上限；0 表示免押。">
                  <InputNumber min={0} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["deposit", "fixedAmount"]} label="每单固定押金" tooltip="仅在押金规则选择“每单固定金额”时使用。">
                  <InputNumber min={0} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["preauthorization", "mode"]} label="预授权规则" rules={[{ required: true }]}>
                  <Select
                    options={(category?.businessModel.supportsPreauthorization
                      ? Object.entries(preauthorizationRuleLabels)
                      : [["none", securityRuleLabels.none]]
                    ).map(([value, label]) => ({ value, label }))}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["preauthorization", "maxAmount"]} label="订单预授权上限" tooltip="留空表示不设上限；预授权只冻结额度，不计入实收。">
                  <InputNumber min={0} disabled={!category?.businessModel.supportsPreauthorization} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["preauthorization", "fixedAmount"]} label="订单固定预授权" tooltip="仅在预授权规则选择“每单固定金额”时使用。">
                  <InputNumber min={0} disabled={!category?.businessModel.supportsPreauthorization} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["preauthorization", "riskSurchargeAmount"]} label="风险附加额度" tooltip="仅在预授权规则选择“租金倍数 + 风险附加”时使用。">
                  <InputNumber min={0} disabled={!category?.businessModel.supportsPreauthorization} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["fulfillment", "pickupInspectionRequired"]}
                  label="领取必检"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["fulfillment", "returnInspectionRequired"]}
                  label="归还必检"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["fulfillment", "evidenceRequired"]}
                  label="必须影像证据"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["fulfillment", "allowDifferentReturnLocation"]}
                  label="允许异地归还"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Card size="small" title="超时、取消与损坏" style={{ marginTop: 12 }}>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item
                  name={["overdue", "graceMinutes"]}
                  label="逾期宽限分钟"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["overdue", "feeMode"]} label="逾期收费">
                  <Select
                    options={[
                      "none",
                      "hourly",
                      "next_period",
                      "multiplier",
                      "manual_review",
                    ].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["overdue", "feeMultiplier"]} label="逾期倍率">
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name={["overdue", "maximumFee"]} label="逾期封顶">
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "freeBeforeHours"]}
                  label="免费取消小时前"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "lateFeeType"]}
                  label="晚取消收费"
                >
                  <Select
                    options={["none", "fixed_amount", "percentage"].map(
                      (value) => ({ value, label: value }),
                    )}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "lateFeeValue"]}
                  label="晚取消费用值"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["cancellation", "weatherExceptionEnabled"]}
                  label="天气例外"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["damage", "manualReviewRequired"]}
                  label="损坏人工核定"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["damage", "chargeLimit"]}
                  label="损坏收费封顶"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Card size="small" title="资质" style={{ marginTop: 12 }}>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item
                  name={["qualification", "required"]}
                  label="必须审核资质"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["qualification", "documentTypes"]}
                  label="证件类型"
                >
                  <Select mode="tags" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["qualification", "minimumValidityDays"]}
                  label="最少剩余有效天数"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Form.Item
            name="changeReason"
            label="变更原因"
            rules={[{ required: true }]}
            style={{ marginTop: 16 }}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>
      <Modal
        title={`发布规则版本 v${rulePublishTarget?.version ?? ""}`}
        open={Boolean(rulePublishTarget)}
        onOk={() => rulePublishForm.submit()}
        confirmLoading={publishRule.isPending}
        onCancel={() => {
          setRulePublishTarget(undefined);
          setRulePublishEffectiveFrom(undefined);
        }}
        okText="确认发布"
        destroyOnHidden
        width={640}
      >
        <Form
          form={rulePublishForm}
          layout="vertical"
          onFinish={(values) => publishRule.mutate(values)}
        >
          <Form.Item
            name="effectiveFrom"
            label="生效时点"
            extra="留空表示立即生效；填未来时点即安排生效，到点后自动按新版本报价。生效时点必须晚于已发布的最新版本。"
          >
            <DatePicker
              showTime
              style={{ width: "100%" }}
              onChange={(value) => setRulePublishEffectiveFrom(value?.toISOString())}
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label="发布原因"
            rules={[{ required: true, message: "发布原因必填并写入审计" }]}
          >
            <Input.TextArea rows={2} maxLength={500} showCount />
          </Form.Item>
        </Form>
        <QueryState loading={rulePublishPreview.isLoading} error={rulePublishPreview.error}>
          {rulePublishPreview.data && (
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: "effectiveFrom",
                  label: "生效时点",
                  children: `${dayjs(rulePublishPreview.data.effectiveFrom).format("YYYY-MM-DD HH:mm")}（${rulePublishPreview.data.scheduled ? "待生效" : "立即生效"}）`,
                },
                {
                  key: "current",
                  label: "当前生效版本",
                  children: rulePublishPreview.data.currentVersion
                    ? `v${rulePublishPreview.data.currentVersion}`
                    : "无（首次发布）",
                },
                {
                  key: "superseded",
                  label: "生效后被替代",
                  children: rulePublishPreview.data.supersededVersions.length
                    ? rulePublishPreview.data.supersededVersions
                        .map((value) => `v${value}`)
                        .join("、")
                    : "无",
                },
                {
                  key: "locked",
                  label: "已锁定报价",
                  children: `${rulePublishPreview.data.lockedQuoteCount} 张，仍按各自规则快照结算，不受本次发布影响`,
                },
              ]}
            />
          )}
        </QueryState>
      </Modal>
      <Modal
        title={`恢复规则版本 v${ruleRestoreTarget?.version ?? ""}`}
        open={Boolean(ruleRestoreTarget)}
        onOk={() => ruleRestoreForm.submit()}
        confirmLoading={restoreRule.isPending}
        onCancel={() => setRuleRestoreTarget(undefined)}
        okText="生成新草稿"
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="恢复只会按该版本的内容生成新草稿"
          description="被恢复的版本原样保留，已发布版本不可修改；新草稿仍需具备发布权限的人发布后才对客户生效。"
        />
        <Form
          form={ruleRestoreForm}
          layout="vertical"
          onFinish={(values) => restoreRule.mutate(values)}
        >
          <Form.Item
            name="reason"
            label="恢复原因"
            rules={[{ required: true, message: "恢复原因必填并写入审计" }]}
          >
            <Input.TextArea rows={2} maxLength={191} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`作废规则版本 v${ruleVoidTarget?.version ?? ""}`}
        open={Boolean(ruleVoidTarget)}
        onOk={() => ruleVoidForm.submit()}
        confirmLoading={voidRule.isPending}
        onCancel={() => setRuleVoidTarget(undefined)}
        okText="确认作废"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="作废后该版本不再参与任何租期的规则匹配"
          description="若它是当前唯一生效版本，作废后落在该时段的报价会直接失败而不是回落到旧规则；请先发布替代版本。已锁定的报价与订单按各自快照结算，不受影响。"
        />
        <Form form={ruleVoidForm} layout="vertical" onFinish={(values) => voidRule.mutate(values)}>
          <Form.Item
            name="reason"
            label="作废原因"
            rules={[{ required: true, message: "作废原因必填并写入审计" }]}
          >
            <Input.TextArea rows={2} maxLength={191} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        title={`覆盖营业日 · ${calendarDay?.date ?? ""}`}
        width={480}
        open={Boolean(calendarDay)}
        onClose={() => setCalendarDay(undefined)}
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={saveDay.isPending}
            onClick={() => calendarDayForm.submit()}
          >
            保存覆盖
          </Button>
        }
      >
        <Form
          form={calendarDayForm}
          layout="vertical"
          onFinish={(values) =>
            // 营业时段原样带回被编辑那一行的值：抽屉里没有时段编辑器，而 PUT 是整日覆盖，
            // 不带回就会让一次改价把已配置的营业/领取/归还时段清空。
            saveDay.mutate({ ...values, hours: calendarDay?.hours })
          }
        >
          {/* PRICE-02A：范围覆盖的来源信息（批次与日期时间边界），在日期详情里可见。 */}
          {calendarDay?.overrideScope && (
            <Alert
              style={{ marginBottom: 16 }}
              type="info"
              showIcon
              message={
                calendarDay.overrideScope.kind === "range"
                  ? `属于范围覆盖：${calendarDay.overrideScope.rangeStart} ~ ${calendarDay.overrideScope.rangeEnd}`
                  : "单日覆盖"
              }
              description={
                `批次 ${calendarDay.overrideScope.batchId}` +
                (calendarDay.overrideScope.startDateTime
                  ? `；起止时点 ${calendarDay.overrideScope.startDateTime} ~ ${calendarDay.overrideScope.endDateTime}`
                  : "")
              }
            />
          )}
          {calendarDay && (calendar.data?.timePriceSummary ?? []).find((row) => row.date === calendarDay.date)?.entries.length ? (
            <Card
              size="small"
              title="当日分时价格摘要"
              style={{ marginBottom: 16 }}
              extra={canManagePrice ? <Button type="link" onClick={() => navigate("/rental/pricing")}>进入基础定价</Button> : undefined}
            >
              <Space direction="vertical" size={4}>
                {(calendar.data?.timePriceSummary ?? []).find((row) => row.date === calendarDay.date)!.entries.map((entry, index) => (
                  <Typography.Text key={`${entry.version}-${entry.unit}-${entry.timeLabel}-${index}`}>
                    {entry.planCode ?? `价格版本 ${entry.version}`} · {entry.itemGroupCodes.join("、")} · {entry.timeLabel} ×{entry.multiplier}
                    {entry.overrideRef ? ` · 引用 ${entry.overrideRef}` : ""}
                  </Typography.Text>
                ))}
              </Space>
            </Card>
          ) : null}
          <Form.Item name="date" label="日期">
            <Input disabled />
          </Form.Item>
          <Form.Item name="dayType" label="日期类型">
            <Select
              options={[
                "workday",
                "weekend",
                "statutory_holiday",
                "makeup_workday",
                "tenant_special",
              ].map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item name="name" label="名称">
            <Input />
          </Form.Item>
          <Form.Item name="pricingMultiplier" hidden>
            <InputNumber />
          </Form.Item>
          <Alert
            style={{ marginBottom: 16 }}
            type="info"
            showIcon
            message="日历不再直接设置价格系数"
            description="逐商品价格、日期类型价格和一次性分时价格都在基础定价中维护；日期范围覆盖只保存一次性规则引用。"
          />
          <Form.Item name="pricingOverrideRef" label="一次性价格引用" tooltip="填写基础定价中一次性日期时间价格规则的引用标识；留空表示不引用特殊价格。">
            <Input allowClear placeholder="例如 NATIONAL-DAY-2026" />
          </Form.Item>
          <Form.Item
            name="overrideReason"
            label="调整原因"
            rules={[{ required: true }]}
            tooltip="人工覆盖必须留下原因；操作人与调整时间由服务端记录。移除覆盖会恢复到官方日历或每周模板的原值。"
          >
            <Input />
          </Form.Item>
          <Form.Item name="closed" label="停业" valuePropName="checked">
            <Switch />
          </Form.Item>
          {/* 四态营业状态（需求 4.5.4）。此前抽屉只有「停业」开关、没有四态选择器，
              于是限时营业与自助营业在界面上既看不到也配不了；服务端在未提供时会沿用原值，
              这里显式给出选择器让运营能真正改它。 */}
          <Form.Item
            name="businessStatus"
            label="营业状态"
            tooltip="留空表示按「停业」开关推导（停业=停止营业、否则正常营业）。限时营业需要配营业时段才会真正限制时点；自助营业需要地点声明自助能力。"
          >
            <Select
              allowClear
              placeholder="留空按停业开关推导"
              options={Object.entries(businessStatusLabels).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          {/* 营业时段是结构化对象，本轮不做可视化时段编辑器。它**不注册为表单字段**：
              rc-field-form 只提交已注册字段，而把对象塞进隐藏 Input 会让 React 收到
              非字符串 value。改为提交时从被编辑的那一行原样带回（见 onFinish）。 */}
          <Form.Item name="source" hidden>
            <Input />
          </Form.Item>
        </Form>
      </Drawer>
      {/* 引用公共官方来源版本（需求 4.5.2/4.5.8）。空间侧不再手填原始官方 JSON：
          公共数据由 SaaS 平台管理员在注册表里维护，这里只能挑一版应用到本空间草稿。 */}
      <Drawer
        title={`应用 ${year} 年公共官方日历来源`}
        width={720}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        destroyOnHidden
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="官方数据是公共基础来源，由平台维护、按版本发布"
            description="应用某一版只会生成或更新本经营空间的草稿；已有的人工覆盖会被保留，本版未包含的日期会回落到每周模板。确认后仍需你自己发布。"
          />
          <QueryState loading={officialSourceVersions.isLoading} error={officialSourceVersions.error}>
            <Table
              rowKey="id"
              size="small"
              dataSource={officialSourceVersions.data ?? []}
              pagination={false}
              locale={{ emptyText: `平台尚未登记 ${year} 年度的官方来源版本，请联系 SaaS 平台管理员` }}
              columns={[
                { title: "来源", dataIndex: "sourceName" },
                { title: "来源版本", dataIndex: "version", width: 100, render: (value) => `v${value}` },
                {
                  title: "官方发布日期",
                  dataIndex: "publishedAt",
                  width: 130,
                  render: (value) => dayjs(value as string).format("YYYY-MM-DD"),
                },
                { title: "日期条数", dataIndex: "dayCount", width: 90 },
                {
                  title: "操作",
                  width: 110,
                  render: (_, row) => (
                    <Button
                      type="link"
                      loading={applyOfficialSource.isPending}
                      onClick={() => applyOfficialSource.mutate(row.id)}
                    >
                      应用到草稿
                    </Button>
                  ),
                },
              ]}
            />
          </QueryState>
        </Space>
      </Drawer>
      <Modal
        title="发布年度营业日历"
        open={publishOpen}
        onCancel={() => setPublishOpen(false)}
        onOk={() => publishForm.submit()}
        confirmLoading={publishCalendar.isPending}
        okText="发布"
        width={760}
        destroyOnHidden
      >
        <Form
          form={publishForm}
          layout="vertical"
          onFinish={(values) => publishCalendar.mutate(values.changeReason)}
        >
          <Alert
            type="info"
            showIcon
            message="发布后不可原地修改"
            description="当前已发布版本会被标记为「已被替代」并保留，历史报价仍可追溯原版本；变更原因与相对上一版本的日期差异会一并记录。"
            style={{ marginBottom: 16 }}
          />
          {/* 需求 4.5.8：发布前必须展示受影响日期以及停业、营业时间、履约能力和特殊价格变化；
              存在未来订单时必须提示。预览是只读推演，不会改动这些订单。 */}
          <QueryState loading={publishPreview.isLoading} error={publishPreview.error}>
            {publishPreview.data && (
              <Space direction="vertical" size={12} style={{ width: "100%", marginBottom: 16 }}>
                <Descriptions size="small" column={2} bordered>
                  <Descriptions.Item label="待发布版本">v{publishPreview.data.draftVersion}</Descriptions.Item>
                  <Descriptions.Item label="当前已发布">
                    {publishPreview.data.publishedVersion
                      ? `v${publishPreview.data.publishedVersion}`
                      : "无（首次发布）"}
                  </Descriptions.Item>
                  <Descriptions.Item label="受影响日期">
                    {publishPreview.data.dates.length} 天
                  </Descriptions.Item>
                  <Descriptions.Item label="公共官方来源">
                    {publishPreview.data.officialSourceConfirmed ? (
                      <Tag color="success">已确认</Tag>
                    ) : (
                      <Tag color="warning">尚未确认</Tag>
                    )}
                  </Descriptions.Item>
                </Descriptions>
                {publishPreview.data.firstPublish && (
                  <Alert
                    type="info"
                    showIcon
                    message="该年度首次发布：差异基准是每周默认营业模板"
                    description="下面列出的是这次发布相对周模板真正带来的业务变化（人工覆盖、官方节假日、停业或限时、特殊价格）；与「空日历」比会把全年 365 天都列出来，没有筛选价值。"
                  />
                )}
                <>
                    <Space size={8} wrap>
                      <Tag color="volcano">
                        营业状态/停业 {publishPreview.data.closureChanges.length} 天
                      </Tag>
                      <Tag color="geekblue">
                        营业与履约时段 {publishPreview.data.hoursChanges.length} 天
                      </Tag>
                      <Tag color="gold">
                        特殊价格 {publishPreview.data.pricingChanges.length} 天
                      </Tag>
                    </Space>
                    {publishPreview.data.dates.length > 0 && (
                      <Table
                        rowKey="date"
                        size="small"
                        dataSource={publishPreview.data.dates}
                        pagination={{ pageSize: 6, showSizeChanger: false }}
                        columns={[
                          { title: "日期", dataIndex: "date", width: 110 },
                          {
                            title: "变化",
                            dataIndex: "changedFields",
                            render: (fields: string[], row) =>
                              row.change !== "changed" ? (
                                <Tag>{row.change === "added" ? "新增日期" : "移除日期"}</Tag>
                              ) : (
                                <Space size={4} wrap>
                                  {fields.map((field) => (
                                    <Tag key={field}>{previewFieldLabels[field] ?? field}</Tag>
                                  ))}
                                </Space>
                              ),
                          },
                          {
                            title: "发布前 → 发布后",
                            render: (_, row) => (
                              <Typography.Text style={{ fontSize: 12 }}>
                                {row.before
                                  ? `${businessStatusLabels[row.before.businessStatus ?? (row.before.closed ? "closed" : "open")]} ×${row.before.pricingMultiplier}`
                                  : "（无）"}
                                {" → "}
                                {row.after
                                  ? `${businessStatusLabels[row.after.businessStatus ?? (row.after.closed ? "closed" : "open")]} ×${row.after.pricingMultiplier}`
                                  : "（无）"}
                              </Typography.Text>
                            ),
                          },
                        ]}
                      />
                    )}
                  </>
                {publishPreview.data.futureOrders.length > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    message={`有 ${publishPreview.data.futureOrders.length} 张未来订单落在受影响日期上`}
                    description={
                      <Space direction="vertical" size={0}>
                        <Typography.Text style={{ fontSize: 12 }}>
                          发布不会改动这些订单，它们继续按各自的订单快照执行；如需调整请单独处理。
                        </Typography.Text>
                        {publishPreview.data.futureOrders.slice(0, 5).map((order) => (
                          <Typography.Text key={order.orderId} type="secondary" style={{ fontSize: 12 }}>
                            {order.orderNo} · {order.status} · 重叠 {order.affectedDates.join("、")}
                          </Typography.Text>
                        ))}
                      </Space>
                    }
                  />
                )}
              </Space>
            )}
          </QueryState>
          <Form.Item
            name="changeReason"
            label="变更原因"
            rules={[
              { required: true, whitespace: true, message: "请填写变更原因" },
            ]}
          >
            <Input.TextArea rows={3} placeholder="例如：按国务院办公厅通知更新国庆调休" />
          </Form.Item>
        </Form>
      </Modal>
      {/* 历史版本、差异详情、覆盖审计与作废入口（需求 4.5.7/4.5.8）。
          后端端点早已就绪，但此前没有任何界面入口，「客服/财务查看历史版本」「完整追溯」
          都没形成闭环。 */}
      <Drawer
        title={`${year} 年度日历历史版本`}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width={880}
        destroyOnHidden
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="历史版本只读保留，不得删除或原地改回"
            description="已发布版本被新版本取代后进入「已被替代」，历史报价仍按原版本追溯；只有草稿可以作废。"
          />
          <QueryState loading={calendarVersions.isLoading} error={calendarVersions.error}>
            <Table<RentalCalendarVersionSummary>
              rowKey="version"
              size="small"
              dataSource={calendarVersions.data ?? []}
              pagination={false}
              onRow={(row) => ({ onClick: () => setHistoryVersion(row.version) })}
              rowClassName={(row) => (row.version === historyVersion ? "ant-table-row-selected" : "")}
              columns={[
                { title: "版本", dataIndex: "version", width: 90, render: (value) => `v${value}` },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 100,
                  render: (value) => <Tag>{calendarStatusLabels[value as string] ?? value}</Tag>,
                },
                { title: "上一版本", dataIndex: "previousVersion", width: 100, render: (value) => (value ? `v${value}` : "—") },
                {
                  title: "日期/覆盖/审计",
                  width: 130,
                  render: (_, row) => `${row.dayCount} / ${row.overrideCount} / ${row.overrideAuditCount}`,
                },
                {
                  title: "差异",
                  width: 150,
                  render: (_, row) =>
                    row.publishDiffCounts
                      ? `+${row.publishDiffCounts.added} -${row.publishDiffCounts.removed} ~${row.publishDiffCounts.changed}`
                      : "—",
                },
                {
                  title: "变更原因/发布人",
                  render: (_, row) => (
                    <Space direction="vertical" size={0}>
                      <Typography.Text style={{ fontSize: 12 }}>{row.changeReason ?? "—"}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {row.publishedBy ?? ""}
                        {row.voidReason ? `作废：${row.voidReason}` : ""}
                      </Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: "操作",
                  width: 170,
                  render: (_, row) => {
                    if (!canEditCalendar) return <Typography.Text type="secondary">只读</Typography.Text>;
                    return (
                      <Space size={0}>
                        {row.status === "draft" ? (
                          <Button
                            type="link"
                            danger
                            onClick={(event) => {
                              event.stopPropagation();
                              voidForm.resetFields();
                              setVoidTarget(row);
                            }}
                          >
                            作废
                          </Button>
                        ) : (
                          // 需求 4.5.7：恢复旧规则必须以旧内容生成新版本，不得原地改回。
                          <Button
                            type="link"
                            onClick={(event) => {
                              event.stopPropagation();
                              restoreForm.resetFields();
                              setRestoreTarget(row);
                            }}
                          >
                            以此版本建新草稿
                          </Button>
                        )}
                      </Space>
                    );
                  },
                },
              ]}
            />
          </QueryState>
          {historyVersion && (
            <Card
              className="data-panel"
              title={`v${historyVersion} 差异与覆盖审计`}
              extra={
                <Button size="small" onClick={() => setHistoryVersion(undefined)}>
                  收起
                </Button>
              }
            >
              <QueryState loading={calendarVersionDetail.isLoading} error={calendarVersionDetail.error}>
                {calendarVersionDetail.data && (
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Descriptions size="small" column={2} bordered>
                      <Descriptions.Item label="状态">
                        {calendarStatusLabels[calendarVersionDetail.data.status] ?? calendarVersionDetail.data.status}
                      </Descriptions.Item>
                      <Descriptions.Item label="官方来源">
                        {calendarVersionDetail.data.sourceName ?? "无"}
                      </Descriptions.Item>
                      <Descriptions.Item label="发布时间">
                        {calendarVersionDetail.data.publishedAt
                          ? dayjs(calendarVersionDetail.data.publishedAt).format("YYYY-MM-DD HH:mm")
                          : "未发布"}
                      </Descriptions.Item>
                      <Descriptions.Item label="被替代时间">
                        {calendarVersionDetail.data.supersededAt
                          ? dayjs(calendarVersionDetail.data.supersededAt).format("YYYY-MM-DD HH:mm")
                          : "—"}
                      </Descriptions.Item>
                    </Descriptions>
                    {calendarVersionDetail.data.publishDiff ? (
                      <Descriptions size="small" column={3} bordered>
                        <Descriptions.Item label="新增日期">
                          {calendarVersionDetail.data.publishDiff.added.join("、") || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="移除日期">
                          {calendarVersionDetail.data.publishDiff.removed.join("、") || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="变更日期">
                          {calendarVersionDetail.data.publishDiff.changed.join("、") || "—"}
                        </Descriptions.Item>
                      </Descriptions>
                    ) : (
                      <Typography.Text type="secondary">该版本没有相对上一版本的差异记录（首次发布或尚未发布）。</Typography.Text>
                    )}
                  </Space>
                )}
              </QueryState>
              <QueryState loading={calendarAudits.isLoading} error={calendarAudits.error}>
                <Table
                  rowKey={(row) => `${row.date}-${row.action}-${row.at}`}
                  size="small"
                  style={{ marginTop: 12 }}
                  dataSource={(calendarAudits.data ?? []).filter((row) => row.version === historyVersion)}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                  locale={{ emptyText: "该版本没有人工覆盖调整" }}
                  columns={[
                    { title: "日期", dataIndex: "date", width: 110 },
                    {
                      title: "动作",
                      dataIndex: "action",
                      width: 100,
                      render: (value) => <Tag>{auditActionLabels[value as string] ?? value}</Tag>,
                    },
                    { title: "原因", dataIndex: "reason" },
                    { title: "操作人", dataIndex: "operator", width: 120, render: (value) => value ?? "—" },
                    {
                      title: "时间",
                      dataIndex: "at",
                      width: 150,
                      render: (value) => dayjs(value as string).format("YYYY-MM-DD HH:mm"),
                    },
                    {
                      title: "前 → 后",
                      render: (_, row) => (
                        <Typography.Text style={{ fontSize: 12 }}>
                          {row.before
                            ? `${row.before.dayType} ×${row.before.pricingMultiplier}`
                            : "（无）"}
                          {" → "}
                          {row.after ? `${row.after.dayType} ×${row.after.pricingMultiplier}` : "（无）"}
                        </Typography.Text>
                      ),
                    },
                  ]}
                />
              </QueryState>
            </Card>
          )}
        </Space>
      </Drawer>
      <Modal
        title={voidTarget ? `作废草稿 v${voidTarget.version}` : "作废草稿"}
        open={Boolean(voidTarget)}
        onCancel={() => setVoidTarget(undefined)}
        onOk={() => voidForm.submit()}
        confirmLoading={voidVersion.isPending}
        okText="确认作废"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <Form
          form={voidForm}
          layout="vertical"
          onFinish={(values) =>
            voidTarget && voidVersion.mutate({ version: voidTarget.version, reason: values.reason })
          }
        >
          <Alert
            type="warning"
            showIcon
            message="只有草稿可以作废"
            description="作废后该草稿不再进入编辑视图，但记录本身保留并写入作废原因、操作人与时间；已发布版本请发布新版本替代，已被替代版本必须保留以供历史报价追溯。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="reason"
            label="作废原因"
            rules={[{ required: true, whitespace: true, message: "请填写作废原因" }]}
          >
            <Input.TextArea rows={3} placeholder="例如：录错年度，弃用该草稿" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={restoreTarget ? `以 v${restoreTarget.version} 的内容建新草稿` : "恢复历史版本"}
        open={Boolean(restoreTarget)}
        onCancel={() => setRestoreTarget(undefined)}
        onOk={() => restoreForm.submit()}
        confirmLoading={restoreVersion.isPending}
        okText="生成新草稿"
        destroyOnHidden
      >
        <Form
          form={restoreForm}
          layout="vertical"
          onFinish={(values) =>
            restoreTarget && restoreVersion.mutate({ version: restoreTarget.version, reason: values.reason })
          }
        >
          <Alert
            type="info"
            showIcon
            message="恢复不会原地改回旧版本"
            description="会以该版本的逐日内容生成一个新草稿；被恢复的版本与当前已发布版本都保持原样。新草稿仍需经发布前预检、填写变更原因后再发布。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="reason"
            label="恢复原因"
            rules={[{ required: true, whitespace: true, message: "请填写恢复原因" }]}
          >
            <Input.TextArea rows={3} placeholder="例如：新版调休有误，回到上一版官方安排" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`移除 ${revertTarget?.date ?? ""} 的人工覆盖`}
        open={Boolean(revertTarget)}
        onCancel={() => setRevertTarget(undefined)}
        onOk={() => revertForm.submit()}
        confirmLoading={removeDayOverride.isPending}
        okText="移除覆盖"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <Form
          form={revertForm}
          layout="vertical"
          onFinish={(values) =>
            revertTarget &&
            removeDayOverride.mutate({
              date: revertTarget.date,
              overrideReason: values.overrideReason,
            })
          }
        >
          <Alert
            type="warning"
            showIcon
            message={
              revertTarget?.overriddenFrom
                ? `将恢复为：${revertTarget.overriddenFrom.name} · ${revertTarget.overriddenFrom.dayType} · 价格系数 ×${revertTarget.overriddenFrom.pricingMultiplier}`
                : "该日期没有官方原值，将按每周模板重算"
            }
            description="移除不会把该日期变成空白日；原覆盖内容、撤销原因与操作人会进入审计流水。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="overrideReason"
            label="调整原因"
            rules={[
              { required: true, whitespace: true, message: "请填写移除原因" },
            ]}
          >
            <Input.TextArea rows={3} placeholder="例如：误将国庆首日标为停业，恢复官方安排" />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        title={
          templateForm.getFieldValue("id") ? "编辑通知模板" : "新增通知模板"
        }
        width={680}
        open={Boolean(templateEditor)}
        onClose={() => setTemplateEditor(null)}
        destroyOnHidden
        extra={
          <Button
            type="primary"
            loading={saveTemplate.isPending}
            onClick={() => templateForm.submit()}
          >
            保存新版本
          </Button>
        }
      >
        <Form
          form={templateForm}
          layout="vertical"
          onFinish={(values) => saveTemplate.mutate(values)}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="eventCode"
                label="事件"
                rules={[{ required: true }]}
              >
                <Select
                  options={(
                    settings.data?.notifications.enabledEvents ?? []
                  ).map((value) => ({ value, label: value }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="channel"
                label="渠道"
                rules={[{ required: true }]}
              >
                <Select
                  options={(
                    settings.data?.notifications.editableChannels ?? []
                  ).map((value) => ({ value, label: value }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="name" label="模板名称">
            <Input />
          </Form.Item>
          <Form.Item name="title" label="标题">
            <Input />
          </Form.Item>
          <Form.Item name="body" label="正文">
            <Input.TextArea rows={5} />
          </Form.Item>
          <Form.Item name="variableSchemaText" label="变量 schema（JSON）">
            <Input.TextArea rows={8} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: "enabled", label: "启用" },
                { value: "disabled", label: "停用" },
              ]}
            />
          </Form.Item>
        </Form>
      </Drawer>
      <Modal
        title={`测试发送 · ${sendTemplate?.name ?? ""}`}
        open={Boolean(sendTemplate)}
        onCancel={() => setSendTemplate(undefined)}
        onOk={() => sendForm.submit()}
        confirmLoading={sendNotification.isPending}
        destroyOnHidden
      >
        <Form
          form={sendForm}
          layout="vertical"
          onFinish={(values) => sendNotification.mutate(values)}
        >
          <Form.Item name="templateId" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="recipient"
            label="接收人"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="variablesText"
            label="变量 JSON"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={8} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
