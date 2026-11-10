/** Original transfer messages addressed to the initiating or receiving person.
 * Does not select an enterprise, grant authority, decide or recover K/C. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { enterpriseOwnTransferMessagesSnapshot, type EnterpriseOwnTransferMessages } from "@rental-os/shared";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseTransferMessagesPanel({english}:{english:boolean}) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const identity=context.identity,tenant=context.tenantCode,basePath=context.basePath,customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode;
  const enabled=Boolean(customerId && context.session?.customer.customerType==="personal" && !context.loading && !context.signal.aborted);
  const assertCurrent=()=>{const c=owner.current;if(!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath || c.session?.customer.customerId!==customerId
    || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted)throw new Error(english ? "Personal transfer-message scope changed" : "本人交接消息读取身份已变化");};
  const query=useQuery({queryKey:["enterprise-transfer-messages",identity,tenant,basePath,customerId,workspace],enabled,queryFn:async({signal})=>{
    assertCurrent();const value=enterpriseOwnTransferMessagesSnapshot(await context.read<EnterpriseOwnTransferMessages>("/enterprise/my-transfer-messages",AbortSignal.any([context.signal,signal])),tenant,customerId!);
    assertCurrent();if(!value)throw new Error(english ? "Original transfer messages unavailable" : "原交接消息不可核对");return{identity,tenant,basePath,customerId,workspace,value};
  }});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId && query.data.workspace===workspace ? query.data.value : undefined;
  return <section aria-label={english ? "Personal administrator transfer messages" : "本人管理员交接消息"}>
    <h3>{english ? "Your original administrator transfers" : "本人的管理员交接原消息"}</h3>
    <Alert type="info" title={english ? "Only transfers you originally initiated or received" : "仅本人原发起或接收的交接"} description={english ? "These are original request, decision and closure receipts, not current roles, delivery or read confirmations. This page does not accept, refuse or recover a transfer. Merchant status/merge and external notifications are not covered." : "显示原发起、接受/拒绝及封闭核对收据，不代表今天角色，也不是送达/已读确认。这里不接受、拒绝或恢复交接；商户状态/合并及外部通知不在本来源内。"}/>
    {!enabled ? <Alert type="warning" title={english ? "Use your current personal account" : "请使用当前本人账号"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read transfer messages again" : "重新读取交接消息"} disabled={query.isFetching} onAction={refresh}/>
      {query.isFetching && <p role="status">{english ? "Reading original transfer receipts" : "正在读取原交接收据"}</p>}
      {query.error && <Alert type="error" title={english ? "Original transfer messages could not be verified" : "原交接消息未核对成功"}/>}
      {visible && <>{visible.items.length===0 && <p>{english ? "No addressed transfer receipts in this scope; not a complete notification history." : "本范围未读到有原双方关联的交接收据，不代表完整通知历史为空。"}</p>}
        <Table rowKey={r=>r.receipt.operationKey} dataSource={visible.items} sorting={false} pagination={false} onRefresh={refresh} columns={[
          {title:english ? "Original enterprise" : "原企业",dataIndex:"corporateCustomerId"},
          {title:english ? "Your original participation" : "本人原参与方",render:(_,r)=>r.participation==="initiator" ? english ? "Initiator" : "发起人" : english ? "Recipient" : "接收人"},
          {title:english ? "Original transfer" : "原交接",render:(_,r)=>r.receipt.objectId},{title:english ? "Original actor reference" : "原操作者引用",render:(_,r)=>r.receipt.actorCustomerId},
          {title:english ? "Original action" : "原动作",render:(_,r)=>r.receipt.action},{title:english ? "Original reason" : "原原因",render:(_,r)=>r.receipt.reason},
          {title:english ? "Original time (UTC)" : "原时间（UTC）",render:(_,r)=>r.receipt.createdAt},{title:english ? "Historical result, not current authority" : "历史结果，非当前权限",render:(_,r)=>JSON.stringify(r.receipt.result)},
          {title:english ? "Original receipt key" : "原收据键",render:(_,r)=>r.receipt.operationKey},
          {title:english ? "Personal page" : "本人入口",render:()=>{const path=`${basePath}/join`;return parseEnterpriseRoute(path)?.basePath===basePath ? <Link to={path}>{english ? "Open personal relationship page" : "打开本人关系页"}</Link> : english ? "Original entry unavailable" : "原入口不可用";}}
        ]}/>
      </>}
    </>}
  </section>;
}
