/** Applicant-addressed original review receipts. Registered links locate the
 * own application only; history neither grants authority nor resolves K/C. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { enterpriseOwnApplicationReviewMessagesSnapshot, type EnterpriseOwnApplicationReviewMessages } from "@rental-os/shared";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseApplicationReviewMessagesPanel({english}:{english:boolean}) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode,identity=context.identity,tenant=context.tenantCode,basePath=context.basePath;
  const enabled=Boolean(customerId && context.session?.customer.customerType==="personal" && !context.loading && !context.signal.aborted);
  const assertCurrent=()=>{const c=owner.current;if(!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath || c.session?.customer.customerId!==customerId || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted)throw new Error(english ? "Current personal review-message scope changed" : "当前本人审核消息身份已变化");};
  const query=useQuery({queryKey:["enterprise-own-application-review-messages",identity,tenant,basePath,customerId,workspace],enabled,queryFn:async({signal})=>{assertCurrent();const value=enterpriseOwnApplicationReviewMessagesSnapshot(await context.read<EnterpriseOwnApplicationReviewMessages>("/enterprise/my-application-review-messages",AbortSignal.any([context.signal,signal])),tenant,customerId!);assertCurrent();if(!value)throw new Error(english ? "Original application review messages unavailable" : "本人原审核消息不可核对");return{identity,tenant,basePath,customerId,workspace,value};}});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId && query.data.workspace===workspace ? query.data.value : undefined;
  const entry=(id:string)=>{const path=`${basePath}/applications`;return parseEnterpriseRoute(path)?.basePath===basePath ? `${path}?${new URLSearchParams({requestId:id})}` : undefined;};
  const state=(v:EnterpriseOwnApplicationReviewMessages["items"][number]["state"])=>v==="approved" ? english ? "Approval recorded" : "已记录审核通过" : v==="rejected" ? english ? "Rejection recorded" : "已记录审核拒绝" : english ? "Supplement requested" : "已记录补件要求";
  return <section aria-label={english ? "Own original application review messages" : "本人企业申请原审核消息"}>
    <h3>{english ? "Enterprise application: original review history" : "本人企业申请：原审核历史"}</h3>
    <Alert type="info" title={english ? "Original receipts, not current feedback or delivery records" : "原审核收据，非当前反馈或送达记录"} description={english ? "Original approval, rejection and supplement receipts remain distinct from today's application state. No representative/proof material or internal logs are included. Delivery and read receipts are not recorded; history grants no current authority and does not execute a review or recover K/C." : "原通过、拒绝和补件收据与今天申请状态分开，不公开代表/证明材料或内部日志。送达、已读未记录；历史不授今天权限，不执行审核或恢复 K/C。"}/>
    {!enabled ? <Alert type="warning" title={english ? "Sign in with your current personal account" : "请使用当前个人账号登录"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read original application reviews" : "读取本人原审核记录"} disabled={query.isFetching} onAction={refresh}/>
      {query.isFetching && <p role="status">{english ? "Reading original review receipts" : "正在读取原审核收据"}</p>}
      {query.error && <Alert type="error" title={english ? "Original application review messages could not be verified" : "本人原审核消息未核对成功"}/>}
      {visible && <>{visible.items.length===0 && <p>{english ? "No original reviews in this scope; not complete notification history." : "本范围未读到原审核收据，不代表完整通知历史为空。"}</p>}
        <Table rowKey="operationKey" dataSource={visible.items} sorting={false} pagination={false} onRefresh={refresh} columns={[
          {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},{title:english ? "Original request" : "原申请",dataIndex:"requestId"},{title:english ? "Original review result" : "原审核结果",render:(_,r)=>state(r.state)},
          {title:english ? "Original revision" : "原修订",dataIndex:"revision"},{title:english ? "Original feedback" : "原反馈",dataIndex:"feedback"},{title:english ? "Original receipt company reference" : "原收据企业引用",render:(_,r)=>r.corporateCustomerId ?? (english ? "Not recorded" : "未记录")},
          {title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"},{title:english ? "Original page" : "原入口",render:(_,r)=>{const path=entry(r.requestId);return path ? <Link to={path}>{english ? "Open original application page" : "打开原申请页"}</Link> : english ? "Original entry unavailable" : "原入口不可用";}}
        ]}/>
      </>}
    </>}
  </section>;
}
