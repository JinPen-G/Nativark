/** Shared original transfer receipt projection for corporate audit and addressed
 * personal messages. Callers authorize their audience; this does not grant access,
 * read current authority, recover keys or execute a transfer decision. */
import { ConflictException } from "@nestjs/common";
import { enterpriseInviteTransferAuditEntrySnapshot, enterpriseTransferDecisionResolutionMatches, type EnterpriseInviteTransferAuditEntry, type EnterpriseTransferDecisionResolution } from "@rental-os/shared";
import { enterpriseHash, enterpriseJson } from "./enterprise-command.service";
export interface OriginalAdministratorTransferReceiptRow {
  tenantId: string; corporateCustomerId: string | null; auditObjectId: string | null; objectType: string;
  operationKey: string; actorUserId: string; target: string; reason: string; result: unknown; createdAt: Date;
  requestHash?: string; applicantCustomerId?: string; association?: unknown;
  originalTarget?: string; originalResult?: unknown; originalHash?: string;
}
const reference=(v:unknown):v is string=>typeof v==="string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
export function projectOriginalAdministratorTransferReceipt(row: OriginalAdministratorTransferReceiptRow, tenantId: string, corporateId: string): EnterpriseInviteTransferAuditEntry {
  const invalid=()=>new ConflictException("原交接收据关联无法核对");
  const object=(raw:unknown):Record<string,unknown>=>{let value:unknown;try{value=enterpriseJson(raw);}catch{throw invalid();}if(!value || typeof value!=="object" || Array.isArray(value))throw invalid();return value as Record<string,unknown>;};
  if(row.tenantId!==tenantId || row.corporateCustomerId!==corporateId || !reference(row.auditObjectId) || row.objectType!=="administrator_transfer"
    || typeof row.actorUserId!=="string" || !row.actorUserId.startsWith("customer:") || typeof row.target!=="string" || !Number.isFinite(row.createdAt?.getTime()) || !reference(row.applicantCustomerId))throw invalid();
  const actor=row.actorUserId.slice(9),action=row.target.slice(0,row.target.indexOf(":")),raw=object(row.result),id=row.auditObjectId;
  const resolution=(raw:unknown):EnterpriseTransferDecisionResolution=>{
    const value=object(raw);
    if(!reference(value.originalOperationKey) || value.originalOperationKey.length>128 || !reference(value.closureOperationKey) || value.closureOperationKey.length>128
      || !enterpriseTransferDecisionResolutionMatches(value,{tenantId,applicantCustomerId:actor,transferId:id,originalOperationKey:value.originalOperationKey,closureOperationKey:value.closureOperationKey}) || value.corporateCustomerId!==corporateId)throw invalid();
    // Keep the original canonical field order: MySQL JSON order and private
    // extensions cannot change the original seal encoding or become public facts.
    return {version:1,purpose:"administrator_transfer_resolution",outcome:value.outcome,tenantId,corporateCustomerId:corporateId,applicantCustomerId:actor,transferId:id,
      originalOperationKey:value.originalOperationKey,closureOperationKey:value.closureOperationKey,decision:{id:value.decision.id,state:value.decision.state,revision:value.decision.revision},retryable:false};
  };
  let result:EnterpriseInviteTransferAuditEntry["result"];
  if(action==="administrator.transfer"){
    const association=object(row.association);
    if(row.target!==`administrator.transfer:${corporateId}` || raw.id!==id || association.fromCustomerId!==actor || !reference(association.targetMembershipId) || row.applicantCustomerId===actor)throw invalid();
    result={id,state:raw.state as "pending",revision:raw.revision as number};
  }else{
    if(row.applicantCustomerId!==actor)throw invalid();
    if(action==="administrator.accept"){
      if(row.target!==`administrator.accept:${id}` || raw.id!==id)throw invalid();
      result={id,state:raw.state as "approved"|"rejected",revision:raw.revision as number};
    }else{
      const value=resolution(raw);
      if(action==="administrator.decision.sealed"){
        if(row.target!==`administrator.decision.sealed:${id}` || value.outcome!=="closed" || value.originalOperationKey!==row.operationKey || row.requestHash!==enterpriseHash({action:"administrator.decision.sealed",...value}))throw invalid();
      }else if(action==="administrator.decision.close"){
        if(value.closureOperationKey!==row.operationKey || row.target!==`administrator.decision.close:${enterpriseHash({transferId:id,originalOperationKey:value.originalOperationKey})}`)throw invalid();
        if(value.outcome==="closed"){
          const sealed=resolution(row.originalResult);
          if(row.originalTarget!==`administrator.decision.sealed:${id}` || sealed.outcome!=="closed" || enterpriseHash(sealed)!==enterpriseHash(value) || row.originalHash!==enterpriseHash({action:"administrator.decision.sealed",...sealed}))throw invalid();
        }else{
          const prior=object(row.originalResult);
          if(row.originalTarget!==`administrator.accept:${id}` || prior.id!==id || prior.state!==value.decision.state || prior.revision!==value.decision.revision)throw invalid();
        }
      }else throw invalid();
      result={id,state:value.decision.state,revision:value.decision.revision,outcome:value.outcome};
    }
  }
  const item=enterpriseInviteTransferAuditEntrySnapshot({operationKey:row.operationKey,objectId:id,objectType:"administrator_transfer",actorCustomerId:actor,action,reason:row.reason,createdAt:row.createdAt.toISOString(),result});
  if(!item)throw invalid();return item;
}
