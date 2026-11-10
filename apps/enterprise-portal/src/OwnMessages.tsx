/** Personal persisted feedback summaries. Independent of corporate task/audit
 * queues; registered links locate pages only, never acknowledge or execute. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { enterpriseOwnMessagesSnapshot, type EnterpriseOwnMessage, type EnterpriseOwnMessages } from "@rental-os/shared";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseOwnMessagesPanel({ english }: { english: boolean }) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode,identity=context.identity,tenant=context.tenantCode,basePath=context.basePath;
  const enabled=Boolean(customerId && context.session?.customer.customerType === "personal" && !context.loading && !context.signal.aborted);
  const assertCurrent=()=>{const c=owner.current;if(!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath || c.session?.customer.customerId!==customerId
    || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted)throw new Error(english ? "Current personal feedback scope changed" : "当前本人反馈身份已变化");};
  const query=useQuery({queryKey:["enterprise-own-messages",identity,tenant,basePath,customerId,workspace],enabled,queryFn:async({signal})=>{assertCurrent();const value=enterpriseOwnMessagesSnapshot(await context.read<EnterpriseOwnMessages>("/enterprise/my-messages",AbortSignal.any([context.signal,signal])),tenant,customerId!);assertCurrent();if(!value)throw new Error(english ? "Original personal feedback unavailable" : "原本人反馈不可核对");return{identity,tenant,basePath,customerId,workspace,value};}});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId && query.data.workspace===workspace ? query.data.value : undefined;
  const entry=(row:EnterpriseOwnMessage)=>{const path=`${basePath}/${row.page}`;if(parseEnterpriseRoute(path)?.basePath!==basePath)return undefined;return row.kind === "join_request" ? path : `${path}?${new URLSearchParams({requestId:row.requestId})}`;};
  const kind=(v:EnterpriseOwnMessage["kind"])=>v === "corporate_application" ? english ? "Enterprise application" : "企业申请" : v === "join_request" ? english ? "Join application" : "加入申请" : english ? "Management request" : "资料/管理申请";
  const state=(v:EnterpriseOwnMessage["state"])=>v === "approved" ? english ? "Approval recorded" : "已记录审核通过" : v === "rejected" ? english ? "Rejection recorded" : "已记录审核拒绝" : english ? "Supplement requested" : "已记录补件要求";
  return <section aria-label={english ? "Personal messages" : "本人站内消息"}>
    <h3>{english ? "Personal messages: current feedback" : "本人站内消息：当前反馈"}</h3>
    <Alert type="info" title={english ? "Original persisted feedback only" : "仅原持久申请的当前反馈"} description={english ? "One current summary per application, not delivery history. Missing read/delivery receipts are not reported as read or delivered. Approval grants no current authority and does not prove business execution. This source does not include relationship, approval, order/financial or external notices." : "每个申请只显示当前持久反馈，不是历史送达记录；无已读/送达收据，不冒造已读或送达。审核通过不授当前权限、不证明业务已执行；本来源不包含关系变更、批准、订单/财务及外部通知。"}/>
    {!enabled ? <Alert type="warning" title={english ? "Sign in with your current personal account" : "请使用当前个人账号登录"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read personal feedback again" : "重新读取本人反馈"} disabled={query.isFetching} onAction={refresh}/>
      {query.isFetching && <p role="status">{english ? "Reading original feedback" : "正在读取原反馈"}</p>}
      {query.error && <Alert type="error" title={english ? "Original personal feedback could not be verified" : "原本人反馈未核对成功"}/>}
      {visible && <>{visible.items.length===0 && <p>{english ? "No current feedback in the stated scope; not a complete notification history." : "本范围未读到当前反馈，不代表完整通知历史为空。"}</p>}
        <Table rowKey={row=>`${row.kind}:${row.requestId}:${row.revision}`} dataSource={visible.items} pagination={false} sorting={false} onRefresh={refresh} columns={[
          {title:english ? "Application" : "申请类型",render:(_,row)=>kind(row.kind)},
          {title:english ? "Original request" : "原申请",dataIndex:"requestId"},
          {title:english ? "Recorded result" : "原持久结果",render:(_,row)=>state(row.state)},
          {title:english ? "Original revision" : "原修订",dataIndex:"revision"},
          {title:english ? "Original update (UTC)" : "原更新时间（UTC）",dataIndex:"updatedAt"},
          {title:english ? "Original feedback" : "原反馈",render:(_,row)=>row.feedback ?? (english ? "Feedback not recorded" : "原反馈未记录")},
          {title:english ? "Original page" : "原入口",render:(_,row)=>{const path=entry(row);return path ? <Link to={path}>{english ? "Open original application page" : "打开原申请页"}</Link> : english ? "Original entry unavailable" : "原入口不可用";}}
        ]}/>
      </>}
    </>}
  </section>;
}
