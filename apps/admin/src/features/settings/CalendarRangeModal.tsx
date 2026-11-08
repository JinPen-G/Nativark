import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Space, Tag, Typography } from "antd";
import { ActionButton, App, FormSection, Modal } from "@/components/ui";
import { Checkbox } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, DatePicker, Table, TimeInput } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button } from "@/components/ui";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import {
  ApplyRentalCalendarRangeOverrideResult,
  ApplyRentalCalendarRangeRemoveResult,
  RentalCalendarBusinessStatus,
  RentalCalendarRangeOverridePreview,
  RentalCalendarRangeRemovePreview,
  RentalDayType,
} from "@rental-os/shared";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { errorText } from "./governance/shared";
import styles from "./governance/GovernanceForms.module.css";

type RangeRow = RentalCalendarRangeOverridePreview["days"][number] | RentalCalendarRangeRemovePreview["days"][number];

/**
 * PRICE-02A（需求 4.5.9）：「新增日期范围覆盖 / 移除日期范围覆盖」的统一操作抽屉。
 *
 * 交互契约由需求钉死：
 * - 只修改明确选择的字段，未选择字段保持原值；
 * - 提交前必须预览（冲突日期、当前值、将替换的字段、替换后的结果；移除前展示恢复值）；
 * - 既有覆盖必须显式确认，绝不静默覆盖；
 * - 一次提交原子生效（共用原因/批次，只推进一次 revision），并发 409 提示刷新重试；
 * - 不得跨年度：DatePicker 的月份面板限制在起始日期所在年度内，后端还会独立拒绝。
 */

const dayTypeOptions: Array<{ value: RentalDayType; label: string }> = [
  { value: "workday", label: "工作日" },
  { value: "weekend", label: "周末" },
  { value: "statutory_holiday", label: "法定节假日" },
  { value: "makeup_workday", label: "调休工作日" },
  { value: "tenant_special", label: "空间特殊日" },
];

const businessStatusOptions: Array<{ value: RentalCalendarBusinessStatus; label: string }> = [
  { value: "open", label: "正常营业" },
  { value: "limited", label: "限时营业" },
  { value: "closed", label: "停止营业" },
  { value: "self_service", label: "自助营业" },
];

type FieldKey = "dayType" | "name" | "pricingOverrideRef" | "businessStatus" | "hours";

