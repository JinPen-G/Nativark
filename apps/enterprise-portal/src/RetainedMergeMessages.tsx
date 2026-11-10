/** Own retained-master merge records only; no source person, original review
 * material, business transfer, inherited authority or merge-chain navigation. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { enterpriseOwnRetainedMergeMessagesSnapshot, type EnterpriseOwnRetainedMergeMessages } from "@rental-os/shared";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseRetainedMergeMessagesPanel({english}:{english:boolean}) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const identity=context.identity,tenant=context.tenantCode,basePath=context.basePath,customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode;
  const enabled=Boolean(customerId && context.session?.customer.customerType==="personal" && !context.loading && !context.signal.aborted);
  const assertCurrent=()=>{const c=owner.current;if(!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath || c.session?.customer.customerId!==customerId
    || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted)throw new Error(english ? "Personal retained-record scope changed" : "本人合并记录消息读取身份已变化");};
  const query=useQuery({queryKey:["enterprise-retained-merge-messages",identity,tenant,basePath,customerId,workspace],enabled,queryFn:async({signal})=>{
    assertCurrent();const value=enterpriseOwnRetainedMergeMessagesSnapshot(await context.read<EnterpriseOwnRetainedMergeMessages>("/enterprise/my-retained-merge-messages",AbortSignal.any([context.signal,signal])),tenant,customerId!);
    assertCurrent();if(!value)throw new Error(english ? "Original retained merge records unavailable" : "原本人保留方合并记录不可核对");return{identity,tenant,basePath,customerId,workspace,value};
  }});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId && query.data.workspace===workspace ? query.data.value : undefined;
  return <section aria-label={english ? "Your retained-master merge records" : "本人保留方合并记录消息"}>
    <h3>{english ? "Original merges retaining your master record" : "保留本人主档的原合并记录"}</h3>
    <Alert type="info" title={english ? "Original retained record only" : "仅原保留方记录"} description={english ? "Only records originally naming your master as the retained target. The merged person's details, differences and review are private. This does not transfer enterprise relationships, historical business subjects or authority, or prove delivery/read confirmation." : "只读原记录明确以本人主档为保留方的引用与合并时间，不公开被合并客户、字段差异或审核资料。它不代表企业关系、历史业务主体或权限已转入，也不是送达/已读确认。"}/>
    {!enabled ? <Alert type="warning" title={english ? "Use your current personal account" : "请使用当前本人账号"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read retained merge records again" : "重新读取保留方合并记录"} disabled={query.isFetching} onAction={refresh}/>
      {query.isFetching && <p role="status">{english ? "Reading original retained records" : "正在读取原保留方记录"}</p>}
      {query.error && <Alert type="error" title={english ? "Original retained records could not be verified" : "原保留方记录未核对成功"}/>}
      {visible && <>{visible.items.length===0 && <p>{english ? "No original records in this source; not a complete notification history." : "本来源未读到原记录，不代表完整通知历史为空。"}</p>}
        <Table rowKey="id" dataSource={visible.items} sorting={false} pagination={false} onRefresh={refresh} columns={[
          {title:english ? "Original record" : "原记录",dataIndex:"id"},{title:english ? "Original merge time (UTC)" : "原合并时间（UTC）",dataIndex:"mergedAt"},
          {title:english ? "Record boundary" : "记录边界",render:()=>english ? "Master record retained; no inherited authority" : "仅主档保留，不授继承权限"}
        ]}/>
      </>}
    </>}
  </section>;
}
