import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Col, Form, InputNumber, Row, Select, Space, Switch } from "antd";
import { rentalCoreApi } from "@/api/rentalCore";
import { rewardTypeLabels } from "./ruleOptionLabels";
import type { GovernancePermissions } from "./shared";

/**
 * 「会员奖励规则」页签：注册赠礼与邀请奖励的触发条件与额度。
 *
 * 这些字段属于租户经营设置（`settings.membership.*`），与其他页签一样绑定外壳的
 * settingsForm、由页头「保存租户设置」统一提交。人工补发奖励、权益账户与奖励流水
 * 不是配置而是经营事实，已拆到「会员与客户 → 会员激励」独立页面。
 */
export function MembershipRewardRulesTab({ permissions }: { permissions: GovernancePermissions }) {
  const couponTemplates = useQuery({
    queryKey: ["rental-core", "coupon-templates"],
    queryFn: rentalCoreApi.couponTemplates,
    enabled: permissions.canSeeSettings,
  });
  const activeCouponOptions = (couponTemplates.data ?? [])
    .filter((item) => item.status === "active")
    .map((item) => ({ value: item.id, label: item.name }));
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        title="注册、实名审核和首单完成会自动触发奖励判断"
        description="这里只配置奖励规则；人工补发、客户权益账户与奖励流水在「会员与客户 → 会员激励」页维护。积分、营销余额和奖励券会进入 Rental Core 权益账户；营销余额不是支付机构资金账户。"
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
                      (value) => ({ value, label: rewardTypeLabels[value] ?? value }),
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
              <Select allowClear options={activeCouponOptions} />
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
                      (value) => ({ value, label: rewardTypeLabels[value] ?? value }),
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
              <Select allowClear options={activeCouponOptions} />
            </Form.Item>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