export function CalendarRangeModal({
  mode,
  year,
  currentRevision,
  open,
  onClose,
  onApplied,
}: {
  mode: "override" | "remove";
  year: number;
  /** 当前可编辑版本的 revision，用于乐观并发；undefined 表示年度还没有落库行。 */
  currentRevision?: number;
  open: boolean;
  onClose: () => void;
  onApplied: (result: ApplyRentalCalendarRangeOverrideResult | ApplyRentalCalendarRangeRemoveResult, mode: "override" | "remove") => void;
}) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [step, setStep] = useState<"input" | "preview">("input");
  const [overridePreview, setOverridePreview] = useState<RentalCalendarRangeOverridePreview>();
  const [removePreview, setRemovePreview] = useState<RentalCalendarRangeRemovePreview>();
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);
  const [previewRevision, setPreviewRevision] = useState<number>();
  const [useDatetime, setUseDatetime] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Record<FieldKey, boolean>>({
    dayType: true,
    name: false,
    pricingOverrideRef: false,
    businessStatus: false,
    hours: false,
  });

  const reset = () => {
    setStep("input");
    setOverridePreview(undefined);
    setRemovePreview(undefined);
    setConflictAcknowledged(false);
    setPreviewRevision(undefined);
    setUseDatetime(false);
    setSelectedFields({ dayType: true, name: false, pricingOverrideRef: false, businessStatus: false, hours: false });
    form.resetFields();
    previewMutation.reset();
    applyMutation.reset();
  };

  const close = () => {
    onClose();
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      await form.validateFields();
      const values = form.getFieldsValue(true) as {
        range?: [Dayjs, Dayjs];
        dateTimeRange?: [Dayjs, Dayjs];
        dayType?: RentalDayType;
        name?: string;
        pricingOverrideRef?: string;
        businessStatus?: RentalCalendarBusinessStatus;
        hoursStart?: string;
        hoursEnd?: string;
        overrideReason?: string;
      };
      const [start, end] = values.range ?? [];
      const [startDateTime, endDateTime] = values.dateTimeRange ?? [];
      if (!start || !end) throw new Error(t("请选择日期范围"));
      if (mode === "override" && useDatetime && (!startDateTime || !endDateTime)) {
        throw new Error(t("日期时间范围必须同时提供开始与结束时点"));
      }
      const startDate = start.format("YYYY-MM-DD");
      const endDate = end.format("YYYY-MM-DD");
      const payload = {
        startDate,
        endDate,
        startDateTime: mode === "override" && useDatetime ? startDateTime?.toISOString() : undefined,
        endDateTime: mode === "override" && useDatetime ? endDateTime?.toISOString() : undefined,
        ...(mode === "override"
          ? {
              fields: {
                ...(selectedFields.dayType ? { dayType: values.dayType } : {}),
                ...(selectedFields.name ? { name: values.name } : {}),
                ...(selectedFields.pricingOverrideRef ? { pricingOverrideRef: values.pricingOverrideRef } : {}),
                ...(selectedFields.businessStatus ? { businessStatus: values.businessStatus } : {}),
                ...(selectedFields.hours && values.hoursStart && values.hoursEnd
                  ? { hours: { windows: [{ start: values.hoursStart, end: values.hoursEnd }] } }
                  : {}),
              },
            }
          : {}),
      };
      if (mode === "override") {
        if (!Object.values(payload.fields ?? {}).some((value) => value !== undefined)) {
          throw new Error(t("至少选择并填写一个要设置的字段"));
        }
        if (!values.overrideReason?.trim()) throw new Error(t("请填写调整原因"));
        const preview = await rentalCoreApi.calendarRangePreview(year, payload as Parameters<typeof rentalCoreApi.calendarRangePreview>[1]);
        return { preview, revision: currentRevision };
      }
      const preview = await rentalCoreApi.calendarRangeRemovePreview(year, payload);
      return { preview, revision: currentRevision };
    },
    onSuccess: ({ preview, revision }) => {
      setConflictAcknowledged(false);
      setPreviewRevision(revision);
      if (mode === "override") setOverridePreview(preview as RentalCalendarRangeOverridePreview);
      else setRemovePreview(preview as RentalCalendarRangeRemovePreview);
      setStep("preview");
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (step !== "preview" || previewRevision !== currentRevision) throw new Error(t("日历已更新，请返回修改并重新预览"));
      const values = form.getFieldsValue(true) as {
        range?: [Dayjs, Dayjs];
        dateTimeRange?: [Dayjs, Dayjs];
        dayType?: RentalDayType;
        name?: string;
        pricingOverrideRef?: string;
        businessStatus?: RentalCalendarBusinessStatus;
        hoursStart?: string;
        hoursEnd?: string;
        overrideReason?: string;
      };
      const [start, end] = values.range ?? [];
      const [startDateTime, endDateTime] = values.dateTimeRange ?? [];
      if (!start || !end) throw new Error(t("请选择日期范围"));
      const startDate = start.format("YYYY-MM-DD");
      const endDate = end.format("YYYY-MM-DD");
      if (mode === "override") {
        return rentalCoreApi.calendarRangeApply(year, {
          startDate,
          endDate,
          startDateTime: useDatetime ? startDateTime?.toISOString() : undefined,
          endDateTime: useDatetime ? endDateTime?.toISOString() : undefined,
          fields: {
            ...(selectedFields.dayType ? { dayType: values.dayType } : {}),
            ...(selectedFields.name ? { name: values.name } : {}),
            ...(selectedFields.pricingOverrideRef ? { pricingOverrideRef: values.pricingOverrideRef } : {}),
            ...(selectedFields.businessStatus ? { businessStatus: values.businessStatus } : {}),
            ...(selectedFields.hours && values.hoursStart && values.hoursEnd
              ? { hours: { windows: [{ start: values.hoursStart, end: values.hoursEnd }] } }
              : {}),
          },
          overrideReason: values.overrideReason!.trim(),
          expectedRevision: previewRevision,
          // 已在预览步确认过冲突：预览展示冲突且用户点击「确认覆盖」才会走到这里。
          overrideConfirmed: conflictAcknowledged || undefined,
        });
      }
      return rentalCoreApi.calendarRangeRemove(year, {
        startDate,
        endDate,
        overrideReason: values.overrideReason!.trim(),
        expectedRevision: previewRevision,
      });
    },
    onSuccess: (result) => {
      message.success(
        mode === "override"
          ? `${t("范围覆盖已应用")}：${(result as ApplyRentalCalendarRangeOverrideResult).appliedCount} ${t("天")}，${t("批次")} ${(result as ApplyRentalCalendarRangeOverrideResult).batchId}`
          : `${t("范围移除完成")}：${t("恢复")} ${(result as ApplyRentalCalendarRangeRemoveResult).removedCount} ${t("天")}`
      );
      queryClient.invalidateQueries({ queryKey: ["rental-core", "calendar", year] });
      onApplied(result, mode);
      close();
    },
  });

  const conflicts = overridePreview?.days.filter((row) => row.conflict) ?? [];
  const needsAck = mode === "override" && (overridePreview?.conflictCount ?? 0) > 0 && !conflictAcknowledged;

  const previewColumns = useMemo<ColumnsType<RangeRow>>(() => {
    const dayLabel = (value: string) => t(dayTypeOptions.find(option => option.value === value)?.label ?? value);
    const statusLabel = (value: string) => t(businessStatusOptions.find(option => option.value === value)?.label ?? value);
    const fieldLabels: Record<string, string> = { dayType: "日期类型", name: "名称", businessStatus: "营业状态", closed: "停业", hours: "营业时段", pricingOverrideRef: "一次性价格引用", pricingMultiplier: "特殊价格", source: "来源" };
    const isRemoveRow = (row: RangeRow): row is RentalCalendarRangeRemovePreview["days"][number] =>
      "hasOverride" in row;
    if (mode === "remove") {
      return [
        { title: t("日期"), dataIndex: "date", width: 110 },
        {
          title: t("有覆盖"),
          dataIndex: "hasOverride",
          width: 70,
          render: (value: boolean) => (value ? <Tag color="volcano">{t("是")}</Tag> : <Tag>{t("否")}</Tag>),
        },
        {
          title: t("当前值"),
          render: (_, row) => {
            const status = "conflict" in row ? row.current.businessStatus ?? (row.current.closed ? "closed" : "open") : row.current.businessStatus ?? (row.current.closed ? "closed" : "open");
            return (
              <Typography.Text className="text-meta">
                {dayLabel(row.current.dayType)} · {statusLabel(status)}
              </Typography.Text>
            );
          },
        },
        {
          title: t("移除后恢复为"),
          render: (_, row) =>
            isRemoveRow(row) && row.hasOverride ? (
              <Space size={4}>
                <Tag color={row.restoredSource === "official_cn" ? "geekblue" : "default"}>
                  {row.restoredSource === "official_cn" ? t("官方日历") : t("每周模板")}
                </Tag>
                <Typography.Text className="text-meta">
                  {dayLabel(row.restored.dayType)} · {row.restored.name}
                </Typography.Text>
              </Space>
            ) : (
              <Typography.Text type="secondary">{t("保持不变")}</Typography.Text>
            ),
        },
      ];
    }
    const isOverrideRow = (row: RangeRow): row is RentalCalendarRangeOverridePreview["days"][number] => "conflict" in row;
    const overrideColumns: ColumnsType<RentalCalendarRangeOverridePreview["days"][number]> = [
      { title: t("日期"), dataIndex: "date", width: 110 },
      {
        title: t("冲突"),
        dataIndex: "conflict",
        width: 70,
        render: (value: boolean) => (value ? <Tag color="volcano">{t("已有覆盖")}</Tag> : <Tag>{t("无")}</Tag>),
      },
      {
        title: t("基础值（模板/官方）"),
        render: (_, raw) => {
          if (!isOverrideRow(raw)) return null;
          const row = raw;
          return (
            <Typography.Text className="text-meta">
              {dayLabel(row.base.dayType)} · {statusLabel(row.base.businessStatus ?? (row.base.closed ? "closed" : "open"))}
              {row.base.hours?.windows?.length ? ` · ${row.base.hours.windows.map((w) => `${w.start}-${w.end}`).join("、")}` : ""}
            </Typography.Text>
          );
        },
      },
      {
        title: t("当前生效值"),
        render: (_, raw) => {
          if (!isOverrideRow(raw)) return null;
          const row = raw;
          return (
            <Typography.Text className="text-meta">
              {dayLabel(row.current.dayType)} · {statusLabel(row.current.businessStatus ?? (row.current.closed ? "closed" : "open"))}
              {row.current.hours?.windows?.length ? ` · ${row.current.hours.windows.map((w) => `${w.start}-${w.end}`).join("、")}` : ""}
            </Typography.Text>
          );
        },
      },
      {
        title: t("应用后"),
        render: (_, raw) => {
          if (!isOverrideRow(raw)) return null;
          const row = raw;
          return (
            <Typography.Text className="text-meta">
              {dayLabel(row.after.dayType)} · {statusLabel(row.after.businessStatus ?? (row.after.closed ? "closed" : "open"))}
              {row.after.hours?.windows?.length ? ` · ${row.after.hours.windows.map((w) => `${w.start}-${w.end}`).join("、")}` : ""}
              {row.after.pricingOverrideRef ? ` · ${t("特殊价格引用")} ${row.after.pricingOverrideRef}` : ""}
            </Typography.Text>
          );
        },
      },
      {
        title: t("将替换的字段"),
        dataIndex: "changedFields",
        render: (value: string[]) => value.map((field) => <Tag key={field}>{t(fieldLabels[field] ?? field)}</Tag>),
      },
    ];
    return overrideColumns as ColumnsType<RangeRow>;
  }, [mode, t]);

  const previewData: RangeRow[] | undefined =
    mode === "override" ? overridePreview?.days : removePreview?.days;
  const operationError = applyMutation.error ?? previewMutation.error;
  const isFieldError = operationError && typeof operationError === "object" && "errorFields" in operationError;
  const busy = previewMutation.isPending || applyMutation.isPending;

  return (
    <Modal presentation="side"
      title={mode === "override" ? `${t("新增日期范围覆盖")} · ${year} ${t("年")}` : `${t("移除日期范围覆盖")} · ${year} ${t("年")}`}
      width={880}
      open={open}
      onCancel={close}
      afterClose={reset}
      closable={!busy}
      keyboard={!busy}
      maskClosable={!busy}
      destroyOnHidden
      footer={
        step === "input" ? (
          <><Button disabled={busy} onClick={close}>{t("取消")}</Button><ActionButton key="preview" label={t("预览影响")} pending={previewMutation.isPending} onAction={() => previewMutation.mutateAsync()} /></>
        ) : (
          <>
            <Button disabled={busy} onClick={() => { setStep("input"); setConflictAcknowledged(false); applyMutation.reset(); }}>{t("返回修改")}</Button>
            {mode === "override" ? (
              <ActionButton key="apply" intent="confirm" label={`${t("确认应用")}（${overridePreview?.totalDays ?? 0} ${t("天")}）`} pending={applyMutation.isPending} disabled={needsAck} onAction={() => applyMutation.mutateAsync()} />
            ) : (
              <ActionButton key="remove" intent="confirm" label={`${t("确认移除")}（${removePreview?.overrideCount ?? 0} ${t("天")}）`} pending={applyMutation.isPending} onAction={() => applyMutation.mutateAsync()} />
            )}
          </>
        )
      }
    >
      {operationError && !isFieldError && <Alert type="error" showIcon title={t("日历操作未完成")} description={errorText(operationError, operationError.message || t("请检查输入后重试"))} />}
      <div hidden={step === "preview"}>
      <Form form={form} layout="vertical" disabled={busy || step === "preview"} initialValues={{ hoursStart: "09:00", hoursEnd: "18:00" }} onValuesChange={() => { previewMutation.reset(); applyMutation.reset(); }}>
        <FormSection title={t("覆盖范围")}>
        <Form.Item
          name="range"
          label={t("日期范围（同一自然年内；跨年度请按年度分两次提交）")}
          rules={[{ required: true, message: t("请选择日期范围") }]}
        >
          <DatePicker.RangePicker
            style={{ width: "100%" }}
            format="YYYY-MM-DD"
            minDate={dayjs(`${year}-01-01`)}
            maxDate={dayjs(`${year}-12-31`)}
          />
        </Form.Item>
        {mode === "override" && (
          <>
            <Form.Item label={t("按日期时间选择范围（可选）")} tooltip={t("日历字段按整天生效；起止时点会记录到覆盖范围并在日期详情展示，一次性价格覆盖的时段语义由价格模块承接。")}>
              <Checkbox
                checked={useDatetime}
                onChange={(event) => setUseDatetime(event.target.checked)}
              >
                {t("指定开始与结束时点")}
              </Checkbox>
            </Form.Item>
            {useDatetime && <Form.Item name="dateTimeRange" label={t("起止时点")} rules={[{ required: true, message: t("日期时间范围必须同时提供开始与结束时点") }]}>
              <DatePicker.RangePicker showTime format="YYYY-MM-DD HH:mm" />
            </Form.Item>}
          </>
        )}
        </FormSection>
        {mode === "override" && <FormSection title={t("要设置的字段（未勾选字段保持原值）")}>
            <Space size={16} wrap className={styles.fieldChoices}>
              {(
                [
                  ["dayType", t("日期类型")],
                  ["name", t("名称")],
                  ["pricingOverrideRef", t("一次性价格引用")],
                  ["businessStatus", t("营业状态")],
                  ["hours", t("营业时段")],
                ] as Array<[FieldKey, string]>
              ).map(([key, label]) => (
                <Checkbox
                  key={key}
                  checked={selectedFields[key]}
                  onChange={(event) => setSelectedFields((previous) => ({ ...previous, [key]: event.target.checked }))}
                >
                  {label}
                </Checkbox>
              ))}
            </Space>
            {selectedFields.dayType && (
              <Form.Item name="dayType" label={t("日期类型")} rules={[{ required: selectedFields.dayType }]}>
                <Select options={dayTypeOptions.map((option) => ({ ...option, label: t(option.label) }))} />
              </Form.Item>
            )}
            {selectedFields.name && (
              <Form.Item name="name" label={t("名称（节日 / 调休 / 特殊日名）")} rules={[{ required: selectedFields.name }]}>
                <Input />
              </Form.Item>
            )}
            {selectedFields.pricingOverrideRef && (
              <Form.Item name="pricingOverrideRef" label={t("一次性价格引用")} tooltip={t("填写基础定价中一次性特殊价格规则的引用标识；价格值仍由商品价格版本维护。")} rules={[{ required: selectedFields.pricingOverrideRef }]}>
                <Input placeholder="例如 NATIONAL-DAY-2026" />
              </Form.Item>
            )}
            {selectedFields.businessStatus && (
              <Form.Item name="businessStatus" label={t("营业状态")} rules={[{ required: selectedFields.businessStatus }]}>
                <Select options={businessStatusOptions.map((option) => ({ ...option, label: t(option.label) }))} />
              </Form.Item>
            )}
            {selectedFields.hours && (
              <Space size={16} wrap>
                <Form.Item name="hoursStart" label={t("营业开始")} rules={[{ required: selectedFields.hours }]}>
                  <TimeInput label={t("营业开始")} />
                </Form.Item>
                <Form.Item name="hoursEnd" label={t("营业结束")} rules={[{ required: selectedFields.hours }]}>
                  <TimeInput label={t("营业结束")} />
                </Form.Item>
              </Space>
            )}
            {selectedFields.pricingOverrideRef && <Alert type="info" showIcon title={t("一次性特殊价格由价格模块提供")} description={t("价格值由价格计划维护；日历范围覆盖只保存一次性价格规则的稳定引用，不保存商品价格或空间统一系数。")} />}
            <Form.Item
              name="overrideReason"
              label={t("调整原因（必填，随本批全部日期一起记录）")}
              rules={[{ required: true, message: t("请填写调整原因") }]}
              style={{ marginTop: 16 }}
            >
              <Input maxLength={191} />
            </Form.Item>
          </FormSection>}
        {mode === "remove" && (
          <Form.Item
            name="overrideReason"
            label={t("移除原因（必填）")}
            rules={[{ required: true, message: t("请填写移除原因") }]}
          >
            <Input maxLength={191} />
          </Form.Item>
        )}
      </Form>
      </div>

      {step === "preview" && (
        <Space orientation="vertical" size={12} style={{ width: "100%", marginTop: 8 }}>
          <Alert
            type={needsAck ? "warning" : "info"}
            showIcon
            title={
              mode === "override"
                ? `${t("预览：共")} ${overridePreview?.totalDays ?? 0} ${t("天，其中")} ${overridePreview?.conflictCount ?? 0} ${t("天已有人工覆盖")}`
                : `${t("移除预览：范围内")} ${removePreview?.overrideCount ?? 0} ${t("天有人工覆盖，其余保持不变")}`
            }
            description={
              mode === "override"
                ? t("请核对以下日期的变化。其他人已修改日历时，本次应用会被拒绝，需要重新预览。")
                : t("移除后日期恢复到官方日历或每周模板；只影响范围内的已有覆盖，不会产生空白日。")
            }
          />
          {needsAck && (
            <Alert
              type="warning"
              showIcon
              title={`${t("有")} ${conflicts.length} ${t("天已存在人工覆盖，必须明确确认后才能应用")}`}
              description={`${t("冲突日期")}：${conflicts.map((row) => row.date).join("、")}。${t("应用会替换这些日期上现有人工覆盖的原因与取值（历史审计保留在覆盖审计流水里）。")}`}
              action={
                <Checkbox disabled={applyMutation.isPending} checked={conflictAcknowledged} onChange={(event) => setConflictAcknowledged(event.target.checked)}>
                  {t("我已确认替换上述日期的现有人工覆盖")}
                </Checkbox>
              }
            />
          )}
          <Table
            rowKey="date"
            size="small"
            dataSource={previewData}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            columns={previewColumns}
            scroll={{ y: 360 }}
          />
        </Space>
      )}
    </Modal>
  );
}
