/** Retained-applicant join-review receipts, not current member authority.
 * A recorded rejection may be observed invalidation; no decision reason is invented. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { enterpriseOwnJoinReviewMessagesSnapshot, type EnterpriseOwnJoinReviewMessages } from "@rental-os/shared";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseJoinReviewMessagesPanel({english}:{english:boolean}) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode,identity=context.identity,tenant=context.tenantCode,basePath=context.basePath;
  const enabled=Boolean(customerId && context.session?.customer.customerType==="personal" && !context.loading && !context.signal.aborted);
  const assertCurrent=()=>{const c=owner.current;if(!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath || c.session?.customer.customerId!==customerId || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted)throw new Error(english ? "Current personal join-review scope changed" : "当前本人加入审核消息身份已变化");};
  const query=useQuery({queryKey:["enterprise-own-join-review-messages",identity,tenant,basePath,customerId,workspace],enabled,queryFn:async({signal})=>{assertCurrent();const value=enterpriseOwnJoinReviewMessagesSnapshot(await context.read<EnterpriseOwnJoinReviewMessages>("/enterprise/my-join-review-messages",AbortSignal.any([context.signal,signal])),tenant,customerId!);assertCurrent();if(!value)throw new Error(english ? "Original join-review messages unavailable" : "本人加入原审核消息不可核对");return{identity,tenant,basePath,customerId,workspace,value};}});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId && query.data.workspace===workspace ? query.data.value : undefined;
  const path=`${basePath}/join`,entry=parseEnterpriseRoute(path)?.basePath===basePath ? path : undefined;
  const state=(v:EnterpriseOwnJoinReviewMessages["items"][number]["state"])=>v==="approved" ? english ? "Original result: approved" : "原结果：通过" : english ? "Original result: rejected" : "原结果：拒绝";
  return <section aria-label={english ? "Own original join-review messages" : "本人加入申请原审核消息"}>
    <h3>{english ? "Join application: original review receipts" : "本人加入申请：原审核收据"}</h3>
    <Alert type="info" title={english ? "Original outcomes, not current membership or delivery" : "原收据结果，非当前成员权或送达"} description={english ? "A rejected result may also record invalidation observed during review. The operation reason is not proof of the specific rejection reason. No invitation code, personal material or internal logs are included. Delivery/read receipts are not recorded; no authority, review or K/C recovery runs here." : "拒绝结果也可能是审核操作观察到原申请失效；原操作原因不证明具体拒绝原因，不用今天资料补结论。不公开邀请码、个人材料或内部日志，送达/已读未记录；不授今天权限、不执行审核或恢复 K/C。"}/>
    {!enabled ? <Alert type="warning" title={english ? "Sign in with your current personal account" : "请使用当前个人账号登录"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read original join reviews" : "读取本人加入原审核记录"} disabled={query.isFetching} onAction={refresh}/>
      {query.isFetching && <p role="status">{english ? "Reading original join-review receipts" : "正在读取原加入审核收据"}</p>}
      {query.error && <Alert type="error" title={english ? "Original join-review messages could not be verified" : "本人加入原审核消息未核对成功"}/>}
      {visible && <>{visible.items.length===0 && <p>{english ? "No original join reviews in this scope; not complete history." : "本范围未读到原加入审核收据，不代表完整历史为空。"}</p>}
        <Table rowKey="operationKey" dataSource={visible.items} sorting={false} pagination={false} onRefresh={refresh} columns={[
          {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},{title:english ? "Original request" : "原申请",dataIndex:"requestId"},{title:english ? "Original enterprise reference" : "原企业引用",dataIndex:"corporateCustomerId"},{title:english ? "Original receipt result" : "原收据结果",render:(_,r)=>state(r.state)},
          {title:english ? "Original revision" : "原修订",dataIndex:"revision"},{title:english ? "Original operation reason" : "原操作原因",dataIndex:"reason"},{title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"},{title:english ? "Own page" : "本人入口",render:()=>entry ? <Link to={entry}>{english ? "Open own join page" : "打开本人加入页"}</Link> : english ? "Own entry unavailable" : "本人入口不可用"}
        ]}/>
      </>}
    </>}
  </section>;
}
