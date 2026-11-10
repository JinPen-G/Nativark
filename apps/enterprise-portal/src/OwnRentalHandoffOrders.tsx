/** Current-service original enterprise-employee rentals, including those without a
 * request. Historical relation comes only from the order; this never grants action. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { enterpriseRentalHandoffOrderSourceSnapshot, type EnterpriseRentalHandoffOrderSource } from "@rental-os/shared";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseRentalHandoffOrderTable({ source, english }: { source?: EnterpriseRentalHandoffOrderSource; english: boolean }) {
  const context = useEnterprise(), workspace = context.session?.workspace?.workspaceCode;
  const readable = Boolean(context.session?.customer.customerType === "personal" && workspace && !context.loading && !context.signal?.aborted);
  const value = readable ? enterpriseRentalHandoffOrderSourceSnapshot(source, workspace ?? "") : undefined;
  const path = `${context.basePath}/join`;
  const registered = parseEnterpriseRoute(path)?.basePath === context.basePath;
  return <section aria-label={english ? "Original enterprise rentals to review" : "原企业身份租赁待核对"}>
    <h3>{english ? "Review original enterprise rentals" : "核对原企业身份租赁"}</h3>
    <Alert type="info" title={english ? "Current service and your original employee identity only" : "仅当前服务、本人原企业员工身份订单"}
      description={english ? "Includes rentals without a handoff request. Original states and relationships do not prove pickup, payment or completed handoff. Missing historical identity and other services are not included; this is not a complete in-flight total." : "包含尚未申请交接的原单。原状态和关系不证明已领取、付款或交接完成；缺历史身份依据及其他服务未纳入，不是完整在途总数。"}/>
    {!value || value.state === "unavailable" ? <Alert type="warning" title={english ? "Original rental source unavailable; read a known original order separately" : "原单来源不可用；已知原订单仍可独立核对"}/> : <>
      {value.items.length === 0 && <p>{english ? "No matching rentals in this documented scope; this does not prove there are no ongoing responsibilities." : "本次覆盖范围内未读到匹配原单，不证明没有尚未处理的责任。"}</p>}
      <Table rowKey={row => row.material.orderId} dataSource={value.items} sorting={false} pagination={false} columns={[
        { title: english ? "Original order" : "原订单", render: (_, row) => row.material.orderNo },
        { title: english ? "Recorded state" : "原记录状态", dataIndex: "status" },
        { title: english ? "Original enterprise / relation" : "原企业与关系", render: (_, row) => `${row.material.corporateCustomerId} / ${row.material.corporateMembershipId}` },
        { title: english ? "Order revision (UTC)" : "原订单修订（UTC）", render: (_, row) => row.material.orderUpdatedAt },
        { title: english ? "Review" : "核对入口", render: (_, row) => registered ? <Link to={`${path}?${new URLSearchParams({ handoffOrderId: row.material.orderId })}`}>{english ? "Review original order before requesting" : "先核对原单再申请交接"}</Link> : english ? "Original entry unavailable" : "原入口不可用" }
      ]}/>
    </>}
  </section>;
}
export function EnterpriseOwnRentalHandoffOrders({ english }: { english: boolean }) {
  const context = useEnterprise(), workspace = context.session?.workspace?.workspaceCode;
  const readable = Boolean(context.session?.customer.customerType === "personal" && workspace && !context.loading && !context.signal.aborted);
  const latest = useRef({ identity: context.identity, workspace, readable }); latest.current = { identity: context.identity, workspace, readable };
  const assertCurrent = () => { if (!readable || !latest.current.readable || latest.current.identity !== context.identity || latest.current.workspace !== workspace || context.signal.aborted) throw new Error("原客户或服务不可用"); };
  const query = useQuery({ queryKey: ["enterprise-own-handoff-orders", context.identity, workspace], enabled: readable,
    queryFn: async ({ signal }) => {
      assertCurrent(); const identity = context.identity;
      const source = enterpriseRentalHandoffOrderSourceSnapshot(await context.read<EnterpriseRentalHandoffOrderSource>("/enterprise/handoff-orders", signal), workspace ?? "");
      assertCurrent(); if (!source) throw new Error("原单来源不可核对 / Original rental source unavailable");
      return { identity, source };
    } });
  const refresh = async () => { assertCurrent(); await query.refetch({ throwOnError: true }); };
  return <><ActionButton intent="refresh" label={english ? "Read original rental source again" : "重新读取原租赁来源"} disabled={!readable || query.isFetching} onAction={refresh}/>
    {query.isFetching ? <p role="status">{english ? "Reading original rental source" : "正在读取原租赁来源"}</p> :
      <EnterpriseRentalHandoffOrderTable english={english} source={readable && !query.error && query.data?.identity === context.identity ? query.data.source : undefined}/>}</>;
}
