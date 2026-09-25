import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { RENTAL_PRICING_UNIT_LABELS, formatRentalMoney, rentalCurrencySymbol, type RentalPricingGroup, type SaveRentalPricingGroupRequest, type UpdateRentalPricingGroupSecurityRatesRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Drawer, Form, Input, InputNumber, Select, Space, Table, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { resolveTenantNavigationLabels } from "@/app/navigation-terminology";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { toPricingGroupRequest, type PricingGroupFormValues } from "./pricing-group-initial-rate";
import { PRICE_VERSIONS_QUERY_KEY, usePriceVersions } from "./usePriceVersions";

export function PricingGroupPage() {
  const { message } = App.useApp();
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<RentalPricingGroup>();
  const [open, setOpen] = useState(false);
  const [securityEditing, setSecurityEditing] = useState<RentalPricingGroup>();
  const [securityOpen, setSecurityOpen] = useState(false);
  const [form] = Form.useForm<PricingGroupFormValues>();
  const [securityForm] = Form.useForm<UpdateRentalPricingGroupSecurityRatesRequest>();
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const models = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const pricingGroups = useQuery({ queryKey: ["rental-core", "pricing-groups"], queryFn: rentalCoreApi.pricingGroups });
  const settings = useQuery({ queryKey: ["rental-core", "business-settings"], queryFn: rentalCoreApi.businessSettings });
  const rules = useQuery({ queryKey: ["rental-core", "rule-versions"], queryFn: rentalCoreApi.ruleVersions });
  const currency = settings.data?.pricing.currency;
  const { currentVersionDetail } = usePriceVersions();
  // 已发布（含未来生效）与最新草稿都参与字段展示，避免先配价格后配资金规则时
  // 出现“发布被拒、页面却没有补录入口”的死锁。
  const rateRuleCandidates = (rules.data ?? []).filter((row) =>
    row.status === "published" || row.status === "pending" || row.status === "draft"
  );
  const depositModes = rateRuleCandidates.map((row) => {
    const legacyMode = row.config.payment.depositMode;
    return row.config.deposit?.mode ?? (legacyMode === "preauthorization" ? "none" : legacyMode ?? "none");
  });
  const preauthorizationModes = rateRuleCandidates.map((row) =>
    row.config.preauthorization?.mode ?? (row.config.payment.depositMode === "preauthorization" ? "fixed" : "none")
  );
  const securityRateFields = [
    ...(depositModes.includes("fixed") ? [{ name: "depositAmount", label: "每件固定押金" }] : []),
    ...(depositModes.includes("price_multiple") ? [{ name: "depositMultiple", label: "押金租金倍数" }] : []),
    ...(preauthorizationModes.includes("fixed") ? [{ name: "preAuthAmount", label: "每件预授权额度" }] : []),
    ...(preauthorizationModes.some((mode) => mode === "price_multiple" || mode === "risk_surcharge") ? [{ name: "preAuthMultiple", label: "预授权租金倍数" }] : [])
  ];
  const save = useMutation({
    mutationFn: rentalCoreApi.savePricingGroup,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "pricing-groups"] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "pricing-plans"] }),
        queryClient.invalidateQueries({ queryKey: PRICE_VERSIONS_QUERY_KEY })
      ]);
      setOpen(false);
      setEditing(undefined);
      form.resetFields();
      message.success(t("定价分组已保存"));
    },
    onError: () => message.error(t("保存失败，请检查编码、成员型号和库存方式"))
  });
  const saveSecurityRates = useMutation({
    mutationFn: (data: UpdateRentalPricingGroupSecurityRatesRequest) => rentalCoreApi.updatePricingGroupSecurityRates(securityEditing!.id, data),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PRICE_VERSIONS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-version"] })
      ]);
      setSecurityOpen(false);
      setSecurityEditing(undefined);
      securityForm.resetFields();
      message.success(t("资金费率已保存，新价格版本已生效") + ` · ${result.version}`);
    },
    onError: (error) => message.error(error instanceof Error ? error.message : t("资金费率保存失败，请检查规则与待生效调价"))
  });
  const rows = useMemo(
    () => (pricingGroups.data ?? []).filter((row) => `${row.code}${row.name}${row.members.map((item) => item.name).join("")}`.toLowerCase().includes(keyword.toLowerCase())),
    [pricingGroups.data, keyword]
  );
  const routeLabel = t(resolveTenantNavigationLabels(profile.data?.terminology).routes.pricingGroups ?? "定价分组");
  const itemLabel = t(profile.data?.terminology.itemLabel ?? "商品");
  const itemGroupLabel = t(profile.data?.terminology.itemGroupLabel ?? "产品型号");

  function edit(record?: RentalPricingGroup) {
    if (!settings.data || !rules.data) {
      const failed = settings.isError || rules.isError;
      message.error(t(failed ? "基础经营设置或业务规则读取失败，请刷新后重试" : "基础经营设置或业务规则仍在加载，请稍后重试"));
      return;
    }
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
      initialRates: [{ unit: settings.data?.pricing.defaultUnit ?? "calendar_day", baseAmount: 0, usagePrecision: 0, usageMode: "flat" }],
      status: "enabled"
    });
    setOpen(true);
  }

  function editSecurityRates(record: RentalPricingGroup) {
    const currentRates = (currentVersionDetail.data?.rates ?? [])
      .filter((rate) => (rate.pricingGroupId ?? rate.itemGroupId) === record.id)
      .map(({ unit, depositAmount, depositMultiple, preAuthAmount, preAuthMultiple }) => ({ unit, depositAmount, depositMultiple, preAuthAmount, preAuthMultiple }));
    if (!currentRates.length) {
      message.error(t("当前价格版本没有该定价组的费率，请先建立或发布基本价"));
      return;
    }
    if (!securityRateFields.length) {
      message.info(t("当前已发布或草稿规则没有按计价单位收取押金/预授权，无需配置此处费率"));
      return;
    }
    setSecurityEditing(record);
    securityForm.setFieldsValue({ rates: currentRates });
    setSecurityOpen(true);
  }

  return <>
    <PageHeader
      title={routeLabel}
      description={locale === "en-US" ? `Create customer-facing ${itemLabel} pricing tiers and select the ${itemGroupLabel} that can fulfill each tier.` : `建立面向客户的${itemLabel}价格档位，并选择可承接该档位的${itemGroupLabel}。`}
      note={{
        title: locale === "en-US" ? `A pricing group is not a ${itemGroupLabel}` : `定价分组不是${itemGroupLabel}`,
        description: locale === "en-US" ? `A pricing group can contain multiple ${itemGroupLabel}; the same ${itemGroupLabel} can belong to multiple pricing groups. Assets and inventory are maintained only once; the quote selects the actual fulfilling model.` : `一个定价分组可以包含多个${itemGroupLabel}；同一${itemGroupLabel}也可以加入多个定价分组。资产与库存始终只维护一份，报价后由系统选择实际承接型号。`
      }}
      extra={<Button type="primary" icon={<PlusOutlined />} disabled={settings.isLoading || settings.isError} onClick={() => edit()}>{t("新增定价分组")}</Button>}
    />
    <Card className="data-panel">
      <Input allowClear prefix={<SearchOutlined />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("搜索分组或成员型号")} style={{ width: 320, marginBottom: 16 }} />
      <QueryState loading={pricingGroups.isLoading || models.isLoading || settings.isLoading || rules.isLoading || currentVersionDetail.isLoading} error={pricingGroups.error || models.error || settings.error || rules.error || currentVersionDetail.error}>
        <Table<RentalPricingGroup> rowKey="id" dataSource={rows} columns={[
          { title: t("定价分组"), render: (_, row) => <><b>{row.name}</b><br /><span className="muted">{row.code} · v{row.version}</span></> },
          { title: `${t("包含的")}${itemGroupLabel}`, render: (_, row) => <Space size={[4, 4]} wrap>{row.members.length ? row.members.map((member) => <Tag color="processing" key={member.id}>{member.name} · {member.code}</Tag>) : <Tag>{t("未配置")}</Tag>}</Space> },
          { title: t("默认计价"), render: (_, row) => row.defaultPricingUnit ? t(RENTAL_PRICING_UNIT_LABELS[row.defaultPricingUnit] ?? row.defaultPricingUnit) : t("跟随价格配置") },
          { title: "当前基本价", render: (_, row) => {
            const rates = (currentVersionDetail.data?.rates ?? []).filter((rate) => (rate.pricingGroupId ?? rate.itemGroupId) === row.id);
            return rates.length ? <Space size={[4, 4]} wrap>{rates.map((rate) => <Tag color="processing" key={`${rate.itemGroupId}:${rate.unit}`}>{formatRentalMoney(rate.baseAmount, currency)} / {t(RENTAL_PRICING_UNIT_LABELS[rate.unit] ?? rate.unit)}</Tag>)}</Space> : <Tag color="warning">{t("历史分组未配置")}</Tag>;
          } },
          { title: t("状态"), dataIndex: "status", render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{t(value === "enabled" ? "启用" : "停用")}</Tag> },
          { title: t("操作"), width: 190, render: (_, row) => <Space>
            <Button type="link" icon={<EditOutlined />} onClick={() => edit(row)}>{t("编辑")}</Button>
            <Button type="link" disabled={!securityRateFields.length || !currentVersionDetail.data} onClick={() => editSecurityRates(row)}>{t("押金/预授权")}</Button>
          </Space> }
        ]} />
      </QueryState>
    </Card>
    <Drawer title={t(editing ? "编辑定价分组" : "新增定价分组")} size={640} open={open} destroyOnHidden onClose={() => setOpen(false)} extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>{t("保存")}</Button>}>
      <Form<PricingGroupFormValues> form={form} layout="vertical" onFinish={(values) => save.mutate(toPricingGroupRequest(values, editing?.id))}>
        <Form.Item name="code" label={t("分组编码")} rules={[{ required: true }]}><Input disabled={Boolean(editing)} placeholder="COMFORT_SEDAN" /></Form.Item>
        <Form.Item name="name" label={t("分组名称")} rules={[{ required: true }]}><Input placeholder={locale === "en-US" ? `e.g. Standard ${itemLabel} group` : `如：标准${itemLabel}分组`} /></Form.Item>
        <Form.Item name="memberItemGroupIds" label={`${t("包含的")}${itemGroupLabel}`} rules={[{ required: true, type: "array", min: 1 }]} extra={t("同一型号可以加入多个定价分组；库存不会因此复制。")}>
          <Select mode="multiple" showSearch={{ optionFilterProp: "label" }} optionRender={(option) => {
            const model = (models.data ?? []).find((item) => item.id === option.value);
            const specification = model ? [model.attributes.manufacturer, model.attributes.brand, model.attributes.model, model.attributes.trim].filter(Boolean).join(" · ") : "";
            return <Space orientation="vertical" size={0}><span>{option.label}</span>{specification && <span className="muted">{specification}</span>}</Space>;
          }} options={(models.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))} />
        </Form.Item>
        {!editing && <Card size="small" title={t("基本价")} style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary">{t("只需选择计价单位并填写对应价格。第一行作为该分组的默认计价单位。")}</Typography.Paragraph>
          <Form.List
            name="initialRates"
            rules={[{ validator: async (_, value) => {
              if (!value?.length) throw new Error(t("至少填写一条基本价"));
              if (new Set(value.map((row: { unit?: string }) => row.unit)).size !== value.length) throw new Error(t("同一个计价单位不能重复"));
            } }]}
          >
            {(fields, { add, remove }, { errors }) => <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              {fields.map((field, index) => <Space key={field.key} orientation="vertical" size={4} style={{ width: "100%" }}>
                <Space align="start" wrap style={{ width: "100%" }}>
                  <Form.Item name={[field.name, "unit"]} label={index === 0 ? t("计价单位（默认）") : t("计价单位")} rules={[{ required: true, message: t("请选择计价单位") }]}>
                    <Select style={{ width: 220 }} options={(settings.data?.pricing.enabledUnits ?? []).map((value) => ({ value, label: t(RENTAL_PRICING_UNIT_LABELS[value] ?? value) }))} />
                  </Form.Item>
                  <Form.Item name={[field.name, "baseAmount"]} label={t("价格")} rules={[{ required: true, message: t("请填写价格") }]}>
                    <InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: 220 }} />
                  </Form.Item>
                  <Button danger type="text" aria-label={t("删除基本价")} icon={<DeleteOutlined />} disabled={fields.length === 1} onClick={() => remove(field.name)} style={{ marginTop: 30 }} />
                </Space>
                {securityRateFields.length > 0 && <Card size="small" title={t("押金与预授权")} style={{ marginTop: 8 }}>
                  <Typography.Paragraph type="secondary">{t("按当前已生效的业务规则填写本计价单位需要的资金金额；押金是实收，预授权是冻结额度，两者分别计算。")}</Typography.Paragraph>
                  <Space align="start" wrap>
                    {securityRateFields.map((fieldConfig) => <Form.Item
                      key={fieldConfig.name}
                      name={[field.name, fieldConfig.name]}
                      label={t(fieldConfig.label)}
                      rules={[{ required: true, message: t("当前已生效规则要求填写此金额") }, { type: "number", min: 0.01, message: t("金额或倍数必须大于 0") }]}
                      extra={fieldConfig.name.toLowerCase().includes("multiple") ? t("按本行实际租金乘以该倍数") : t("启用对应规则时必须大于 0")}
                    >
                      <InputNumber min={0.01} precision={2} style={{ width: 220 }} />
                    </Form.Item>)}
                  </Space>
                </Card>}
                <Form.Item noStyle shouldUpdate={(previous, current) =>
                  previous.initialRates?.[field.name]?.unit !== current.initialRates?.[field.name]?.unit ||
                  previous.initialRates?.[field.name]?.usageMode !== current.initialRates?.[field.name]?.usageMode
                }>
                  {({ getFieldValue }) => getFieldValue(["initialRates", field.name, "unit"]) === "usage" && <Card size="small" title={t("用量计费规则")} style={{ marginTop: 8 }}>
                    <Typography.Paragraph type="secondary">{locale === "en-US" ? "Charge the base amount, include the configured quantity, then bill excess usage by the selected rule. Each started precision step is rounded up." : `基础价包含设定用量；超出部分按统一单价或分段累进计费。计量精度按“开始即计”向上进位（${t(profile.data?.terminology.usageMetricLabel ?? "使用量")}）。`}</Typography.Paragraph>
                    <Space align="start" wrap>
                      <Form.Item name={[field.name, "includedUsage"]} label={t("基础价包含用量")} extra={t("留空按 0 处理")}>
                        <InputNumber min={0} precision={2} style={{ width: 180 }} />
                      </Form.Item>
                      <Form.Item name={[field.name, "usagePrecision"]} label={t("用量计量精度")}>
                        <Select style={{ width: 220 }} options={[
                          { value: 0, label: locale === "en-US" ? "Whole unit" : "整数（每 1 单位进位）" },
                          { value: 1, label: locale === "en-US" ? "0.1 (round up per 0.1 unit)" : "0.1（每 0.1 单位进位）" },
                          { value: 2, label: locale === "en-US" ? "0.01 (round up per 0.01 unit)" : "0.01（每 0.01 单位进位）" }
                        ]} />
                      </Form.Item>
                      <Form.Item name={[field.name, "usageMode"]} label={t("超额计费方式")} rules={[{ required: true, message: t("请选择超额计费方式") }]}>
                        <Select style={{ width: 220 }} onChange={(mode: "flat" | "progressive") => {
                          if (mode === "progressive" && !form.getFieldValue(["initialRates", field.name, "tiers"])?.length) {
                            form.setFieldValue(["initialRates", field.name, "tiers"], [{ minUnits: 1, unitAmount: 0 }]);
                          }
                        }} options={[
                          { value: "flat", label: t("统一超额单价") },
                          { value: "progressive", label: t("超额分段累进") }
                        ]} />
                      </Form.Item>
                    </Space>
                    {getFieldValue(["initialRates", field.name, "usageMode"]) === "progressive" ? <Form.List
                      name={[field.name, "tiers"]}
                      rules={[{ validator: async (_, tiers: Array<{ minUnits?: number }> | undefined) => {
                        if (!tiers?.length || tiers[0].minUnits !== 1) throw new Error(t("分段累进第一档必须从第 1 个超额单位开始"));
                        if (new Set(tiers.map((tier) => tier.minUnits)).size !== tiers.length) throw new Error(t("阶梯起始单位不能重复"));
                      } }]}
                    >
                      {(tierFields, { add: addTier, remove: removeTier }, { errors: tierErrors }) => <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                        {tierFields.map((tierField, tierIndex) => <Space key={tierField.key} align="start" wrap>
                          <Form.Item name={[tierField.name, "minUnits"]} label={tierIndex === 0 ? t("起始超额单位（第一档固定为 1）") : t("起始超额单位")} rules={[{ required: true }, { type: "number", min: 1, message: t("起始单位必须大于 0") }]}>
                            <InputNumber min={1} precision={0} disabled={tierIndex === 0} style={{ width: 260 }} />
                          </Form.Item>
                          <Form.Item name={[tierField.name, "unitAmount"]} label={t("每单位价格")} rules={[{ required: true, message: t("请填写每单位价格") }]}>
                            <InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: 220 }} />
                          </Form.Item>
                          <Button danger type="text" aria-label={t("删除阶梯")} icon={<DeleteOutlined />} disabled={tierFields.length === 1 || tierIndex === 0} onClick={() => removeTier(tierField.name)} style={{ marginTop: 30 }} />
                        </Space>)}
                        <Form.ErrorList errors={tierErrors} />
                        <Button icon={<PlusOutlined />} onClick={() => {
                          const tiers = getFieldValue(["initialRates", field.name, "tiers"]) as Array<{ minUnits?: number }> | undefined;
                          const lastMinUnits = tiers?.[tiers.length - 1]?.minUnits ?? 1;
                          addTier({ minUnits: Math.max(2, lastMinUnits + 1), unitAmount: 0 });
                        }}>{t("增加价格档")}</Button>
                      </Space>}
                    </Form.List> : <Form.Item name={[field.name, "excessUsageAmount"]} label={t("超额单价（每单位）")} rules={[{ required: true, message: t("请填写超额单价") }]}>
                      <InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: 220 }} />
                    </Form.Item>}
                    <Form.Item name={[field.name, "maxAmount"]} label={t("单件本次租期封顶（可选）")} extra={t("留空表示不封顶；填 0 表示免租")}>
                      <InputNumber min={0} precision={2} prefix={rentalCurrencySymbol(currency)} style={{ width: 220 }} />
                    </Form.Item>
                  </Card>}
                </Form.Item>
              </Space>)}
              <Form.ErrorList errors={errors} />
              <Button icon={<PlusOutlined />} disabled={fields.length >= (settings.data?.pricing.enabledUnits.length ?? 0)} onClick={() => add({ unit: settings.data?.pricing.defaultUnit, baseAmount: 0, usagePrecision: 0, usageMode: "flat" })}>{t("增加计价单位")}</Button>
            </Space>}
          </Form.List>
        </Card>}
        {editing && <Form.Item name="defaultPricingUnit" label={t("默认计价单位")}><Select allowClear options={(settings.data?.pricing.enabledUnits ?? []).map((value) => ({ value, label: t(RENTAL_PRICING_UNIT_LABELS[value] ?? value) }))} /></Form.Item>}
        <Form.Item name="description" label={t("说明")}><Input.TextArea rows={3} /></Form.Item>
        <Form.Item name="status" label={t("状态")} rules={[{ required: true }]}><Select options={[{ value: "enabled", label: t("启用") }, { value: "disabled", label: t("停用") }]} /></Form.Item>
      </Form>
    </Drawer>
    <Drawer
      title={`${t("押金/预授权费率")} · ${securityEditing?.name ?? ""}`}
      size={640}
      open={securityOpen}
      destroyOnHidden
      onClose={() => setSecurityOpen(false)}
      extra={<Button type="primary" loading={saveSecurityRates.isPending} onClick={() => securityForm.submit()}>{t("保存并生成新价格版本")}</Button>}
    >
      <Typography.Paragraph type="secondary">
        {t("只调整本定价组的押金与预授权金额，不改基本租金。保存后会为整个经营空间追加新价格版本，历史版本和既有订单快照保持不变。")}
      </Typography.Paragraph>
      <Form<UpdateRentalPricingGroupSecurityRatesRequest> form={securityForm} layout="vertical" onFinish={(values) => saveSecurityRates.mutate(values)}>
        <Form.List name="rates">
          {(fields) => <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            {fields.map((field) => {
              const unit = securityForm.getFieldValue(["rates", field.name, "unit"]) as keyof typeof RENTAL_PRICING_UNIT_LABELS | undefined;
              return <Card size="small" key={field.key} title={t(unit ? RENTAL_PRICING_UNIT_LABELS[unit] : "计价单位")}>
                <Form.Item name={[field.name, "unit"]} hidden><Input /></Form.Item>
                <Space align="start" wrap>
                  {securityRateFields.map((fieldConfig) => <Form.Item
                    key={fieldConfig.name}
                    name={[field.name, fieldConfig.name]}
                    label={t(fieldConfig.label)}
                    rules={[{ required: true, message: t("当前业务规则要求填写此金额") }, { type: "number", min: 0.01, message: t("金额或倍数必须大于 0") }]}
                    extra={fieldConfig.name.toLowerCase().includes("multiple") ? t("按本行实际租金乘以该倍数") : t("启用对应规则时必须大于 0")}
                  >
                    <InputNumber min={0.01} precision={2} style={{ width: 240 }} />
                  </Form.Item>)}
                </Space>
              </Card>;
            })}
          </Space>}
        </Form.List>
      </Form>
    </Drawer>
  </>;
}
