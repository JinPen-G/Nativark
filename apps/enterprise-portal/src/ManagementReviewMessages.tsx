/** Own management-review receipts, not master/credit/policy execution facts.
 * The retained request type is fixed by its original save contract; links only locate. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { enterpriseOwnManagementReviewMessagesSnapshot, type EnterpriseManagementRequestType, type EnterpriseOwnManagementReviewMessages } from "@rental-os/shared";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseManagementReviewMessagesPanel({english}:{english:boolean}) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode,identity=context.identity,tenant=context.tenantCode,basePath=context.basePath;
  const enabled=Boolean(customerId && context.session?.customer.customerType==="personal" && !context.loading && !context.signal.aborted);
  const assertCurrent=()=>{const c=owner.current;if(!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath || c.session?.customer.customerId!==customerId || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted)throw new Error(english ? "Current personal management-review scope changed" : "当前本人管理审核消息身份已变化");};
  const query=useQuery({queryKey:["enterprise-own-management-review-messages",identity,tenant,basePath,customerId,workspace],enabled,queryFn:async({signal})=>{assertCurrent();const value=enterpriseOwnManagementReviewMessagesSnapshot(await context.read<EnterpriseOwnManagementReviewMessages>("/enterprise/my-management-review-messages",AbortSignal.any([context.signal,signal])),tenant,customerId!);assertCurrent();if(!value)throw new Error(english ? "Original management-review messages unavailable" : "本人管理原审核消息不可核对");return{identity,tenant,basePath,customerId,workspace,value};}});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId && query.data.workspace===workspace ? query.data.value : undefined;
  const entry=(id:string)=>{const path=`${basePath}/profile`;return parseEnterpriseRoute(path)?.basePath===basePath ? `${path}?${new URLSearchParams({requestId:id})}` : undefined;};
  const kind=(v:EnterpriseManagementRequestType)=>v==="profile_change" ? english ? "Profile request" : "资料申请" : v==="credit_change" ? english ? "Credit request" : "授信申请"
    : v==="payment_proof" ? english ? "Rental-fee payment evidence" : "费用回款凭证" : english ? "Scope request" : "范围申请";
  const state=(v:EnterpriseOwnManagementReviewMessages["items"][number]["state"])=>v==="approved" ? english ? "Approval recorded (review only)" : "已记录审核通过（仅审核）" : v==="rejected" ? english ? "Rejection recorded" : "已记录审核拒绝" : english ? "Supplement requested" : "已记录补件要求";
  return <section aria-label={english ? "Own original management-review messages" : "本人资料管理申请原审核消息"}>
    <h3>{english ? "Management requests: original review history" : "本人资料/管理申请：原审核历史"}</h3>
    <Alert type="info" title={english ? "Review only, no business change" : "仅原审核，不代表业务已变更"} description={english ? "Only original review-only receipts and the fixed original request category. Approval does not change a master, credit limit or policy, confirm payment or settle a debt. Private proposal/evidence and internal logs are not included. Delivery/read receipts remain unrecorded; no review or K/C recovery runs here." : "仅原 review-only 收据与固定的原申请类别。审核通过不表示主档、额度或政策已变更，也不确认到账或清偿债务。不公开私有提案/证据或内部日志；送达/已读未记录，不执行审核或恢复 K/C。"}/>
    {!enabled ? <Alert type="warning" title={english ? "Sign in with your current personal account" : "请使用当前个人账号登录"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read original management reviews" : "读取本人管理原审核记录"} disabled={query.isFetching} onAction={refresh}/>
      {query.isFetching && <p role="status">{english ? "Reading original management-review receipts" : "正在读取原管理审核收据"}</p>}
      {query.error && <Alert type="error" title={english ? "Original management-review messages could not be verified" : "本人管理原审核消息未核对成功"}/>}
      {visible && <>{visible.items.length===0 && !visible.paymentProofItems?.length && <p>{english ? "No original management reviews in this scope; not complete history." : "本范围未读到原管理审核收据，不代表完整历史为空。"}</p>}
        <Table rowKey="operationKey" dataSource={[...visible.items, ...(visible.paymentProofItems ?? [])]} sorting={false} pagination={false} onRefresh={refresh} columns={[
          {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},{title:english ? "Original request" : "原申请",dataIndex:"requestId"},{title:english ? "Original category" : "原类别",render:(_,r)=>kind(r.requestType)},{title:english ? "Original enterprise reference" : "原企业引用",dataIndex:"corporateCustomerId"},{title:english ? "Original review result" : "原审核结果",render:(_,r)=>state(r.state)},
          {title:english ? "Original revision" : "原修订",dataIndex:"revision"},{title:english ? "Original operation reason" : "原操作原因",dataIndex:"reason"},{title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"},{title:english ? "Own page" : "本人入口",render:(_,r)=>{const path=entry(r.requestId);return path ? <Link to={path}>{english ? "Open own request page" : "打开本人申请页"}</Link> : english ? "Own entry unavailable" : "本人入口不可用";}}
        ]}/>
      </>}
    </>}
  </section>;
}
