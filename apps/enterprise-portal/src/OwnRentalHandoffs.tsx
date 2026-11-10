/** Original own handoff feedback, explicit pending-request withdrawal and K recovery.
 * Not an order index or authority to change Core subjects, funds or enterprise exit. */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { enterpriseRentalHandoffSnapshot, type EnterpriseRentalHandoffView, type EnterpriseRentalHandoffWithdrawn, type EnterpriseRentalHandoffCreated } from "@rental-os/shared";
import { ActionButton, Alert, ConfirmAction, Input, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
import { useOriginalWorkflowOperation } from "./original-workflow-operation";
const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
type Feedback = { identity: string; id: string; value: EnterpriseRentalHandoffView; key: string };
export function EnterpriseOwnRentalHandoffs({ english }: { english: boolean }) {
  const context = useEnterprise(), operation = useOriginalWorkflowOperation("rental-handoff"), location = useLocation();
  const [requestId,setRequestId]=useState(""),[reason,setReason]=useState(""),[feedback,setFeedback]=useState<Feedback>(),[list,setList]=useState<{identity:string;rows:EnterpriseRentalHandoffView[]}>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [original,setOriginal]=useState<{identity:string;value:EnterpriseRentalHandoffWithdrawn|EnterpriseRentalHandoffCreated}>();
  const [reasonOwner,setReasonOwner]=useState("");
  const confirmation=useRef<{feedback:Feedback;reason:string}|undefined>(undefined),readState=useRef({epoch:0,busy:false}),mounted=useRef(true);
  const readable=Boolean(context.session?.customer.customerType==="personal"&&reference(context.session.workspace?.workspaceCode)&&!context.loading&&!context.signal.aborted);
  const visible=readable&&!busy&&!error&&feedback?.identity===context.identity&&feedback.id===requestId?feedback:undefined;
  const latest=useRef({requestId,visible,reason,reasonOwner,readable});latest.current={requestId,visible,reason,reasonOwner,readable};
  const copy=(raw:unknown)=>{const value=enterpriseRentalHandoffSnapshot(raw,context.session!.workspace!.workspaceCode);if(!value)throw new Error("原交接反馈不可核对 / Original handoff feedback unavailable");return value;};
  useEffect(()=>{readState.current.epoch++;readState.current.busy=false;setRequestId("");setReason("");setReasonOwner("");setFeedback(undefined);setList(undefined);setOriginal(undefined);setBusy(false);setError("");confirmation.current=undefined;},[context.identity]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;readState.current.epoch++;};},[]);
  const assertRead=()=>{operation.assertCurrent();if(!mounted.current||!latest.current.readable)throw new Error("当前本人服务不可读取 / Current personal service unavailable");};
  const clearFeedback=()=>{readState.current.epoch++;readState.current.busy=false;latest.current.visible=undefined;confirmation.current=undefined;setFeedback(undefined);setBusy(false);setError("");};
  const detail=async(id:string)=>{
    assertRead();if(!reference(id)||latest.current.requestId!==id||readState.current.busy)throw new Error("原交接申请引用已变化 / Original handoff reference changed");
    const epoch=++readState.current.epoch;readState.current.busy=true;latest.current.visible=undefined;confirmation.current=undefined;setFeedback(undefined);setBusy(true);setError("");
    try{const value=copy(await operation.read(`/enterprise/handoff-requests/${encodeURIComponent(id)}`));assertRead();if(epoch!==readState.current.epoch||latest.current.requestId!==id||value.id!==id)throw new Error("原读取已隔离 / Original read isolated");setFeedback({identity:context.identity,id,value,key:JSON.stringify(value)});}
    catch(e){if(mounted.current&&epoch===readState.current.epoch)setError(english?"Original handoff feedback unavailable":"原交接申请反馈不可读取");throw e;}
    finally{if(mounted.current&&epoch===readState.current.epoch){readState.current.busy=false;setBusy(false);}}
  };
  const readList=async()=>{
    assertRead();if(readState.current.busy)throw new Error("原读取仍在处理中");const epoch=++readState.current.epoch;readState.current.busy=true;latest.current.visible=undefined;confirmation.current=undefined;setFeedback(undefined);setList(undefined);setBusy(true);setError("");
    try{const raw=await operation.read<unknown>("/enterprise/handoff-requests");assertRead();if(epoch!==readState.current.epoch||!Array.isArray(raw)||raw.length>200)throw new Error("本人交接列表不可核对");const rows=raw.map(copy);if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error("原交接引用重复");setList({identity:context.identity,rows});}
    catch(e){if(mounted.current&&epoch===readState.current.epoch)setError(english?"Own handoff list unavailable; read an original request reference":"本人交接列表不可读取，可按原申请引用核对");throw e;}
    finally{if(mounted.current&&epoch===readState.current.epoch){readState.current.busy=false;setBusy(false);}}
  };
  const select=async(id:string)=>{assertRead();clearFeedback();latest.current.requestId=id;setRequestId(id);await detail(id);};
  const locate=new URLSearchParams(location.search).getAll("handoffRequestId"),deepId=locate.length===0?undefined:locate.length===1&&reference(locate[0])?locate[0]:null;
  useEffect(()=>{if(deepId===null){clearFeedback();setError(english?"Original task reference unavailable":"原交接待办引用不可核对");}else if(deepId&&readable){void select(deepId).catch(()=>{});}},[context.identity,deepId,readable]);
  const withdraw=async()=>{
    const frozen=confirmation.current;
    const assertOriginal=()=>{assertRead();if(!frozen||latest.current.visible!==frozen.feedback||latest.current.requestId!==frozen.feedback.id||latest.current.reason!==frozen.reason||latest.current.reasonOwner!==frozen.feedback.id||!frozen.reason.trim()||frozen.reason.length>500||frozen.feedback.value.state!=="pending")throw new Error("原申请或撤回确认已变化 / Original request or withdrawal confirmation changed");};
    assertOriginal();await operation.run<EnterpriseRentalHandoffWithdrawn>(async()=>{assertOriginal();const value=copy(await operation.read(`/enterprise/handoff-requests/${encodeURIComponent(frozen!.feedback.id)}`));assertOriginal();if(JSON.stringify(value)!==frozen!.feedback.key)throw new Error("原交接申请已变化 / Original handoff request changed");return{path:`/enterprise/handoff-requests/${encodeURIComponent(value.id)}/withdraw`,input:{expectedRevision:1,reason:frozen!.reason.trim(),materialKey:frozen!.feedback.key,confirm:true}};},async value=>{operation.assertCurrent();setOriginal({identity:context.identity,value});});
    if(latest.current.visible===frozen!.feedback){setReason("");confirmation.current=undefined;await detail(frozen!.feedback.id);}
  };
  const recover=async()=>{assertRead();const receipt=await operation.recover(async()=>{});if(receipt?.state==="committed"&&receipt.result){operation.assertCurrent();setOriginal({identity:context.identity,value:receipt.result as unknown as EnterpriseRentalHandoffWithdrawn|EnterpriseRentalHandoffCreated});clearFeedback();}};
  const state=(value:string)=>value==="pending"?(english?"Awaiting merchant review":"待商户核对"):value==="reviewed"?(english?"Merchant opinion recorded":"已记录商户意见"):(english?"Request withdrawn":"申请已撤回");
  return <section aria-label={english?"Own original handoff requests":"本人原交接申请"}><h3>{english?"Track original handoff requests":"跟进本人原交接申请"}</h3>
    <Alert type="info" title={english?"Requests and opinions do not change rental responsibility":"申请、意见或撤回不改变原租赁责任"} description={english?"Current-service personal requests only. Withdrawal ends a pending request, not an order, payment or enterprise exit. Merchant opinions are not handoff completion.":"仅当前服务本人申请。撤回只结束待核对申请，不取消订单、不退款或改变企业退出；商户意见不等于业务交接完成。"}/>
    <ActionButton intent="review" label={english?"Read my handoff requests":"读取本人交接申请"} disabled={!readable||busy||operation.busy} onAction={readList}/>
    {operation.pending&&<ActionButton intent="review" label={operation.rentalHandoffWithdrawalId?(english?"Read original handoff withdrawal":"核对原交接撤回"):(english?"Read original handoff creation":"核对原交接创建")} disabled={!readable||operation.busy} onAction={recover}/>}
    {original?.identity===context.identity&&readable&&<Alert type="info" title={original.value.state==="withdrawn"?(english?"Original request withdrawal verified; rental unchanged":"原申请撤回已核对，租赁未改变"):(english?"Original creation verified; not merchant acceptance":"原申请创建已核对，不代表商户受理")} description={`${original.value.id} / ${original.value.orderId}`}/>}
    <label htmlFor="own-rental-handoff-id">{english?"Original handoff request reference":"原交接申请引用"}</label><Input id="own-rental-handoff-id" value={requestId} maxLength={191} disabled={!readable||operation.busy} onChange={event=>{assertRead();clearFeedback();latest.current.requestId=event.target.value;setRequestId(event.target.value);}}/>
    <ActionButton intent="review" label={english?"Read this original handoff feedback":"读取本条交接反馈"} disabled={!readable||!reference(requestId)||busy||operation.busy} onAction={()=>detail(requestId)}/>
    {(error||operation.error)&&<Alert type="warning" title={error||operation.error}/>}
    {readable&&!busy&&!error&&list?.identity===context.identity&&<Table rowKey="id" dataSource={list.rows} pagination={false} sorting={false} columns={[{title:english?"Original order":"原订单",render:(_,row:EnterpriseRentalHandoffView)=>row.material.orderNo},{title:english?"State":"状态",render:(_,row:EnterpriseRentalHandoffView)=>state(row.state)},{title:english?"Feedback":"反馈",render:(_,row:EnterpriseRentalHandoffView)=><ActionButton intent="review" label={english?"Read request feedback":"读取申请反馈"} disabled={operation.busy} onAction={()=>select(row.id)}/>}]}/>}
    {reason&&reasonOwner!==requestId&&<Alert type="info" title={english?"Unsaved withdrawal reason retained for its original request":"未保存撤回原因保留在原申请，不改绑当前申请"}/>}
    {visible&&<><dl><dt>{english?"Original order and request":"原订单与申请"}</dt><dd>{visible.value.orderId} / {visible.value.id}</dd><dt>{english?"State and revision":"状态与修订"}</dt><dd>{state(visible.value.state)} / {visible.value.revision}</dd><dt>{english?"Original request reason":"原申请原因"}</dt><dd>{visible.value.reason}</dd>{visible.value.merchantReview&&<><dt>{english?"Merchant opinion and original time (UTC)":"商户意见与原处理时间（UTC）"}</dt><dd>{visible.value.merchantReview.reason} / {visible.value.merchantReview.reviewedAt}</dd></>}</dl>
      {visible.value.state==="pending"&&<><label htmlFor="own-rental-handoff-withdraw-reason">{english?"Withdrawal reason":"撤回原因"}</label><Input.TextArea id="own-rental-handoff-withdraw-reason" value={reasonOwner===visible.id?reason:""} maxLength={500} disabled={operation.blocked} onChange={event=>{assertRead();if(latest.current.visible!==visible||operation.blocked)return;latest.current.reasonOwner=visible.id;latest.current.reason=event.target.value;setReasonOwner(visible.id);setReason(event.target.value);}}/>
        <ConfirmAction label={english?"Withdraw this handoff request":"撤回本条交接申请"} disabled={operation.blocked||reasonOwner!==visible.id||!reason.trim()} prompt={english?"Withdraw this original pending request? Orders, subjects, funds and enterprise exit remain unchanged.":"撤回本条原待核对申请？订单、主体、资金和企业退出保持不变。"} onStateChange={value=>{if(value==="confirming")confirmation.current={feedback:visible,reason};else if(value==="idle"||value==="done")confirmation.current=undefined;}} onConfirm={withdraw}/>
      </>}
    </>}
  </section>;
}
