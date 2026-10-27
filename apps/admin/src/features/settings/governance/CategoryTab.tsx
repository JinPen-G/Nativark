import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@/components/ui/icons";
import { DEFAULT_RENTAL_PAYMENT_METHODS, RENTAL_CURRENCY_CODES, RENTAL_CURRENCY_META, RENTAL_PAYMENT_METHOD_CODES, RENTAL_PRICING_UNIT_LABELS } from "@rental-os/shared";
import type { RentalCategoryDefinition, TenantRentalBusinessSettings } from "@rental-os/shared";
import { Card, Col, InputNumber, Row, Space, Tag, Typography } from "antd";
import { App, Form } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button, SaveButton } from "@/components/ui";
import { useServerFormSync } from "@/app/useServerFormSync";
import { useLocale } from "@/app/locale";
import type { GovernanceTabContext } from "./shared";
import { CategoryPreparationEntry } from "./CategoryPreparationDialog";

const PAYMENT_METHOD_LABELS: Record<(typeof RENTAL_PAYMENT_METHOD_CODES)[number], string> = {
  offline_cash: "线下现金",
  offline_transfer: "线下转账",
  alipay: "支付宝",
  wechat_pay: "微信支付",
};
const pricingUnitLabels = RENTAL_PRICING_UNIT_LABELS;
const locationTypeLabels: Record<string, string> = { store: "门店", warehouse: "仓库", station: "取还点", locker: "自提柜", delivery_hub: "配送中心", project_site: "项目现场" };
const modeLabels: Record<string, string> = {
  store_pickup_return: "门店取还",
  partner_pickup_return: "合作商取还",
  warehouse_pickup_return: "仓库取还",
  locker_pickup_return: "自提柜取还",
  delivery: "配送",
  onsite_delivery: "现场交付",
};

/**
 * 「品类与租赁方式」页签。
 *
 * 这里独立持有本页签表单。服务端仍用整体 business-settings 快照接口，
 * 但保存时只把本页字段作为 patch 交给外壳合并，其他页签不会被 UI 按钮隐式提交。
 */
export type CategorySettingsFormValues = {
  pricing: TenantRentalBusinessSettings["pricing"];
  payment: TenantRentalBusinessSettings["payment"];
  fulfillment: TenantRentalBusinessSettings["fulfillment"];
  allocation: NonNullable<TenantRentalBusinessSettings["allocation"]>;
};

