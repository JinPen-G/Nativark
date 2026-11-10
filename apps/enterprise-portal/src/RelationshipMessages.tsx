/** Personal recipient-bound original relation/admin messages. No current grant
 * is inferred; not a corporate audit, notification sender or K recovery tool. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { enterpriseOwnRelationshipMessagesSnapshot, type EnterpriseOwnRelationshipMessages } from "@rental-os/shared";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseRelationshipMessagesPanel({english}:{english:boolean}) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const identity=context.identity,tenant=context.tenantCode,basePath=context.basePath,customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode;
  const enabled=Boolean(customerId && context.session?.customer.customerType === "personal" && !context.loading && !context.signal.aborted);
  const assertCurrent=()=>{const c=owner.current;if(!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath || c.session?.customer.customerId!==customerId
    || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted)throw new Error(english ? "Personal change-message scope changed" : "本人变更消息读取身份已变化");};
  const query=useQuery({queryKey:["enterprise-relationship-messages",identity,tenant,basePath,customerId,workspace],enabled,queryFn:async({signal})=>{assertCurrent();const value=enterpriseOwnRelationshipMessagesSnapshot(await context.read<EnterpriseOwnRelationshipMessages>("/enterprise/my-relationship-messages",AbortSignal.any([context.signal,signal])),tenant,customerId!);assertCurrent();if(!value)throw new Error(english ? "Original personal change messages unavailable" : "原本人变更消息不可核对");return{identity,tenant,basePath,customerId,workspace,value};}});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId && query.data.workspace===workspace ? query.data.value : undefined;
  return <section aria-label={english ? "Personal relationship change messages" : "本人关系变更消息"}>
    <h3>{english ? "Original personal relationship and administrator changes" : "本人关系与管理员授权原变更"}</h3>
    <Alert type="info" title={english ? "Original receipts addressed to your retained relationship" : "仅原保留关系接收人的操作收据"} description={english ? "Historical status, role and actions are not current authority or delivery/read receipts. Merchant status/merge and transfer messages are not part of this source. No change is executed or K/C recovered here." : "历史状态、角色和动作不授当前权限，也不是送达/已读证明。商户状态/合并及交接消息不在本来源内；这里不执行变更或恢复K/C。"}/>
    {!enabled ? <Alert type="warning" title={english ? "Use your current personal account" : "请使用当前本人账号"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read personal changes again" : "重新读取本人变更"} disabled={query.isFetching} onAction={refresh}/>
      {query.isFetching && <p role="status">{english ? "Reading original change receipts" : "正在读取原变更收据"}</p>}
      {query.error && <Alert type="error" title={english ? "Original change messages could not be verified" : "原变更消息未核对成功"}/>}
      {visible && <>{visible.items.length===0 && <p>{english ? "No addressed original receipts in this scope; not a complete notification history." : "本范围未读到有原接收人关联的收据，不代表完整通知历史为空。"}</p>}
        <Table rowKey={r=>r.receipt.operationKey} dataSource={visible.items} sorting={false} pagination={false} onRefresh={refresh} columns={[
          {title:english ? "Original enterprise" : "原企业",dataIndex:"corporateCustomerId"},{title:english ? "Original relation" : "原关系",render:(_,r)=>r.receipt.membershipId},
          {title:english ? "Original actor reference" : "原操作者引用",render:(_,r)=>r.receipt.actorCustomerId},{title:english ? "Original action" : "原动作",render:(_,r)=>r.receipt.action},
          {title:english ? "Original reason" : "原原因",render:(_,r)=>r.receipt.reason},{title:english ? "Original time (UTC)" : "原时间（UTC）",render:(_,r)=>r.receipt.createdAt},
          {title:english ? "Historical result (not current authority)" : "历史结果（非当前授权）",render:(_,r)=>JSON.stringify(r.receipt.result)},
          {title:english ? "Original receipt key" : "原收据键",render:(_,r)=>r.receipt.operationKey},
          {title:english ? "Personal page" : "本人入口",render:()=>{const path=`${basePath}/join`;return parseEnterpriseRoute(path)?.basePath===basePath ? <Link to={path}>{english ? "Open personal relationship page" : "打开本人关系页"}</Link> : english ? "Original entry unavailable" : "原入口不可用";}}
        ]}/>
      </>}
    </>}
  </section>;
}
