/** Current customer grants consume original Core financial projections. Reads
 * discard changed identities, and cash receipts and allocations stay separate. */
import { useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatRentalMoney, type RentalEnterpriseCorporateFinancialProjection, type RentalEnterpriseHistoryWorkspaceBasis,
  type RentalEnterpriseOrderFinancialProjection } from "@rental-os/shared";
import { Alert, Button, ListSection, Table } from "@/components/ui/customer-entry";
import { LoadingState } from "@/components/LoadingState";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";

const reference = (value: string) => /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
const timestamp = (value: string) => value.replace("T", " ").replace("Z", " UTC");
const money = (value: number) => Number.isFinite(value) && Math.abs(value) <= 9999999999.99
  && Number(value.toFixed(2)) === value;
const entryLabels: Record<string, readonly [string, string]> = {
  reserve: ["占用", "Reservation"], release: ["释放", "Release"], settle: ["形成应收", "Receivable"],
  payment_allocation: ["回款核销", "Payment allocation"], allocation_reversal: ["核销冲销", "Allocation reversal"],
  adjust: ["调账", "Adjustment"]
};
const creditReasons: Record<string, readonly [string, string]> = {
  original_account_source_not_connected: ["原授信账户来源尚未接通", "Original credit account source is unavailable"],
  original_account_configuration_missing_with_ledger: ["原账户配置缺失，已有债权需核对", "Account configuration is missing while original ledger entries exist"],
  authoritative_account_history_space_scope_not_connected: ["历史账户经营空间范围待核对", "Historical account workspace authority needs verification"]
};

