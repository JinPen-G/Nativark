/** Current customer's task/receipt projections from durable originals, not a new
 * notification sender. Corporate queues recheck their exact action and workspace. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { EnterpriseManagedCorporate } from "@rental-os/shared";
import { ENTERPRISE_REVIEW_REQUEST_TYPES } from "@rental-os/shared";
import { enterpriseOwnEmployeePolicyMessagesSnapshot, ENTERPRISE_EMPLOYEE_POLICY_MESSAGE_UNAVAILABLE, type EnterpriseOwnEmployeePolicyMessages, enterpriseOwnCorporateStatusMessagesSnapshot, type EnterpriseOwnCorporateStatusMessages, enterpriseOwnManagementReviewMessagesSnapshot, type EnterpriseOwnManagementReviewMessages, enterpriseOwnJoinReviewMessagesSnapshot, type EnterpriseOwnJoinReviewMessages, enterpriseOwnApplicationReviewMessagesSnapshot, type EnterpriseOwnApplicationReviewMessages, enterpriseOwnRetainedMergeMessagesSnapshot, type EnterpriseOwnRetainedMergeMessages, enterpriseOwnStatusMessagesSnapshot, type EnterpriseOwnStatusMessages, enterpriseOwnTransferMessagesSnapshot, type EnterpriseOwnTransferMessages, enterpriseOwnRelationshipMessagesSnapshot, type EnterpriseOwnRelationshipMessages, enterpriseApprovalNoticesSnapshot, type EnterpriseApprovalNotices, enterpriseOwnMessagesSnapshot, ENTERPRISE_OWN_MESSAGE_UNAVAILABLE, type EnterpriseOwnMessages, type EnterpriseAuditView, type EnterpriseTaskCenter, type EnterpriseTaskItem } from "@rental-os/shared";
import { getRequestIdentity } from "../../common/request-identity";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseApplicationService } from "./enterprise-application.service";
import { EnterpriseApprovalService } from "./enterprise-approval.service";
import { EnterpriseExtensionApprovalService } from "./enterprise-extension-approval.service";
import { EnterpriseExchangeApprovalService } from "./enterprise-exchange-approval.service";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
import { EnterpriseMembersService } from "./enterprise-members.service";
import { EnterpriseRentalHandoffService } from "./enterprise-rental-handoff.service";
import { EnterpriseManagementRequestService } from "./enterprise-management-request.service";
import { projectOriginalAdministratorTransferReceipt, type OriginalAdministratorTransferReceiptRow } from "./enterprise-transfer-receipt-projection";
@Injectable()
export class EnterpriseTaskCenterService {
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService,
    private readonly applications: EnterpriseApplicationService, private readonly members: EnterpriseMembersService,
    private readonly approvals: EnterpriseApprovalService, private readonly access: EnterpriseAccessService, private readonly management: EnterpriseManagementRequestService, private readonly extensions: EnterpriseExtensionApprovalService, private readonly exchanges: EnterpriseExchangeApprovalService, private readonly handoffs: EnterpriseRentalHandoffService) {}
  async tasks(context: ClientRequestContext, corporateId?: string): Promise<EnterpriseTaskCenter> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    let corporate: EnterpriseManagedCorporate | undefined;
    const applications = await this.applications.mine(context), own = await this.members.joinRequests(context);
    const items: EnterpriseTaskItem[] = [...applications, ...own].map(row => ({ id: row.id, kind: row.kind as EnterpriseTaskItem["kind"], state: row.state,
      revision: row.revision, corporateCustomerId: row.corporateCustomerId ?? undefined, createdAt: row.createdAt,
      requiresAction: row.state === "supplement_required" || row.kind === "administrator_transfer" && row.state === "pending",
      page: row.kind === "corporate_application" ? "applications" : "join" }));
    const management = await this.management.mine(context);
    items.push(...management.map(row => ({ id: row.id, kind: "management_request" as const, state: row.state, revision: row.revision,
      corporateCustomerId: row.corporateCustomerId, createdAt: row.createdAt, requiresAction: row.state === "supplement_required", page: "profile" as const })));
    const handoffs = await this.handoffs.mine(context);
    items.push(...handoffs.map(row => ({ id: row.id, kind: "rental_handoff" as const, state: row.state, revision: row.revision,
      corporateCustomerId: row.material.corporateCustomerId, createdAt: row.createdAt, requiresAction: row.state === "reviewed", page: "join" as const })));
    // Own originals remain readable for a restricted (not exited/closed) customer.
    // Current corporate authority comes from requireAction, never this cached status.
    {
      const approvals = await this.approvals.list(context);
      items.push(...approvals.map(row => ({ id: row.id, kind: "booking_approval" as const, state: row.state, revision: row.revision,
        corporateCustomerId: row.corporateCustomerId, expiresAt: row.expiresAt, requiresAction: ["approved", "executing"].includes(row.state), page: "approvals" as const })));
      const extensions = await this.extensions.list(context);
      items.push(...extensions.map(row => ({ id: row.id, kind: "extension_approval" as const, state: row.state, revision: row.revision,
        corporateCustomerId: row.corporateCustomerId, expiresAt: row.expiresAt, requiresAction: row.state === "approved", page: "extension-approvals" as const })));
      const exchanges = await this.exchanges.list(context);
      items.push(...exchanges.map(row => ({ id: row.id, kind: "exchange_approval" as const, state: row.state, revision: row.revision,
        corporateCustomerId: row.corporateCustomerId, expiresAt: row.expiresAt, requiresAction: row.state === "approved" && !row.employeeConfirmation, page: "exchange-approvals" as const })));
      if (corporateId) {
        corporate = await this.access.requireAction(context, corporateId, "portal:enter");
        if (corporate.actions.includes("members:manage")) {
          const joins = await this.members.joinRequests(context, corporateId);
          items.push(...joins.filter(row => row.state === "pending").map(row => ({ id: row.id, kind: "join_request" as const, state: row.state,
            revision: row.revision, corporateCustomerId: corporateId, createdAt: row.createdAt, requiresAction: true, page: "join-requests" as const })));
        }
        if (corporate.actions.includes("approvals:review")) {
          const queue = await this.approvals.list(context, corporateId);
          items.push(...queue.filter(row => row.state === "pending" && row.applicantCustomerId !== context.customerId).map(row => ({ id: row.id,
            kind: "booking_approval" as const, state: row.state, revision: row.revision, corporateCustomerId: corporateId,
            expiresAt: row.expiresAt, requiresAction: true, page: "approvals" as const })));
          const exchangeQueue = await this.exchanges.list(context, corporateId);
          items.push(...exchangeQueue.filter(row => row.state === "pending" && row.applicantCustomerId !== context.customerId).map(row => ({ id: row.id,
            kind: "exchange_approval" as const, state: row.state, revision: row.revision, corporateCustomerId: corporateId,
            expiresAt: row.expiresAt, requiresAction: true, page: "exchange-approvals" as const })));
          const extensionQueue = await this.extensions.list(context, corporateId);
          items.push(...extensionQueue.filter(row => row.state === "pending" && row.applicantCustomerId !== context.customerId).map(row => ({ id: row.id,
            kind: "extension_approval" as const, state: row.state, revision: row.revision, corporateCustomerId: corporateId,
            expiresAt: row.expiresAt, requiresAction: true, page: "extension-approvals" as const })));
        }
      }
    }
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const unique = [...new Map(items.map(row => [`${row.kind}:${row.id}:${row.page}`, row])).values()];
    if (unique.length > 200) throw new ConflictException("企业待办超过当前有界读取范围，请按原任务页核对");
    let handoffOrders: EnterpriseTaskCenter["handoffOrders"];
    try { handoffOrders = await this.handoffs.orderSource(context); }
    catch (error) {
      // A missing/bounded historical source must not masquerade as no ongoing
      // rentals or hide the independently persisted request/receipt entry.
      if (!(error instanceof ConflictException || error instanceof ServiceUnavailableException)) throw error;
      handoffOrders = { state: "unavailable", coverage: "current_workspace_original_own_enterprise_employee_orders" };
    }
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    // 交接订单来源可能等待额外 IO，企业待办在全部来源完成后再复验原关系与动作。
    if (corporate) {
      const after = await this.access.requireAction(context, corporate.corporateCustomerId, "portal:enter");
      if (corporate.membershipId !== after.membershipId || corporate.permissionRevision !== after.permissionRevision
        || corporate.actions.some(action => !after.actions.includes(action))) throw new ConflictException("企业任务权限已变化，请重新读取");
    }
    return { items: unique, handoffOrders,
      coverage: "own_requests_and_current_workspace_approvals", unavailable: ["order_alerts", "financial_alerts", "external_notifications"] };
  }
  /** Only this person's current persisted feedback. No join expiry transition,
   * corporate grant, sender/read-state write or command-receipt recovery. */
  async messages(context: ClientRequestContext): Promise<EnterpriseOwnMessages> {
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if (context.customerType!=="personal" || !actor || actor.tenantId!==context.tenantId || actor.userId!==context.customerId
      || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || actor.workspaceId!==context.workspaceId || scope()!==key) throw new ForbiddenException("本人反馈读取身份已变化");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    // The ownership/kind/feedback state restriction is before LIMIT. Do not call
    // joinRequests here: its original expiry transition is not a message reader.
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;id:string;kind:string;state:string;revision:number;applicantCustomerId:string;decisionReason:string|null;updatedAt:Date;requestType:string|null}>>`
      SELECT tenantId,id,kind,state,revision,applicantCustomerId,JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(payload),payload,'{}'),'$.requestType')) AS requestType,decisionReason,updatedAt FROM enterprise_workflow_requests
      WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId}
        AND kind IN ('corporate_application','join_request','finance_request') AND state IN ('approved','rejected','supplement_required')
      ORDER BY updatedAt DESC,id DESC LIMIT 201`;
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    if (rows.length>200) throw new ConflictException("本人反馈超出当前有界范围，请在原申请页核对");
    const items=rows.map(row=>{
      if (row.tenantId!==context.tenantId || row.applicantCustomerId!==context.customerId || !["corporate_application","join_request","finance_request"].includes(row.kind)
        || row.kind === "finance_request" && !ENTERPRISE_REVIEW_REQUEST_TYPES.some(type => type === row.requestType)
        || !Number.isFinite(row.updatedAt?.getTime()) || row.decisionReason!==null && typeof row.decisionReason!=="string") throw new ConflictException("原本人反馈关联不可核对");
      return {requestId:row.id,kind:row.kind === "finance_request" ? "management_request" : row.kind,state:row.state,revision:row.revision,updatedAt:row.updatedAt.toISOString(),
        page:row.kind === "corporate_application" ? "applications" : row.kind === "join_request" ? "join" : "profile",...(row.decisionReason!==null ? {feedback:row.decisionReason} : {})};
    });
    const result=enterpriseOwnMessagesSnapshot({tenantCode:context.tenantCode,customerId:context.customerId,coverage:"own_current_persisted_request_feedback",delivery:"not_reported",readState:"not_recorded",items,unavailable:[...ENTERPRISE_OWN_MESSAGE_UNAVAILABLE]},context.tenantCode,context.customerId);
    if (!result) throw new ConflictException("原本人反馈缺少可核对字段");return result;
  }
  /** Applicant-addressed original merchant review receipts. Current workflow
   * state/material and today's corporate authority never reconstruct these results. */
  async applicationReviewMessages(context:ClientRequestContext):Promise<EnterpriseOwnApplicationReviewMessages> {
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if(context.customerType!=="personal" || !actor || actor.tenantId!==context.tenantId || actor.userId!==context.customerId || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || actor.workspaceId!==context.workspaceId || scope()!==key)throw new ForbiddenException("本人审核消息读取身份已变化");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;requestId:string;applicantCustomerId:string;operationKey:string;actorUserId:string;target:string;reason:string;createdAt:Date;result:unknown}>>`
      SELECT w.tenantId,w.id AS requestId,w.applicantCustomerId,o.operationKey,o.actorUserId,o.target,o.reason,o.createdAt,
        JSON_OBJECT('id',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id'),'state',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.state'),'revision',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.revision'),'corporateCustomerId',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.corporateCustomerId')) AS result
      FROM enterprise_workflow_requests w JOIN enterprise_portal_operations o ON o.tenantId=w.tenantId AND o.target=CONCAT('application.review:',w.id)
      WHERE w.tenantId=${context.tenantId} AND w.applicantCustomerId=${context.customerId} AND w.kind='corporate_application' AND o.actorUserId LIKE 'operator:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    if(rows.length>200)throw new ConflictException("本人原审核消息超出有界范围");
    const items=rows.map(row=>{
      if(row.tenantId!==context.tenantId || row.applicantCustomerId!==context.customerId || typeof row.actorUserId!=="string" || !/^operator:[a-zA-Z0-9_-]{1,191}$/u.test(row.actorUserId) || row.target!==`application.review:${row.requestId}` || !Number.isFinite(row.createdAt?.getTime()))throw new ConflictException("原本人审核收据关联不可核对");
      let decoded:unknown;try{decoded=enterpriseJson(row.result);}catch{throw new ConflictException("原本人审核收据损坏");}
      if(!decoded || typeof decoded!=="object" || Array.isArray(decoded))throw new ConflictException("原本人审核结果不可核对");
      const original=decoded as Record<string,unknown>;if(original.id!==row.requestId)throw new ConflictException("原本人审核申请引用不一致");
      return {requestId:row.requestId,operationKey:row.operationKey,state:original.state,revision:original.revision,feedback:row.reason,createdAt:row.createdAt.toISOString(),...(original.corporateCustomerId!==null && original.corporateCustomerId!==undefined?{corporateCustomerId:original.corporateCustomerId}:{})};
    });
    const result=enterpriseOwnApplicationReviewMessagesSnapshot({tenantCode:context.tenantCode,customerId:context.customerId,coverage:"own_original_application_review_receipts",delivery:"not_reported",readState:"not_recorded",items},context.tenantCode,context.customerId);
    if(!result)throw new ConflictException("原本人审核消息缺少可核对字段");return result;
  }
  /** Original customer review receipts addressed to their retained join applicant.
   * The operation reason is not a reconstructed reason for every rejection. */
  async joinReviewMessages(context:ClientRequestContext):Promise<EnterpriseOwnJoinReviewMessages> {
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if(context.customerType!=="personal" || !actor || actor.tenantId!==context.tenantId || actor.userId!==context.customerId || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || actor.workspaceId!==context.workspaceId || scope()!==key)throw new ForbiddenException("本人加入审核消息身份已变化");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;joinReviewRequestId:string;corporateCustomerId:string|null;applicantCustomerId:string;operationKey:string;actorUserId:string;target:string;reason:string;createdAt:Date;result:unknown}>>`
      SELECT w.tenantId,w.id AS joinReviewRequestId,w.corporateCustomerId,w.applicantCustomerId,o.operationKey,o.actorUserId,o.target,o.reason,o.createdAt,
        JSON_OBJECT('id',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id'),'state',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.state'),'revision',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.revision')) AS result
      FROM enterprise_workflow_requests w JOIN enterprise_portal_operations o ON o.tenantId=w.tenantId AND o.target=CONCAT('join.review:',w.id)
      WHERE w.tenantId=${context.tenantId} AND w.applicantCustomerId=${context.customerId} AND w.kind='join_request' AND o.actorUserId LIKE 'customer:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    if(rows.length>200)throw new ConflictException("本人加入原审核消息超出有界范围");
    const items=rows.map(row=>{
      const requestId=row.joinReviewRequestId;
      if(row.tenantId!==context.tenantId || row.applicantCustomerId!==context.customerId || typeof row.actorUserId!=="string" || !/^customer:[a-zA-Z0-9_-]{1,191}$/u.test(row.actorUserId) || row.target!==`join.review:${requestId}` || !Number.isFinite(row.createdAt?.getTime()))throw new ConflictException("原本人加入审核收据关联不可核对");
      let decoded:unknown;try{decoded=enterpriseJson(row.result);}catch{throw new ConflictException("原本人加入审核收据损坏");}
      if(!decoded || typeof decoded!=="object" || Array.isArray(decoded))throw new ConflictException("原本人加入审核结果不可核对");
      const original=decoded as Record<string,unknown>;if(original.id!==requestId)throw new ConflictException("原本人加入审核申请引用不一致");
      return {requestId,corporateCustomerId:row.corporateCustomerId,operationKey:row.operationKey,state:original.state,revision:original.revision,reason:row.reason,createdAt:row.createdAt.toISOString()};
    });
    const result=enterpriseOwnJoinReviewMessagesSnapshot({tenantCode:context.tenantCode,customerId:context.customerId,coverage:"own_original_join_review_receipts",delivery:"not_reported",readState:"not_recorded",items},context.tenantCode,context.customerId);
    if(!result)throw new ConflictException("原本人加入审核消息缺少可核对字段");return result;
  }
  /** Retained type is immutable under original management save; only that scalar
   * and original review-only receipts are read, never current proposal or business state. */
  async managementReviewMessages(context:ClientRequestContext):Promise<EnterpriseOwnManagementReviewMessages> {
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if(context.customerType!=="personal" || !actor || actor.tenantId!==context.tenantId || actor.userId!==context.customerId || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || actor.workspaceId!==context.workspaceId || scope()!==key)throw new ForbiddenException("本人管理审核消息身份已变化");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;managementReviewRequestId:string;corporateCustomerId:string;applicantCustomerId:string;originalRequestType:string|null;operationKey:string;actorUserId:string;target:string;reason:string;createdAt:Date;result:unknown}>>`
      SELECT w.tenantId,w.id AS managementReviewRequestId,w.corporateCustomerId,w.applicantCustomerId,
        JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(w.payload),w.payload,'{}'),'$.requestType')) AS originalRequestType,o.operationKey,o.actorUserId,o.target,o.reason,o.createdAt,
        JSON_OBJECT('id',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id'),'state',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.state'),'revision',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.revision'),'effect',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.effect')) AS result
      FROM enterprise_workflow_requests w JOIN enterprise_portal_operations o ON o.tenantId=w.tenantId AND o.target=CONCAT('management-request.review:',w.id)
      WHERE w.tenantId=${context.tenantId} AND w.applicantCustomerId=${context.customerId} AND w.kind='finance_request' AND o.actorUserId LIKE 'operator:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    if(rows.length>200)throw new ConflictException("本人管理原审核消息超出有界范围");
    const items=rows.map(row=>{
      const requestId=row.managementReviewRequestId;
      if(row.tenantId!==context.tenantId || row.applicantCustomerId!==context.customerId || typeof row.actorUserId!=="string" || !/^operator:[a-zA-Z0-9_-]{1,191}$/u.test(row.actorUserId) || row.target!==`management-request.review:${requestId}` || !Number.isFinite(row.createdAt?.getTime()))throw new ConflictException("原本人管理审核收据关联不可核对");
      let decoded:unknown;try{decoded=enterpriseJson(row.result);}catch{throw new ConflictException("原本人管理审核收据损坏");}
      if(!decoded || typeof decoded!=="object" || Array.isArray(decoded))throw new ConflictException("原本人管理审核结果不可核对");
      const original=decoded as Record<string,unknown>;if(original.id!==requestId)throw new ConflictException("原本人管理审核申请引用不一致");
      return {requestId,corporateCustomerId:row.corporateCustomerId,requestType:row.originalRequestType,operationKey:row.operationKey,state:original.state,revision:original.revision,effect:original.effect,reason:row.reason,createdAt:row.createdAt.toISOString()};
    });
    const paymentProofItems = items.filter(item => item.requestType === "payment_proof");
    const result=enterpriseOwnManagementReviewMessagesSnapshot({tenantCode:context.tenantCode,customerId:context.customerId,coverage:"own_original_management_review_only_receipts",delivery:"not_reported",readState:"not_recorded",items:items.filter(item => item.requestType !== "payment_proof"),
      ...(paymentProofItems.length ? {paymentProofItems} : {})},context.tenantCode,context.customerId);
    if(!result)throw new ConflictException("原本人管理审核消息缺少可核对字段");return result;
  }
  /** Original member-policy target and retained immutable relation ownership only.
   * Current role/state/grants and policy bodies/revisions never reconstruct history. */
  async employeePolicyMessages(context:ClientRequestContext):Promise<EnterpriseOwnEmployeePolicyMessages> {
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if(context.customerType!=="personal" || !actor || actor.tenantId!==context.tenantId || actor.userId!==context.customerId || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || actor.workspaceId!==context.workspaceId || scope()!==key)throw new ForbiddenException("本人员工政策消息身份已变化");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    // The retained relation's tenant/company/person/id are immutable at the original
    // writer. Do not select today's role/status/revision or derive company-wide recipients.
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;corporateCustomerId:string;recipientCustomerId:string;membershipId:string;associatedScope:string|null;operationKey:string;actorUserId:string;target:string;createdAt:Date;result:unknown}>>`
      SELECT m.tenantId,m.corporateCustomerId,m.personalCustomerId AS recipientCustomerId,m.id AS membershipId,p.scopeKey AS associatedScope,o.operationKey,o.actorUserId,o.target,o.createdAt,
        JSON_OBJECT('scopeKey',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.scopeKey')),'revision',JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.revision'),'membershipUpdatedAt',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.membershipUpdatedAt'))) AS result
      FROM customer_corporate_memberships m JOIN enterprise_portal_operations o ON o.tenantId=m.tenantId AND o.target=CONCAT('policy.company:',m.corporateCustomerId,':',m.id)
      LEFT JOIN enterprise_scope_policies p ON p.tenantId=m.tenantId AND p.corporateCustomerId=m.corporateCustomerId AND p.scopeKey=CONCAT('member:',m.id)
      WHERE m.tenantId=${context.tenantId} AND m.personalCustomerId=${context.customerId} AND o.actorUserId LIKE 'customer:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    if(rows.length>200)throw new ConflictException("本人员工政策消息超出有界范围");
    const ref=(v:unknown):v is string=>typeof v==="string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
    const items=rows.map(row=>{
      if(row.tenantId!==context.tenantId || row.recipientCustomerId!==context.customerId || !ref(row.corporateCustomerId) || !ref(row.membershipId) || row.associatedScope!==`member:${row.membershipId}` || typeof row.actorUserId!=="string" || !row.actorUserId.startsWith("customer:") || !ref(row.actorUserId.slice(9)) || row.target!==`policy.company:${row.corporateCustomerId}:${row.membershipId}` || !Number.isFinite(row.createdAt?.getTime()))throw new ConflictException("原员工政策接收人或对象关联不可核对");
      let raw:unknown;try{raw=enterpriseJson(row.result);}catch{throw new ConflictException("原员工政策收据元数据损坏");}
      if(!raw || typeof raw!=="object" || Array.isArray(raw) || (raw as Record<string,unknown>).scopeKey!==row.associatedScope)throw new ConflictException("原员工政策收据用途不可核对");
      const result=raw as Record<string,unknown>;
      return {corporateCustomerId:row.corporateCustomerId,membershipId:row.membershipId,operationKey:row.operationKey,revision:result.revision,membershipUpdatedAt:result.membershipUpdatedAt,createdAt:row.createdAt.toISOString(),effect:"original_employee_policy_save_only"};
    });
    const result=enterpriseOwnEmployeePolicyMessagesSnapshot({tenantCode:context.tenantCode,customerId:context.customerId,coverage:"own_original_retained_employee_policy_save_receipts",delivery:"not_reported",readState:"not_recorded",unavailable:[...ENTERPRISE_EMPLOYEE_POLICY_MESSAGE_UNAVAILABLE],items},context.tenantCode,context.customerId);
    if(!result)throw new ConflictException("原员工政策消息缺少可核对字段");return result;
  }
  /** Only original captured recipients. Current roles/relations, missing old
   * captures, internal reasons and delivery state never reconstruct history. */
  async corporateStatusMessages(context:ClientRequestContext):Promise<EnterpriseOwnCorporateStatusMessages> {
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if(context.customerType!=="personal" || !actor || actor.tenantId!==context.tenantId || actor.userId!==context.customerId || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || actor.workspaceId!==context.workspaceId || scope()!==key)throw new ForbiddenException("本人企业状态消息身份已变化");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    let rows:Array<{tenantId:string;recipientCustomerId:string;historyId:string;corporateCustomerId:string;membershipId:string;membershipUpdatedAt:Date;capturedAt:Date;sourceHistoryId:string|null;sourceCompanyId:string|null;scope:string|null;action:string|null;fromStatus:string|null;toStatus:string|null;at:Date|null}>;
    try { rows=await this.prisma.$queryRaw<typeof rows>`
      SELECT r.tenantId,r.recipientCustomerId,r.historyId,r.corporateCustomerId,r.membershipId,r.membershipUpdatedAt,r.capturedAt,
        h.id AS sourceHistoryId,h.customerId AS sourceCompanyId,h.scope,h.action,h.fromStatus,h.toStatus,h.at
      FROM enterprise_corporate_status_recipients r LEFT JOIN customer_status_history h ON h.tenantId=r.tenantId AND h.id=r.historyId
      WHERE r.tenantId=${context.tenantId} AND r.recipientCustomerId=${context.customerId}
      ORDER BY r.capturedAt DESC,r.historyId DESC LIMIT 201`;
    } catch(error) {
      if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==="P2010" && ["1146","1054"].includes(String(error.meta?.code)))throw new ServiceUnavailableException("企业状态原接收人消息来源尚未装配");
      throw error;
    }
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    if(rows.length>200)throw new ConflictException("本人企业状态消息超出有界范围");
    const items=rows.map(row=>{
      if(row.tenantId!==context.tenantId || row.recipientCustomerId!==context.customerId || row.sourceHistoryId!==row.historyId || row.sourceCompanyId!==row.corporateCustomerId || row.scope!=="membership" || !Number.isFinite(row.membershipUpdatedAt?.getTime()) || !Number.isFinite(row.capturedAt?.getTime()) || !Number.isFinite(row.at?.getTime()))throw new ConflictException("原企业状态接收人或事件关联不可核对");
      return {historyId:row.historyId,corporateCustomerId:row.corporateCustomerId,membershipId:row.membershipId,membershipUpdatedAt:row.membershipUpdatedAt.toISOString(),capturedAt:row.capturedAt.toISOString(),action:row.action,fromStatus:row.fromStatus,toStatus:row.toStatus,at:row.at!.toISOString()};
    });
    const result=enterpriseOwnCorporateStatusMessagesSnapshot({tenantCode:context.tenantCode,customerId:context.customerId,coverage:"own_original_captured_corporate_membership_status_events",delivery:"not_reported",readState:"not_recorded",unavailable:["uncaptured_corporate_status_history"],items},context.tenantCode,context.customerId);
    if(!result)throw new ConflictException("原企业状态消息缺少可核对字段");return result;
  }
  /** Minimal recorded approval messages. Reviewer scope is current and explicit;
   * neither expiry filtering nor the stored state authorizes a decision/Core write. */
  async approvalNotices(context: ClientRequestContext, corporateId?: string): Promise<EnterpriseApprovalNotices> {
    const ref=(v:unknown):v is string=>typeof v === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
    if (corporateId!==undefined && !ref(corporateId)) throw new BadRequestException("批准提醒企业引用无效");
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if (context.customerType!=="personal" || !ref(context.workspaceId) || !ref(context.workspaceCode) || !actor
      || actor.tenantId!==context.tenantId || actor.userId!==context.customerId || actor.workspaceId!==context.workspaceId || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || scope()!==key) throw new ForbiddenException("批准消息须当前本人和认证空间");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    const before=corporateId ? await this.access.requireAction(context,corporateId,"approvals:review") : undefined;assertScope();
    // Trusted ownership/current review restrictions are applied before each 201
    // probe. No quote, order, preview, amount or current employee data is selected.
    const visibility=corporateId ? Prisma.sql`a.corporateCustomerId=${corporateId} AND a.applicantCustomerId<>${context.customerId} AND a.state='pending' AND a.expiresAt>NOW(3)` : Prisma.sql`a.applicantCustomerId=${context.customerId}`;
    const feedback=corporateId ? Prisma.sql`NULL` : Prisma.sql`a.decisionReason`;
    type Row={tenantId:string;workspaceId:string;corporateCustomerId:string;applicantCustomerId:string;id:string;noticeKind:string;state:string;revision:number;createdAt:Date;expiresAt:Date;decisionReason:string|null};
    const booking=await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT a.tenantId,a.workspaceId,a.corporateCustomerId,a.applicantCustomerId,a.id,'booking_approval' AS noticeKind,a.state,a.revision,a.createdAt,a.expiresAt,NULL AS decisionReason
      FROM enterprise_booking_approvals a WHERE a.tenantId=${context.tenantId} AND a.workspaceId=${context.workspaceId} AND ${visibility}
      ORDER BY a.createdAt DESC,a.id DESC LIMIT 201`);
    const extensions=await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT a.tenantId,a.workspaceId,a.corporateCustomerId,a.applicantCustomerId,a.id,'extension_approval' AS noticeKind,a.state,a.revision,a.createdAt,a.expiresAt,${feedback} AS decisionReason
      FROM enterprise_extension_approvals a WHERE a.tenantId=${context.tenantId} AND a.workspaceId=${context.workspaceId} AND ${visibility}
      ORDER BY a.createdAt DESC,a.id DESC LIMIT 201`);
    const exchanges=await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT a.tenantId,a.workspaceId,a.corporateCustomerId,a.applicantCustomerId,a.id,'exchange_approval' AS noticeKind,a.state,a.revision,a.createdAt,a.expiresAt,${feedback} AS decisionReason
      FROM enterprise_exchange_approvals a WHERE a.tenantId=${context.tenantId} AND a.workspaceId=${context.workspaceId} AND ${visibility}
      ORDER BY a.createdAt DESC,a.id DESC LIMIT 201`);
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    const after=corporateId ? await this.access.requireAction(context,corporateId,"approvals:review") : undefined;assertScope();
    if (before && (after?.membershipId!==before.membershipId || after?.permissionRevision!==before.permissionRevision)) throw new ForbiddenException("当前审批提醒授权已变化");
    const rows=[...booking,...extensions,...exchanges];if(rows.length>200)throw new ConflictException("批准消息超出当前有界范围，请在原批准页核对");
    const items=rows.map(row=>{
      if(row.tenantId!==context.tenantId || row.workspaceId!==context.workspaceId || !ref(row.applicantCustomerId)
        || (corporateId ? row.corporateCustomerId!==corporateId || row.applicantCustomerId===context.customerId || row.state!=="pending" : row.applicantCustomerId!==context.customerId)
        || !Number.isFinite(row.createdAt?.getTime()) || !Number.isFinite(row.expiresAt?.getTime()) || row.decisionReason!==null && typeof row.decisionReason!=="string")throw new ConflictException("原批准消息关联不可核对");
      return {approvalId:row.id,kind:row.noticeKind,state:row.state,revision:row.revision,createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt.toISOString(),
        page:row.noticeKind === "booking_approval" ? "approvals" : row.noticeKind === "extension_approval" ? "extension-approvals" : "exchange-approvals",...(!corporateId && row.decisionReason!==null ? {feedback:row.decisionReason} : {})};
    });
    const current={tenantCode:context.tenantCode,customerId:context.customerId,workspaceCode:context.workspaceCode,...(corporateId ? {corporateCustomerId:corporateId,permissionRevision:after!.permissionRevision} : {})};
    const result=enterpriseApprovalNoticesSnapshot({...current,coverage:corporateId ? "current_workspace_nonself_pending_approval_records" : "current_workspace_own_recorded_approval_states",delivery:"not_reported",readState:"not_recorded",items},current);
    if(!result)throw new ConflictException("原批准消息缺少可核对字段");return result;
  }
  /** Original portal changes addressed to this retained relation owner. Today's
   * role/status/grants are not historical results or a requirement to read them. */
  async relationshipMessages(context: ClientRequestContext): Promise<EnterpriseOwnRelationshipMessages> {
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if(context.customerType!=="personal" || !actor || actor.tenantId!==context.tenantId || actor.userId!==context.customerId
      || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || actor.workspaceId!==context.workspaceId || scope()!==key)throw new ForbiddenException("本人变更消息读取身份已变化");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    // Retained original ownership is restricted before LIMIT; corporate audit
    // permissions, current member state and unrelated operator logs are not read.
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;corporateCustomerId:string;recipientCustomerId:string;membershipId:string;operationKey:string;actorUserId:string;target:string;reason:string;result:unknown;createdAt:Date}>>`
      SELECT m.tenantId,m.corporateCustomerId,m.personalCustomerId AS recipientCustomerId,m.id AS membershipId,o.operationKey,o.actorUserId,o.target,o.reason,o.result,o.createdAt
      FROM customer_corporate_memberships m JOIN enterprise_portal_operations o ON o.tenantId=m.tenantId
        AND o.target IN (CONCAT('member.change:',m.id),CONCAT('member.exit:',m.id),CONCAT('administrator.change:',m.id))
      WHERE m.tenantId=${context.tenantId} AND m.personalCustomerId=${context.customerId} AND o.actorUserId LIKE 'customer:%'
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    if(rows.length>200)throw new ConflictException("本人变更消息超出当前有界范围");
    const items=rows.map(row=>{if(row.tenantId!==context.tenantId || row.recipientCustomerId!==context.customerId || typeof row.actorUserId!=="string" || !row.actorUserId.startsWith("customer:")
      || typeof row.target!=="string" || !Number.isFinite(row.createdAt?.getTime()))throw new ConflictException("原变更消息接收人关联不可核对");
      const action=row.target.slice(0,row.target.indexOf(":"));if(!["member.change","member.exit","administrator.change"].includes(action) || row.target!==`${action}:${row.membershipId}`)throw new ConflictException("原变更消息用途不可核对");
      let result:unknown;try{result=enterpriseJson(row.result);}catch{throw new ConflictException("原变更收据损坏");}
      return {corporateCustomerId:row.corporateCustomerId,receipt:{operationKey:row.operationKey,membershipId:row.membershipId,actorCustomerId:row.actorUserId.slice(9),action,reason:row.reason,result,createdAt:row.createdAt.toISOString()}};
    });
    const result=enterpriseOwnRelationshipMessagesSnapshot({tenantCode:context.tenantCode,customerId:context.customerId,coverage:"own_original_member_administrator_command_receipts",delivery:"not_reported",readState:"not_recorded",items},context.tenantCode,context.customerId);
    if(!result)throw new ConflictException("原本人变更消息缺少可核对字段");return result;
  }
  /** Both original transfer parties may read addressed history with their own
   * current credentials. No current role/grant or full authority material read. */
  async transferMessages(context: ClientRequestContext): Promise<EnterpriseOwnTransferMessages> {
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if(context.customerType!=="personal" || !actor || actor.tenantId!==context.tenantId || actor.userId!==context.customerId
      || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || actor.workspaceId!==context.workspaceId || scope()!==key)throw new ForbiddenException("本人交接消息读取身份已变化");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    // Original recipient/from associations and customer realm are before LIMIT.
    // Own orphaned command receipts remain candidates so corruption cannot become
    // an empty success. Only two immutable payload scalars are selected.
    const rows=await this.prisma.$queryRaw<OriginalAdministratorTransferReceiptRow[]>`
      SELECT o.tenantId,w.corporateCustomerId,w.id AS auditObjectId,'administrator_transfer' AS objectType,o.operationKey,o.actorUserId,o.target,o.reason,o.result,o.createdAt,o.requestHash,w.applicantCustomerId,
        JSON_OBJECT('fromCustomerId',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(w.payload),w.payload,'{}'),'$.fromCustomerId')),'targetMembershipId',JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(w.payload),w.payload,'{}'),'$.targetMembershipId'))) AS association,
        k.target AS originalTarget,k.result AS originalResult,k.requestHash AS originalHash
      FROM enterprise_portal_operations o LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId AND w.kind='administrator_transfer'
        AND (o.target IN (CONCAT('administrator.accept:',w.id),CONCAT('administrator.decision.sealed:',w.id))
          OR (o.target=CONCAT('administrator.transfer:',w.corporateCustomerId) AND w.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id')))
          OR (o.target LIKE 'administrator.decision.close:%' AND w.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.transferId'))))
      LEFT JOIN enterprise_portal_operations k ON k.tenantId=o.tenantId AND k.actorUserId=o.actorUserId AND k.operationKey=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.originalOperationKey'))
        AND k.target IN (CONCAT('administrator.accept:',w.id),CONCAT('administrator.decision.sealed:',w.id))
      WHERE o.tenantId=${context.tenantId} AND o.actorUserId LIKE 'customer:%'
        AND (w.applicantCustomerId=${context.customerId} OR JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(w.payload),w.payload,'{}'),'$.fromCustomerId'))=${context.customerId} OR o.actorUserId=${`customer:${context.customerId}`})
        AND (o.target LIKE 'administrator.transfer:%' OR o.target LIKE 'administrator.accept:%' OR o.target LIKE 'administrator.decision.sealed:%' OR o.target LIKE 'administrator.decision.close:%')
      ORDER BY o.createdAt DESC,o.operationKey DESC LIMIT 201`;
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    if(rows.length>200)throw new ConflictException("本人交接消息超出当前有界范围");
    const reference=(v:unknown):v is string=>typeof v==="string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
    const items=rows.map(row=>{
      let decoded:unknown;try{decoded=enterpriseJson(row.association);}catch{throw new ConflictException("原交接双方关联不可核对");}
      if(!decoded || typeof decoded!=="object" || Array.isArray(decoded))throw new ConflictException("原交接双方关联不可核对");
      const association=decoded as Record<string,unknown>;
      if(!reference(association.fromCustomerId) || !reference(association.targetMembershipId)
        || !reference(row.applicantCustomerId) || association.fromCustomerId===row.applicantCustomerId || !reference(row.corporateCustomerId))throw new ConflictException("原交接双方关联不可核对");
      const participation=association.fromCustomerId===context.customerId ? "initiator" : row.applicantCustomerId===context.customerId ? "recipient" : undefined;
      if(!participation)throw new ConflictException("非原交接消息接收人");
      return {corporateCustomerId:row.corporateCustomerId,participation,receipt:projectOriginalAdministratorTransferReceipt(row,context.tenantId,row.corporateCustomerId)};
    });
    const result=enterpriseOwnTransferMessagesSnapshot({tenantCode:context.tenantCode,customerId:context.customerId,coverage:"own_original_administrator_transfer_receipts",delivery:"not_reported",readState:"not_recorded",items},context.tenantCode,context.customerId);
    if(!result)throw new ConflictException("原本人交接消息缺少可核对字段");return result;
  }
  /** Only this person's original account/member status facts. Internal reasons,
   * operator/approver identities, merges and historical workspace logs stay private. */
  async statusMessages(context: ClientRequestContext): Promise<EnterpriseOwnStatusMessages> {
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if(context.customerType!=="personal" || !actor || actor.tenantId!==context.tenantId || actor.userId!==context.customerId
      || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || actor.workspaceId!==context.workspaceId || scope()!==key)throw new ForbiddenException("本人状态消息读取身份已变化");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    // These are original global account/member events, not space orders. Ownership,
    // scope and non-merge public actions are restricted before the 201 probe.
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;customerId:string;id:string;scope:string;action:string;fromStatus:string|null;toStatus:string;at:Date}>>`
      SELECT h.tenantId,h.customerId,h.id,h.scope,h.action,h.fromStatus,h.toStatus,h.at FROM customer_status_history h
      WHERE h.tenantId=${context.tenantId} AND h.customerId=${context.customerId} AND h.scope IN ('account','membership')
        AND h.action IN ('activate','suspend','restrict','release','exit','close','reopen')
      ORDER BY h.at DESC,h.id DESC LIMIT 201`;
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    if(rows.length>200)throw new ConflictException("本人状态消息超出当前有界范围");
    const items=rows.map(row=>{
      if(row.tenantId!==context.tenantId || row.customerId!==context.customerId || !Number.isFinite(row.at?.getTime()))throw new ConflictException("原本人状态消息关联不可核对");
      return {id:row.id,scope:row.scope,action:row.action,toStatus:row.toStatus,at:row.at.toISOString(),...(row.fromStatus!==null?{fromStatus:row.fromStatus}:{})};
    });
    const result=enterpriseOwnStatusMessagesSnapshot({tenantCode:context.tenantCode,customerId:context.customerId,coverage:"own_original_account_membership_status_history",delivery:"not_reported",readState:"not_recorded",items},context.tenantCode,context.customerId);
    if(!result)throw new ConflictException("原本人状态消息缺少可核对字段");return result;
  }
  /** Own original retained-master merge references only. Never follows a merge
   * chain, exposes the source person's data or inherits their relationships. */
  async retainedMergeMessages(context: ClientRequestContext): Promise<EnterpriseOwnRetainedMergeMessages> {
    const scope=()=>JSON.stringify([context.tenantId,context.tenantCode,context.customerId,context.sessionId,context.workspaceId,context.workspaceCode]),key=scope();
    const assertScope=()=>{const actor=getRequestIdentity();if(context.customerType!=="personal" || !actor || actor.tenantId!==context.tenantId || actor.userId!==context.customerId
      || actor.isSaasAdmin!==false || actor.staffApi===true || actor.dataScope!==undefined || actor.workspaceId!==context.workspaceId || scope()!==key)throw new ForbiddenException("本人合并记录消息读取身份已变化");};
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    // Restrict original target ownership before LIMIT; only a distinct-master
    // association flag is read, never the source ID, private diff or review data.
    const rows=await this.prisma.$queryRaw<Array<{tenantId:string;targetCustomerId:string;id:string;mergedAt:Date;associationState:string}>>`
      SELECT m.tenantId,m.targetCustomerId,m.id,m.mergedAt,CASE WHEN m.sourceCustomerId<>m.targetCustomerId THEN 'distinct' ELSE 'invalid' END AS associationState
      FROM customer_merge_mappings m WHERE m.tenantId=${context.tenantId} AND m.targetCustomerId=${context.customerId}
      ORDER BY m.mergedAt DESC,m.id DESC LIMIT 201`;
    assertScope();await this.commands.customer(context,this.prisma as unknown as Prisma.TransactionClient,false);assertScope();
    if(rows.length>200)throw new ConflictException("本人合并记录消息超出当前有界范围");
    const items=rows.map(row=>{
      if(row.tenantId!==context.tenantId || row.targetCustomerId!==context.customerId || row.associationState!=="distinct" || !Number.isFinite(row.mergedAt?.getTime()))throw new ConflictException("原合并保留方关联不可核对");
      return {id:row.id,mergedAt:row.mergedAt.toISOString(),effect:"retained_master_record_only"};
    });
    const result=enterpriseOwnRetainedMergeMessagesSnapshot({tenantCode:context.tenantCode,customerId:context.customerId,coverage:"own_original_retained_master_merge_records",delivery:"not_reported",readState:"not_recorded",items},context.tenantCode,context.customerId);
    if(!result)throw new ConflictException("原本人合并记录消息缺少可核对字段");return result;
  }
  async ownAudit(context: ClientRequestContext): Promise<EnterpriseAuditView[]> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const rows = await this.prisma.$queryRaw<Array<{ operationKey: string; target: string; reason: string; createdAt: Date }>>`
      SELECT operationKey,target,reason,createdAt FROM enterprise_portal_operations
      WHERE tenantId=${context.tenantId} AND actorUserId=${`customer:${context.customerId}`} ORDER BY createdAt DESC,operationKey DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("本人原操作记录超出当前有界读取范围");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return rows.map(row => ({ operationKey: row.operationKey, action: row.target.split(":", 1)[0], target: row.target,
      reason: row.reason, actor: context.customerId, createdAt: row.createdAt.toISOString() }));
  }
}
