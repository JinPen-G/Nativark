/** Curated corporate command audit, separate from own recovery and operator logs.
 * Retained objects supply immutable associations only; booking uses the current
 * trusted workspace. Never projects money/material or today's state as history. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { enterpriseMerchantPortalAuditEntrySnapshot, type EnterpriseMerchantPortalAuditEntry, enterpriseMerchantPolicyAuditEntrySnapshot, type EnterpriseMerchantPolicyAuditEntry, enterpriseApplicationApprovalAuditEntrySnapshot, type EnterpriseApplicationApprovalAuditEntry, enterprisePolicyAuditEntrySnapshot, type EnterprisePolicyAuditEntry, enterpriseJoinAuditEntrySnapshot, type EnterpriseJoinAuditEntry, enterpriseMembershipAuditEntrySnapshot, enterpriseInviteTransferAuditEntrySnapshot, enterpriseBusinessAuditEntrySnapshot, enterpriseExpenseAuditEntrySnapshot, type EnterpriseExpenseAuditEntry, type EnterpriseBusinessAuditEntry, type EnterpriseInviteTransferAuditEntry, type EnterpriseMembershipAudit } from "@rental-os/shared";
import { projectOriginalAdministratorTransferReceipt } from "./enterprise-transfer-receipt-projection";
import { getRequestIdentity } from "../../common/request-identity";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { enterpriseHash, enterpriseJson } from "./enterprise-command.service";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
const reference = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
@Injectable()
export class EnterpriseMembershipAuditService {
  constructor(private readonly prisma: PrismaService, private readonly access: EnterpriseAccessService) {}
  private async workflowAudits(tenantId: string, corporateId: string): Promise<EnterpriseInviteTransferAuditEntry[]> {
    type Row = { tenantId: string; corporateCustomerId: string | null; auditObjectId: string | null; objectType: "invite" | "administrator_transfer"; operationKey: string; actorUserId: string; target: string; reason: string; result: unknown; createdAt: Date; requestHash?: string; applicantCustomerId?: string; association?: unknown; originalTarget?: string; originalResult?: unknown; originalHash?: string };
    // Known creation targets remain in the result even when their ID/association
    // is corrupt, so a broken own receipt cannot become an empty success.
    const invites = await this.prisma.$queryRaw<Row[]>`
      SELECT o.tenantId,i.corporateCustomerId,i.id AS auditObjectId,'invite' AS objectType,o.operationKey,o.actorUserId,o.target,o.reason,o.result,o.createdAt
      FROM enterprise_portal_operations o LEFT JOIN enterprise_invites i ON i.tenantId=o.tenantId AND i.corporateCustomerId=${corporateId}
        AND (o.target=CONCAT('invite.revoke:',i.id) OR (o.target=CONCAT('invite.create:',${corporateId}) AND i.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.invite.id'))))
      WHERE o.tenantId=${tenantId} AND o.actorUserId LIKE 'customer:%'
        AND (o.target=CONCAT('invite.create:',${corporateId}) OR o.target=CONCAT('invite.revoke:',i.id))
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    const transfers = await this.prisma.$queryRaw<Row[]>`
      SELECT o.tenantId,w.corporateCustomerId,w.id AS auditObjectId,'administrator_transfer' AS objectType,o.operationKey,o.actorUserId,o.target,o.reason,o.result,o.createdAt,o.requestHash,
        w.applicantCustomerId,w.payload AS association,k.target AS originalTarget,k.result AS originalResult,k.requestHash AS originalHash
      FROM enterprise_portal_operations o LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId AND w.corporateCustomerId=${corporateId} AND w.kind='administrator_transfer'
        AND (o.target IN (CONCAT('administrator.accept:',w.id),CONCAT('administrator.decision.sealed:',w.id))
          OR (o.target=CONCAT('administrator.transfer:',${corporateId}) AND w.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id')))
          OR (o.target LIKE 'administrator.decision.close:%' AND w.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.transferId'))))
      LEFT JOIN enterprise_portal_operations k ON k.tenantId=o.tenantId AND k.operationKey=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.originalOperationKey')) AND k.actorUserId=o.actorUserId
        AND k.target IN (CONCAT('administrator.accept:',w.id),CONCAT('administrator.decision.sealed:',w.id))
      WHERE o.tenantId=${tenantId} AND o.actorUserId LIKE 'customer:%'
        AND (o.target=CONCAT('administrator.transfer:',${corporateId}) OR o.target IN (CONCAT('administrator.accept:',w.id),CONCAT('administrator.decision.sealed:',w.id))
          OR (o.target LIKE 'administrator.decision.close:%' AND JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.corporateCustomerId'))=${corporateId}))
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    if (invites.length+transfers.length>200) throw new ConflictException("邀请交接审计超出有界范围");
    const invalid = () => new ConflictException("原邀请或交接审计关联无法核对");
    const object = (raw: unknown): Record<string, unknown> => { let value: unknown; try { value=enterpriseJson(raw); } catch { throw invalid(); } if(!value || typeof value!=="object" || Array.isArray(value))throw invalid(); return value as Record<string,unknown>; };
    return [...invites,...transfers].map(row => {
      if(row.objectType!=="invite")return projectOriginalAdministratorTransferReceipt(row,tenantId,corporateId);
      if(row.tenantId!==tenantId || row.corporateCustomerId!==corporateId || !reference(row.auditObjectId) || typeof row.actorUserId!=="string" || !row.actorUserId.startsWith("customer:") || typeof row.target!=="string" || !Number.isFinite(row.createdAt?.getTime())) throw invalid();
      const action=row.target.slice(0,row.target.indexOf(":")), actor=row.actorUserId.slice("customer:".length), raw=object(row.result);
      let result: EnterpriseInviteTransferAuditEntry["result"];
      if(action === "invite.create") { const invite=object(raw.invite); if(row.target!==`invite.create:${corporateId}` || invite.id!==row.auditObjectId || invite.corporateCustomerId!==corporateId || raw.codeRetrievableAgain!==false || "code" in raw) throw invalid(); result={id:row.auditObjectId,status:invite.status as "active",revision:invite.revision as number,createdAt:invite.createdAt as string,expiresAt:invite.expiresAt as string,maxUses:invite.maxUses as number,used:invite.used as 0,codeRetrievableAgain:false}; }
      else { if(action!=="invite.revoke" || row.target!==`invite.revoke:${row.auditObjectId}` || raw.id!==row.auditObjectId || "code" in raw)throw invalid(); result={id:row.auditObjectId,status:raw.status as "revoked",revision:raw.revision as number}; }
      const item=enterpriseInviteTransferAuditEntrySnapshot({operationKey:row.operationKey,objectId:row.auditObjectId,objectType:row.objectType,actorCustomerId:actor,action,reason:row.reason,createdAt:row.createdAt.toISOString(),result});
      if(!item)throw invalid();return item;
    });
  }
  private async businessAudits(context: ClientRequestContext, corporateId: string): Promise<EnterpriseBusinessAuditEntry[]> {
    type Row = { tenantId: string; corporateCustomerId: string | null; auditObjectId: string | null; objectType: "booking_approval" | "management_request";
      applicantCustomerId: string | null; workspaceId?: string; expectedRequestTarget?: string; operationKey: string; actorUserId: string; target: string; reason: string; result: unknown; createdAt: Date };
    // Only the public management-review receipt is included from operators. Other
    // operator/security logs and the request's proposal/evidence are not read.
    const management = await this.prisma.$queryRaw<Row[]>`
      SELECT o.tenantId,w.corporateCustomerId,w.id AS auditObjectId,'management_request' AS objectType,w.applicantCustomerId,
        o.operationKey,o.actorUserId,o.target,o.reason,o.result,o.createdAt
      FROM enterprise_portal_operations o LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId AND w.corporateCustomerId=${corporateId} AND w.kind='finance_request'
        AND ((o.target=CONCAT('management-request.save:',${corporateId}) AND w.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id')))
          OR o.target IN (CONCAT('management-request.withdraw:',w.id),CONCAT('management-request.review:',w.id)))
      WHERE o.tenantId=${context.tenantId}
        AND ((o.actorUserId LIKE 'customer:%' AND (o.target=CONCAT('management-request.save:',${corporateId}) OR o.target=CONCAT('management-request.withdraw:',w.id)))
          OR (o.actorUserId LIKE 'operator:%' AND o.target=CONCAT('management-request.review:',w.id)))
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    // The current trusted workspace is applied before LIMIT, not post-filtered
    // from an enterprise-wide approval list. Missing workspace never means all.
    const bookings = context.workspaceId ? await this.prisma.$queryRaw<Row[]>`
      SELECT o.tenantId,a.corporateCustomerId,a.id AS auditObjectId,'booking_approval' AS objectType,a.applicantCustomerId,a.workspaceId,
        CONCAT('approval.request:',a.quoteId) AS expectedRequestTarget,o.operationKey,o.actorUserId,o.target,o.reason,o.result,o.createdAt
      FROM enterprise_booking_approvals a JOIN enterprise_portal_operations o ON o.tenantId=a.tenantId
        AND o.target IN (CONCAT('approval.request:',a.quoteId),CONCAT('approval.decision:',a.id),CONCAT('approval.submit:',a.id),CONCAT('approval.close:',a.id))
      WHERE a.tenantId=${context.tenantId} AND a.corporateCustomerId=${corporateId} AND a.workspaceId=${context.workspaceId} AND o.actorUserId LIKE 'customer:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201` : [];
    if (management.length+bookings.length>200) throw new ConflictException("批准资料审计超出有界范围");
    const invalid = () => new ConflictException("原批准或资料审核收据关联不可核对");
    return [...management,...bookings].map(row => {
      if (row.tenantId!==context.tenantId || row.corporateCustomerId!==corporateId || !reference(row.auditObjectId) || !reference(row.applicantCustomerId)
        || typeof row.actorUserId!=="string" || typeof row.target!=="string" || !Number.isFinite(row.createdAt?.getTime())) throw invalid();
      const actorMatch=/^(customer|operator):([a-zA-Z0-9_-]{1,191})$/u.exec(row.actorUserId);
      if (!actorMatch) throw invalid();
      let raw: Record<string,unknown>; try { const decoded=enterpriseJson(row.result); if (!decoded || typeof decoded!=="object" || Array.isArray(decoded)) throw invalid(); raw=decoded as Record<string,unknown>; } catch { throw invalid(); }
      const action=row.target.slice(0,row.target.indexOf(":")), kind=actorMatch[1] as "customer"|"operator", actorId=actorMatch[2];
      if (row.objectType === "booking_approval") {
        if (row.workspaceId!==context.workspaceId || kind!=="customer" || !["approval.request","approval.decision","approval.submit","approval.close"].includes(action)
          || row.target!==(action === "approval.request" ? row.expectedRequestTarget : `${action}:${row.auditObjectId}`)
          || (action === "approval.submit" ? raw.approvalId : raw.id)!==row.auditObjectId
          || (action === "approval.decision" ? (raw.state === "withdrawn" ? actorId!==row.applicantCustomerId : actorId===row.applicantCustomerId) : actorId!==row.applicantCustomerId)
          || action === "approval.submit" && raw.state === "executing" && raw.executionKey!==row.operationKey) throw invalid();
      } else if (row.objectType === "management_request") {
        if (!["management-request.save","management-request.withdraw","management-request.review"].includes(action)
          || row.target!==(action === "management-request.save" ? `management-request.save:${corporateId}` : `${action}:${row.auditObjectId}`)
          || raw.id!==row.auditObjectId || (action === "management-request.review" ? kind!=="operator" : kind!=="customer" || actorId!==row.applicantCustomerId)) throw invalid();
      } else throw invalid();
      const result={id:row.auditObjectId,state:raw.state,revision:raw.revision,effect:raw.effect,execution:raw.execution,inventory:raw.inventory,expiresAt:raw.expiresAt,retryable:raw.retryable};
      const item=enterpriseBusinessAuditEntrySnapshot({operationKey:row.operationKey,objectId:row.auditObjectId,objectType:row.objectType,actor:{kind,id:actorId},action,reason:row.reason,createdAt:row.createdAt.toISOString(),result});
      if (!item) throw invalid(); return item;
    });
  }
  private async expenseAudits(context: ClientRequestContext, corporateId: string): Promise<EnterpriseExpenseAuditEntry[]> {
    if (!context.workspaceId) return [];
    type Row = { tenantId:string; corporateCustomerId:string; auditObjectId:string; auditOrderId:string; workspaceId:string; applicantCustomerId:string;
      objectType:"extension_approval"|"exchange_approval"; operationKey:string; actorUserId:string; target:string; reason:string; result:unknown; createdAt:Date;
      requestHash?:string; originalKey?:string; originalTarget?:string; originalResult?:unknown; originalHash?:string };
    // No order/preview reader: retained approval IDs, owner and service are the
    // association. Unassociated request seals cannot be attributed to a company.
    const extensions = await this.prisma.$queryRaw<Row[]>`
      SELECT a.tenantId,a.corporateCustomerId,a.id AS auditObjectId,a.orderId AS auditOrderId,a.workspaceId,a.applicantCustomerId,'extension_approval' AS objectType,
        o.operationKey,o.actorUserId,o.target,o.reason,o.result,o.createdAt,o.requestHash,k.operationKey AS originalKey,k.target AS originalTarget,k.result AS originalResult,k.requestHash AS originalHash
      FROM enterprise_extension_approvals a JOIN enterprise_portal_operations o ON o.tenantId=a.tenantId
        AND ((o.target=CONCAT('extension.request:',a.orderId) AND a.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id')))
          OR o.target IN (CONCAT('extension.decision:',a.id),CONCAT('extension.submit:',a.id),CONCAT('extension.close:',a.id),CONCAT('extension.sealed:',a.id))
          OR (o.target LIKE 'extension.request.close:%' AND a.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.approvalId'))))
      LEFT JOIN enterprise_portal_operations k ON k.tenantId=o.tenantId AND k.actorUserId=o.actorUserId
        AND k.operationKey=COALESCE(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.originalOperationKey')),JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.closedOperationKey')))
      WHERE a.tenantId=${context.tenantId} AND a.corporateCustomerId=${corporateId} AND a.workspaceId=${context.workspaceId} AND o.actorUserId LIKE 'customer:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    const exchanges = await this.prisma.$queryRaw<Row[]>`
      SELECT a.tenantId,a.corporateCustomerId,a.id AS auditObjectId,a.orderId AS auditOrderId,a.workspaceId,a.applicantCustomerId,'exchange_approval' AS objectType,
        o.operationKey,o.actorUserId,o.target,o.reason,o.result,o.createdAt,k.operationKey AS originalKey,k.target AS originalTarget,k.result AS originalResult
      FROM enterprise_exchange_approvals a JOIN enterprise_portal_operations o ON o.tenantId=a.tenantId
        AND ((o.target=CONCAT('exchange.request:',a.orderId) AND a.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id')))
          OR o.target IN (CONCAT('exchange.decision:',a.id),CONCAT('exchange.expense.confirm:',a.id))
          OR (o.target LIKE 'exchange.request.close:%' AND a.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.approvalId'))))
      LEFT JOIN enterprise_portal_operations k ON k.tenantId=o.tenantId AND k.actorUserId=o.actorUserId
        AND k.operationKey=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.originalOperationKey'))
      WHERE a.tenantId=${context.tenantId} AND a.corporateCustomerId=${corporateId} AND a.workspaceId=${context.workspaceId} AND o.actorUserId LIKE 'customer:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    if (extensions.length+exchanges.length>200) throw new ConflictException("续租换货审计超出有界范围");
    const invalid=()=>new ConflictException("原续租换货批准收据关联不可核对");
    const object=(value:unknown):Record<string,unknown> => { try { const raw=enterpriseJson(value); if (!raw || typeof raw!=="object" || Array.isArray(raw)) throw invalid(); return raw as Record<string,unknown>; } catch { throw invalid(); } };
    return [...extensions,...exchanges].map(row => {
      if (row.tenantId!==context.tenantId || row.corporateCustomerId!==corporateId || row.workspaceId!==context.workspaceId || !reference(row.auditObjectId)
        || !reference(row.auditOrderId) || !reference(row.applicantCustomerId) || typeof row.actorUserId!=="string" || !row.actorUserId.startsWith("customer:") || !Number.isFinite(row.createdAt?.getTime())) throw invalid();
      const actor=row.actorUserId.slice(9), prefix=row.objectType === "extension_approval" ? "extension" : row.objectType === "exchange_approval" ? "exchange" : undefined;
      if (!prefix || !reference(actor) || typeof row.target!=="string") throw invalid();
      const raw=object(row.result), action=row.target.slice(0,row.target.indexOf(":"));
      if (action===`${prefix}.request.close`) {
        const key=raw.originalOperationKey;
        if (actor!==row.applicantCustomerId || raw.state!=="observed" || raw.approvalId!==row.auditObjectId || raw.orderId!==row.auditOrderId || raw.workspaceId!==context.workspaceId
          || raw.workspaceCode!==context.workspaceCode || raw.applicantCustomerId!==actor || !reference(key) || key.length>128 || key===row.operationKey || raw.closureOperationKey!==row.operationKey
          || row.originalKey!==key || row.originalTarget!==`${prefix}.request:${row.auditOrderId}`
          || row.target!==`${prefix}.request.close:${prefix === "extension" ? enterpriseHash({orderId:row.auditOrderId,workspaceId:context.workspaceId,originalOperationKey:key}) : requestFingerprint({orderId:row.auditOrderId,workspaceId:context.workspaceId,originalOperationKey:key})}`) throw invalid();
        const prior=object(row.originalResult);
        if (prior.id!==row.auditObjectId || !enterpriseExpenseAuditEntrySnapshot({operationKey:key,objectId:row.auditObjectId,objectType:row.objectType,actorCustomerId:actor,action:`${prefix}.request`,reason:row.reason,createdAt:row.createdAt.toISOString(),result:prior})) throw invalid();
      } else {
        if (row.target!==`${action}:${action===`${prefix}.request` ? row.auditOrderId : row.auditObjectId}`
          || (action === "extension.submit" || action === "extension.close" || action === "extension.sealed" ? raw.approvalId : raw.id)!==row.auditObjectId
          || (action===`${prefix}.decision` ? raw.state === "withdrawn" ? actor!==row.applicantCustomerId : actor===row.applicantCustomerId : actor!==row.applicantCustomerId)) throw invalid();
        if (action === "extension.submit" && !reference(raw.extensionId)) throw invalid();
        if (action === "extension.sealed" && (raw.closedOperationKey!==row.operationKey || row.requestHash!==enterpriseHash({action:"extension.sealed",target:row.auditObjectId,originalOperationKey:row.operationKey}))) throw invalid();
        if (action === "extension.close") {
          const key=raw.state === "closed" ? raw.closedOperationKey : raw.originalOperationKey, prior=object(row.originalResult);
          if (!reference(key) || key.length>128 || key===row.operationKey || key!==row.originalKey || prior.approvalId!==row.auditObjectId || prior.retryable!==false) throw invalid();
          if (raw.state === "closed") { if (row.originalTarget!==`extension.sealed:${row.auditObjectId}` || prior.state!=="closed" || prior.closedOperationKey!==key || row.originalHash!==enterpriseHash({action:"extension.sealed",target:row.auditObjectId,originalOperationKey:key})) throw invalid(); }
          else if (raw.state!=="consumed" || row.originalTarget!==`extension.submit:${row.auditObjectId}` || prior.state!=="consumed" || !reference(raw.extensionId) || raw.extensionId!==prior.extensionId) throw invalid();
        }
        if (action === "exchange.expense.confirm" && (raw.orderId!==row.auditOrderId || raw.workspaceId!==context.workspaceId || raw.applicantCustomerId!==actor || raw.operationKey!==row.operationKey)) throw invalid();
      }
      const result={id:row.auditObjectId,state:raw.state,revision:raw.revision,expiresAt:raw.expiresAt,retryable:raw.retryable,confirmedAt:raw.confirmedAt,scope:raw.scope};
      const item=enterpriseExpenseAuditEntrySnapshot({operationKey:row.operationKey,objectId:row.auditObjectId,objectType:row.objectType,actorCustomerId:actor,action,reason:row.reason,createdAt:row.createdAt.toISOString(),result});
      if (!item) throw invalid(); return item;
    });
  }
  /** Original corporate/request association only; no invitation input, personal
   * material, current request state or today's relationship as receipt evidence. */
  private async joiningAudits(tenantId:string,corporateId:string):Promise<EnterpriseJoinAuditEntry[]> {
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;corporateCustomerId:string;objectId:string;applicantCustomerId:string;operationKey:string;actorUserId:string;target:string;reason:string;result:unknown;createdAt:Date}>>`
      SELECT w.tenantId,w.corporateCustomerId,w.id AS objectId,w.applicantCustomerId,o.operationKey,o.actorUserId,o.target,o.reason,o.result,o.createdAt
      FROM enterprise_workflow_requests w JOIN enterprise_portal_operations o ON o.tenantId=w.tenantId
        AND (o.target IN (CONCAT('join.withdraw:',w.id),CONCAT('join.review:',w.id))
          OR (o.target='join.submit:self' AND w.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id'))))
      WHERE w.tenantId=${tenantId} AND w.corporateCustomerId=${corporateId} AND w.kind='join_request' AND o.actorUserId LIKE 'customer:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    if(rows.length>200)throw new ConflictException("加入申请审计超出有界范围");
    return rows.map(row=>{
      if(row.tenantId!==tenantId || row.corporateCustomerId!==corporateId || !reference(row.objectId) || !reference(row.applicantCustomerId) || typeof row.actorUserId!=="string" || !row.actorUserId.startsWith("customer:") || typeof row.target!=="string" || !Number.isFinite(row.createdAt?.getTime()))throw new ConflictException("原加入申请审计关联不可核对");
      const action=row.target.slice(0,row.target.indexOf(":")),actor=row.actorUserId.slice(9);
      if(!["join.submit","join.withdraw","join.review"].includes(action) || row.target!==`${action}:${action==="join.submit"?"self":row.objectId}` || action!=="join.review" && actor!==row.applicantCustomerId)throw new ConflictException("原加入申请审计用途不可核对");
      let result:unknown;try{result=enterpriseJson(row.result);}catch{throw new ConflictException("原加入收据损坏");}
      const item=enterpriseJoinAuditEntrySnapshot({operationKey:row.operationKey,objectId:row.objectId,actorCustomerId:actor,action,reason:row.reason,result,createdAt:row.createdAt.toISOString()});
      if(!item)throw new ConflictException("原加入审计结果缺少可核对字段");return item;
    });
  }
  /** Customer company/member saves only. SQL projects original metadata scalars,
   * not policy bodies/amounts or today's policy/member revision. */
  private async policyAudits(tenantId:string,corporateId:string):Promise<EnterprisePolicyAuditEntry[]> {
    const prefix=`policy.company:${corporateId}:`;
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;corporateCustomerId:string|null;associatedScope:string|null;operationKey:string;actorUserId:string;target:string;reason:string;createdAt:Date;result:unknown}>>`
      SELECT o.tenantId,p.corporateCustomerId,p.scopeKey AS associatedScope,o.operationKey,o.actorUserId,o.target,o.reason,o.createdAt,
        JSON_OBJECT('scopeKey',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.scopeKey')),'revision',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.revision'),'membershipUpdatedAt',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.membershipUpdatedAt'))) AS result
      FROM enterprise_portal_operations o LEFT JOIN enterprise_scope_policies p ON p.tenantId=o.tenantId AND p.corporateCustomerId=${corporateId}
        AND p.scopeKey=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.scopeKey'))
      WHERE o.tenantId=${tenantId} AND o.actorUserId LIKE 'customer:%' AND LEFT(o.target,CHAR_LENGTH(${prefix}))=${prefix}
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    if(rows.length>200)throw new ConflictException("企业政策元数据审计超出有界范围");
    return rows.map(row=>{
      if(row.tenantId!==tenantId || row.corporateCustomerId!==corporateId || typeof row.actorUserId!=="string" || !row.actorUserId.startsWith("customer:") || typeof row.associatedScope!=="string" || !Number.isFinite(row.createdAt?.getTime()))throw new ConflictException("原政策审计对象关联不可核对");
      let decoded:unknown;try{decoded=enterpriseJson(row.result);}catch{throw new ConflictException("原政策元数据损坏");}
      if(!decoded || typeof decoded!=="object" || Array.isArray(decoded))throw new ConflictException("原政策元数据不可核对");
      const raw=decoded as Record<string,unknown>,scopeKey=row.associatedScope;
      if(raw.scopeKey!==scopeKey || row.target!==`${prefix}${scopeKey==="company"?"company":scopeKey.startsWith("member:")?scopeKey.slice(7):""}`)throw new ConflictException("原政策收据用途不一致");
      const item=enterprisePolicyAuditEntrySnapshot({operationKey:row.operationKey,actorCustomerId:row.actorUserId.slice(9),action:"policy.company",scopeKey,reason:row.reason,createdAt:row.createdAt.toISOString(),result:{scopeKey:raw.scopeKey,revision:raw.revision,...(raw.membershipUpdatedAt!==null?{membershipUpdatedAt:raw.membershipUpdatedAt}:{})}});
      if(!item)throw new ConflictException("原政策元数据缺少可核对字段");return item;
    });
  }
  /** Explicitly published operator approval metadata with its original company
   * binding. Other operator logs and unassociated/private application stages stay out. */
  private async applicationApprovalAudits(tenantId:string,corporateId:string):Promise<EnterpriseApplicationApprovalAuditEntry[]> {
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;associatedCompany:string|null;objectId:string|null;operationKey:string;actorUserId:string;target:string;reason:string;createdAt:Date;result:unknown}>>`
      SELECT o.tenantId,w.corporateCustomerId AS associatedCompany,w.id AS objectId,o.operationKey,o.actorUserId,o.target,o.reason,o.createdAt,
        JSON_OBJECT('id',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id')),'state',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.state')),'revision',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.revision'),'corporateCustomerId',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.corporateCustomerId'))) AS result
      FROM enterprise_portal_operations o LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId AND w.kind='corporate_application' AND o.target=CONCAT('application.review:',w.id)
      WHERE o.tenantId=${tenantId} AND o.actorUserId LIKE 'operator:%' AND o.target LIKE 'application.review:%'
        AND JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.state'))='approved'
        AND (JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.corporateCustomerId'))=${corporateId} OR w.corporateCustomerId=${corporateId})
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    if(rows.length>200)throw new ConflictException("企业申请批准审计超出有界范围");
    return rows.map(row=>{
      if(row.tenantId!==tenantId || row.associatedCompany!==corporateId || !reference(row.objectId) || typeof row.actorUserId!=="string" || !row.actorUserId.startsWith("operator:") || row.target!==`application.review:${row.objectId}` || !Number.isFinite(row.createdAt?.getTime()))throw new ConflictException("原申请批准企业关联不可核对");
      let result:unknown;try{result=enterpriseJson(row.result);}catch{throw new ConflictException("原申请批准收据损坏");}
      const item=enterpriseApplicationApprovalAuditEntrySnapshot({operationKey:row.operationKey,objectId:row.objectId,actor:{kind:"operator",id:row.actorUserId.slice(9)},action:"application.review",reason:row.reason,createdAt:row.createdAt.toISOString(),result},corporateId);
      if(!item)throw new ConflictException("原申请批准收据缺少可核对字段");return item;
    });
  }
  /** Only the registered public merchant-policy save purpose. Retained policy
   * rows establish the scope association, never today's body or revision. */
  private async merchantPolicyAudits(tenantId:string,corporateId:string):Promise<EnterpriseMerchantPolicyAuditEntry[]> {
    const target=`policy.merchant:${corporateId}`;
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;corporateCustomerId:string|null;associatedMerchantScope:string|null;operationKey:string;actorUserId:string;target:string;reason:string;createdAt:Date;result:unknown}>>`
      SELECT o.tenantId,p.corporateCustomerId,p.scopeKey AS associatedMerchantScope,o.operationKey,o.actorUserId,o.target,o.reason,o.createdAt,
        JSON_OBJECT('scopeKey',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.scopeKey')),'revision',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.revision')) AS result
      FROM enterprise_portal_operations o LEFT JOIN enterprise_scope_policies p ON p.tenantId=o.tenantId AND p.corporateCustomerId=${corporateId} AND p.scopeKey='merchant'
      WHERE o.tenantId=${tenantId} AND o.actorUserId LIKE 'operator:%' AND o.target=${target}
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    if(rows.length>200)throw new ConflictException("商户政策元数据审计超出有界范围");
    return rows.map(row=>{
      if(row.tenantId!==tenantId || row.corporateCustomerId!==corporateId || row.associatedMerchantScope!=="merchant" || typeof row.actorUserId!=="string" || !row.actorUserId.startsWith("operator:") || row.target!==target || !Number.isFinite(row.createdAt?.getTime()))throw new ConflictException("原商户政策企业或作用域关联不可核对");
      let result:unknown;try{result=enterpriseJson(row.result);}catch{throw new ConflictException("原商户政策保存元数据损坏");}
      const item=enterpriseMerchantPolicyAuditEntrySnapshot({operationKey:row.operationKey,actor:{kind:"operator",id:row.actorUserId.slice(9)},action:"policy.merchant",scopeKey:"merchant",reason:row.reason,createdAt:row.createdAt.toISOString(),result});
      if(!item)throw new ConflictException("原商户政策保存元数据缺少可核对字段");return item;
    });
  }
  /** Original EnterprisePortalService stores bare operator IDs and company targets,
   * unlike namespaced commands. Reserved tenant-target history is not identifiable. */
  private async merchantPortalAudits(tenantId:string,corporateId:string):Promise<EnterpriseMerchantPortalAuditEntry[]|undefined> {
    if(corporateId==="tenant")return undefined;
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;associatedPortalCompany:string|null;operationKey:string;actorUserId:string;target:string;reason:string;createdAt:Date;result:unknown}>>`
      SELECT o.tenantId,p.corporateCustomerId AS associatedPortalCompany,o.operationKey,o.actorUserId,o.target,o.reason,o.createdAt,
        JSON_OBJECT('corporateCustomerId',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.corporateCustomerId')),'enabled',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.enabled'),'revision',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.revision')) AS result
      FROM enterprise_portal_operations o LEFT JOIN enterprise_corporate_portals p ON p.tenantId=o.tenantId AND p.corporateCustomerId=${corporateId}
      WHERE o.tenantId=${tenantId} AND o.target=${corporateId} AND o.actorUserId NOT LIKE 'customer:%' AND o.actorUserId NOT LIKE 'operator:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    if(rows.length>200)throw new ConflictException("商户门户原配置审计超出有界范围");
    return rows.map(row=>{
      if(row.tenantId!==tenantId || row.associatedPortalCompany!==corporateId || !reference(row.actorUserId) || row.target!==corporateId || !Number.isFinite(row.createdAt?.getTime()))throw new ConflictException("原门户配置操作者或企业关联不可核对");
      let result:unknown;try{result=enterpriseJson(row.result);}catch{throw new ConflictException("原门户配置收据元数据损坏");}
      const item=enterpriseMerchantPortalAuditEntrySnapshot({operationKey:row.operationKey,actor:{kind:"operator",id:row.actorUserId},action:"portal.configuration",reason:row.reason,createdAt:row.createdAt.toISOString(),result},corporateId);
      if(!item)throw new ConflictException("原门户配置收据缺少可核对字段");return item;
    });
  }
  async read(context: ClientRequestContext, corporateId: string): Promise<EnterpriseMembershipAudit> {
    if (!reference(corporateId)) throw new BadRequestException("企业审计引用无效");
    const scopeKey = () => JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]);
    const key = scopeKey();
    const assertScope = () => {
      const current = getRequestIdentity();
      if (context.customerType !== "personal" || !reference(context.tenantId) || !reference(context.customerId) || !current || current.tenantId !== context.tenantId || current.userId !== context.customerId
        || current.isSaasAdmin !== false || current.staffApi === true || current.dataScope !== undefined || scopeKey() !== key
        || Boolean(context.workspaceId)!==Boolean(context.workspaceCode)
        || context.workspaceId && (!reference(context.workspaceId) || !reference(context.workspaceCode) || current.workspaceId!==context.workspaceId)) throw new ForbiddenException("审计须当前客户与商户及空间身份");
    };
    assertScope();
    const before = await this.access.requireAction(context, corporateId, "audit:read"); assertScope();
    // Association is restricted in SQL before LIMIT. Exited rows remain retained;
    // current role/status/PII are deliberately not selected as historical evidence.
    const rows = await this.prisma.$queryRaw<Array<{ tenantId: string; corporateCustomerId: string; membershipId: string; operationKey: string; actorUserId: string; target: string; reason: string; result: unknown; createdAt: Date }>>`
      SELECT o.tenantId,m.corporateCustomerId,m.id AS membershipId,o.operationKey,o.actorUserId,o.target,o.reason,o.result,o.createdAt
      FROM customer_corporate_memberships m JOIN enterprise_portal_operations o ON o.tenantId=m.tenantId
        AND o.target IN (CONCAT('member.change:',m.id),CONCAT('member.exit:',m.id),CONCAT('administrator.change:',m.id))
      WHERE m.tenantId=${context.tenantId} AND m.corporateCustomerId=${corporateId} AND o.actorUserId LIKE 'customer:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    assertScope();
    const workflowItems = await this.workflowAudits(context.tenantId, corporateId); assertScope();
    const businessItems = await this.businessAudits(context, corporateId); assertScope();
    const expenseItems = await this.expenseAudits(context, corporateId); assertScope();
    const joiningItems = await this.joiningAudits(context.tenantId, corporateId); assertScope();
    const policyItems = await this.policyAudits(context.tenantId, corporateId); assertScope();
    const applicationApprovalItems = await this.applicationApprovalAudits(context.tenantId, corporateId); assertScope();
    const merchantPolicyItems = await this.merchantPolicyAudits(context.tenantId, corporateId); assertScope();
    const merchantPortalItems = await this.merchantPortalAudits(context.tenantId, corporateId); assertScope();
    const after = await this.access.requireAction(context, corporateId, "audit:read"); assertScope();
    if (after.membershipId !== before.membershipId || after.permissionRevision !== before.permissionRevision) throw new ForbiddenException("企业审计授权已变化，请重新读取");
    if (rows.length > 200 || new Set(rows.map(row => row.operationKey)).size !== rows.length) throw new ConflictException("企业成员审计超出有界范围");
    const items: EnterpriseMembershipAudit["items"] = rows.map(row => {
      if (row.tenantId !== context.tenantId || row.corporateCustomerId !== corporateId || !reference(row.membershipId) || typeof row.actorUserId !== "string" || typeof row.target !== "string" || !row.actorUserId.startsWith("customer:")
        || !Number.isFinite(row.createdAt?.getTime())) throw new ConflictException("原企业审计关联不可核对");
      const action = row.target?.slice(0,row.target.indexOf(":"));
      if (!["member.change","member.exit","administrator.change"].includes(action) || row.target !== `${action}:${row.membershipId}`) throw new ConflictException("原企业审计用途不可核对");
      let result: unknown; try { result = enterpriseJson(row.result); } catch { throw new ConflictException("原审计收据损坏"); }
      const item = enterpriseMembershipAuditEntrySnapshot({ operationKey: row.operationKey, membershipId: row.membershipId, actorCustomerId: row.actorUserId.slice("customer:".length), action, reason: row.reason, result, createdAt: row.createdAt.toISOString() });
      if (!item) throw new ConflictException("原审计结果缺少可核对字段");
      return item;
    });
    const all=[...items,...workflowItems,...businessItems,...expenseItems,...joiningItems,...policyItems,...applicationApprovalItems,...merchantPolicyItems,...(merchantPortalItems ?? [])];
    if (all.length>200 || new Set(all.map(row => row.operationKey)).size!==all.length) throw new ConflictException("企业管理审计超出统一有界范围");
    return { tenantCode: context.tenantCode, corporateCustomerId: corporateId, permissionRevision: after.permissionRevision,
      coverage: "original_member_and_administrator_commands", workflowCoverage:"original_invite_and_administrator_transfer_commands", workflowItems,
      businessCoverage:"original_management_and_current_workspace_booking_commands", businessItems,
      expenseCoverage:"original_current_workspace_associated_expense_approval_commands",expenseItems,
      joiningCoverage:"original_corporate_associated_join_request_commands",joiningItems,
      policyCoverage:"original_customer_company_and_member_policy_commands",policyItems,
      applicationApprovalCoverage:"original_application_approval_company_binding_receipts",applicationApprovalItems,
      merchantPolicyCoverage:"original_merchant_policy_save_metadata",merchantPolicyItems,
      ...(merchantPortalItems!==undefined ? {merchantPortalCoverage:"original_bare_actor_corporate_portal_configuration_metadata" as const,merchantPortalItems} : {}),
      bookingWorkspace:context.workspaceId ? {state:"available",code:context.workspaceCode} : {state:"unavailable"},
      unavailable: [...(context.workspaceId ? [] : ["approvals" as const]),"remaining_approval_audit","order_and_financial_audit"], items };
  }
}
