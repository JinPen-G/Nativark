import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { RENTAL_PRICING_UNIT_LABELS, type RentalPricingGroup, type SaveRentalPricingGroupRequest } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Drawer, Form, Input, InputNumber, Select, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { resolveTenantNavigationLabels } from "@/app/navigation-terminology";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

export function PricingGroupPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<RentalPricingGroup>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<SaveRentalPricingGroupRequest>();
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const models = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const pricingGroups = useQuery({ queryKey: ["rental-core", "pricing-groups"], queryFn: rentalCoreApi.pricingGroups });
  const settings = useQuery({ queryKey: ["rental-core", "business-settings"], queryFn: rentalCoreApi.businessSettings });
  const versions = useQuery({ queryKey: ["rental-core", "price-versions"], queryFn: () => rentalCoreApi.priceVersions(1, 100) });
  const currentVersion = versions.data?.rows.find((row) => !dayjs(row.effectiveFrom).isAfter(dayjs()));
  const currentVersionDetail = useQuery({
    queryKey: ["rental-core", "price-version", currentVersion?.sequence],
    queryFn: () => rentalCoreApi.priceVersion(currentVersion!.sequence),
    enabled: Boolean(currentVersion)
  });
  const save = useMutation({
    mutationFn: rentalCoreApi.savePricingGroup,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "pricing-groups"] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "pricing-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-versions"] })
      ]);
      setOpen(false);
      setEditing(undefined);
      form.resetFields();
      message.success("定价分组已保存");
    },
    onError: () => message.error("保存失败，请检查编码、成员型号和库存方式")
  });
  const rows = useMemo(
    () => (pricingGroups.data ?? []).filter((row) => `${row.code}${row.name}${row.members.map((item) => item.name).join("")}`.toLowerCase().includes(keyword.toLowerCase())),
    [pricingGroups.data, keyword]
  );
  const routeLabel = resolveTenantNavigationLabels(profile.data?.terminology).routes.pricingGroups ?? "定价分组";

  function edit(record?: RentalPricingGroup) {
    setEditing(record);
    form.setFieldsValue(record ? {
      id: record.id,
      code: record.code,
      name: record.name,
      description: record.description,
      defaultPricingUnit: record.defaultPricingUnit,
      memberItemGroupIds: record.memberItemGroupIds,
      status: record.status
    } : {
      code: "",
      name: "",
      memberItemGroupIds: [],
      initialRates: [{ unit: settings.data?.pricing.defaultUnit ?? "calendar_day", baseAmount: 0 }],
      status: "enabled"
    });
    setOpen(true);
  }

  return <>
    <PageHeader
      title={routeLabel}
      description={`建立面向客户的${profile.data?.terminology.itemLabel ?? "商品"}价格档位，并选择可承接该档位的${profile.data?.terminology.itemGroupLabel ?? "产品型号"}。`}
      note={{
        title: "定价分组不是产品型号",
        description: "例如“舒适轿车组”可包含宝马 3 系、奔驰 C 级。一个型号可进入多个分组，但资产与库存只维护一份，报价后由系统选择实际承接型号。"
      }}
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>新增定价分组</Button>}
    />
    <Card className="data-panel">
      <Input allowClear prefix={<SearchOutlined />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索分组或成员型号" style={{ width: 320, marginBottom: 16 }} />
      <QueryState loading={pricingGroups.isLoading || models.isLoading} error={pricingGroups.error || models.error}>
        <Table<RentalPricingGroup> rowKey="id" dataSource={rows} columns={[
          { title: "定价分组", render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code} · v{row.version}</span></> },
          { title: `包含的${profile.data?.terminology.itemGroupLabel ?? "产品型号"}`, render: (_, row) => <Space size={[4, 4]} wrap>{row.members.length ? row.members.map((member) => <Tag color="blue" key={member.id}>{member.name} · {member.code}</Tag>) : <Tag>未配置</Tag>}</Space> },
          { title: "默认计价", render: (_, row) => row.defaultPricingUnit ? RENTAL_PRICING_UNIT_LABELS[row.defaultPricingUnit] : "跟随价格配置" },
          { title: "当前基本价", render: (_, row) => {
            const rates = (currentVersionDetail.data?.rates ?? []).filter((rate) => (rate.pricingGroupId ?? rate.itemGroupId) === row.id);
            return rates.length ? <Space size={[4, 4]} wrap>{rates.map((rate) => <Tag color="processing" key={`${rate.itemGroupId}:${rate.unit}`}>¥{rate.baseAmount.toFixed(2)} / {RENTAL_PRICING_UNIT_LABELS[rate.unit]}</Tag>)}</Space> : <Tag color="warning">历史分组未配置</Tag>;
          } },
          { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{value === "enabled" ? "启用" : "停用"}</Tag> },
          { title: "操作", width: 100, render: (_, row) => <Button type="link" icon={<EditOutlined />} onClick={() => edit(row)}>编辑</Button> }
        ]} />
      </QueryState>
    </Card>
    <Drawer title={editing ? "编辑定价分组" : "新增定价分组"} size={640} open={open} destroyOnHidden onClose={() => setOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存</Button>}>
      <Form<SaveRentalPricingGroupRequest> form={form} layout="vertical" onFinish={(values) => save.mutate({ ...values, id: editing?.id, defaultPricingUnit: editing ? values.defaultPricingUnit : values.initialRates?.[0]?.unit })}>
        <Form.Item name="code" label="分组编码" rules={[{ required: true }]}><Input disabled={Boolean(editing)} placeholder="COMFORT_SEDAN" /></Form.Item>
        <Form.Item name="name" label="分组名称" rules={[{ required: true }]}><Input placeholder="舒适轿车组" /></Form.Item>
        <Form.Item name="memberItemGroupIds" label={`包含的${profile.data?.terminology.itemGroupLabel ?? "产品型号"}`} rules={[{ required: true, type: "array", min: 1 }]} extra="同一型号可以加入多个定价分组；库存不会因此复制。">
          <Select mode="multiple" showSearch={{ optionFilterProp: "label" }} optionRender={(option) => {
            const model = (models.data ?? []).find((item) => item.id === option.value);
            const specification = model ? [model.attributes.manufacturer, model.attributes.brand, model.attributes.model, model.attributes.trim].filter(Boolean).join(" · ") : "";
            return <Space orientation="vertical" size={0}><span>{option.label}</span>{specification && <span className="muted">{specification}</span>}</Space>;
          }} options={(models.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))} />
        </Form.Item>
        {!editing && <Card size="small" title="基本价" style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary">只需选择计价单位并填写对应价格。第一行作为该分组的默认计价单位。</Typography.Paragraph>
          <Form.List
            name="initialRates"
            rules={[{ validator: async (_, value) => {
              if (!value?.length) throw new Error("至少填写一条基本价");
              if (new Set(value.map((row: { unit?: string }) => row.unit)).size !== value.length) throw new Error("同一个计价单位不能重复");
            } }]}
          >
            {(fields, { add, remove }, { errors }) => <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              {fields.map((field, index) => <Space key={field.key} align="start" style={{ width: "100%" }}>
                <Form.Item name={[field.name, "unit"]} label={index === 0 ? "计价单位（默认）" : "计价单位"} rules={[{ required: true, message: "请选择计价单位" }]}>
                  <Select style={{ width: 220 }} options={(settings.data?.pricing.enabledUnits ?? []).map((value) => ({ value, label: RENTAL_PRICING_UNIT_LABELS[value] ?? value }))} />
                </Form.Item>
                <Form.Item name={[field.name, "baseAmount"]} label="价格" rules={[{ required: true, message: "请填写价格" }]}>
                  <InputNumber min={0} precision={2} prefix="¥" style={{ width: 220 }} />
                </Form.Item>
                <Button danger type="text" aria-label="删除基本价" icon={<DeleteOutlined />} disabled={fields.length === 1} onClick={() => remove(field.name)} style={{ marginTop: 30 }} />
              </Space>)}
              <Form.ErrorList errors={errors} />
              <Button icon={<PlusOutlined />} disabled={fields.length >= (settings.data?.pricing.enabledUnits.length ?? 0)} onClick={() => add({ unit: undefined, baseAmount: 0 })}>增加计价单位</Button>
            </Space>}
          </Form.List>
        </Card>}
        {editing && <Form.Item name="defaultPricingUnit" label="默认计价单位"><Select allowClear options={(settings.data?.pricing.enabledUnits ?? []).map((value) => ({ value, label: RENTAL_PRICING_UNIT_LABELS[value] ?? value }))} /></Form.Item>}
        <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item>
      </Form>
    </Drawer>
  </>;
}