export function EnterpriseFinancePage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const [parameters] = useSearchParams(), references = parameters.getAll("orderId"), orderId = references[0] ?? "";
  const invalidReference = references.length > 1 || references.length === 1 && !reference(orderId);
  const corporateId = context.selectedCorporateId;
  const corporate = context.entry?.corporates.find(row => row.corporateCustomerId === corporateId);
  const workspace = context.session?.workspace;
  const allowed = Boolean(corporate?.actions.includes("finance:read") && workspace);
  const orderAllowed = Boolean(allowed && corporate?.actions.includes("orders:read"));
  const identity = JSON.stringify([context.identity, workspace?.workspaceCode, allowed, orderAllowed]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const base = `/enterprise/corporates/${encodeURIComponent(corporateId)}`;

  function verifyScope(result: RentalEnterpriseCorporateFinancialProjection | RentalEnterpriseOrderFinancialProjection | RentalEnterpriseHistoryWorkspaceBasis, signal: AbortSignal) {
    if (signal.aborted || context.signal.aborted || currentIdentity.current !== identity || result.apiVersion !== "v1"
      || result.corporateCustomerId !== corporateId || result.permissionRevision !== corporate?.permissionRevision
      || typeof result.observedAt !== "string" || !Number.isFinite(Date.parse(result.observedAt))) {
      throw new Error(english ? "The financial scope changed. Read the original source again." : "财务范围或原来源已变化，请重新读取");
    }
  }

  const history = useQuery({
    queryKey: ["enterprise-financial-workspace-basis", identity, corporateId],
    enabled: orderAllowed && Boolean(orderId) && !invalidReference && !context.loading,
    retry: false, staleTime: 0, gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await context.read<RentalEnterpriseHistoryWorkspaceBasis>(`${base}/history-workspaces`, AbortSignal.any([signal, context.signal]));
      verifyScope(result, signal);
      if (result.source !== "original_enterprise_order_subjects" || result.coverage !== "current_trusted_workspace_only"
        || result.crossWorkspaceRead?.state !== "unavailable" || result.crossWorkspaceRead.reason !== "authoritative_enterprise_history_space_scope_not_connected"
        || !Array.isArray(result.workspaces) || result.workspaces.length > 1
        || result.workspaces.some(row => !reference(row.workspaceId) || row.workspaceCode !== workspace?.workspaceCode
          || typeof row.workspaceName !== "string" || row.workspaceName.length > 191)) {
        throw new Error(english ? "Original financial workspace authority needs verification." : "原财务经营空间依据待核对");
      }
      return result;
    }
  });

  const account = useQuery({
    queryKey: ["enterprise-credit-account", identity, corporateId], enabled: allowed && !invalidReference && !context.loading,
    retry: false, staleTime: 0, gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await context.read<RentalEnterpriseCorporateFinancialProjection>(`${base}/finance`, AbortSignal.any([signal, context.signal]));
      verifyScope(result, signal);
      if (result.source !== "original_tenant_corporate_credit_account" || !result.credit
        || result.statements?.state !== "unavailable" || result.statements.reason !== "formal_statement_provider_not_implemented"
        || result.maturities?.state !== "unavailable" || result.maturities.reason !== "financially_determined_maturity_read_port_not_connected") {
        throw new Error(english ? "The original account projection is inconsistent." : "原授信账户投影无法核对");
      }
      if (result.credit.state === "available") {
        const value = result.credit.account;
        if (!value || ![value.creditLimit, value.reservedAmount, value.receivableAmount, value.availableAmount].every(money)
          || [value.creditLimit, value.reservedAmount, value.receivableAmount].some(amount => amount < 0) || value.currency !== "CNY"
          || !["active", "suspended", "revoked"].includes(value.status) || !["monthly", "semi_monthly", "per_order"].includes(value.billingCycle)
          || !Number.isSafeInteger(value.settlementTermDays) || value.settlementTermDays < 0) {
          throw new Error(english ? "Original account amounts or configuration need verification." : "原账户金额或结算配置待核对");
        }
      } else if (result.credit.state !== "not_configured"
        && (result.credit.state !== "unavailable" || !Object.hasOwn(creditReasons, result.credit.reason))) {
        throw new Error(english ? "The original account state is unavailable." : "原账户状态无法核对");
      }
      return result;
    }
  });

  const order = useQuery({
    queryKey: ["enterprise-order-finance", identity, corporateId, orderId],
    enabled: orderAllowed && Boolean(orderId) && Boolean(history.data) && !history.error && !invalidReference && !context.loading,
    retry: false, staleTime: 0, gcTime: 0,
    queryFn: async ({ signal }) => {
      const acceptedWorkspace = history.data?.workspaces[0];
      if (!acceptedWorkspace || acceptedWorkspace.workspaceCode !== workspace?.workspaceCode) {
        throw new Error(english ? "No authorized original financial workspace was observed." : "未读取到原受权财务经营空间");
      }
      const result = await context.read<RentalEnterpriseOrderFinancialProjection>(`${base}/orders/${encodeURIComponent(orderId)}/finance`, AbortSignal.any([signal, context.signal]));
      verifyScope(result, signal);
      if (result.source !== "persisted_original_core_finance" || result.orderId !== orderId || result.workspaceId !== acceptedWorkspace.workspaceId
        || typeof result.currency !== "string" || !/^[A-Z]{3}$/u.test(result.currency)
        || typeof result.sourceOrderUpdatedAt !== "string" || !Number.isFinite(Date.parse(result.sourceOrderUpdatedAt))
        || !money(result.corporatePaymentAllocated) || result.corporatePaymentAllocated < 0 || !result.rentalCash
        || result.guarantee?.state !== "unavailable" || result.guarantee.reason !== "original_payer_or_provider_guarantee_read_port_not_connected"
        || result.statements?.state !== "unavailable" || result.statements.reason !== "formal_statement_provider_not_implemented"
        || !Array.isArray(result.receivableEntries) || new Set(result.receivableEntries.map(row => row.id)).size !== result.receivableEntries.length
        || result.receivableEntries.some(row => typeof row.id !== "string" || !row.id || !Object.hasOwn(entryLabels, row.entryType)
          || ![row.amount, row.reservedDelta, row.receivableDelta].every(money) || row.amount < 0
          || typeof row.occurredAt !== "string" || !Number.isFinite(Date.parse(row.occurredAt)))) {
        throw new Error(english ? "The original order financial projection is inconsistent." : "原订单财务投影无法核对");
      }
      if (result.rentalCash.state === "available") {
        if (![result.rentalCash.collected, result.rentalCash.refunded, result.rentalCash.netReceived].every(money)
          || result.rentalCash.collected < 0 || result.rentalCash.refunded < 0) {
          throw new Error(english ? "Original cash receipts need verification." : "原实款记录待核对");
        }
      } else if (result.rentalCash.state !== "unavailable" || result.rentalCash.reason !== "unverified_original_cash_receipt") {
        throw new Error(english ? "The original cash receipt state is inconsistent." : "原实款记录状态无法核对");
      }
      return result;
    }
  });

  if (!allowed) return <Alert type="warning" title={english ? "Enterprise finance access is unavailable" : "当前企业财务查看权限不可用"}
    action={<Button onClick={context.reload}>{english ? "Check access" : "重新核验权限"}</Button>} />;
  if (invalidReference) return <Alert type="error" title={english ? "Invalid order reference" : "订单引用无效"} />;
  const credit = account.data?.credit;
  const financial = order.data;
  const accountStatus = { active: english ? "Active" : "有效", suspended: english ? "Suspended" : "暂停", revoked: english ? "Revoked" : "已撤销" };
  const cycles = { monthly: english ? "Monthly" : "月结", semi_monthly: english ? "Semi-monthly" : "半月结", per_order: english ? "Per order" : "逐单结算" };

  return <section className="enterprise-approval-review">
    <p>{corporate?.corporateName} · {workspace?.workspaceName}</p>
    <ListSection title={english ? "Original credit account" : "原授信账户"}>
      {account.error ? <Alert type="error" title={account.error instanceof Error ? account.error.message : "读取失败"}
        action={<Button onClick={() => void account.refetch()}>{english ? "Read again" : "重新读取"}</Button>} />
        : !credit ? <LoadingState /> : credit.state === "available" ? <>
          <dl className="enterprise-review-facts" aria-busy={account.isFetching}>
            {([
              [english ? "Credit limit" : "授信额度", credit.account.creditLimit],
              [english ? "Reserved" : "已占用", credit.account.reservedAmount],
              [english ? "Receivables" : "应收余额", credit.account.receivableAmount],
              [english ? "Available credit" : "可用额度", credit.account.availableAmount]
            ] as const).map(([label, value]) => <div className="enterprise-review-fact" key={label}><dt>{label}</dt><dd>{formatRentalMoney(value, credit.account.currency)}</dd></div>)}
            <div className="enterprise-review-fact"><dt>{english ? "Account status" : "账户状态"}</dt><dd>{accountStatus[credit.account.status]}</dd></div>
            <div className="enterprise-review-fact"><dt>{english ? "Settlement configuration" : "结算配置"}</dt><dd>{cycles[credit.account.billingCycle]} · {credit.account.settlementTermDays}{english ? " days" : "天"}</dd></div>
          </dl>
          <p>{english ? "Observed" : "原来源读取时间"} · {timestamp(account.data!.observedAt)}</p>
        </> : <Alert type="info" title={credit.state === "not_configured" ? english ? "Credit is not configured" : "企业尚未配置授信"
          : creditReasons[credit.reason][english ? 1 : 0]} />}
    </ListSection>
    <Alert type="info" title={english ? "Formal statements and financially determined maturities are unavailable" : "正式账单与核定到期来源尚未接通"} />

    {orderId ? !orderAllowed ? <Alert type="warning" title={english ? "Order viewing also requires orders:read" : "订单财务还须原企业订单查看权限"} />
      : history.error ? <Alert type="error" title={history.error instanceof Error ? history.error.message : "读取失败"}
        action={<Button onClick={() => void history.refetch()}>{english ? "Read again" : "重新读取"}</Button>} />
      : order.error ? <Alert type="error" title={order.error instanceof Error ? order.error.message : "读取失败"}
        action={<Button onClick={() => void order.refetch()}>{english ? "Read again" : "重新读取"}</Button>} />
      : !financial ? <LoadingState /> : <>
        <ListSection title={english ? "Original order financial records" : "原订单财务记录"}>
          <p>{financial.orderId} · {financial.currency} · {english ? "Observed" : "原来源读取时间"} {timestamp(financial.observedAt)}</p>
          {financial.rentalCash.state === "available" ? <dl className="enterprise-review-facts" aria-busy={order.isFetching}>
            {([
              [english ? "Rental cash collected" : "租金实收", financial.rentalCash.collected],
              [english ? "Rental cash refunded" : "租金退款", financial.rentalCash.refunded],
              [english ? "Net rental cash received" : "净实收租金", financial.rentalCash.netReceived]
            ] as const).map(([label, value]) => <div className="enterprise-review-fact" key={label}><dt>{label}</dt><dd>{formatRentalMoney(value, financial.currency)}</dd></div>)}
          </dl> : <Alert type="warning" title={english ? "Original cash receipts need verification" : "原实款记录待核对"} />}
          <dl className="enterprise-review-facts"><div className="enterprise-review-fact"><dt>{english ? "Corporate payment allocated" : "企业回款核销"}</dt><dd>{formatRentalMoney(financial.corporatePaymentAllocated, financial.currency)}</dd></div></dl>
        </ListSection>
        <ListSection title={english ? "Original receivable and reservation entries" : "原应收与占用流水"}>
          <Table rowKey="id" dataSource={financial.receivableEntries} pagination={false} sorting={false} loading={order.isFetching}
            onRefresh={() => order.refetch()} columns={[
              { title: english ? "Entry" : "流水类型", dataIndex: "entryType", render: value => entryLabels[value][english ? 1 : 0] },
              { title: english ? "Amount" : "流水金额", render: (_, row) => formatRentalMoney(row.amount, financial.currency) },
              { title: english ? "Reservation change" : "占用变动", render: (_, row) => formatRentalMoney(row.reservedDelta, financial.currency) },
              { title: english ? "Receivable change" : "应收变动", render: (_, row) => formatRentalMoney(row.receivableDelta, financial.currency) },
              { title: english ? "Recorded · UTC" : "发生时间 · UTC", dataIndex: "occurredAt", render: timestamp }
            ]} />
        </ListSection>
        <Alert type="info" title={english ? "Original guarantee payer and provider records are unavailable" : "保证金原出资人及供应商记录尚未接通"} />
        <Link to={`${context.basePath}/orders?${new URLSearchParams({ orderId })}`}>{english ? "Back to original order" : "返回原订单"}</Link>
      </> : orderAllowed && <Link to={`${context.basePath}/orders`}>{english ? "Choose an original enterprise-paid order" : "选择原企业承担订单核对财务"}</Link>}
  </section>;
}
