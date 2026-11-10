/** Original employee-policy save metadata addressed by the retained relationship.
 * Not current eligibility, a policy editor, a notification sender or K/C recovery. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { enterpriseOwnEmployeePolicyMessagesSnapshot, type EnterpriseOwnEmployeePolicyMessages } from "@rental-os/shared";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseEmployeePolicyMessagesPanel({english}:{english:boolean}) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode,identity=context.identity,tenant=context.tenantCode,basePath=context.basePath;
  const enabled=Boolean(customerId && context.session?.customer.customerType==="personal" && !context.loading && !context.signal.aborted);
  const assertCurrent=()=>{const c=owner.current;if(!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath || c.session?.customer.customerId!==customerId || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted)throw new Error(english ? "Current personal policy-message scope changed" : "当前本人员工政策消息身份已变化");};
  const query=useQuery({queryKey:["enterprise-own-employee-policy-messages",identity,tenant,basePath,customerId,workspace],enabled,queryFn:async({signal})=>{assertCurrent();const value=enterpriseOwnEmployeePolicyMessagesSnapshot(await context.read<EnterpriseOwnEmployeePolicyMessages>("/enterprise/my-employee-policy-messages",AbortSignal.any([context.signal,signal])),tenant,customerId!);assertCurrent();if(!value)throw new Error(english ? "Original employee-policy receipt unavailable" : "原员工政策收据不可核对");return{identity,tenant,basePath,customerId,workspace,value};}});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId && query.data.workspace===workspace ? query.data.value : undefined;
  const path=`${basePath}/join`,entry=parseEnterpriseRoute(path)?.basePath===basePath ? path : undefined;
  return <section aria-label={english ? "Own original employee-policy messages" : "本人员工政策原收据消息"}>
    <h3>{english ? "Employee policy: original saves" : "员工政策：原保存记录"}</h3>
    <Alert type="info" title={english ? "Historical metadata, not current rental authority" : "历史元数据，不是当前租赁授权"} description={english ? "Original employee-policy saves linked to your retained relationship only. Company/merchant-wide recipients and unassociated history remain unavailable. No policy text, amounts, payment settings, internal reason, delivery/read receipt or K/C recovery is provided. Open your own relationship page to separately check current eligibility." : "只读保留的本人原关系所关联的员工政策保存记录；企业/商户范围接收人及未关联历史仍不可用。不公开政策正文、金额、付费配置或内部原因，不声称送达/已读，不恢复 K/C。当前资格须在本人关系页另行核对。"}/>
    {!enabled ? <Alert type="warning" title={english ? "Sign in with your current personal account" : "请使用当前个人账号登录"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read original employee policy saves" : "读取原员工政策保存记录"} disabled={query.isFetching} onAction={refresh}/>
      {query.isFetching && <p role="status">{english ? "Reading original policy receipts" : "正在读取原政策收据"}</p>}
      {query.error && <Alert type="error" title={english ? "Original employee-policy source unavailable" : "原员工政策消息来源不可用"}/>}
      {visible && <>{visible.items.length===0 && <p>{english ? "No associated original save receipts read; missing recipient history remains unavailable." : "未读到本人关联的原保存收据；缺接收人历史仍不可用。"}</p>}
        <Table rowKey="operationKey" dataSource={visible.items} sorting={false} pagination={false} onRefresh={refresh} columns={[
          {title:english ? "Original save (UTC)" : "原保存时间（UTC）",dataIndex:"createdAt"},{title:english ? "Original enterprise" : "原企业引用",dataIndex:"corporateCustomerId"},{title:english ? "Original relationship" : "原关系",dataIndex:"membershipId"},{title:english ? "Saved policy revision" : "原保存政策修订",dataIndex:"revision"},
          {title:english ? "Original relationship revision (UTC)" : "原关系修订（UTC）",dataIndex:"membershipUpdatedAt"},{title:english ? "Original key (read only)" : "原操作键（只读）",dataIndex:"operationKey"},{title:english ? "Own page" : "本人入口",render:()=>entry ? <Link to={entry}>{english ? "Open own relationship page" : "打开本人关系页"}</Link> : english ? "Own entry unavailable" : "本人入口不可用"}
        ]}/>
      </>}
    </>}
  </section>;
}
