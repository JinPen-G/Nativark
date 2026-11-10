/** Explicit current-workspace merchant coordination, not Core execution.
 * Original material and native confirmation are frozen; unknown K is read only. */
import { useEffect, useRef, useState } from "react";
import { enterpriseRentalHandoffMaterialSnapshot, type EnterpriseRentalHandoffMerchantView, type EnterpriseRentalHandoffReviewed } from "@rental-os/shared";
import { ActionButton, Alert, ConfirmAction, Input } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { useOriginalEnterpriseOperation } from "./original-enterprise-operation";
import { EnterpriseRentalHandoffQueue } from "./EnterpriseRentalHandoffQueue";
const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
const utc = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function copyMerchantRentalHandoff(value: unknown): EnterpriseRentalHandoffMerchantView {
  const row = value as EnterpriseRentalHandoffMerchantView | null;
  if (!row || Array.isArray(row) || !reference(row.id) || !reference(row.orderId) || !reference(row.applicantCustomerId) || !["pending","reviewed","withdrawn"].includes(row.state) || !Number.isSafeInteger(row.revision) || row.revision < 1
    || typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > 500 || !utc(row.createdAt) || !utc(row.updatedAt) || row.effect !== "request_only_no_business_change") throw new Error("原交接申请材料不可核对");
  const material = enterpriseRentalHandoffMaterialSnapshot(row.material, row.orderId, row.material?.workspaceCode), review = row.merchantReview;
  if (!material || material.subjects.user !== "self" || Boolean(review) !== (row.state === "reviewed") || review && (!reference(review.operatorId) || typeof review.reason !== "string" || !review.reason.trim() || review.reason.length > 500 || !utc(review.reviewedAt) || row.revision !== 2)) throw new Error("原交接申请处理依据不可核对");
  return { id:row.id,orderId:row.orderId,applicantCustomerId:row.applicantCustomerId,state:row.state,revision:row.revision,material,reason:row.reason,createdAt:row.createdAt,updatedAt:row.updatedAt,effect:row.effect,
    ...(review ? {merchantReview:{operatorId:review.operatorId,reason:review.reason,reviewedAt:review.reviewedAt}} : {}) };
}
type Material = { identity: string; locator: string; value: EnterpriseRentalHandoffMerchantView; key: string };
export function EnterpriseRentalHandoffs() {
  const { t } = useLocale(), auth = useAuthStore(), operation = useOriginalEnterpriseOperation("enterprise-rental-handoff");
  const [requestId,setRequestId]=useState(""),[reason,setReason]=useState(""),[material,setMaterial]=useState<Material>(),[reading,setReading]=useState(false),[error,setError]=useState("");
  const [reasonOwner,setReasonOwner]=useState("");
  const [original,setOriginal]=useState<{identity:string;value:EnterpriseRentalHandoffReviewed}>();
  const confirmation=useRef<{material:Material;reason:string}|undefined>(undefined),readState=useRef({epoch:0,busy:false});
  const permitted=Boolean(auth.sessionVerified&&auth.currentWorkspaceId&&auth.hasPermission("rental-os:corporate:manage")&&auth.hasPermission("rental-os:order:view")&&(auth.user?.isPlatformAdmin||auth.user?.dataScope==="all"));
  const canRecord=permitted&&auth.hasPermission("rental-os:order:operate"),locator=JSON.stringify([operation.identity,requestId]);
  const visible=permitted&&!reading&&!error&&material?.identity===operation.identity&&material.locator===locator?material:undefined;
  const latest=useRef({locator,requestId,visible,reason,reasonOwner});latest.current={locator,requestId,visible,reason,reasonOwner};
  useEffect(()=>{readState.current.epoch++;readState.current.busy=false;setReading(false);setMaterial(undefined);setError("");setReason("");setReasonOwner("");setOriginal(undefined);confirmation.current=undefined;},[operation.identity]);
  useEffect(()=>()=>{readState.current.epoch++;readState.current.busy=false;},[]);
  const assertPermission=(write=false)=>{operation.assertCurrent();const current=useAuthStore.getState();if(!current.currentWorkspaceId||!current.hasPermission("rental-os:corporate:manage")||!current.hasPermission("rental-os:order:view")||write&&!current.hasPermission("rental-os:order:operate")||!current.user?.isPlatformAdmin&&current.user?.dataScope!=="all")throw new Error(t("当前商户或订单权限不可用"));};
  const read=async()=>{
    assertPermission();if(!reference(requestId)||latest.current.locator!==locator||readState.current.busy)throw new Error(t("原交接申请引用不可核对"));
    const epoch=++readState.current.epoch;readState.current.busy=true;latest.current.visible=undefined;confirmation.current=undefined;setReading(true);setMaterial(undefined);setError("");
    try{const value=copyMerchantRentalHandoff(await operation.read(`/rental/v1/enterprise-handoff-requests/${encodeURIComponent(requestId)}`));assertPermission();if(epoch!==readState.current.epoch||latest.current.locator!==locator||value.id!==requestId)throw new Error(t("原交接材料读取已隔离"));setMaterial({identity:operation.identity,locator,value,key:JSON.stringify(value)});}
    catch(e){if(epoch===readState.current.epoch&&latest.current.locator===locator){setMaterial(undefined);setError(t("原交接申请材料不可读取"));}throw e;}
    finally{if(epoch===readState.current.epoch){readState.current.busy=false;setReading(false);}}
  };
  const submit=async()=>{
    const frozen=confirmation.current;
    const assertOriginal=()=>{assertPermission(true);if(!frozen||latest.current.visible!==frozen.material||frozen.material.locator!==latest.current.locator||latest.current.reason!==frozen.reason||latest.current.reasonOwner!==frozen.material.value.id||!frozen.reason.trim()||frozen.reason.length>500||frozen.material.value.state!=="pending"||frozen.material.value.revision!==1)throw new Error(t("原交接材料或处理意见已变化"));};
    assertOriginal();
    await operation.run<EnterpriseRentalHandoffReviewed>(async()=>{
      assertOriginal();const value=copyMerchantRentalHandoff(await operation.read(`/rental/v1/enterprise-handoff-requests/${encodeURIComponent(frozen!.material.value.id)}`));assertOriginal();if(JSON.stringify(value)!==frozen!.material.key)throw new Error(t("原交接申请已变化，请重新核对"));
      return{path:`/rental/v1/enterprise-handoff-requests/${encodeURIComponent(value.id)}/review`,method:"post",input:{expectedRevision:1,reason:frozen!.reason.trim(),materialKey:frozen!.material.key,confirm:true}};
    },async value=>{operation.assertCurrent();setOriginal({identity:operation.identity,value});});
    if(latest.current.visible===frozen!.material){setReason("");confirmation.current=undefined;await read();}
  };
  const recover=async()=>{assertPermission();const receipt=await operation.recover(async()=>{});if(receipt?.state==="committed"&&receipt.result){setOriginal({identity:operation.identity,value:receipt.result as unknown as EnterpriseRentalHandoffReviewed});confirmation.current=undefined;} };
  const locate=(value:string)=>{assertPermission();if(latest.current.locator!==locator)return;readState.current.epoch++;readState.current.busy=false;latest.current.visible=undefined;latest.current.requestId=value;latest.current.locator=JSON.stringify([operation.identity,value]);confirmation.current=undefined;setRequestId(value);setMaterial(undefined);setReading(false);setError("");};
  const role=(value:string)=>value==="corporate"?t("原企业"):value==="unavailable"?t("原主体依据不足"):t("原申请人个人");
  return <section><h3>{t("原租赁交接申请")}</h3>
    <EnterpriseRentalHandoffQueue onLocate={locate}/>
    <Alert type="info" title={t("仅记录商户核对意见，不执行租赁交接")} description={t("原订单、使用人、签约付款主体、资金和员工退出授权保持不变；记录意见不等于取还、取消、退款或业务完成。")}/>
    <label htmlFor="merchant-rental-handoff-id">{t("原交接申请引用")}</label>
    <Input id="merchant-rental-handoff-id" maxLength={191} value={requestId} disabled={!permitted||operation.busy} onChange={event=>{assertPermission();if(latest.current.locator!==locator)return;readState.current.epoch++;readState.current.busy=false;latest.current.visible=undefined;latest.current.requestId=event.target.value;latest.current.locator=JSON.stringify([operation.identity,event.target.value]);confirmation.current=undefined;setRequestId(event.target.value);setMaterial(undefined);setReading(false);setError("");}}/>
    <ActionButton intent="review" label={t("读取原交接申请")} disabled={!permitted||!reference(requestId)||reading||operation.busy} onAction={read}/>
    {operation.pending&&<ActionButton intent="review" label={t("核对原交接处理结果")} disabled={!permitted||operation.busy} onAction={recover}/>}
    {original?.identity===operation.identity&&permitted&&<Alert type="info" title={t("原商户处理收据已核对，不代表业务完成")} description={`${original.value.id} / ${original.value.orderId} / ${original.value.revision}`}/>}
    {(error||operation.error)&&<Alert type="warning" title={error||operation.error}/>}
    {visible&&<><dl>
      <dt>{t("原订单")}</dt><dd>{visible.value.material.orderNo} / {visible.value.orderId}</dd>
      <dt>{t("原申请人引用")}</dt><dd>{visible.value.applicantCustomerId}</dd>
      <dt>{t("原企业与关系引用")}</dt><dd>{visible.value.material.corporateCustomerId} / {visible.value.material.corporateMembershipId}</dd>
      <dt>{t("原申请原因")}</dt><dd>{visible.value.reason}</dd>
      <dt>{t("原订单修订（UTC）")}</dt><dd>{visible.value.material.orderUpdatedAt}</dd>
      <dt>{t("原签约、付款、使用主体类别")}</dt><dd>{role(visible.value.material.subjects.contract)} / {role(visible.value.material.subjects.payer)} / {role(visible.value.material.subjects.user)}</dd>
      <dt>{t("原申请状态与修订")}</dt><dd>{t(visible.value.state==="pending"?"待商户核对":visible.value.state==="reviewed"?"已记录商户处理意见":"已撤回")} / {visible.value.revision}</dd>
      {visible.value.merchantReview&&<><dt>{t("商户处理意见与原处理时间（UTC）")}</dt><dd>{visible.value.merchantReview.reason} / {visible.value.merchantReview.reviewedAt}</dd></>}
    </dl>{visible.value.state==="pending"&&<>
      <label htmlFor="merchant-rental-handoff-opinion">{t("本条商户处理意见")}</label>
      <Input.TextArea id="merchant-rental-handoff-opinion" value={reasonOwner===visible.value.id?reason:""} maxLength={500} disabled={!canRecord||operation.blocked} onChange={event=>{assertPermission(true);if(latest.current.visible!==visible||operation.blocked)return;latest.current.reason=event.target.value;latest.current.reasonOwner=visible.value.id;setReasonOwner(visible.value.id);setReason(event.target.value);}}/>
      <ConfirmAction label={t("记录本条处理意见")} disabled={!canRecord||operation.blocked||reasonOwner!==visible.value.id||!reason.trim()} prompt={t("记录已核对原申请的商户处理意见？不改变订单、主体、资金或退出授权。")}
        onStateChange={state=>{if(state==="confirming")confirmation.current={material:visible,reason};else if(state==="idle"||state==="done")confirmation.current=undefined;}} onConfirm={submit}/>
    </>}</>}
  </section>;
}
