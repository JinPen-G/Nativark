import { ListSection, SaveButton } from "@/components/ui";
import type {
  RentalCalendarDay,
  RentalCalendarVersionSummary,
  SaveRentalCalendarDayRequest,
} from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Descriptions, InputNumber, Space, Tag, Typography } from "antd";
import { App, Modal } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button, Drawer } from "@/components/ui";
import dayjs from "dayjs";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { QueryState } from "@/components/QueryState";
import { CalendarMonthGrid } from "@/features/settings/CalendarMonthGrid";
import { CalendarRangeModal } from "@/features/settings/CalendarRangeModal";
import { calendarDayTypeLabels } from "./ruleOptionLabels";
import type { GovernancePermissions } from "./shared";

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

/**
 * 「营业日历」页签：年度日历（月历/全年列表）、官方来源应用、发布、历史版本与覆盖审计，
 * 以及逐日覆盖抽屉、范围覆盖抽屉与作废/恢复/移除覆盖三个原因弹窗。
 */
export function CalendarTab({ permissions }: { permissions: GovernancePermissions }) {
  const { message } = App.useApp();
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { canManagePrice, canEditCalendar, canPublishCalendar, canViewCalendarHistory, canSeeCalendar } = permissions;
  const [year, setYear] = useState(currentYear);
  // PRICE-02A（需求 4.5.9）：默认按自然月运营日历；全年列表仅作为可选视图保留。
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1);
  const [calendarListView, setCalendarListView] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeMode, setRangeMode] = useState<"override" | "remove">("override");
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
  const [calendarDayForm] = Form.useForm<SaveRentalCalendarDayRequest>();
  const [publishForm] = Form.useForm<{ changeReason: string }>();
  const [revertForm] = Form.useForm<{ overrideReason: string }>();
  const [voidForm] = Form.useForm<{ reason: string }>();
  const [restoreForm] = Form.useForm<{ reason: string }>();

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

  const saveDay = useMutation({
    mutationFn: (value: SaveRentalCalendarDayRequest) =>
      rentalCoreApi.saveCalendarDay(year, value),
    onSuccess: async () => {
      setCalendarDay(undefined);
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "calendar", year],
      });
      message.success(t("租户日历覆盖已保存"));
    },
    onError: () => message.error(t("日期或价格系数无效")),
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
          `${t("官方来源已应用到草稿。")} ${preserved.length} ${t("个日期存在人工覆盖，已保留原覆盖")}：${preserved.join("、")}`,
        );
      } else {
        message.success(t("官方来源已应用到草稿，请核对后发布"));
      }
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          t("应用官方来源失败"),
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
      message.success(t("年度营业日历已发布，后续报价将记录该版本"));
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          t("发布失败：需填写变更原因"),
      ),
  });
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
      message.success(`${t("已按该版本生成新草稿")} v${created.version}，${t("请核对后发布")}`);
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          t("恢复失败：必须填写原因，且不能恢复当前正在编辑的版本"),
      ),
  });
  /** 作废草稿版本（需求 4.5.7）。原因必填，作废后该草稿不再进入编辑视图。 */
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
      message.success(t("草稿版本已作废，并记录了作废原因"));
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          t("作废失败：只能作废草稿版本，且必须填写原因"),
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
      message.success(t("人工覆盖已移除，该日期恢复为官方日历或每周模板"));
    },
    onError: () => message.error(t("移除失败：该日期没有人工覆盖，或未填写调整原因")),
  });

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

  return (
    <>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <div className="table-toolbar">
          <Space wrap>
            <Select
              value={year}
              onChange={setYear}
              options={[
                currentYear - 1,
                currentYear,
                currentYear + 1,
              ].map((value) => ({ value, label: locale === "en-US" ? String(value) : `${value} ${t("年")}` }))}
            />
            {calendar.data && <Tag
              color={
                calendar.data?.status === "published"
                  ? "success"
                  : "warning"
              }
            >
              {t(calendarStatusLabels[calendar.data?.status ?? ""] ?? calendar.data?.status ?? "")} · v{calendar.data?.version}
            </Tag>}
            <Typography.Text type="secondary">
              {calendar.data?.sourceName ?? t("未引用官方来源")}
            </Typography.Text>
          </Space>
          <Space wrap>
            {/* 需求 4.5.9：默认月历视图，全年逐日长列表仅作为可选视图保留。 */}
            <Switch
              checkedChildren={t("列表")}
              unCheckedChildren={t("月历")}
              checked={calendarListView}
              onChange={setCalendarListView}
            />
            <Button
              onClick={() => {
                setHistoryVersion(undefined);
                setHistoryOpen(true);
              }}
            >
              {t("历史版本")}
            </Button>
            {canEditCalendar && (
              <Button
                type="primary"
                onClick={() => {
                  setRangeMode("override");
                  setRangeOpen(true);
                }}
              >
                {t("新增日期范围覆盖")}
              </Button>
            )}
            {canEditCalendar && (
              <Button
                onClick={() => {
                  setRangeMode("remove");
                  setRangeOpen(true);
                }}
              >
                {t("移除日期范围覆盖")}
              </Button>
            )}
            {canEditCalendar && (
              <Button onClick={() => setImportOpen(true)}>{t("应用官方来源")}</Button>
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
                {t("发布年度版本")}
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
            title={`${t("当前引用的官方来源有新版本")} v${calendar.data.latestOfficialSourceVersion}`}
            description={t("平台已登记该年度更新的官方节假日数据。应用后会在草稿上生成新的一版，仍需发布才生效，且不会改动已有报价与订单。")}
            action={
              canEditCalendar ? (
                <Button size="small" onClick={() => setImportOpen(true)}>
                  {t("查看 / 应用")}
                </Button>
              ) : undefined
            }
          />
        ) : calendar.data?.officialSourceAvailableToSelect ? (
          <Alert
            type="info"
            showIcon
            title={`${t("平台已登记该年度可用的官方来源")}（${calendar.data.availableOfficialSourceCount ?? 0} ${t("个")}），${t("可选择应用")}`}
            description={t("本经营空间尚未引用任何官方来源版本；当前日历按每周默认模板与人工覆盖生成。选择来源时可查看各来源的公告日期与版本。")}
            action={
              canEditCalendar ? (
                <Button size="small" onClick={() => setImportOpen(true)}>
                  {t("选择官方来源")}
                </Button>
              ) : undefined
            }
          />
        ) : calendar.data?.officialSourceRegisteredButUnavailable ? (
          <Alert
            type="info"
            showIcon
            title={t("当前没有可用的官方来源")}
            description={t("平台登记过该年度官方来源，但目前全部已停用；如需应用请联系平台管理员恢复来源。")}
          />
        ) : !calendar.data?.sourceName ? (
          <Alert
            type="info"
            showIcon
            title={t("平台尚未登记该年度公共官方来源")}
            description={t("官方节假日来源由 SaaS 平台管理员维护；登记后这里会提示可选择应用。")}
          />
        ) : null}
        <Alert
          type="info"
          showIcon
          title={t("法定节假日与调休工作日必须来自有来源记录的年度数据")}
          description={t("租户可以覆盖特殊营业日、停业日和营业时段；特殊价格只在价格模块维护，日历保存规则引用。报价会记录命中的年度日历与价格版本。")}
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
        <ListSection title={t("全年日历")}>
          <Table<RentalCalendarDay>
            rowKey="date"
            size="small"
            onRefresh={() => calendar.refetch()} loading={calendar.isFetching} dataSource={calendar.data?.days ?? []}
            pagination={{ pageSize: 31, showSizeChanger: false }}
            columns={[
              { title: t("日期"), dataIndex: "date" },
              {
                title: t("类型"),
                dataIndex: "dayType",
                render: (value) => <Tag>{t(calendarDayTypeLabels[value as string] ?? value)}</Tag>,
              },
              { title: t("名称"), dataIndex: "name" },
              { title: t("历史系数（兼容）"), dataIndex: "pricingMultiplier" },
              {
                title: t("停业"),
                dataIndex: "closed",
                render: (value) => (value ? t("是") : t("否")),
              },
              {
                // 四态营业状态与营业时段此前在表格上完全不可见，于是「限时营业 →
                // 正常营业」这种翻转在界面上看不出来（需求 4.5.4/4.5.1）。
                title: t("营业状态"),
                dataIndex: "businessStatus",
                render: (value, row) => (
                  <Tag>{t(businessStatusLabels[(value as string) ?? (row.closed ? "closed" : "open")] ?? value)}</Tag>
                ),
              },
              {
                title: t("营业时段"),
                render: (_, row) =>
                  row.hours?.windows?.length ? (
                    <Space orientation="vertical" size={0}>
                      <Typography.Text className="text-meta">
                        {row.hours.windows.map((w) => `${w.start}-${w.end}`).join("、")}
                      </Typography.Text>
                      {(row.hours.pickup?.length || row.hours.return?.length) && (
                        <Typography.Text type="secondary" className="text-meta">
                          {row.hours.pickup?.length
                            ? `${t("取")} ${row.hours.pickup.map((w) => `${w.start}-${w.end}`).join("、")}`
                            : ""}
                          {row.hours.return?.length
                            ? ` ${t("还")} ${row.hours.return.map((w) => `${w.start}-${w.end}`).join("、")}`
                            : ""}
                        </Typography.Text>
                      )}
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">{t("沿用每周模板")}</Typography.Text>
                  ),
              },
              { title: t("来源"), dataIndex: "source" },
              {
                title: t("被覆盖的原始值"),
                // 需求 4.5.3：日期详情必须能说明当前结果的来源并展示被覆盖的原始值。
                // 只显示"来源=人工覆盖"而不显示原值，运营无法判断撤销后会恢复成什么。
                render: (_, row) =>
                  row.source === "tenant_override" ? (
                    <Space orientation="vertical" size={0}>
                      <Typography.Text className="text-meta">
                        {row.overriddenFrom
                          ? `${row.overriddenFrom.name} · ${row.overriddenFrom.dayType} · ×${row.overriddenFrom.pricingMultiplier}`
                          : t("每周模板")}
                      </Typography.Text>
                      <Typography.Text type="secondary" className="text-meta">
                        {row.overrideReason ?? t("未记录原因")}
                        {row.overrideBy ? ` · ${row.overrideBy}` : ""}
                      </Typography.Text>
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                  ),
              },
              {
                title: t("操作"),
                render: (_, row) =>
                  canEditCalendar ? (
                    <Space size={0}>
                      <Button type="link" onClick={() => openDay(row)}>
                        {t("租户覆盖")}
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
                          {t("移除覆盖")}
                        </Button>
                      )}
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">{t("只读")}</Typography.Text>
                  ),
              },
            ]}
          />
        </ListSection>
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

      <Drawer
        title={`${t("覆盖营业日")} · ${calendarDay?.date ?? ""}`}
        size={480}
        open={Boolean(calendarDay)}
        onClose={() => setCalendarDay(undefined)}
        forceRender
        destroyOnHidden
        extra={
          <SaveButton  label={t("保存覆盖")} form={calendarDayForm} pending={saveDay.isPending} onSave={async values => { const operation = saveDay.mutateAsync({ ...values, hours: calendarDay?.hours }); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
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
              title={
                calendarDay.overrideScope.kind === "range"
                  ? `${t("属于范围覆盖")}：${calendarDay.overrideScope.rangeStart} ~ ${calendarDay.overrideScope.rangeEnd}`
                  : t("单日覆盖")
              }
              description={
                `${t("批次")} ${calendarDay.overrideScope.batchId}` +
                (calendarDay.overrideScope.startDateTime
                  ? `；${t("起止时点")} ${calendarDay.overrideScope.startDateTime} ~ ${calendarDay.overrideScope.endDateTime}`
                  : "")
              }
            />
          )}
          {calendarDay && (calendar.data?.timePriceSummary ?? []).find((row) => row.date === calendarDay.date)?.entries.length ? (
            <Card
              size="small"
              title={t("当日分时价格摘要")}
              style={{ marginBottom: 16 }}
              extra={canManagePrice ? <Button type="link" onClick={() => navigate("/rental/pricing")}>{t("进入价格版本与调价")}</Button> : undefined}
            >
              <Space orientation="vertical" size={4}>
                {(calendar.data?.timePriceSummary ?? []).find((row) => row.date === calendarDay.date)!.entries.map((entry, index) => (
                  <Typography.Text key={`${entry.version}-${entry.unit}-${entry.timeLabel}-${index}`}>
                    {entry.planCode ?? `${t("价格版本")} ${entry.version}`} · {entry.itemGroupCodes.join("、")} · {entry.timeLabel} ×{entry.multiplier}
                    {entry.overrideRef ? ` · ${t("引用")} ${entry.overrideRef}` : ""}
                  </Typography.Text>
                ))}
              </Space>
            </Card>
          ) : null}
          <Form.Item name="date" label={t("日期")}>
            <Input disabled />
          </Form.Item>
          <Form.Item name="dayType" label={t("日期类型")}>
            <Select
              options={[
                "workday",
                "weekend",
                "statutory_holiday",
                "makeup_workday",
                "tenant_special",
              ].map((value) => ({ value, label: t(calendarDayTypeLabels[value] ?? value) }))}
            />
          </Form.Item>
          <Form.Item name="name" label={t("名称")}>
            <Input />
          </Form.Item>
          <Form.Item name="pricingMultiplier" hidden>
            <InputNumber />
          </Form.Item>
          <Alert
            style={{ marginBottom: 16 }}
            type="info"
            showIcon
            title={t("日历不再直接设置价格系数")}
            description={t("逐商品价格、日期类型价格和一次性分时价格都在「价格版本与调价」中维护；日期范围覆盖只保存一次性规则引用。")}
          />
          <Form.Item name="pricingOverrideRef" label={t("一次性价格引用")} tooltip={t("填写「价格版本与调价」中一次性日期时间价格规则的引用标识；留空表示不引用特殊价格。") }>
            <Input allowClear placeholder="例如 NATIONAL-DAY-2026" />
          </Form.Item>
          <Form.Item
            name="overrideReason"
            label={t("调整原因")}
            rules={[{ required: true }]}
            tooltip={t("人工覆盖必须留下原因；操作人与调整时间由服务端记录。移除覆盖会恢复到官方日历或每周模板的原值。")}
          >
            <Input />
          </Form.Item>
          <Form.Item name="closed" label={t("停业")} valuePropName="checked">
            <Switch />
          </Form.Item>
          {/* 四态营业状态（需求 4.5.4）。此前抽屉只有「停业」开关、没有四态选择器，
              于是限时营业与自助营业在界面上既看不到也配不了；服务端在未提供时会沿用原值，
              这里显式给出选择器让运营能真正改它。 */}
          <Form.Item
            name="businessStatus"
            label={t("营业状态")}
            tooltip={t("留空表示按「停业」开关推导（停业=停止营业、否则正常营业）。限时营业需要配营业时段才会真正限制时点；自助营业需要地点声明自助能力。")}
          >
            <Select
              allowClear
              placeholder={t("留空按停业开关推导")}
              options={Object.entries(businessStatusLabels).map(([value, label]) => ({ value, label: t(label) }))}
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
        title={`${t("应用")} ${year} ${t("年公共官方日历来源")}`}
        size={720}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        destroyOnHidden
      >
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            title={t("官方数据是公共基础来源，由平台维护、按版本发布")}
            description={t("应用某一版只会生成或更新本经营空间的草稿；已有的人工覆盖会被保留，本版未包含的日期会回落到每周模板。确认后仍需你自己发布。")}
          />
          <QueryState loading={officialSourceVersions.isLoading} error={officialSourceVersions.error}>
            <Table
              rowKey="id"
              size="small"
              onRefresh={() => officialSourceVersions.refetch()} loading={officialSourceVersions.isFetching} dataSource={officialSourceVersions.data ?? []}
              pagination={false}
              locale={{ emptyText: `${t("平台尚未登记")} ${year} ${t("年度的官方来源版本，请联系 SaaS 平台管理员")}` }}
              columns={[
                { title: t("来源"), dataIndex: "sourceName" },
                { title: t("来源版本"), dataIndex: "version", width: 100, render: (value) => `v${value}` },
                {
                  title: t("官方发布日期"),
                  dataIndex: "publishedAt",
                  width: 130,
                  render: (value) => dayjs(value as string).format("YYYY-MM-DD"),
                },
                { title: t("日期条数"), dataIndex: "dayCount", width: 90 },
                {
                  title: t("操作"),
                  width: 110,
                  render: (_, row) => (
                    <Button
                      type="link"
                      loading={applyOfficialSource.isPending}
                      onClick={() => applyOfficialSource.mutate(row.id)}
                    >
                      {t("应用到草稿")}
                    </Button>
                  ),
                },
              ]}
            />
          </QueryState>
        </Space>
      </Drawer>
      <Modal
        title={t("发布年度营业日历")}
        open={publishOpen}
        onCancel={() => setPublishOpen(false)}
        onConfirm={() => publishForm.validateFields().then((values) => publishCalendar.mutateAsync(values.changeReason))}
        confirmLoading={publishCalendar.isPending}
        okText={t("发布")}
        width={760}
        forceRender
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
            title={t("发布后不可原地修改")}
            description={t("当前已发布版本会被标记为「已被替代」并保留，历史报价仍可追溯原版本；变更原因与相对上一版本的日期差异会一并记录。")}
            style={{ marginBottom: 16 }}
          />
          {/* 需求 4.5.8：发布前必须展示受影响日期以及停业、营业时间、履约能力和特殊价格变化；
              存在未来订单时必须提示。预览是只读推演，不会改动这些订单。 */}
          <QueryState loading={publishPreview.isLoading} error={publishPreview.error}>
            {publishPreview.data && (
              <Space orientation="vertical" size={12} style={{ width: "100%", marginBottom: 16 }}>
                <Descriptions size="small" column={2} bordered>
                  <Descriptions.Item label={t("待发布版本")}>v{publishPreview.data.draftVersion}</Descriptions.Item>
                  <Descriptions.Item label={t("当前已发布")}>
                    {publishPreview.data.publishedVersion
                      ? `v${publishPreview.data.publishedVersion}`
                      : t("无（首次发布）")}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("受影响日期")}>
                    {publishPreview.data.dates.length} {t("天")}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("公共官方来源")}>
                    {publishPreview.data.officialSourceConfirmed ? (
                      <Tag color="success">{t("已确认")}</Tag>
                    ) : (
                      <Tag color="warning">{t("尚未确认")}</Tag>
                    )}
                  </Descriptions.Item>
                </Descriptions>
                {publishPreview.data.firstPublish && (
                  <Alert
                    type="info"
                    showIcon
                    title={t("该年度首次发布：差异基准是每周默认营业模板")}
                    description={t("下面列出的是这次发布相对周模板真正带来的业务变化（人工覆盖、官方节假日、停业或限时、特殊价格）；与「空日历」比会把全年 365 天都列出来，没有筛选价值。")}
                  />
                )}
                <>
                    <Space size={8} wrap>
                      <Tag color="volcano">
                        {t("营业状态/停业")} {publishPreview.data.closureChanges.length} {t("天")}
                      </Tag>
                      <Tag color="geekblue">
                        {t("营业与履约时段")} {publishPreview.data.hoursChanges.length} {t("天")}
                      </Tag>
                      <Tag color="gold">
                        {t("特殊价格")} {publishPreview.data.pricingChanges.length} {t("天")}
                      </Tag>
                    </Space>
                    {publishPreview.data.dates.length > 0 && (
                      <Table
                        rowKey="date"
                        size="small"
                        onRefresh={() => publishPreview.refetch()} loading={publishPreview.isFetching} dataSource={publishPreview.data.dates}
                        pagination={{ pageSize: 6, showSizeChanger: false }}
                        columns={[
                          { title: t("日期"), dataIndex: "date", width: 110 },
                          {
                            title: t("变化"),
                            dataIndex: "changedFields",
                            render: (fields: string[], row) =>
                              row.change !== "changed" ? (
                                <Tag>{row.change === "added" ? t("新增日期") : t("移除日期")}</Tag>
                              ) : (
                                <Space size={4} wrap>
                                  {fields.map((field) => (
                                    <Tag key={field}>{t(previewFieldLabels[field] ?? field)}</Tag>
                                  ))}
                                </Space>
                              ),
                          },
                          {
                            title: t("发布前 → 发布后"),
                            render: (_, row) => (
                              <Typography.Text className="text-meta">
                                {row.before
                                  ? `${t(businessStatusLabels[row.before.businessStatus ?? (row.before.closed ? "closed" : "open")] ?? row.before.businessStatus ?? "open")} ×${row.before.pricingMultiplier}`
                                  : t("（无）")}
                                {" → "}
                                {row.after
                                  ? `${t(businessStatusLabels[row.after.businessStatus ?? (row.after.closed ? "closed" : "open")] ?? row.after.businessStatus ?? "open")} ×${row.after.pricingMultiplier}`
                                  : t("（无）")}
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
                    title={`${t("有")} ${publishPreview.data.futureOrders.length} ${t("张未来订单落在受影响日期上")}`}
                    description={
                      <Space orientation="vertical" size={0}>
                        <Typography.Text className="text-meta">
                          {t("发布不会改动这些订单，它们继续按各自的订单快照执行；如需调整请单独处理。")}
                        </Typography.Text>
                        {publishPreview.data.futureOrders.slice(0, 5).map((order) => (
                          <Typography.Text key={order.orderId} type="secondary" className="text-meta">
                            {order.orderNo} · {order.status} · {t("重叠")} {order.affectedDates.join("、")}
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
            label={t("变更原因")}
            rules={[
              { required: true, whitespace: true, message: t("请填写变更原因") },
            ]}
          >
            <Input.TextArea rows={3} placeholder={t("例如：按国务院办公厅通知更新国庆调休")} />
          </Form.Item>
        </Form>
      </Modal>
      {/* 历史版本、差异详情、覆盖审计与作废入口（需求 4.5.7/4.5.8）。
          后端端点早已就绪，但此前没有任何界面入口，「客服/财务查看历史版本」「完整追溯」
          都没形成闭环。 */}
      <Drawer
        title={`${year} ${t("年度日历历史版本")}`}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        size={880}
        destroyOnHidden
      >
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            title={t("历史版本只读保留，不得删除或原地改回")}
            description={t("已发布版本被新版本取代后进入「已被替代」，历史报价仍按原版本追溯；只有草稿可以作废。")}
          />
          <QueryState loading={calendarVersions.isLoading} error={calendarVersions.error}>
            <Table<RentalCalendarVersionSummary>
              rowKey="version"
              size="small"
              onRefresh={() => calendarVersions.refetch()} loading={calendarVersions.isFetching} dataSource={calendarVersions.data ?? []}
              pagination={false}
              onRow={(row) => ({ onClick: () => setHistoryVersion(row.version) })}
              rowClassName={(row) => (row.version === historyVersion ? "ant-table-row-selected" : "")}
              columns={[
                { title: t("版本"), dataIndex: "version", width: 90, render: (value) => `v${value}` },
                {
                  title: t("状态"),
                  dataIndex: "status",
                  width: 100,
                  render: (value) => <Tag>{t(calendarStatusLabels[value as string] ?? value)}</Tag>,
                },
                { title: t("上一版本"), dataIndex: "previousVersion", width: 100, render: (value) => (value ? `v${value}` : "—") },
                {
                  title: t("日期/覆盖/审计"),
                  width: 130,
                  render: (_, row) => `${row.dayCount} / ${row.overrideCount} / ${row.overrideAuditCount}`,
                },
                {
                  title: t("差异"),
                  width: 150,
                  render: (_, row) =>
                    row.publishDiffCounts
                      ? `+${row.publishDiffCounts.added} -${row.publishDiffCounts.removed} ~${row.publishDiffCounts.changed}`
                      : "—",
                },
                {
                  title: t("变更原因/发布人"),
                  render: (_, row) => (
                    <Space orientation="vertical" size={0}>
                      <Typography.Text className="text-meta">{row.changeReason ?? "—"}</Typography.Text>
                      <Typography.Text type="secondary" className="text-meta">
                        {row.publishedBy ?? ""}
                        {row.voidReason ? `${t("作废")}：${row.voidReason}` : ""}
                      </Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: t("操作"),
                  width: 170,
                  render: (_, row) => {
                    if (!canEditCalendar) return <Typography.Text type="secondary">{t("只读")}</Typography.Text>;
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
                            {t("作废")}
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
                            {t("以此版本建新草稿")}
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
            <ListSection title={`v${historyVersion} ${t("差异与覆盖审计")}`} extra={
                <Button size="small" onClick={() => setHistoryVersion(undefined)}>
                  {t("收起")}
                </Button>
              }>
              <QueryState loading={calendarVersionDetail.isLoading} error={calendarVersionDetail.error}>
                {calendarVersionDetail.data && (
                  <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                    <Descriptions size="small" column={2} bordered>
                      <Descriptions.Item label={t("状态")}>
                        {t(calendarStatusLabels[calendarVersionDetail.data.status] ?? calendarVersionDetail.data.status)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("官方来源")}>
                        {calendarVersionDetail.data.sourceName ?? t("无")}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("发布时间")}>
                        {calendarVersionDetail.data.publishedAt
                          ? dayjs(calendarVersionDetail.data.publishedAt).format("YYYY-MM-DD HH:mm")
                          : t("未发布")}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("被替代时间")}>
                        {calendarVersionDetail.data.supersededAt
                          ? dayjs(calendarVersionDetail.data.supersededAt).format("YYYY-MM-DD HH:mm")
                          : "—"}
                      </Descriptions.Item>
                    </Descriptions>
                    {calendarVersionDetail.data.publishDiff ? (
                      <Descriptions size="small" column={3} bordered>
                        <Descriptions.Item label={t("新增日期")}>
                          {calendarVersionDetail.data.publishDiff.added.join("、") || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label={t("移除日期")}>
                          {calendarVersionDetail.data.publishDiff.removed.join("、") || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label={t("变更日期")}>
                          {calendarVersionDetail.data.publishDiff.changed.join("、") || "—"}
                        </Descriptions.Item>
                      </Descriptions>
                    ) : (
                      <Typography.Text type="secondary">{t("该版本没有相对上一版本的差异记录（首次发布或尚未发布）。")}</Typography.Text>
                    )}
                  </Space>
                )}
              </QueryState>
              <QueryState loading={calendarAudits.isLoading} error={calendarAudits.error}>
                <Table
                  rowKey={(row) => `${row.date}-${row.action}-${row.at}`}
                  size="small"

                  onRefresh={() => calendarAudits.refetch()} loading={calendarAudits.isFetching} dataSource={(calendarAudits.data ?? []).filter((row) => row.version === historyVersion)}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                  locale={{ emptyText: t("该版本没有人工覆盖调整") }}
                  columns={[
                    { title: t("日期"), dataIndex: "date", width: 110 },
                    {
                      title: t("动作"),
                      dataIndex: "action",
                      width: 100,
                      render: (value) => <Tag>{t(auditActionLabels[value as string] ?? value)}</Tag>,
                    },
                    { title: t("原因"), dataIndex: "reason" },
                    { title: t("操作人"), dataIndex: "operator", width: 120, render: (value) => value ?? "—" },
                    {
                      title: t("时间"),
                      dataIndex: "at",
                      width: 150,
                      render: (value) => dayjs(value as string).format("YYYY-MM-DD HH:mm"),
                    },
                    {
                      title: t("前 → 后"),
                      render: (_, row) => (
                        <Typography.Text className="text-meta">
                          {row.before
                            ? `${row.before.dayType} ×${row.before.pricingMultiplier}`
                            : t("（无）")}
                          {" → "}
                          {row.after ? `${row.after.dayType} ×${row.after.pricingMultiplier}` : t("（无）")}
                        </Typography.Text>
                      ),
                    },
                  ]}
                />
              </QueryState>
            </ListSection>
          )}
        </Space>
      </Drawer>
      <Modal
        title={voidTarget ? `${t("作废草稿")} v${voidTarget.version}` : t("作废草稿")}
        open={Boolean(voidTarget)}
        onCancel={() => setVoidTarget(undefined)}
        onConfirm={() => voidForm.validateFields().then(async values => { const operation = voidTarget && voidVersion.mutateAsync({ version: voidTarget.version, reason: values.reason }); if (!operation) throw new Error("Operation unavailable"); return operation; })}
        confirmLoading={voidVersion.isPending}
        okText={t("确认作废")}
        okButtonProps={{ danger: true }}
        forceRender
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
            title={t("只有草稿可以作废")}
            description={t("作废后该草稿不再进入编辑视图，但记录本身保留并写入作废原因、操作人与时间；已发布版本请发布新版本替代，已被替代版本必须保留以供历史报价追溯。")}
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="reason"
            label={t("作废原因")}
            rules={[{ required: true, whitespace: true, message: t("请填写作废原因") }]}
          >
            <Input.TextArea rows={3} placeholder={t("例如：录错年度，弃用该草稿")} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={restoreTarget ? `${t("以 v")} ${restoreTarget.version} ${t("的内容建新草稿")}` : t("恢复历史版本")}
        open={Boolean(restoreTarget)}
        onCancel={() => setRestoreTarget(undefined)}
        onConfirm={() => restoreForm.validateFields().then(async values => { const operation = restoreTarget && restoreVersion.mutateAsync({ version: restoreTarget.version, reason: values.reason }); if (!operation) throw new Error("Operation unavailable"); return operation; })}
        confirmLoading={restoreVersion.isPending}
        okText={t("生成新草稿")}
        forceRender
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
            title={t("恢复不会原地改回旧版本")}
            description={t("会以该版本的逐日内容生成一个新草稿；被恢复的版本与当前已发布版本都保持原样。新草稿仍需经发布前预检、填写变更原因后再发布。")}
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="reason"
            label={t("恢复原因")}
            rules={[{ required: true, whitespace: true, message: t("请填写恢复原因") }]}
          >
            <Input.TextArea rows={3} placeholder={t("例如：新版调休有误，回到上一版官方安排")} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`${t("移除")} ${revertTarget?.date ?? ""} ${t("的人工覆盖")}`}
        open={Boolean(revertTarget)}
        onCancel={() => setRevertTarget(undefined)}
        onConfirm={() => revertForm.validateFields().then(async values => { const operation = revertTarget &&
            removeDayOverride.mutateAsync({
              date: revertTarget.date,
              overrideReason: values.overrideReason,
            }); if (!operation) throw new Error("Operation unavailable"); return operation; })}
        confirmLoading={removeDayOverride.isPending}
        okText={t("移除覆盖")}
        okButtonProps={{ danger: true }}
        forceRender
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
            title={
              revertTarget?.overriddenFrom
                ? `${t("将恢复为")}：${revertTarget.overriddenFrom.name} · ${revertTarget.overriddenFrom.dayType} · ${t("价格系数")} ×${revertTarget.overriddenFrom.pricingMultiplier}`
                : t("该日期没有官方原值，将按每周模板重算")
            }
            description={t("移除不会把该日期变成空白日；原覆盖内容、撤销原因与操作人会进入审计流水。")}
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            name="overrideReason"
            label={t("调整原因")}
            rules={[
              { required: true, whitespace: true, message: t("请填写移除原因") },
            ]}
          >
            <Input.TextArea rows={3} placeholder={t("例如：误将国庆首日标为停业，恢复官方安排")} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
