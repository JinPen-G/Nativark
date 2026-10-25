import { SaveButton } from "@/components/ui";
import { SaveOutlined } from "@/components/ui/icons";
import { useQuery } from "@tanstack/react-query";
import type { TenantRentalBusinessSettings } from "@rental-os/shared";
import { Card, Col, InputNumber, Row, Space, Typography } from "antd";
import { Form } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Select } from "@/components/ui";
import { Button } from "@/components/ui";
import { useEffect } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { rewardTypeLabels } from "./ruleOptionLabels";
import type { GovernancePermissions, GovernanceTabContext } from "./shared";

/**
 * 「会员奖励规则」页签：注册赠礼与邀请奖励的触发条件与额度。
 *
 * 这些字段属于租户经营设置（`settings.membership.*`），但本页签独立持有表单和保存动作。
 * 人工补发奖励、权益账户与奖励流水不是配置而是经营事实，已拆到「会员与客户 → 会员激励」独立页面。
 */
export type MembershipSettingsFormValues = {
  membership: TenantRentalBusinessSettings["membership"];
};

export function MembershipRewardRulesTab({
  permissions,
  settings,
  onSave,
  saving,
}: Pick<GovernanceTabContext, "permissions" | "settings" | "saving"> & {
  onSave: (values: MembershipSettingsFormValues) => Promise<unknown>;
}) {
  const { t } = useLocale();
  const [form] = Form.useForm<MembershipSettingsFormValues>();
  useEffect(() => {
    form.setFieldsValue({ membership: settings.membership });
  }, [form, settings]);

  const couponTemplates = useQuery({
    queryKey: ["rental-core", "coupon-templates"],
    queryFn: rentalCoreApi.couponTemplates,
    enabled: permissions.canSeeSettings,
  });
  const activeCouponOptions = (couponTemplates.data ?? [])
    .filter((item) => item.status === "active")
    .map((item) => ({ value: item.id, label: item.name }));
  return (
    <Form<MembershipSettingsFormValues> form={form} layout="vertical" onFinish={values => { void onSave(values).catch(() => undefined); }}>
      <div className="table-toolbar">
        <Typography.Text type="secondary">{t("只保存本页配置")}</Typography.Text>
        <SaveButton label={t("保存本页")} form={form} pending={saving} onSave={onSave} />
      </div>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        title={t("注册、实名审核和首单完成会自动触发奖励判断")}
        description={t("这里只配置奖励规则；人工补发、客户权益账户与奖励流水在「会员与客户 → 会员激励」页维护。积分、营销余额和奖励券会进入 Rental Core 权益账户；营销余额不是支付机构资金账户。")}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title={t("注册赠礼")}>
            <Form.Item
              name={["membership", "signupRewardEnabled"]}
              label={t("启用")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name={["membership", "signupRewardType"]}
                  label={t("奖励类型")}
                >
                  <Select
                    options={["points", "balance", "coupon"].map(
                      (value) => ({ value, label: t(rewardTypeLabels[value] ?? value) }),
                    )}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name={["membership", "signupRewardAmount"]}
                  label={t("数量")}
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name={["membership", "signupRewardCouponTemplateId"]}
              label={t("赠送券模板（奖励类型为优惠券时必选）")}
            >
              <Select allowClear options={activeCouponOptions} />
            </Form.Item>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={t("邀请奖励")}>
            <Form.Item
              name={["membership", "referralRewardEnabled"]}
              label={t("启用")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name={["membership", "referralTrigger"]}
              label={t("奖励触发节点")}
            >
              <Select
                options={[
                  {
                    value: "registration",
                    label: t("被邀请人完成注册"),
                  },
                  {
                    value: "identity_verified",
                    label: t("被邀请人通过实名审核"),
                  },
                  {
                    value: "first_order_completed",
                    label: t("被邀请人完成首单"),
                  },
                ]}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item
                  name={["membership", "referralRewardType"]}
                  label={t("类型")}
                >
                  <Select
                    options={["points", "balance", "coupon"].map(
                      (value) => ({ value, label: t(rewardTypeLabels[value] ?? value) }),
                    )}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["membership", "referrerRewardAmount"]}
                  label={t("邀请人")}
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name={["membership", "inviteeRewardAmount"]}
                  label={t("被邀请人")}
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name={["membership", "referralRewardCouponTemplateId"]}
              label={t("邀请奖励券模板（奖励类型为优惠券时必选）")}
            >
              <Select allowClear options={activeCouponOptions} />
            </Form.Item>
          </Card>
        </Col>
      </Row>
      </Space>
    </Form>
  );
}
