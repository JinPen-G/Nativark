import { CustomerPreview } from "@/features/membership/CustomerPreview";
import { DataTableMoney, ListFilters, ListSection, SaveButton, useListFilter } from "@/components/ui";
import { formatRentalMoney } from "@rental-os/shared";
import type { GrantRentalRewardRequest, RentalRewardLedgerEntry } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tag } from "antd";
import { App } from "@/components/ui";
import { Alert, Button, Form, Input, Modal, Select, Table, Tabs } from "@/components/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import dayjs from "dayjs";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { RecordFacts } from "@/components/RecordDetailLayout";
import recordStyles from "@/components/RecordDetailLayout.module.css";

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
  const scope = useListQueryIdentity();
  return <MembershipRewardsWorkspace key={scope} scope={scope} />;
}

function MembershipRewardsWorkspace({ scope }: { scope: string }) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canManagePrice = hasPermission("rental-os:price:manage");
  const canEditRules = hasPermission("rental-os:rules:manage");
  const canManageParams = hasPermission("system:params:manage");
  const canSeeRewards = canManagePrice || canEditRules || canManageParams;
  const [view, setView] = useState("accounts");
  const [rewardOpen, setRewardOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<RentalRewardLedgerEntry>();
  const reverseDialog = useModalDismissal(Boolean(reverseTarget), () => setReverseTarget(undefined));
  const [rewardForm] = Form.useForm<GrantRentalRewardRequest>();
  const rewards = useQuery({
    queryKey: ["rental-core", "rewards", scope],
    queryFn: () => rentalCoreApi.rewards(),
    enabled: canSeeRewards,
  });
  const benefitAccounts = useQuery({
    queryKey: ["rental-core", "benefit-accounts", scope],
    queryFn: () => rentalCoreApi.benefitAccounts(),
    enabled: canSeeRewards,
  });
  const accountFilter = useListFilter(benefitAccounts.data, { fields: row => [row.customerId] });
  const rewardFilter = useListFilter(rewards.data, { fields: row => [row.customerId, row.reason, row.idempotencyKey, t(rewardLabels[row.rewardType] ?? row.rewardType), t(triggerLabels[row.triggerType] ?? row.triggerType)], status: row => row.status });
  // 营销余额按空间结算币种显示；经营设置的读取只对价格/规则权限开放，
  // 只有平台参数权限的账号拿不到币种时退回无币种格式，不发注定 403 的请求。
  const settings = useQuery({
    queryKey: ["rental-core", "business-settings", scope],
    queryFn: rentalCoreApi.businessSettings,
    enabled: canManagePrice || canEditRules,
  });
  const currency = settings.data?.pricing.currency;
  const grantReward = useMutation({
    mutationFn: rentalCoreApi.grantReward,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "rewards"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "benefit-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }),
      ]);
      setRewardOpen(false);
      message.success(t("奖励流水已按幂等键生成"));
    },
    onError: (error) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      message.error(t([400, 401, 403, 404, 409, 422].includes(status ?? 0) ? "生成失败：规则未启用、触发条件不匹配或参数不完整" : "补发结果暂未确认，请保留业务事件编号并核对流水"));
    },
  });
  const reverseReward = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rentalCoreApi.reverseReward(id, reason),
    onSuccess: async () => {
      reverseDialog.dismiss();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "rewards"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "benefit-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "customer-coupons"] }),
      ]);
      message.success(t("奖励已撤销并保留流水"));
    },
    onError: () => message.error(t("撤销结果暂未确认，请刷新流水核对")),
  });

  if (!canSeeRewards) return <Alert type="warning" showIcon title={t("无权查看会员激励")} />;

  return (
    <>
      <PageHeader
        title={t("会员激励")}
        description={t("人工补发仅用于补偿；营销余额不是支付资金。")}
        extra={<Button type="primary" icon={<Plus />} disabled={!canSeeRewards} onClick={() => setRewardOpen(true)}>{t("补发奖励")}</Button>}
      />
        <Tabs activeKey={view} onChange={setView} aria-label={t("会员激励")} items={[
        { key: "accounts", label: t("客户权益账户"), children:
          <QueryState loading={benefitAccounts.isLoading} error={benefitAccounts.error} onRetry={() => benefitAccounts.refetch({ throwOnError: true })}>
          <ListSection controls={<ListFilters filter={accountFilter} placeholder="客户编号" />}>
            <Table
              rowKey="customerId"
              onRefresh={() => benefitAccounts.refetch()} loading={benefitAccounts.isLoading} refreshing={benefitAccounts.isFetching} dataSource={accountFilter.rows} pagination={accountFilter.pagination}
              emptyScene={accountFilter.keyword ? "search" : "empty"} locale={{ emptyText: t(accountFilter.keyword ? "没有匹配的权益账户" : "还没有客户获得过积分、营销余额或奖励券") }}
              columns={[
                { title: t("客户"), dataIndex: "customerId", render: (_, row) => <CustomerPreview customerId={row.customerId} name={row.customerId} /> },
                { title: t("积分"), dataIndex: "pointsBalance", align: "right" },
                { title: t("营销余额"), dataIndex: "marketingBalance", align: "right", render: (value) => <DataTableMoney formatted={formatRentalMoney(Number(value), currency)} /> },
                { title: t("可用奖励券"), dataIndex: "availableRewardCouponCount", align: "right" },
                { title: t("更新时间"), dataIndex: "updatedAt", render: value => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—" },
              ]}
            />
          </ListSection></QueryState> },
        { key: "rewards", label: t("奖励流水"), children:
          <QueryState loading={rewards.isLoading} error={rewards.error} onRetry={() => rewards.refetch({ throwOnError: true })}>
          <ListSection controls={<ListFilters filter={rewardFilter} placeholder="客户编号、原因或业务事件编号" options={[{ value: "granted", label: "已发放" }, { value: "reversed", label: "已撤销" }]} />}>
            <Table
              rowKey="id"
              onRefresh={() => rewards.refetch()} loading={rewards.isLoading} refreshing={rewards.isFetching} dataSource={rewardFilter.rows} pagination={rewardFilter.pagination}
              emptyScene={rewardFilter.keyword || rewardFilter.status ? "search" : "empty"} locale={{ emptyText: t(rewardFilter.keyword || rewardFilter.status ? "没有匹配的奖励流水" : "还没有奖励流水：自动事件未触发，也没有人工补发") }}
              columns={[
                { title: t("客户"), dataIndex: "customerId", render: (_, row) => <CustomerPreview customerId={row.customerId} name={row.customerId} /> },
                {
                  title: t("奖励"),
                  render: (_, row) => <><span>{t(rewardLabels[row.rewardType] ?? row.rewardType)}</span>{" · "}{row.rewardType === "balance" ? <DataTableMoney formatted={formatRentalMoney(row.amount, currency)} /> : row.amount}</>,
                },
                { title: t("触发"), dataIndex: "triggerType", render: value => t(triggerLabels[value] ?? value) },
                { title: t("业务事件编号"), dataIndex: "idempotencyKey" },
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
                        disabled={reverseReward.isPending || rewards.isError}
                        onClick={() => setReverseTarget(row)}
                      >
                        {t("撤销")}
                      </Button>
                    ) : (
                      "-"
                    ),
                },
              ]}
            />
          </ListSection></QueryState> }
        ]} />
      <Modal title={t("人工补发奖励流水")} open={rewardOpen} onCancel={() => setRewardOpen(false)} destroyOnHidden
        closable={!grantReward.isPending} keyboard={!grantReward.isPending} maskClosable={!grantReward.isPending}
        afterClose={() => { if (grantReward.isSuccess) rewardForm.resetFields(); }}
        footer={<><Button disabled={grantReward.isPending} onClick={() => setRewardOpen(false)}>{t("取消")}</Button><SaveButton label={t("生成并入账")} form={rewardForm} disabled={!canSeeRewards} pending={grantReward.isPending} onSave={values => grantReward.mutateAsync(values)} /></>}>
        <Alert type="info" showIcon title={t("人工补发仅用于补偿；营销余额不是支付资金。")} style={{ marginBottom: "var(--space-4)" }} />
        <Form form={rewardForm} layout="vertical" disabled={!canSeeRewards || grantReward.isPending} onFinish={values => grantReward.mutate(values)}>
          <Form.Item name="customerId" label={t("客户编号")} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="triggerType" label={t("触发")} rules={[{ required: true, message: t("请选择奖励触发事件") }]}><Select options={Object.entries(triggerLabels).map(([value, label]) => ({ value, label: t(label) }))} /></Form.Item>
          <Form.Item name="relatedCustomerId" label={t("关联客户编号")}><Input /></Form.Item>
          <Form.Item name="idempotencyKey" label={t("业务事件编号")} rules={[{ required: true }]} extra={t("同一补发事件使用同一编号，避免重复入账。")}><Input /></Form.Item>
        </Form>
      </Modal>
      <Modal title={t("撤销奖励")} open={reverseDialog.visible} onCancel={reverseDialog.dismiss} afterClose={reverseDialog.afterClose} destroyOnHidden
        closable={!reverseReward.isPending} keyboard={!reverseReward.isPending} maskClosable={!reverseReward.isPending} cancelButtonProps={{ disabled: reverseReward.isPending }}
        confirmLoading={reverseReward.isPending} okText={t("撤销奖励")} okButtonProps={{ disabled: !reverseTarget || rewards.isError }}
        onConfirm={() => reverseTarget ? reverseReward.mutateAsync({ id: reverseTarget.id, reason: t("运营人工撤销") }) : Promise.reject(new Error("Operation unavailable"))}>
        <div className={recordStyles.stack}><Alert type="warning" showIcon title={t("撤销会保留原流水与撤销时间。")} />
        {reverseTarget && <RecordFacts items={[
          { key: "customer", label: "客户编号", value: reverseTarget.customerId },
          { key: "type", label: "奖励", value: t(rewardLabels[reverseTarget.rewardType] ?? reverseTarget.rewardType) },
          { key: "amount", label: reverseTarget.rewardType === "balance" ? "金额" : "数量", value: reverseTarget.rewardType === "balance" ? formatRentalMoney(reverseTarget.amount, currency) : reverseTarget.amount },
          { key: "event", label: "业务事件编号", value: reverseTarget.idempotencyKey, wide: true },
        ]} />}
        </div>
      </Modal>
    </>
  );
}
