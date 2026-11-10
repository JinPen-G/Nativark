/** Original captured corporate-status recipients, not today's membership or authority.
 * Missing/failed capture and pre-feature history stay unavailable; nothing is sent or restored. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { enterpriseOwnCorporateStatusMessagesSnapshot, type EnterpriseOwnCorporateStatusMessages } from "@rental-os/shared";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseCorporateStatusMessagesPanel({english}:{english:boolean}) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode,identity=context.identity,tenant=context.tenantCode,basePath=context.basePath;
  const enabled=Boolean(customerId && context.session?.customer.customerType==="personal" && !context.loading && !context.signal.aborted);
  const assertCurrent=()=>{const c=owner.current;if(!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath || c.session?.customer.customerId!==customerId || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted)throw new Error(english ? "Current personal corporate-status scope changed" : "当前本人企业状态消息身份已变化");};
  const query=useQuery({queryKey:["enterprise-own-corporate-status-messages",identity,tenant,basePath,customerId,workspace],enabled,queryFn:async({signal})=>{assertCurrent();const value=enterpriseOwnCorporateStatusMessagesSnapshot(await context.read<EnterpriseOwnCorporateStatusMessages>("/enterprise/my-corporate-status-messages",AbortSignal.any([context.signal,signal])),tenant,customerId!);assertCurrent();if(!value)throw new Error(english ? "Original corporate-status capture unavailable" : "原企业状态接收记录不可核对");return{identity,tenant,basePath,customerId,workspace,value};}});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId && query.data.workspace===workspace ? query.data.value : undefined;
  const path=`${basePath}/join`,entry=parseEnterpriseRoute(path)?.basePath===basePath ? path : undefined;
  const status=(v:EnterpriseOwnCorporateStatusMessages["items"][number]["toStatus"])=>english ? v : ({pending_activation:"待激活",active:"正常",suspended:"暂停",risk_restricted:"风险受限",exited:"已退出",closed:"已注销"}[v]);
  return <section aria-label={english ? "Own captured corporate-status messages" : "本人原接收企业状态消息"}>
    <h3>{english ? "Corporate status: original recipient records" : "企业状态：本人原接收记录"}</h3>
    <Alert type="info" title={english ? "Captured original recipients only" : "仅原事件已捕获的接收人"} description={english ? "Earlier or failed/oversized captures remain unavailable, never rebuilt from today's members. Only original effective active personal relationships were captured in the status transaction. Historical states/revisions grant no current rights. No internal reason, delivery/read receipt, status action or K/C recovery is provided here." : "旧历史、失败或超界的捕获仍不可用，不从今天成员补历史。只记录原状态事务中当时有效在职的个人关系；历史状态/修订不授今天权限。不公开内部原因、不声称送达/已读，不执行状态操作或恢复 K/C。"}/>
    {!enabled ? <Alert type="warning" title={english ? "Sign in with your current personal account" : "请使用当前个人账号登录"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read original corporate status" : "读取原企业状态接收记录"} disabled={query.isFetching} onAction={refresh}/>
      {query.isFetching && <p role="status">{english ? "Reading original recipient records" : "正在读取原接收记录"}</p>}
      {query.error && <Alert type="error" title={english ? "Original corporate-status source unavailable" : "原企业状态接收来源不可用"}/>}
      {visible && <>{visible.items.length===0 && <p>{english ? "No original recipient records read; uncaptured history remains unavailable." : "未读到本人原接收记录；未捕获历史仍不可用。"}</p>}
        <Table rowKey="historyId" dataSource={visible.items} sorting={false} pagination={false} onRefresh={refresh} columns={[
          {title:english ? "Original event (UTC)" : "原事件时间（UTC）",dataIndex:"at"},{title:english ? "Original event reference" : "原事件引用",dataIndex:"historyId"},{title:english ? "Original enterprise" : "原企业引用",dataIndex:"corporateCustomerId"},{title:english ? "Original relationship" : "原关系",dataIndex:"membershipId"},
          {title:english ? "Original states" : "原前后状态",render:(_,r)=>`${status(r.fromStatus)} / ${status(r.toStatus)}`},{title:english ? "Original relationship revision (UTC)" : "原关系修订（UTC）",dataIndex:"membershipUpdatedAt"},{title:english ? "Recipient captured (UTC)" : "接收人捕获时间（UTC）",dataIndex:"capturedAt"},{title:english ? "Own page" : "本人入口",render:()=>entry ? <Link to={entry}>{english ? "Open own relationship page" : "打开本人关系页"}</Link> : english ? "Own entry unavailable" : "本人入口不可用"}
        ]}/>
      </>}
    </>}
  </section>;
}
