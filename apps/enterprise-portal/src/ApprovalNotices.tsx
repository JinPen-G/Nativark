/** Minimal approval messages and current reviewer reminders. No original command
 * is executed/recovered; every registered page remains its own admission gate. */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { enterpriseApprovalNoticesSnapshot, type EnterpriseApprovalNotices } from "@rental-os/shared";
import { parseEnterpriseRoute } from "@rental-os/web-client";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseApprovalNoticesPanel({english,review=false}:{english:boolean;review?:boolean}) {
  const context=useEnterprise(),owner=useRef(context);owner.current=context;
  const identity=context.identity,tenant=context.tenantCode,basePath=context.basePath,customerId=context.session?.customer.customerId,workspace=context.session?.workspace?.workspaceCode;
  const corporateId=review ? context.selectedCorporateId : undefined,corporate=context.entry?.corporates.find(r=>r.corporateCustomerId===corporateId),revision=review ? corporate?.permissionRevision : undefined;
  const enabled=Boolean(customerId && workspace && context.session?.customer.customerType === "personal" && !context.loading && !context.signal.aborted && (!review || corporateId && corporate?.actions.includes("approvals:review")));
  const assertCurrent=()=>{const c=owner.current,corp=c.entry?.corporates.find(r=>r.corporateCustomerId===corporateId);if (!enabled || c.identity!==identity || c.tenantCode!==tenant || c.basePath!==basePath
    || c.session?.customer.customerId!==customerId || c.session?.customer.customerType!=="personal" || c.session?.workspace?.workspaceCode!==workspace || c.loading || c.signal.aborted
    || review && (c.selectedCorporateId!==corporateId || !corp?.actions.includes("approvals:review") || corp.permissionRevision!==revision)) throw new Error(english ? "Current approval-message authority changed" : "当前批准消息身份或审批权已变化");};
  const path=review ? `/enterprise/corporates/${encodeURIComponent(corporateId ?? "")}/approval-notices` : "/enterprise/my-approval-notices";
  const query=useQuery({queryKey:["enterprise-approval-notices",identity,tenant,basePath,customerId,workspace,review,corporateId,revision],enabled,queryFn:async({signal})=>{assertCurrent();const value=enterpriseApprovalNoticesSnapshot(await context.read<EnterpriseApprovalNotices>(path,AbortSignal.any([context.signal,signal])),{tenantCode:tenant,customerId:customerId!,workspaceCode:workspace!,...(review ? {corporateCustomerId:corporateId,permissionRevision:revision} : {})});assertCurrent();if(!value)throw new Error(english ? "Original approval notice unavailable" : "原批准消息不可核对");return{identity,tenant,basePath,customerId,workspace,corporateId,revision,value};}});
  const refresh=async()=>{assertCurrent();await query.refetch({throwOnError:true});};
  const visible=enabled && !query.isFetching && !query.error && query.data?.identity===identity && query.data.tenant===tenant && query.data.basePath===basePath && query.data.customerId===customerId
    && query.data.workspace===workspace && query.data.corporateId===corporateId && query.data.revision===revision ? query.data.value : undefined;
  return <section aria-label={review ? english ? "Enterprise approval reminders" : "企业待审批提醒" : english ? "Personal approval messages" : "本人批准消息"}>
    <h3>{review ? english ? "Current enterprise approval reminders" : "当前企业待审批提醒" : english ? "Personal approval messages: recorded states" : "本人批准消息：原记录状态"}</h3>
    <Alert type="info" title={english ? "Current service and original references only" : "仅当前认证服务与原批准引用"} description={english ? "Stored states and original request/expiry times are not decision authority or proof of execution, payment or delivery. Review reminders are non-self pending records; the original page rechecks current eligibility. No K/C is resolved here." : "存储状态、原申请时间与期限不是批准权限或执行/付款/送达证明。待审批提醒仅当前有权的非本人待处理记录，原审批页仍复验全部资格；这里不解除K/C。"}/>
    {!enabled ? <Alert type="warning" title={review ? english ? "Select a current service and an enterprise with approval authority" : "请选择当前服务及有明确审批权的企业" : english ? "Sign in and select your current service" : "请登录并选择当前认证服务"}/> : <>
      <ActionButton intent="refresh" label={review ? english ? "Read approval reminders again" : "重新读取待审批提醒" : english ? "Read personal approval states again" : "重新读取本人批准状态"} onAction={refresh} disabled={query.isFetching}/>
      {query.isFetching && <p role="status">{english ? "Reading original approval records" : "正在读取原批准记录"}</p>}
      {query.error && <Alert type="error" title={english ? "Original approval messages could not be verified" : "原批准消息未核对成功"}/>}
      {visible && <>{visible.items.length===0 && <p>{english ? "No original records in this declared scope; not a complete notification history." : "声明范围内未读到原记录，不代表完整通知历史为空。"}</p>}
        <Table rowKey={r=>`${r.kind}:${r.approvalId}`} dataSource={visible.items} sorting={false} pagination={false} onRefresh={refresh} columns={[
          {title:english ? "Kind" : "批准类型",dataIndex:"kind"},{title:english ? "Original approval" : "原批准",dataIndex:"approvalId"},
          {title:english ? "Stored state (not current admission)" : "存储状态（非当前准入）",dataIndex:"state"},{title:english ? "Original revision" : "原修订",dataIndex:"revision"},
          {title:english ? "Original request time (UTC)" : "原申请时间（UTC）",dataIndex:"createdAt"},{title:english ? "Original expiry (UTC)" : "原期限（UTC）",dataIndex:"expiresAt"},
          ...(!review ? [{title:english ? "Original feedback" : "原反馈",render:(_:unknown,row:EnterpriseApprovalNotices["items"][number])=>row.feedback ?? (english ? "Feedback not recorded" : "原反馈未记录")}] : []),
          {title:english ? "Original approval page" : "原审批入口",render:(_,row)=>{const target=`${basePath}/${row.page}`;return parseEnterpriseRoute(target)?.basePath===basePath ? <Link to={target}>{english ? "Open original approval page" : "打开原审批页"}</Link> : english ? "Original entry unavailable" : "原入口不可用";}}
        ]}/>
      </>}
    </>}
  </section>;
}
