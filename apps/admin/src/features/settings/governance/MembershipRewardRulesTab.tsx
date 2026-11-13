import { ActionButton, FormSection, SaveButton } from "@/components/ui";
import { SettingsGroups } from "@/components/settings/SettingsWorkspace";
import { WorkspacePageActions } from "@/components/workspace/WorkspaceHeader";
import { useQuery } from "@tanstack/react-query";
import type { TenantRentalBusinessSettings } from "@rental-os/shared";
import { Col, InputNumber, Row, Space } from "antd";
import { App, Form } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Select } from "@/components/ui";
import { useServerFormSync } from "@/app/useServerFormSync";
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
  const { message } = App.useApp();
  const [form] = Form.useForm<MembershipSettingsFormValues>();
  const signupType = Form.useWatch(["membership", "signupRewardType"], form);
  const referralType = Form.useWatch(["membership", "referralRewardType"], form);
  const signupCouponId = Form.useWatch(["membership", "signupRewardCouponTemplateId"], form);
  const referralCouponId = Form.useWatch(["membership", "referralRewardCouponTemplateId"], form);
  const signupCouponRequired = Form.useWatch((values: MembershipSettingsFormValues) => Boolean(values.membership?.signupRewardEnabled
    && values.membership.signupRewardType === "coupon" && values.membership.signupRewardAmount > 0), form);
  const referralCouponRequired = Form.useWatch((values: MembershipSettingsFormValues) => Boolean(values.membership?.referralRewardEnabled
    && values.membership.referralRewardType === "coupon" && Math.max(values.membership.referrerRewardAmount, values.membership.inviteeRewardAmount) > 0), form);
  const needsCouponTemplates = signupType === "coupon" || referralType === "coupon";
  const isCurrent = useServerFormSync(form, settings, () => {
    form.setFieldsValue({ membership: settings.membership });
  });
  const saveCurrent = async (values: MembershipSettingsFormValues) => {
    if (!isCurrent()) {
      const reason = t("服务端配置已变更，未保存的内容已保留。请重新打开本页核对后再保存。");
      message.warning(reason); throw new Error(reason);
    }
    return onSave(values);
  };

  const couponTemplates = useQuery({
    queryKey: ["rental-core", "coupon-templates"],
    queryFn: rentalCoreApi.couponTemplates,
    enabled: permissions.canSeeSettings && needsCouponTemplates,
  });
  const activeCouponOptions = (couponTemplates.data ?? [])
    .filter((item) => item.status === "active" || item.id === signupCouponId || item.id === referralCouponId)
    .map((item) => ({ value: item.id, label: item.status === "active" ? item.name : `${item.name} · ${t("已停用")}`, disabled: item.status !== "active" }));
  const amountLabel = (type?: string) => type === "balance"
    ? t("奖励金额（{currency}）", { currency: settings.pricing.currency })
    : t(type === "coupon" ? "奖励券数量" : "奖励积分");
  return (
    <Form<MembershipSettingsFormValues> form={form} layout="vertical" disabled={saving} onFinish={values => { void saveCurrent(values).catch(() => undefined); }}>
      <WorkspacePageActions><SaveButton label={t("保存本页")} form={form} pending={saving} onSave={saveCurrent} /></WorkspacePageActions>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        title={t("注册、实名审核和首单完成会自动触发奖励判断")}
        description={t("人工补发、客户权益账户与奖励流水在「会员激励」页维护。营销余额属于客户权益，不是支付机构资金账户。")}
      />
      {needsCouponTemplates && couponTemplates.isError && <Alert type="error" showIcon title={t("奖励券模板读取失败，请刷新后重试")} action={<ActionButton variant="secondary" label={t("重试")} onAction={() => couponTemplates.refetch({ throwOnError: true })} />} />}
      <SettingsGroups>
          <FormSection title={t("注册赠礼")}>
            <Form.Item
              name={["membership", "signupRewardEnabled"]}
              label={t("启用注册赠礼")}
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
                  label={amountLabel(signupType)}
                  rules={[{ required: true, message: t("请填写奖励数量") }]}
                >
                  <InputNumber min={0} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name={["membership", "signupRewardCouponTemplateId"]}
              label={t("奖励券模板")}
              extra={t("启用优惠券奖励且发放数量大于 0 时，须选择进行中的券模板。")}
              hidden={signupType !== "coupon"}
              dependencies={[["membership", "signupRewardEnabled"], ["membership", "signupRewardType"], ["membership", "signupRewardAmount"]]}
              rules={[{ required: signupCouponRequired, message: t("优惠券奖励必须选择进行中的券模板") }]}
            >
              <Select allowClear options={activeCouponOptions} loading={couponTemplates.isFetching} disabled={couponTemplates.isError}
                notFoundContent={!couponTemplates.isFetching && !activeCouponOptions.length ? t("暂无进行中的奖励券模板") : undefined} />
            </Form.Item>
          </FormSection>
          <FormSection title={t("邀请奖励")}>
            <Form.Item
              name={["membership", "referralRewardEnabled"]}
              label={t("启用邀请奖励")}
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
                <Form.Item
                  name={["membership", "referralRewardType"]}
                  label={t("奖励类型")}
                >
                  <Select
                    options={["points", "balance", "coupon"].map(
                      (value) => ({ value, label: t(rewardTypeLabels[value] ?? value) }),
                    )}
                  />
                </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name={["membership", "referrerRewardAmount"]}
                  label={`${t("邀请人")} · ${amountLabel(referralType)}`}
                  rules={[{ required: true, message: t("请填写奖励数量") }]}
                >
                  <InputNumber min={0} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name={["membership", "inviteeRewardAmount"]}
                  label={`${t("被邀请人")} · ${amountLabel(referralType)}`}
                  rules={[{ required: true, message: t("请填写奖励数量") }]}
                >
                  <InputNumber min={0} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name={["membership", "referralRewardCouponTemplateId"]}
              label={t("奖励券模板")}
              extra={t("启用优惠券奖励且发放数量大于 0 时，须选择进行中的券模板。")}
              hidden={referralType !== "coupon"}
              dependencies={[["membership", "referralRewardEnabled"], ["membership", "referralRewardType"], ["membership", "referrerRewardAmount"], ["membership", "inviteeRewardAmount"]]}
              rules={[{ required: referralCouponRequired, message: t("优惠券奖励必须选择进行中的券模板") }]}
            >
              <Select allowClear options={activeCouponOptions} loading={couponTemplates.isFetching} disabled={couponTemplates.isError}
                notFoundContent={!couponTemplates.isFetching && !activeCouponOptions.length ? t("暂无进行中的奖励券模板") : undefined} />
            </Form.Item>
          </FormSection>
      </SettingsGroups>
      </Space>
    </Form>
  );
}
