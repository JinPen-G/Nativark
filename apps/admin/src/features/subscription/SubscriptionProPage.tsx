import { useState } from "react";
import { Card, Descriptions, Space, Tag, Typography } from "antd";
import { Empty } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Button } from "@/components/ui";
import { Select } from "@/components/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SubscriptionPlan, SubscriptionRequestStatus, SubscriptionRequestType, type SubscriptionFeatureEntitlement } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { SubscriptionRequestModal } from "./SubscriptionRequestModal";
import { ENTITLEMENT_SOURCE_LABEL, PLAN_LABEL, RELEASE_STATUS_LABEL, formatMoney } from "./subscriptionLabels";
import { groupSubscriptionFeatures, subscriptionError } from "./subscriptionOperations";

export function SubscriptionProPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const canManage = useAuthStore((state) => state.hasPermission("rental-os:subscription:manage"));
  const userId = useAuthStore((state) => state.user?.id);
  const tenantId = useAuthStore((state) => state.tenant?.tenantId);
  const query = useQuery({ queryKey: ["subscription", "tenant-view", tenantId, userId], queryFn: subscriptionApi.tenantView, enabled: Boolean(tenantId && userId) });
  const [consulting, setConsulting] = useState(false);
  const [category, setCategory] = useState<string>();
  const categories = [...new Set(query.data?.entitlements.flatMap((f) => f.categories) ?? [])];
  const features = query.data?.entitlements.filter((f) => !category || !f.categories.length || f.categories.includes(category)) ?? [];
  const groups = groupSubscriptionFeatures(features);
  const openConsult = query.data?.requests.find((r) => r.type === SubscriptionRequestType.UpgradeConsult && r.status === SubscriptionRequestStatus.Pending);

  function featureBlock(title: string, entries: SubscriptionFeatureEntitlement[], description: string) {
    return <Card size="small" title={`${t(title)}（${entries.length}）`}>
      <Typography.Paragraph type="secondary">{t(description)}</Typography.Paragraph>
      {!entries.length ? <Empty description={t("暂无该类功能")} /> : <Descriptions column={1} size="small" items={entries.map((feature) => ({
        key: feature.code, label: feature.name,
        children: <Space orientation="vertical" size={4}>
          <Space wrap><Tag>{t(ENTITLEMENT_SOURCE_LABEL[feature.source])}</Tag><Tag>{t(RELEASE_STATUS_LABEL[feature.releaseStatus])}</Tag><span>{feature.module} · {feature.categories.join(" / ")}</span></Space>
          {feature.valueText && <span>{feature.valueText}</span>}
          <Typography.Text type="secondary">{t(feature.needsConfig ? "需先配置空间及业务条件" : feature.available ? "已获资格，可按权限申请启用" : "当前不可新增使用；仍须满足授权、品类及配置条件")}</Typography.Text>
          {feature.externalFeeNote && <Typography.Text type="secondary">{feature.externalFeeNote}</Typography.Text>}
        </Space>
      }))} />}
    </Card>;
  }

  return <PageHeader title="PRO 介绍与版本对比" description="当前权益按本租户的公共权益与额外授权展示；功能上线不等于 PRO 正式销售开放。"
    extra={<Button onClick={() => navigate(APP_ROUTES.subscription.path)}>{t("返回版本与订阅")}</Button>}
    view={<QueryState loading={query.isLoading}>
      {query.error ? <Alert type="error" message={subscriptionError(query.error, t("订阅介绍加载失败"))} action={<Button onClick={() => query.refetch()}>{t("重试")}</Button>} />
        : query.data && <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Alert type="info" showIcon message={t("正式 PRO 销售尚未开放；四品类首批专业包及销售清单全部通过后才可正式收费。目前仅接受升级咨询或有明确范围的受控试点，不自动收款或开通。")} />
          <Card size="small" title={t("适用场景与范围")}>
            <Typography.Paragraph>{t("基础版保留已承诺的基础租赁经营闭环。PRO 规划面向项目协同、专业交接与养护等更复杂的经营需求，以下以实际发布目录为准；已有授权不重复作为升级卖点。")}</Typography.Paragraph>
            <Select allowClear style={{ minWidth: 200 }} placeholder={t("全部适用品类")} value={category} onChange={setCategory} options={categories.map((value) => ({ value, label: value }))} />
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>{t("查看某品类不表示已经营该品类；启用仍需相应空间、人员权限和业务准备。")}</Typography.Paragraph>
          </Card>
          {featureBlock("已上线且本租户已包含 / 已获授权", groups.included, "无需为这些权益重复升级；到期、空间配置和安全条件仍单独校验。")}
          {featureBlock("已上线的额外权益（仅咨询）", groups.additional, "这些功能尚未被本租户授权覆盖。单项上线不代表四品类 PRO 已正式可售。")}
          {featureBlock("受控试点", groups.pilot, "需明确申请、适用范围和未验证边界，不向所有 PRO 租户默认开放。")}
          {featureBlock("规划中", groups.planned, "不计入当前可购买或本次办理的交付承诺。")}
          {groups.unavailable.length > 0 && featureBlock("暂停 / 停止新使用", groups.unavailable, "保留历史查询与既有业务善后，不代表可以新增启用。")}
          <Card size="small" title={t("标准年费与费用边界")}>
            <Descriptions column={{ xs: 1, md: 2 }} items={[SubscriptionPlan.Standard, SubscriptionPlan.Pro].map((plan) => {
              const price = query.data.standardPricing.find((p) => p.plan === plan);
              return { key: plan, label: t(PLAN_LABEL[plan]), children: <Space orientation="vertical" size={0}><span>{price?.published ? formatMoney(price.annualFee, t("价格待公布")) : t("价格待公布")}</span>{price?.note && <Typography.Text type="secondary">{price.note}</Typography.Text>}</Space> };
            })} />
            <Typography.Text type="secondary">{t("有效基础版升级按相同计价口径核对剩余期间补差，保持统一截止。外部按量服务及硬件另计；不自动扣费、不默认试用。发布价格也不代表 PRO 销售条件已通过。")}</Typography.Text>
          </Card>
          <Card size="small" title={t("常见问题")}><Typography.Text type="secondary">{t("升级不改变历史报价、订单及空间配置。到期停止新业务，既有履约、退款及结算保留；重新授权后仍须核验依赖，不自动发布旧配置。")}</Typography.Text></Card>
          {query.data.overview.plan !== SubscriptionPlan.Pro && <Button type="primary" disabled={!canManage} onClick={() => openConsult ? navigate(`${APP_ROUTES.subscription.path}/requests/${encodeURIComponent(openConsult.id)}`) : setConsulting(true)}>{t(openConsult ? "查看咨询进度" : "提交升级咨询")}</Button>}
          {!canManage && <Typography.Text type="secondary">{t("请联系租户管理员办理咨询与续费。")}</Typography.Text>}
          <SubscriptionRequestModal open={consulting} type={SubscriptionRequestType.UpgradeConsult} onClose={() => setConsulting(false)} />
        </Space>}
    </QueryState>} />;
}