export function CategoryTab({
  category,
  settings,
  onSave,
  saving,
}: Pick<GovernanceTabContext, "category" | "settings" | "saving"> & {
  onSave: (values: CategorySettingsFormValues) => Promise<unknown>;
}) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<CategorySettingsFormValues>();
  const isCurrent = useServerFormSync(form, settings, () => {
    form.setFieldsValue({
      pricing: settings.pricing,
      payment: {
        ...settings.payment,
        enabledMethods: settings.payment.enabledMethods?.length
          ? settings.payment.enabledMethods
          : [...DEFAULT_RENTAL_PAYMENT_METHODS],
      },
      fulfillment: {
        ...settings.fulfillment,
        deliveryServiceArea: settings.fulfillment.deliveryServiceArea ?? { mode: "all", areas: [] },
      },
      allocation: settings.allocation ?? {
        autoPreassign: false,
        preassignDays: 7,
        autoLock: false,
        lockMinutes: 120,
        protectManual: true,
      },
    });
  });
  const saveCurrent = async (values: CategorySettingsFormValues) => {
    if (!isCurrent()) {
      const reason = t("服务端配置已变更，未保存的内容已保留。请重新打开本页核对后再保存。");
      message.warning(reason); throw new Error(reason);
    }
    return onSave(values);
  };

  return (
    <Form<CategorySettingsFormValues> form={form} layout="vertical" onFinish={values => { void saveCurrent(values).catch(() => undefined); }}>
      <div className="table-toolbar">
        <Typography.Text type="secondary">{t("只保存本页配置")}</Typography.Text>
        <SaveButton label={t("保存本页")} form={form} pending={saving} onSave={saveCurrent} />
      </div>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <CategoryPreparationEntry />
      <Alert
        type="info"
        showIcon
        title={t(category.name)}
        description={t("经营品类创建后固定；租户只能在品类支持的计价、履约、库存、预授权和资质能力内配置。")}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Card title={t("计价方式")}>
              {/* 结算币种在租户开通时确定并跟随租户（需求 §948）：这里只展示。
                  允许在这里改会让同一空间的历史配置金额换一种含义，而配置里没有币种快照。 */}
              <Form.Item
                name={["pricing", "currency"]}
                label={t("结算币种")}
                tooltip={t("订单、报价与本空间所有配置金额的币种。开通租户时设定，此处不可修改。")}
              >
                <Select
                  disabled
                  options={RENTAL_CURRENCY_CODES.map((code) => ({
                    value: code,
                    label: `${code} · ${t(RENTAL_CURRENCY_META[code].label)}`,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name={["pricing", "enabledUnits"]}
                label={t("启用计价单位")}
              >
                <Select
                  mode="multiple"
                  options={category.businessModel.pricingUnits.map(
                    (value) => ({
                      value,
                      label: t(pricingUnitLabels[value] ?? value),
                    }),
                  )}
                />
              </Form.Item>
              <Form.Item
                name={["pricing", "defaultUnit"]}
                label={t("默认单位")}
              >
                <Select
                  options={category.businessModel.pricingUnits.map(
                    (value) => ({
                      value,
                      label: t(pricingUnitLabels[value] ?? value),
                    }),
                  )}
                />
              </Form.Item>
              <Form.Item
                name={["pricing", "holidayPricingEnabled"]}
                label={t("启用旧版周末/节假日倍率")}
                tooltip={t("兼容开关，只作用于价格里的旧字段「周末系数」「节假日系数」。关闭后这两个系数不再参与计价，落回商品基础价；逐商品配置的日期类型价格、周期性计价时段与一次性日期时间覆盖不受影响，照常生效。")}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </Card>
            <Card title={t("收款方式")}>
              {/* 支付时点、押金、预授权、异地归还与逾期计费都随报价进订单快照，事实源在「业务规则」页；
                  这里只保留不进快照的运行开关——空间实际开通哪些收款渠道。 */}
              <Form.Item
                name={["payment", "enabledMethods"]}
                label={t("启用收款方式")}
                tooltip={t("线下现金和线下转账可直接登记；支付宝、微信还必须在租户集成设置中完成账号配置、启用并通过实时校验后，客户端才会展示为可用。")}
              >
                <Select
                  mode="multiple"
                  options={RENTAL_PAYMENT_METHOD_CODES.map((value) => ({
                    value,
                    label: t(PAYMENT_METHOD_LABELS[value]),
                  }))}
                />
              </Form.Item>
              <Alert
                type="info"
                showIcon
                title={t("支付时点、押金与预授权、异地归还、逾期计费在「业务规则」页配置，发布后随订单快照冻结。")}
              />
            </Card>
          </Space>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={t("租赁与履约方式")}>
            <Form.Item name={["allocation", "autoPreassign"]} label={t("自动预分配资源")} valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name={["allocation", "preassignDays"]} label={t("提前预分配（天）")}><InputNumber min={0} max={365} precision={0} /></Form.Item>
            <Form.Item name={["allocation", "autoLock"]} label={t("到时自动锁定分配")} valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name={["allocation", "lockMinutes"]} label={t("领取前锁定（分钟）")}><InputNumber min={0} max={43200} precision={0} /></Form.Item>
            <Form.Item name={["allocation", "protectManual"]} label={t("保护人工分配结果")} valuePropName="checked"><Switch /></Form.Item>
            <Alert type="info" title={t("自动任务每分钟检查一次；不自动换掉锁定资源，不跨地点调拨，失败转待人工处理。")} style={{ marginBottom: 16 }} />
            <Form.Item
              name={["fulfillment", "enabledModes"]}
              label={t("启用方式")}
            >
              <Select
                mode="multiple"
                options={category.businessModel.fulfillmentModes.map(
                  (value) => ({
                    value,
                    label: t(modeLabels[value] ?? value),
                  }),
                )}
              />
            </Form.Item>
            <Form.Item
              name={["fulfillment", "deliveryServiceArea", "mode"]}
              label={t("本地配送服务范围")}
              tooltip={t("仅按客户填写的省、市、区县匹配，不调用地图或估算距离。配送固定费用和异地归还费用在定价计划中设置。")}
            >
              <Select
                onChange={(mode: "all" | "allowlist") => {
                  if (mode === "all") form.setFieldValue(["fulfillment", "deliveryServiceArea", "areas"], []);
                }}
                options={[
                  { value: "all", label: t("不限制地区") },
                  { value: "allowlist", label: t("仅限指定省市区") },
                ]}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(previous, current) =>
              previous.fulfillment?.deliveryServiceArea?.mode !== current.fulfillment?.deliveryServiceArea?.mode
            }>
              {({ getFieldValue }) => getFieldValue(["fulfillment", "deliveryServiceArea", "mode"]) === "allowlist" && (
                <Form.List
                  name={["fulfillment", "deliveryServiceArea", "areas"]}
                  rules={[
                    {
                      validator: async (_, areas: Array<{ province?: string; city?: string; district?: string }> | undefined) => {
                        if (!areas?.length || areas.some((area) => !area.province?.trim() || !area.city?.trim())) {
                          throw new Error(t("请至少添加一个完整的省、市；区县可留空表示全市"));
                        }
                        if (areas.length > 100) throw new Error(t("配送区域最多配置 100 条"));
                        const keys = areas.map((area) => [
                          area.province!.trim().toLocaleLowerCase(),
                          area.city!.trim().toLocaleLowerCase(),
                          area.district?.trim().toLocaleLowerCase() ?? "",
                        ].join("|"));
                        if (new Set(keys).size !== keys.length) throw new Error(t("配送区域不能重复"));
                      },
                    },
                  ]}
                >
                  {(fields, { add, remove }, { errors }) => (
                    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                      <Typography.Text type="secondary">
                        {t("区域按客户地址精确匹配。省、市必填；区县留空表示该市全域。")}
                      </Typography.Text>
                      {fields.map((field) => (
                        <Row gutter={[8, 8]} align="middle" key={field.key}>
                          <Col xs={24} md={7}>
                            <Form.Item name={[field.name, "province"]} style={{ marginBottom: 0 }}>
                              <Input maxLength={64} placeholder={t("省份/直辖市")} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={7}>
                            <Form.Item name={[field.name, "city"]} style={{ marginBottom: 0 }}>
                              <Input maxLength={64} placeholder={t("城市")} />
                            </Form.Item>
                          </Col>
                          <Col xs={20} md={7}>
                            <Form.Item name={[field.name, "district"]} style={{ marginBottom: 0 }}>
                              <Input maxLength={64} placeholder={t("区县，可留空")} />
                            </Form.Item>
                          </Col>
                          <Col xs={4} md={3}>
                            <Button
                              aria-label={t("删除配送区域")}
                              icon={<DeleteOutlined />}
                              onClick={() => remove(field.name)}
                            />
                          </Col>
                        </Row>
                      ))}
                      <Form.ErrorList errors={errors} />
                      <Button disabled={fields.length >= 100} icon={<PlusOutlined />} onClick={() => add({ province: "", city: "", district: "" })}>
                        {t("添加配送区域")}
                      </Button>
                    </Space>
                  )}
                </Form.List>
              )}
            </Form.Item>
            <Space wrap>
              {category.businessModel.locationTypes.map((value) => (
                <Tag key={value}>{t(locationTypeLabels[value] ?? value)}</Tag>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
      </Space>
    </Form>
  );
}
