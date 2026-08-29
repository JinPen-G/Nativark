import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import {
  ApplyRentalCalendarRangeOverrideResult,
  ApplyRentalCalendarRangeRemoveResult,
  RentalCalendarBusinessStatus,
  RentalCalendarRangeOverridePreview,
  RentalCalendarRangeRemovePreview,
  RentalDayType,
} from "@store-rental/shared";
import { rentalCoreApi } from "@/api/rentalCore";

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

type FieldKey = "dayType" | "name" | "pricingMultiplier" | "businessStatus" | "hours";

/** 需求 4.5.9：周期性分时价格由 PRICE-03 价格计划维护，月历只消费其只读摘要。 */
function PricePlaceholder() {
  return (
    <Alert
      type="info"
      showIcon
      message="一次性特殊价格由价格模块提供"
      description="价格覆盖由价格计划维护；当前范围覆盖只支持日历字段（类型/状态/时段/系数）。请在基础定价页面创建调价计划，以便预览、确认并形成不可变价格版本。"
    />
  );
}

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
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [step, setStep] = useState<"input" | "preview">("input");
  const [overridePreview, setOverridePreview] = useState<RentalCalendarRangeOverridePreview>();
  const [removePreview, setRemovePreview] = useState<RentalCalendarRangeRemovePreview>();
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);
  const [useDatetime, setUseDatetime] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Record<FieldKey, boolean>>({
    dayType: true,
    name: false,
    pricingMultiplier: false,
    businessStatus: false,
    hours: false,
  });

  const reset = () => {
    setStep("input");
    setOverridePreview(undefined);
    setRemovePreview(undefined);
    setConflictAcknowledged(false);
    setUseDatetime(false);
    form.resetFields();
  };

  const close = () => {
    reset();
    onClose();
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      const values = form.getFieldsValue(true) as {
        range?: [Dayjs, Dayjs];
        startDateTime?: Dayjs;
        endDateTime?: Dayjs;
        dayType?: RentalDayType;
        name?: string;
        pricingMultiplier?: number;
        businessStatus?: RentalCalendarBusinessStatus;
        hoursStart?: string;
        hoursEnd?: string;
        overrideReason?: string;
      };
      const [start, end] = values.range ?? [];
      if (!start || !end) throw new Error("请选择日期范围");
      if (mode === "override" && useDatetime && (!values.startDateTime || !values.endDateTime)) {
        throw new Error("日期时间范围必须同时提供开始与结束时点");
      }
      const startDate = start.format("YYYY-MM-DD");
      const endDate = end.format("YYYY-MM-DD");
      const payload = {
        startDate,
        endDate,
        startDateTime: mode === "override" && useDatetime ? values.startDateTime?.toISOString() : undefined,
        endDateTime: mode === "override" && useDatetime ? values.endDateTime?.toISOString() : undefined,
        ...(mode === "override"
          ? {
              fields: {
                ...(selectedFields.dayType ? { dayType: values.dayType } : {}),
                ...(selectedFields.name ? { name: values.name } : {}),
                ...(selectedFields.pricingMultiplier ? { pricingMultiplier: values.pricingMultiplier } : {}),
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
          throw new Error("至少选择并填写一个要设置的字段");
        }
        if (!values.overrideReason?.trim()) throw new Error("请填写调整原因");
        return rentalCoreApi.calendarRangePreview(year, payload as Parameters<typeof rentalCoreApi.calendarRangePreview>[1]);
      }
      return rentalCoreApi.calendarRangeRemovePreview(year, payload);
    },
    onSuccess: (data) => {
      setConflictAcknowledged(false);
      if (mode === "override") setOverridePreview(data as RentalCalendarRangeOverridePreview);
      else setRemovePreview(data as RentalCalendarRangeRemovePreview);
      setStep("preview");
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const values = form.getFieldsValue(true) as {
        range?: [Dayjs, Dayjs];
        startDateTime?: Dayjs;
        endDateTime?: Dayjs;
        dayType?: RentalDayType;
        name?: string;
        pricingMultiplier?: number;
        businessStatus?: RentalCalendarBusinessStatus;
        hoursStart?: string;
        hoursEnd?: string;
        overrideReason?: string;
      };
      const [start, end] = values.range ?? [];
      if (!start || !end) throw new Error("请选择日期范围");
      const startDate = start.format("YYYY-MM-DD");
      const endDate = end.format("YYYY-MM-DD");
      if (mode === "override") {
        return rentalCoreApi.calendarRangeApply(year, {
          startDate,
          endDate,
          startDateTime: useDatetime ? values.startDateTime?.toISOString() : undefined,
          endDateTime: useDatetime ? values.endDateTime?.toISOString() : undefined,
          fields: {
            ...(selectedFields.dayType ? { dayType: values.dayType } : {}),
            ...(selectedFields.name ? { name: values.name } : {}),
            ...(selectedFields.pricingMultiplier ? { pricingMultiplier: values.pricingMultiplier } : {}),
            ...(selectedFields.businessStatus ? { businessStatus: values.businessStatus } : {}),
            ...(selectedFields.hours && values.hoursStart && values.hoursEnd
              ? { hours: { windows: [{ start: values.hoursStart, end: values.hoursEnd }] } }
              : {}),
          },
          overrideReason: values.overrideReason!.trim(),
          expectedRevision: currentRevision,
          // 已在预览步确认过冲突：预览展示冲突且用户点击「确认覆盖」才会走到这里。
          overrideConfirmed: conflictAcknowledged || undefined,
        });
      }
      return rentalCoreApi.calendarRangeRemove(year, {
        startDate,
        endDate,
        overrideReason: values.overrideReason!.trim(),
        expectedRevision: currentRevision,
      });
    },
    onSuccess: (result) => {
      message.success(
        mode === "override"
          ? `范围覆盖已应用：${(result as ApplyRentalCalendarRangeOverrideResult).appliedCount} 天，批次 ${(result as ApplyRentalCalendarRangeOverrideResult).batchId}`
          : `范围移除完成：恢复 ${(result as ApplyRentalCalendarRangeRemoveResult).removedCount} 天`
      );
      queryClient.invalidateQueries({ queryKey: ["rental-core", "calendar", year] });
      onApplied(result, mode);
      close();
    },
  });

  const conflicts = overridePreview?.days.filter((row) => row.conflict) ?? [];
  const needsAck = mode === "override" && (overridePreview?.conflictCount ?? 0) > 0 && !conflictAcknowledged;

  const previewColumns = useMemo<ColumnsType<RangeRow>>(() => {
    const isRemoveRow = (row: RangeRow): row is RentalCalendarRangeRemovePreview["days"][number] =>
      "hasOverride" in row;
    if (mode === "remove") {
      return [
        { title: "日期", dataIndex: "date", width: 110 },
        {
          title: "有覆盖",
          dataIndex: "hasOverride",
          width: 70,
          render: (value: boolean) => (value ? <Tag color="volcano">是</Tag> : <Tag>否</Tag>),
        },
        {
          title: "当前值",
          render: (_, row) => {
            const status = "conflict" in row ? row.current.businessStatus ?? (row.current.closed ? "closed" : "open") : row.current.businessStatus ?? (row.current.closed ? "closed" : "open");
            return (
              <Typography.Text style={{ fontSize: 12 }}>
                {row.current.dayType} · {status}
              </Typography.Text>
            );
          },
        },
        {
          title: "移除后恢复为",
          render: (_, row) =>
            isRemoveRow(row) && row.hasOverride ? (
              <Space size={4}>
                <Tag color={row.restoredSource === "official_cn" ? "geekblue" : "default"}>
                  {row.restoredSource === "official_cn" ? "官方日历" : "每周模板"}
                </Tag>
                <Typography.Text style={{ fontSize: 12 }}>
                  {row.restored.dayType} · {row.restored.name}
                </Typography.Text>
              </Space>
            ) : (
              <Typography.Text type="secondary">保持不变</Typography.Text>
            ),
        },
      ];
    }
    const isOverrideRow = (row: RangeRow): row is RentalCalendarRangeOverridePreview["days"][number] => "conflict" in row;
    const overrideColumns: ColumnsType<RentalCalendarRangeOverridePreview["days"][number]> = [
      { title: "日期", dataIndex: "date", width: 110 },
      {
        title: "冲突",
        dataIndex: "conflict",
        width: 70,
        render: (value: boolean) => (value ? <Tag color="volcano">已有覆盖</Tag> : <Tag>无</Tag>),
      },
      {
        title: "基础值（模板/官方）",
        render: (_, raw) => {
          if (!isOverrideRow(raw)) return null;
          const row = raw;
          return (
            <Typography.Text style={{ fontSize: 12 }}>
              {row.base.dayType} · {row.base.businessStatus ?? (row.base.closed ? "closed" : "open")}
              {row.base.hours?.windows?.length ? ` · ${row.base.hours.windows.map((w) => `${w.start}-${w.end}`).join("、")}` : ""}
            </Typography.Text>
          );
        },
      },
      {
        title: "当前生效值",
        render: (_, raw) => {
          if (!isOverrideRow(raw)) return null;
          const row = raw;
          return (
            <Typography.Text style={{ fontSize: 12 }}>
              {row.current.dayType} · {row.current.businessStatus ?? (row.current.closed ? "closed" : "open")}
              {row.current.hours?.windows?.length ? ` · ${row.current.hours.windows.map((w) => `${w.start}-${w.end}`).join("、")}` : ""}
            </Typography.Text>
          );
        },
      },
      {
        title: "应用后",
        render: (_, raw) => {
          if (!isOverrideRow(raw)) return null;
          const row = raw;
          return (
            <Typography.Text style={{ fontSize: 12 }}>
              {row.after.dayType} · {row.after.businessStatus ?? (row.after.closed ? "closed" : "open")}
              {row.after.hours?.windows?.length ? ` · ${row.after.hours.windows.map((w) => `${w.start}-${w.end}`).join("、")}` : ""}
              {` · ×${row.after.pricingMultiplier}`}
            </Typography.Text>
          );
        },
      },
      {
        title: "将替换的字段",
        dataIndex: "changedFields",
        render: (value: string[]) => value.map((field) => <Tag key={field}>{field}</Tag>),
      },
    ];
    return overrideColumns as ColumnsType<RangeRow>;
  }, [mode]);

  const previewData: RangeRow[] | undefined =
    mode === "override" ? overridePreview?.days : removePreview?.days;

  return (
    <Drawer
      title={mode === "override" ? `新增日期范围覆盖 · ${year} 年` : `移除日期范围覆盖 · ${year} 年`}
      width={880}
      open={open}
      onClose={close}
      destroyOnHidden
      extra={
        step === "input" ? (
          <Button type="primary" loading={previewMutation.isPending} onClick={() => previewMutation.mutate()}>
            预览影响
          </Button>
        ) : (
          <Space>
            <Button onClick={() => setStep("input")}>返回修改</Button>
            {mode === "override" ? (
              <Button type="primary" danger={needsAck} loading={applyMutation.isPending} disabled={needsAck} onClick={() => applyMutation.mutate()}>
                确认应用（{overridePreview?.totalDays ?? 0} 天）
              </Button>
            ) : (
              <Button type="primary" loading={applyMutation.isPending} onClick={() => applyMutation.mutate()}>
                确认移除（{removePreview?.overrideCount ?? 0} 天）
              </Button>
            )}
          </Space>
        )
      }
    >
      <Form form={form} layout="vertical" initialValues={{ hoursStart: "09:00", hoursEnd: "18:00" }}>
        <Form.Item
          name="range"
          label="日期范围（同一自然年内；跨年度请按年度分两次提交）"
          rules={[{ required: true, message: "请选择日期范围" }]}
        >
          <DatePicker.RangePicker
            style={{ width: "100%" }}
            format="YYYY-MM-DD"
            onChange={() => {
              // 起点变化后把时间范围约束到新年度：跨年请求会被后端拒绝，提前限制减少无效提交。
              const [start] = form.getFieldValue("range") ?? [];
              if (start) {
                form.setFieldValue("range", [start, endOfYearIfDifferent(start, form.getFieldValue("range")?.[1])]);
              }
            }}
            disabledDate={(current) => current.year() !== form.getFieldValue("range")?.[0]?.year() && Boolean(form.getFieldValue("range")?.[0])}
          />
        </Form.Item>
        {mode === "override" && (
          <>
            <Form.Item label="按日期时间选择范围（可选）" tooltip="日历字段按整天生效；起止时点会记录到覆盖范围并在日期详情展示，一次性价格覆盖的时段语义由价格模块承接。">
              <Checkbox
                checked={useDatetime}
                onChange={(event) => setUseDatetime(event.target.checked)}
              >
                指定开始与结束时点
              </Checkbox>
            </Form.Item>
            {useDatetime && (
              <Space size={16} wrap>
                <Form.Item name="startDateTime" label="开始时点" rules={[{ required: useDatetime }]}>
                  <DatePicker showTime format="YYYY-MM-DD HH:mm" />
                </Form.Item>
                <Form.Item name="endDateTime" label="结束时点" rules={[{ required: useDatetime }]}>
                  <DatePicker showTime format="YYYY-MM-DD HH:mm" />
                </Form.Item>
              </Space>
            )}
            <Divider titlePlacement="left">要设置的字段（未勾选字段保持原值）</Divider>
            <Space size={24} wrap>
              {(
                [
                  ["dayType", "日期类型"],
                  ["name", "名称"],
                  ["pricingMultiplier", "价格系数"],
                  ["businessStatus", "营业状态"],
                  ["hours", "营业时段"],
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
              <Form.Item name="dayType" label="日期类型" rules={[{ required: selectedFields.dayType }]}>
                <Select options={dayTypeOptions} />
              </Form.Item>
            )}
            {selectedFields.name && (
              <Form.Item name="name" label="名称（节日 / 调休 / 特殊日名）" rules={[{ required: selectedFields.name }]}>
                <Input />
              </Form.Item>
            )}
            {selectedFields.pricingMultiplier && (
              <Form.Item name="pricingMultiplier" label="价格系数" tooltip="留空不改动；这是既有的一次性特殊价格系数位，逐商品的日期价格与分时价格由 PRICE-03 承接。" rules={[{ required: selectedFields.pricingMultiplier }]}>
                <InputNumber min={0} step={0.05} style={{ width: 160 }} />
              </Form.Item>
            )}
            {selectedFields.businessStatus && (
              <Form.Item name="businessStatus" label="营业状态" rules={[{ required: selectedFields.businessStatus }]}>
                <Select options={businessStatusOptions} />
              </Form.Item>
            )}
            {selectedFields.hours && (
              <Space size={16} wrap>
                <Form.Item name="hoursStart" label="营业开始" rules={[{ required: selectedFields.hours }]}>
                  <Input placeholder="09:00" />
                </Form.Item>
                <Form.Item name="hoursEnd" label="营业结束" rules={[{ required: selectedFields.hours }]}>
                  <Input placeholder="18:00" />
                </Form.Item>
              </Space>
            )}
            <Alert
              style={{ marginBottom: 16 }}
              type="info"
              showIcon
              message="价格说明"
              description="本抽屉不设置商品价格，也不会因为价格时段把整天改成假日；周期性分时价格由价格计划维护（PRICE-03）。"
            />
            <PricePlaceholder />
            <Form.Item
              name="overrideReason"
              label="调整原因（必填，随本批全部日期一起记录）"
              rules={[{ required: true, message: "请填写调整原因" }]}
              style={{ marginTop: 16 }}
            >
              <Input maxLength={191} />
            </Form.Item>
          </>
        )}
        {mode === "remove" && (
          <Form.Item
            name="overrideReason"
            label="移除原因（必填）"
            rules={[{ required: true, message: "请填写移除原因" }]}
          >
            <Input maxLength={191} />
          </Form.Item>
        )}
      </Form>

      {step === "preview" && (
        <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 8 }}>
          <Alert
            type={needsAck ? "warning" : "info"}
            showIcon
            message={
              mode === "override"
                ? `预览：共 ${overridePreview?.totalDays ?? 0} 天，其中 ${overridePreview?.conflictCount ?? 0} 天已有人工覆盖`
                : `移除预览：范围内 ${removePreview?.overrideCount ?? 0} 天有人工覆盖，其余保持不变`
            }
            description={
              mode === "override"
                ? "应用将一次性写入全部日期（共用原因、批次与操作时间，只推进一次版本修订）；与他人的并发编辑会返回 409，请刷新后重试。"
                : "移除后日期恢复到官方日历或每周模板；只影响范围内的已有覆盖，不会产生空白日。"
            }
          />
          {needsAck && (
            <Alert
              type="warning"
              showIcon
              message={`有 ${conflicts.length} 天已存在人工覆盖，必须明确确认后才能应用`}
              description={`冲突日期：${conflicts.map((row) => row.date).join("、")}。应用会替换这些日期上现有人工覆盖的原因与取值（历史审计保留在覆盖审计流水里）。`}
              action={
                <Checkbox checked={conflictAcknowledged} onChange={(event) => setConflictAcknowledged(event.target.checked)}>
                  我已确认替换上述日期的现有人工覆盖
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
    </Drawer>
  );
}

/** 把范围终点约束到与起点同年度（需求 4.5.9：整日覆盖不得跨年度）。 */
function endOfYearIfDifferent(start: Dayjs, end?: Dayjs): Dayjs {
  if (!end || end.year() !== start.year() || end.isBefore(start)) {
    return start.endOf("year");
  }
  return end;
}
