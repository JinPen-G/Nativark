/** Personal original account/member status facts, not a merchant audit or sender.
 * No corporate/merge history, current authorization or status-changing actions. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { enterpriseOwnStatusMessagesSnapshot, type EnterpriseOwnStatusMessages } from "@rental-os/shared";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseOwnStatusMessagesPanel({english}:{english:boolean}) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const identity=context.identity,tenant=context.tenantCode,basePath=context.basePath,customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode;
  const enabled=Boolean(customerId && context.session?.customer.customerType==="personal" && !context.loading && !context.signal.aborted);
  const assertCurrent=()=>{const c=owner.current;if(!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath || c.session?.customer.customerId!==customerId
    || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted)throw new Error(english ? "Personal status-message scope changed" : "本人状态消息读取身份已变化");};
  const query=useQuery({queryKey:["enterprise-own-status-messages",identity,tenant,basePath,customerId,workspace],enabled,queryFn:async({signal})=>{
    assertCurrent();const value=enterpriseOwnStatusMessagesSnapshot(await context.read<EnterpriseOwnStatusMessages>("/enterprise/my-status-messages",AbortSignal.any([context.signal,signal])),tenant,customerId!);
    assertCurrent();if(!value)throw new Error(english ? "Original status messages unavailable" : "原本人状态消息不可核对");return{identity,tenant,basePath,customerId,workspace,value};
  }});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId && query.data.workspace===workspace ? query.data.value : undefined;
  return <section aria-label={english ? "Your original account and membership status messages" : "本人账号与会员原状态消息"}>
    <h3>{english ? "Your original account and membership changes" : "本人账号与会员原状态变更"}</h3>
    <Alert type="info" title={english ? "Original recorded status changes, not today's access" : "原记录状态变更，不代表今天准入"} description={english ? "Your account and tenant-membership facts only. Internal reasons, reviewers, corporate/merge and old workspace events are not included. Missing prior status stays unrecorded; these facts do not prove delivery or read confirmation." : "只读本人账号及租户会员原事实，不含内部原因/审核人、企业/合并及旧空间事件。缺原状态明确未记录，不补今天状态，也不据此确认送达/已读。"}/>
    {!enabled ? <Alert type="warning" title={english ? "Use your current personal account" : "请使用当前本人账号"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read my status changes again" : "重新读取本人状态变更"} disabled={query.isFetching} onAction={refresh}/>
      {query.isFetching && <p role="status">{english ? "Reading original status records" : "正在读取原状态记录"}</p>}
      {query.error && <Alert type="error" title={english ? "Original status messages could not be verified" : "原本人状态消息未核对成功"}/>}
      {visible && <>{visible.items.length===0 && <p>{english ? "No original records in this source; not a complete notification history." : "本来源未读到原记录，不代表完整通知历史为空。"}</p>}
        <Table rowKey="id" dataSource={visible.items} sorting={false} pagination={false} onRefresh={refresh} columns={[
          {title:english ? "Original record" : "原记录",dataIndex:"id"},{title:english ? "Scope" : "作用域",render:(_,r)=>r.scope==="account" ? english ? "Account" : "账号" : english ? "Tenant membership" : "租户会员"},
          {title:english ? "Original action" : "原动作",dataIndex:"action"},{title:english ? "Prior recorded state" : "原先记录状态",render:(_,r)=>r.fromStatus ?? (english ? "Not recorded" : "未记录")},
          {title:english ? "Recorded result, not current access" : "原结果，非当前准入",dataIndex:"toStatus"},{title:english ? "Original event time (UTC)" : "原事件时间（UTC）",dataIndex:"at"}
        ]}/>
      </>}
    </>}
  </section>;
}
