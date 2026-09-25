import { SaveOutlined } from "@ant-design/icons";
import { DEFAULT_RENTAL_PAYMENT_METHODS, RENTAL_CURRENCY_CODES, RENTAL_CURRENCY_META, RENTAL_PAYMENT_METHOD_CODES, RENTAL_PRICING_UNIT_LABELS } from "@rental-os/shared";
import type { RentalCategoryDefinition, TenantRentalBusinessSettings } from "@rental-os/shared";
import { Alert, Button, Card, Col, Form, InputNumber, Row, Select, Space, Switch, Tag, Typography } from "antd";
import { useEffect } from "react";
import { useLocale } from "@/app/locale";
import type { GovernanceTabContext } from "./shared";

const PAYMENT_METHOD_LABELS: Record<(typeof RENTAL_PAYMENT_METHOD_CODES)[number], string> = {
  offline_cash: "线下现金",
  offline_transfer: "线下转账",
  alipay: "支付宝",
  wechat_pay: "微信支付",
};
const pricingUnitLabels = RENTAL_PRICING_UNIT_LABELS;
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
  onSave: (values: CategorySettingsFormValues) => void;
}) {
  const { t } = useLocale();
  const [form] = Form.useForm<CategorySettingsFormValues>();
  useEffect(() => {
    form.setFieldsValue({
      pricing: settings.pricing,
      payment: {
        ...settings.payment,
        enabledMethods: settings.payment.enabledMethods?.length
          ? settings.payment.enabledMethods
          : [...DEFAULT_RENTAL_PAYMENT_METHODS],
      },
      fulfillment: settings.fulfillment,
      allocation: settings.allocation ?? {
        autoPreassign: false,
        preassignDays: 7,
        autoLock: false,
        lockMinutes: 120,
        protectManual: true,
      },
    });
  }, [form, settings]);

  return (
    <Form<CategorySettingsFormValues> form={form} layout="vertical" onFinish={onSave}>
      <div className="table-toolbar">
        <Typography.Text type="secondary">{t("只保存本页配置")}</Typography.Text>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
          {t("保存本页")}
        </Button>
      </div>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        title={`${t(category.name)} · ${t("模型")} ${category.version}`}
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
            <Space wrap>
              {category.businessModel.locationTypes.map((value) => (
                <Tag key={value}>{t(value)}</Tag>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
      </Space>
    </Form>
  );
}
