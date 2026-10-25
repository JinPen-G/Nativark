import { CustomerPreview } from "@/features/membership/CustomerPreview";
import { DataTableMoney, ListFilters, ListSection, SaveButton, useListFilter } from "@/components/ui";
import { formatRentalMoney } from "@rental-os/shared";
import type { GrantRentalRewardRequest } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Space, Tag } from "antd";
import { App } from "@/components/ui";
import { Alert, Button, Form, Input, Select, Table } from "@/components/ui";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const rewardLabels: Record<string, string> = { points: "积分", balance: "营销余额", coupon: "奖励券" };
const triggerLabels: Record<string, string> = { registration: "注册赠礼", identity_verified: "实名通过", first_order_completed: "首单完成", referral: "直接邀请补发" };

/**
 * 会员激励：人工补发奖励流水、客户权益账户与奖励流水。
 *
 * 从「品类与业务规则」拆出：奖励规则（注册赠礼、邀请奖励的触发与额度）仍是租户经营设置，
 * 留在治理页；这里是经营事实的查看与补偿入口。读写走空间级的 /rental/v1/rewards 与
 * /rental/v1/benefit-accounts，服务端守卫认 price:manage / rules:manage / system:params:manage，
 * 页面内判权与之同口径。
 */
export function MembershipRewardsPage() {
  const { message, modal } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canManagePrice = hasPermission("rental-os:price:manage");
  const canEditRules = hasPermission("rental-os:rules:manage");
  const canManageParams = hasPermission("system:params:manage");
  const canSeeRewards = canManagePrice || canEditRules || canManageParams;
  const [rewardForm] = Form.useForm<GrantRentalRewardRequest>();
  const rewards = useQuery({
    queryKey: ["rental-core", "rewards"],
    queryFn: () => rentalCoreApi.rewards(),
    enabled: canSeeRewards,
  });
  const benefitAccounts = useQuery({
    queryKey: ["rental-core", "benefit-accounts"],
    queryFn: () => rentalCoreApi.benefitAccounts(),
    enabled: canSeeRewards,
  });
  const accountFilter = useListFilter(benefitAccounts.data, { fields: row => [row.customerId] });
  const rewardFilter = useListFilter(rewards.data, { fields: row => [row.customerId, row.reason, row.idempotencyKey, t(rewardLabels[row.rewardType] ?? row.rewardType), t(triggerLabels[row.triggerType] ?? row.triggerType)], status: row => row.status });
  // 营销余额按空间结算币种显示；经营设置的读取只对价格/规则权限开放，
  // 只有平台参数权限的账号拿不到币种时退回无币种格式，不发注定 403 的请求。
  const settings = useQuery({
    queryKey: ["rental-core", "business-settings"],
    queryFn: rentalCoreApi.businessSettings,
    enabled: canManagePrice || canEditRules,
  });
  const currency = settings.data?.pricing.currency;
  const grantReward = useMutation({
    mutationFn: rentalCoreApi.grantReward,
    onSuccess: async () => {
      rewardForm.resetFields();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "rewards"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "benefit-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }),
      ]);
      message.success(t("奖励流水已按幂等键生成"));
    },
    onError: () =>
      message.error(t("生成失败：规则未启用、触发条件不匹配或参数不完整")),
  });
  const reverseReward = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rentalCoreApi.reverseReward(id, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "rewards"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "benefit-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }),
      ]);
      message.success(t("奖励已撤销并保留流水"));
    },
  });

  return (
    <>
      <PageHeader
        title={t("会员激励")}
        description={t("人工补发仅用于补偿；营销余额不是支付资金。")}
      />
      <QueryState loading={rewards.isLoading || benefitAccounts.isLoading} error={rewards.error || benefitAccounts.error} onRetry={() => Promise.all([rewards.refetch({ throwOnError: true }), benefitAccounts.refetch({ throwOnError: true })])}>
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Card title={t("人工补发奖励流水")}>
            <Form
              form={rewardForm}
              layout="inline"
              onFinish={(values) => grantReward.mutate(values)}
            >
              <Form.Item
                name="customerId"
                label={t("客户")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item name="triggerType" label={t("触发")}>
                <Select
                  style={{ width: "var(--rental-control-width-select)" }}
                  options={[
                    { value: "registration", label: t("注册赠礼") },
                    { value: "identity_verified", label: t("实名通过") },
                    { value: "first_order_completed", label: t("首单完成") },
                    { value: "referral", label: t("直接邀请补发") },
                  ]}
                />
              </Form.Item>
              <Form.Item name="relatedCustomerId" label={t("关联客户")}>
                <Input />
              </Form.Item>
              <Form.Item
                name="idempotencyKey"
                label={t("业务幂等键")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <SaveButton  label={t("生成并入账")} form={rewardForm} pending={grantReward.isPending} onSave={async values => { const operation = grantReward.mutateAsync(values); if (!operation) throw new Error("Operation unavailable"); return operation; }} />
            </Form>
          </Card>
          <ListSection title={t("客户权益账户")} controls={<ListFilters filter={accountFilter} placeholder="客户编号" />}>
            <Table
              rowKey="customerId"
              onRefresh={() => benefitAccounts.refetch()} loading={benefitAccounts.isFetching} dataSource={accountFilter.rows} pagination={accountFilter.pagination}
              locale={{ emptyText: t("还没有客户获得过积分、营销余额或奖励券") }}
              columns={[
                { title: t("客户"), dataIndex: "customerId", render: (_, row) => <CustomerPreview customerId={row.customerId} name={row.customerId} /> },
                { title: t("积分"), dataIndex: "pointsBalance", align: "right" },
                { title: t("营销余额"), dataIndex: "marketingBalance", align: "right", render: (value) => <DataTableMoney formatted={formatRentalMoney(Number(value), currency)} /> },
                { title: t("可用奖励券"), dataIndex: "availableRewardCouponCount", align: "right" },
                { title: t("更新时间"), dataIndex: "updatedAt" },
              ]}
            />
          </ListSection>
          <ListSection title={t("奖励流水")} controls={<ListFilters filter={rewardFilter} placeholder="客户编号、原因或幂等键" options={[{ value: "granted", label: "已发放" }, { value: "reversed", label: "已撤销" }]} />}>
            <Table
              rowKey="id"
              onRefresh={() => rewards.refetch()} loading={rewards.isFetching} dataSource={rewardFilter.rows} pagination={rewardFilter.pagination}
              locale={{ emptyText: t("还没有奖励流水：自动事件未触发，也没有人工补发") }}
              columns={[
                { title: t("客户"), dataIndex: "customerId", render: (_, row) => <CustomerPreview customerId={row.customerId} name={row.customerId} /> },
                {
                  title: t("奖励"),
                  render: (_, row) => <><span>{t(rewardLabels[row.rewardType] ?? row.rewardType)}</span>{" · "}{row.rewardType === "balance" ? <DataTableMoney formatted={formatRentalMoney(row.amount, currency)} /> : row.amount}</>,
                },
                { title: t("触发"), dataIndex: "triggerType", render: value => t(triggerLabels[value] ?? value) },
                { title: t("幂等键"), dataIndex: "idempotencyKey" },
                {
                  title: t("状态"),
                  dataIndex: "status",
                  render: (value) => <Tag color={value === "granted" ? "success" : "default"}>{t(value === "granted" ? "已发放" : value === "reversed" ? "已撤销" : value)}</Tag>,
                },
                { title: t("原因"), dataIndex: "reason" },
                {
                  title: t("操作"),
                  render: (_, row) =>
                    row.status === "granted" ? (
                      <Button
                        danger
                        type="link"
                        onClick={() =>
                          modal.confirm({
                            title: t("撤销奖励"),
                            content: t("撤销会保留原流水与撤销时间。"),
                            onOk: () =>
                              reverseReward.mutate({
                                id: row.id,
                                reason: t("运营人工撤销"),
                              }),
                          })
                        }
                      >
                        {t("撤销")}
                      </Button>
                    ) : (
                      "-"
                    ),
                },
              ]}
            />
          </ListSection>
        </Space>
      </QueryState>
    </>
  );
}
