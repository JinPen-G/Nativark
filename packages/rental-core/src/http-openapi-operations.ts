/** Rental 原 HTTP 操作单源。宿主挂载、当前权限、事务与原收据仍由原实现裁定。 */
import { STAFF_UPLOAD_OBSERVATION_HTTP } from "@rental-os/shared";
import { RENTAL_EXCHANGE_INSPECTION_OPERATIONS } from "./http-openapi-rental-exchange-inspection-preparation.schemas";
import { ENTERPRISE_COMPONENT_SCHEMAS } from "./http-openapi-enterprise-schemas";

import { CATEGORY_PREPARATION_PREVIEW_SCHEMA, CATEGORY_PREPARATION_BATCH_READ_SCHEMA, CATEGORY_PREPARATION_BATCH_REQUEST_SCHEMA, CATEGORY_PREPARATION_ENTITY_PAGE_SCHEMA, CATEGORY_PREPARATION_REQUEST_SCHEMA, CATEGORY_PREPARATION_SAVE_RESULT_SCHEMA, CATEGORY_CREATION_REQUEST_SCHEMA, CATEGORY_CREATION_PREVIEW_REQUEST_SCHEMA, CATEGORY_CREATED_VERSION_SCHEMA, CATEGORY_CREATION_PREVIEW_SCHEMA, CATEGORY_CREATION_RECEIPT_SCHEMA, CATEGORY_ADOPTION_REQUEST_SCHEMA, CATEGORY_ADOPTION_RESULT_SCHEMA, CATEGORY_ADOPTION_RECEIPT_SCHEMA } from "./http-openapi-category-governance-schemas";

import { stringSchema, numberSchema, booleanSchema, objectSchema, rentalCategoryCodeSchema, ref, arrayOf, objectOf, queryParam, backlogOperation, clientOperation, type HttpMethod, type SchemaObject, type ContractOperation } from "./http-openapi-contract";

function enterpriseWorkflowOperations(): ContractOperation[] {
  const clientRoutes: Array<[HttpMethod, string, string, string?]> = [
    ["post", "order-delegations/issue", "issueEnterpriseOrderDelegation", "IssueEnterpriseOrderDelegation"],
    ["get", "order-delegations/{key}", "readEnterpriseOrderDelegation"],
    ["post", "order-delegations/{key}/revoke", "revokeEnterpriseOrderDelegation", "RevokeEnterpriseOrderDelegation"],
    ["get", "tasks", "enterpriseOwnTasks"], ["get", "corporates/{corporateId}/tasks", "enterpriseCorporateTasks"], ["get", "my-audit", "enterpriseOwnAudit"], ["get", "my-messages", "enterpriseOwnMessages"], ["get", "my-application-review-messages", "enterpriseOwnApplicationReviewMessages"], ["get", "my-join-review-messages", "enterpriseOwnJoinReviewMessages"], ["get", "my-management-review-messages", "enterpriseOwnManagementReviewMessages"], ["get", "my-retained-merge-messages", "enterpriseOwnRetainedMergeMessages"], ["get", "my-status-messages", "enterpriseOwnStatusMessages"], ["get", "my-corporate-status-messages", "enterpriseOwnCorporateStatusMessages"], ["get", "my-employee-policy-messages", "enterpriseOwnEmployeePolicyMessages"], ["get", "my-transfer-messages", "enterpriseOwnTransferMessages"], ["get", "my-relationship-messages", "enterpriseOwnRelationshipMessages"], ["get", "my-approval-notices", "enterpriseOwnApprovalNotices"], ["get", "corporates/{corporateId}/approval-notices", "enterpriseReviewApprovalNotices"],
    ["get", "corporates/{corporateId}/profile", "enterpriseProfile"], ["get", "management-requests", "enterpriseManagementRequests"],
    ["get", "management-requests/{id}", "readEnterpriseManagementRequestDetail"],
    ["get", "corporates/{corporateId}/management-requests/save-operations/{key}", "readEnterpriseManagementSave"],
    ["post", "corporates/{corporateId}/management-requests", "saveEnterpriseManagementRequest", "SaveEnterpriseManagementRequest"],
    ["post", "management-requests/{id}/withdraw", "withdrawEnterpriseManagementRequest", "EnterpriseChangeRequest"],
    ["get", "management-requests/{id}/withdraw-operations/{key}", "readEnterpriseManagementWithdrawal"],
    ["get", "applications/{id}", "readEnterpriseApplicationDetail"],
    ["get", "applications/save-operations/{key}", "readEnterpriseApplicationSave"],
    ["get", "applications", "enterpriseApplications"], ["post", "applications", "saveEnterpriseApplication", "SaveEnterpriseApplicationRequest"],
    ["post", "applications/{id}/withdraw", "withdrawEnterpriseApplication", "EnterpriseChangeRequest"],
    ["get", "applications/{id}/withdraw-operations/{key}", "readEnterpriseApplicationWithdrawal"],
    ["get", "my-requests", "enterpriseOwnRequests"], ["get", "my-relations", "enterpriseOwnRelations"], ["post", "join", "joinEnterprise", "JoinEnterpriseRequest"],
    ["post", "join-requests/{id}/withdraw", "withdrawEnterpriseJoin", "EnterpriseChangeRequest"],
    ["get", "join/request-operations/{key}", "readEnterpriseJoinSubmission"],
    ["get", "join-requests/{id}/withdraw-operations/{key}", "readEnterpriseJoinWithdrawal"],
    ["post", "invites/preview", "previewEnterpriseInvite", "PreviewEnterpriseInviteRequest"],
    ["get", "corporates/{corporateId}/invites/create-operations/{key}", "readEnterpriseInviteCreation"],
    ["get", "corporates/{corporateId}/invites", "enterpriseInvites"], ["post", "corporates/{corporateId}/invites", "createEnterpriseInvite", "CreateEnterpriseInviteRequest"],
    ["get", "corporates/{corporateId}/invites/{id}/revoke-operations/{key}", "readEnterpriseInviteRevocation"],
    ["post", "corporates/{corporateId}/invites/{id}/revoke", "revokeEnterpriseInvite", "EnterpriseChangeRequest"],
    ["get", "corporates/{corporateId}/join-requests/{id}/decision-operations/{key}", "readEnterpriseJoinReview"],
    ["get", "corporates/{corporateId}/join-requests", "enterpriseJoinRequests"], ["post", "corporates/{corporateId}/join-requests/{id}/decision", "reviewEnterpriseJoin", "ReviewEnterpriseJoinRequest"],
    ["put", "corporates/{corporateId}/members/{id}", "changeEnterpriseMember", "ChangeEnterpriseMemberRequest"], ["post", "corporates/{corporateId}/members/{id}/exit", "exitEnterpriseMember", "ChangeEnterpriseMemberRequest"],
    ["get", "corporates/{corporateId}/members/{id}/change-operations/{key}", "readEnterpriseMemberChange"],
    ["get", "corporates/{corporateId}/members/{id}/exit-operations/{key}", "readEnterpriseMemberExit"],
    ["get", "corporates/{corporateId}/members/{id}/administrator/change-operations/{key}", "readEnterpriseAdministratorChange"],
    ["get", "corporates/{corporateId}/members/{id}/administrator", "readEnterpriseAdministrator"],
    ["put", "corporates/{corporateId}/members/{id}/administrator", "changeEnterpriseAdministrator", "ChangeEnterpriseAdministratorRequest"],
    ["post", "corporates/{corporateId}/transfers", "transferEnterpriseAdmin", "TransferEnterpriseAdministratorRequest"], ["post", "transfers/{id}/decision", "acceptEnterpriseAdminTransfer", "DecideEnterpriseTransferRequest"],
    ["get", "corporates/{corporateId}/transfers/request-operations/{key}", "readEnterpriseTransferInitiation"],
    ["get", "transfers/{id}/decision-operations/{key}", "readEnterpriseTransferDecision"],
    ["post", "transfers/{id}/decision-operations/{key}/close", "closeEnterpriseTransferDecision", "CloseEnterpriseTransferDecisionRequest"],
    ["get", "corporates/{corporateId}/policy", "readEnterpriseScopePolicy"], ["put", "corporates/{corporateId}/policy", "saveEnterpriseScopePolicy", "SaveEnterpriseScopePolicyRequest"],
    ["get", "corporates/{corporateId}/members/{id}/policy", "readEnterpriseMemberPolicy"], ["put", "corporates/{corporateId}/members/{id}/policy", "saveEnterpriseMemberPolicy", "SaveEnterpriseScopePolicyRequest"],
    ["get", "corporates/{corporateId}/policy/save-operations/{key}", "readEnterprisePolicySave"],
    ["get", "corporates/{corporateId}/members/{id}/policy/save-operations/{key}", "readEnterpriseMemberPolicySave"],
    ["get", "my-rental-policies", "enterpriseOwnRentalPolicies"],
    ["get", "quotes/{quoteId}/order-operations/{key}", "enterpriseOrderOriginalResult"],
    ["get", "orders/{orderId}/extension-eligibility", "enterpriseExtensionEligibility"],
    ["get", "orders/{orderId}/extension-request-operations/{key}", "enterpriseExtensionRequestOriginalResult"],
    ["post", "orders/{orderId}/extension-request-operations/{key}/close", "closeEnterpriseExtensionRequest", "CloseEnterpriseExtensionRequest"],
    ["get", "orders/{orderId}/exchange-request-operations/{key}", "enterpriseExchangeRequestOriginalResult"],
    ["post", "orders/{orderId}/exchange-request-operations/{key}/close", "closeEnterpriseExchangeRequest", "CloseEnterpriseExchangeRequest"],
    ["get", "orders/{orderId}/exchange-approvals", "enterpriseOrderExchangeApprovals"],
    ["get", "orders/{orderId}/exchange-inspections/{preparationId}", "enterpriseExchangeInspectionMaterial"],
    ["post", "orders/{orderId}/exchange-inspection-consents", "confirmEnterpriseExchangeInspection", "ConfirmRentalExchangeInspectionRequest"],
    ["get", "orders/{orderId}/exchange-inspection-consents/operations/{key}", "enterpriseExchangeInspectionConsentOriginal"],
    ["get", "orders/{orderId}/exchange-choices", "enterpriseExchangeChoices"],
    ["get", "my-exchange-approvals", "enterpriseOwnExchangeApprovals"], ["get", "corporates/{corporateId}/exchange-approvals", "enterpriseExchangeReviewQueue"],
    ["post", "exchange-approvals", "requestEnterpriseExchangeApproval", "RequestEnterpriseExchangeApproval"],
    ["get", "exchange-approvals/{id}", "enterpriseExchangeApproval"],
    ["post", "exchange-approvals/{id}/expense-confirmation", "confirmEnterpriseExchangeExpense", "ConfirmEnterpriseExchangeExpense"],
    ["get", "exchange-approvals/{id}/expense-confirmation", "enterpriseExchangeConfirmationOriginal"],
    ["post", "exchange-approvals/{id}/decision", "decideEnterpriseExchangeApproval", "DecideEnterpriseExchangeApproval"],
    ["get", "my-extension-approvals", "enterpriseOwnExtensionApprovals"], ["get", "corporates/{corporateId}/extension-approvals", "enterpriseExtensionReviewQueue"],
    ["post", "extension-approvals", "requestEnterpriseExtensionApproval", "RequestEnterpriseExtensionApproval"],
    ["post", "extension-approvals/{id}/decision", "decideEnterpriseExtensionApproval", "DecideEnterpriseExtensionApproval"],
    ["post", "extension-approvals/{id}/close-execution", "closeEnterpriseExtensionExecution", "CloseEnterpriseExtensionExecution"],
    ["get", "extension-approvals/{id}/result", "enterpriseExtensionOriginalResult"], ["post", "extension-approvals/submit", "submitEnterpriseExtensionApproval", "SubmitEnterpriseExtensionApproval"],
    ["get", "my-approvals", "enterpriseOwnApprovals"], ["post", "approvals", "requestEnterpriseApproval", "RequestEnterpriseBookingApproval"],
    ["get", "corporates/{corporateId}/approvals", "enterpriseReviewQueue"], ["post", "approvals/{id}/decision", "decideEnterpriseApproval", "DecideEnterpriseBookingApproval"],
    ["post", "approvals/{id}/close-execution", "closeEnterpriseApprovalExecution", "CloseEnterpriseApprovalExecution"],
    ["get", "approvals/{id}/result", "enterpriseApprovalOriginalResult"], ["post", "approvals/submit", "submitEnterpriseApproval", "SubmitEnterpriseApprovedBooking"],
    ["get", "operations/{key}", "readEnterpriseWorkflowOperation"],
    ["get", "corporates/{corporateId}/orders/{orderId}/payment-proof-basis", "readEnterprisePaymentProofBasis"],
    ["post", "corporates/{corporateId}/orders/{orderId}/payment-proof/upload-sessions", "createEnterprisePaymentProofUpload", "EnterprisePaymentProofUploadRequest"],
    ["get", "corporates/{corporateId}/orders/{orderId}/payment-proof/upload-operations/{key}", "readEnterprisePaymentProofUpload"],
    ["post", "corporates/{corporateId}/orders/{orderId}/payment-proof/upload-sessions/{id}/complete", "completeEnterprisePaymentProofUpload", "ClientQualificationUploadCompleteRequest"],
    ["get", "authority/upload-operations/{key}", "enterpriseAuthorityOriginalUpload"],
    ["post", "authority/upload-sessions", "enterpriseAuthorityUpload", "EnterpriseAuthorityUploadRequest"], ["post", "authority/upload-sessions/{id}/complete", "completeEnterpriseAuthorityUpload", "ClientQualificationUploadCompleteRequest"]
  ];
  const responses: Record<string, string> = {
    readEnterprisePaymentProofBasis: "EnterprisePaymentProofBasis", createEnterprisePaymentProofUpload: "FileUploadSessionSummary",
    readEnterprisePaymentProofUpload: "EnterprisePaymentProofUploadOperation", completeEnterprisePaymentProofUpload: "GenericObject",
    issueEnterpriseOrderDelegation: "EnterpriseOrderDelegationOriginal", readEnterpriseOrderDelegation: "EnterpriseOrderDelegationOriginal", revokeEnterpriseOrderDelegation: "EnterpriseOrderDelegationOriginal",
    enterpriseApplications: "EnterpriseWorkflowList", readEnterpriseApplicationDetail: "EnterpriseWorkflowView", enterpriseOwnRequests: "EnterpriseWorkflowList", enterpriseJoinRequests: "EnterpriseWorkflowList", enterpriseOwnRelations: "EnterpriseOwnRelations", previewEnterpriseInvite: "EnterpriseInvitePreview",
    enterpriseExtensionEligibility: "EnterpriseExtensionEligibility", enterpriseExtensionRequestOriginalResult: "EnterpriseExtensionRequestOriginalResult", closeEnterpriseExtensionRequest: "EnterpriseExtensionRequestOriginalResult",
    enterpriseExchangeRequestOriginalResult: "EnterpriseExchangeRequestOriginalResult", closeEnterpriseExchangeRequest: "EnterpriseExchangeRequestOriginalResult",
    enterpriseOrderExchangeApprovals: "EnterpriseExchangeApprovalList", enterpriseExchangeChoices: "EnterpriseExchangeChoices",
    enterpriseExchangeInspectionMaterial: "RentalExchangeInspectionCustomerMaterial", confirmEnterpriseExchangeInspection: "RentalExchangeInspectionConsent",
    enterpriseExchangeInspectionConsentOriginal: "RentalExchangeInspectionConsentOriginal",
    enterpriseOwnExchangeApprovals: "EnterpriseExchangeApprovalList", enterpriseExchangeReviewQueue: "EnterpriseExchangeApprovalList", enterpriseExchangeApproval: "EnterpriseExchangeApprovalView",
    confirmEnterpriseExchangeExpense: "EnterpriseExchangeConfirmationCommandResult", enterpriseExchangeConfirmationOriginal: "EnterpriseExchangeConfirmationResult",
    requestEnterpriseExchangeApproval: "EnterpriseExchangeCommandResult", decideEnterpriseExchangeApproval: "EnterpriseExchangeCommandResult",
    enterpriseOwnExtensionApprovals: "EnterpriseExtensionApprovalList", enterpriseExtensionReviewQueue: "EnterpriseExtensionApprovalList",
    requestEnterpriseExtensionApproval: "EnterpriseExtensionCommandResult", decideEnterpriseExtensionApproval: "EnterpriseExtensionCommandResult",
    enterpriseExtensionOriginalResult: "EnterpriseExtensionOriginalResult", submitEnterpriseExtensionApproval: "EnterpriseExtensionOriginalResult", closeEnterpriseExtensionExecution: "EnterpriseExtensionOriginalResult",
    saveEnterpriseScopePolicy: "EnterpriseScopePolicySaved", saveEnterpriseMemberPolicy: "EnterpriseScopePolicySaved",
    enterpriseOwnRentalPolicies: "EnterpriseOwnRentalPolicies", enterpriseOwnApprovals: "EnterpriseBookingApprovalList", enterpriseReviewQueue: "EnterpriseBookingApprovalList",
    closeEnterpriseApprovalExecution: "EnterpriseApprovalOriginalResult", enterpriseApprovalOriginalResult: "EnterpriseApprovalOriginalResult", enterpriseOrderOriginalResult: "EnterpriseOrderOriginalResult",
    readEnterpriseWorkflowOperation: "EnterprisePortalOperationResponse", readEnterpriseTransferDecision: "EnterprisePortalOperationResponse", readEnterpriseMemberExit: "EnterprisePortalOperationResponse", readEnterpriseMemberChange: "EnterprisePortalOperationResponse", readEnterpriseAdministratorChange: "EnterprisePortalOperationResponse", readEnterpriseTransferInitiation: "EnterprisePortalOperationResponse", closeEnterpriseTransferDecision: "EnterpriseTransferDecisionResolution", readEnterpriseAdministrator: "EnterpriseAdministratorView",
    enterpriseOwnTasks: "EnterpriseTaskCenter", enterpriseCorporateTasks: "EnterpriseTaskCenter", enterpriseOwnAudit: "EnterpriseOwnAudit", enterpriseOwnMessages: "EnterpriseOwnMessages", enterpriseOwnApplicationReviewMessages: "EnterpriseOwnApplicationReviewMessages", enterpriseOwnJoinReviewMessages: "EnterpriseOwnJoinReviewMessages", enterpriseOwnManagementReviewMessages: "EnterpriseOwnManagementReviewMessages", enterpriseOwnRetainedMergeMessages: "EnterpriseOwnRetainedMergeMessages", enterpriseOwnStatusMessages: "EnterpriseOwnStatusMessages", enterpriseOwnCorporateStatusMessages: "EnterpriseOwnCorporateStatusMessages", enterpriseOwnEmployeePolicyMessages: "EnterpriseOwnEmployeePolicyMessages", enterpriseOwnTransferMessages: "EnterpriseOwnTransferMessages", enterpriseOwnRelationshipMessages: "EnterpriseOwnRelationshipMessages", enterpriseOwnApprovalNotices: "EnterpriseApprovalNotices", enterpriseReviewApprovalNotices: "EnterpriseApprovalNotices",
    enterpriseProfile: "EnterpriseProfileView", enterpriseManagementRequests: "EnterpriseManagementRequestList", readEnterpriseManagementRequestDetail: "EnterpriseManagementRequestView",
    saveEnterpriseManagementRequest: "EnterpriseCommandResult", withdrawEnterpriseManagementRequest: "EnterpriseCommandResult", readEnterpriseManagementSave: "EnterprisePortalOperationResponse", readEnterpriseManagementWithdrawal: "EnterprisePortalOperationResponse",
    requestEnterpriseApproval: "EnterpriseApprovalRequestResult", decideEnterpriseApproval: "EnterpriseApprovalDecisionResult", submitEnterpriseApproval: "EnterpriseApprovalSubmissionResult",
    enterpriseInvites: "EnterpriseInviteList", createEnterpriseInvite: "EnterpriseInviteCreated", readEnterpriseInviteCreation: "EnterprisePortalOperationResponse", readEnterpriseInviteRevocation: "EnterprisePortalOperationResponse", readEnterpriseJoinWithdrawal: "EnterprisePortalOperationResponse", readEnterpriseJoinReview: "EnterprisePortalOperationResponse", readEnterpriseJoinSubmission: "EnterprisePortalOperationResponse", readEnterpriseApplicationWithdrawal: "EnterprisePortalOperationResponse", readEnterpriseApplicationSave: "EnterprisePortalOperationResponse", readEnterprisePolicySave: "EnterprisePortalOperationResponse", readEnterpriseMemberPolicySave: "EnterprisePortalOperationResponse"
  };
  return [...clientRoutes.map(([method, route, operationId, requestSchema]) => clientOperation(method, `/api/client/v1/enterprise/${route}`, operationId, ["enterpriseOwnApprovalNotices","enterpriseReviewApprovalNotices"].includes(operationId) ? "Read current-workspace minimal original approval states; reviewer reminders require current explicit review authority and exclude self/expired pending records; not admission, execution or delivery proof" : operationId === "enterpriseOwnRelationshipMessages" ? "Read original member/admin portal command receipts addressed to this retained personal relation owner; no current-state/grant fallback, operator logs, delivery assertion or K recovery" : operationId === "enterpriseOwnMessages" ? "Read this authenticated person's current persisted enterprise/join/management request feedback only; not delivery history, read receipts, current authority or business execution" : operationId === "readEnterpriseManagementSave" ? "Read this applicant's exact original company/key management-save receipt; no proposal, evidence, current enterprise/authority or later decision fallback; review only, no business change" : operationId === "saveEnterpriseMemberPolicy" ? "Save employee policy against its explicitly reviewed active relationship revision; no rebinding a restored relationship or replay as a new grant" : ["readEnterprisePolicySave", "readEnterpriseMemberPolicySave"].includes(operationId) ? "Read this actor's exact original company/member policy-save key only; no current policy, monetary limits or authority fallback" : operationId === "readEnterpriseApplicationDetail" ? "Read only this applicant's exact request and original material/feedback; no current-profile fallback, operator key or file download grant" : operationId === "readEnterpriseApplicationSave" ? "Read this applicant's exact original save key and linked application only; current material or approval never replaces the historical result" : operationId === "readEnterpriseApplicationWithdrawal" ? "Read this applicant's exact original application/key withdrawal; current application or enterprise state never substitutes for the receipt" : operationId === "readEnterpriseJoinSubmission" ? "Read this applicant's original join key and exact request/relation or persisted refusal; never regenerate invite codes or infer current admission" : operationId === "readEnterpriseJoinReview" ? "Read this reviewer's exact company/request/key decision receipt; historical approval does not restore current authority" : operationId === "readEnterpriseJoinWithdrawal" ? "Read this applicant's exact request/key withdrawal receipt; current request or relationship state never replaces original evidence" : operationId === "readEnterpriseInviteRevocation" ? "Read this actor's exact company/invite/key revocation receipt; current revoked state or expiry cannot replace missing original evidence" : operationId === "readEnterpriseInviteCreation" ? "Read this creator's exact company/key invite creation receipt; no raw code is recoverable or regenerated" : operationId === "readEnterpriseAdministratorChange" ? "Read this actor's exact original administrator-change receipt; historical roles/actions never restore current authority" : operationId === "readEnterpriseMemberChange" ? "Read this actor's exact company/member/key change receipt only; no current relationship or member-existence fallback" : operationId === "readEnterpriseTransferInitiation" ? "Read this initiator's exact company/key receipt and original workflow; later decisions never replace the pending initiation result" : operationId === "readEnterpriseMemberExit" ? "Read this customer's exact company/member/key exit receipt; current relation state never substitutes for missing evidence" : operationId === "readEnterpriseTransferDecision" ? "Read this recipient's exact original transfer decision; missing evidence never permits replay" : operationId === "closeEnterpriseTransferDecision" ? "Explicit recipient K/C refusal; an accepted transfer is only observed, never undone" : "Controlled enterprise workflow; current customer and action authorization required", { requestSchema: operationId === "saveEnterpriseMemberPolicy" ? { allOf: [{ $ref: "#/components/schemas/SaveEnterpriseScopePolicyRequest" }, { type: "object", required: ["expectedMembershipUpdatedAt"] }] } : requestSchema,
    responseSchema: responses[operationId] ?? (method === "get" && route.endsWith("/policy") ? "EnterpriseScopePolicyView" : objectSchema),
    ...(["readEnterpriseApplicationDetail", "readEnterpriseManagementRequestDetail"].includes(operationId) ? { parameters: [{ name: "id", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191 } }] } : {}),
    ...(["readEnterpriseJoinSubmission", "readEnterpriseApplicationSave"].includes(operationId) ? { parameters: [{ name: "key", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 128 } }] } : {}),
    ...(["readEnterpriseTransferInitiation", "readEnterpriseInviteCreation", "readEnterprisePolicySave", "readEnterpriseManagementSave"].includes(operationId) ? { parameters: [
      { name: "corporateId", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191 } },
      { name: "key", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 128 } }
    ] } : ["readEnterpriseMemberExit", "readEnterpriseMemberChange", "readEnterpriseAdministratorChange", "readEnterpriseInviteRevocation", "readEnterpriseJoinReview", "readEnterpriseMemberPolicySave"].includes(operationId) ? { parameters: [
      { name: "corporateId", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191 } },
      { name: "id", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191 } },
      { name: "key", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 128 } }
    ] } : ["readEnterpriseTransferDecision", "closeEnterpriseTransferDecision", "readEnterpriseJoinWithdrawal", "readEnterpriseApplicationWithdrawal", "readEnterpriseManagementWithdrawal"].includes(operationId) ? { parameters: [
      { name: "id", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191 } },
      { name: "key", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 128 } }
    ] } : operationId === "enterpriseExchangeChoices" ? { parameters: [
      { name: "allocationId", in: "query" as const, required: false, schema: { type: "string" as const, minLength: 1, maxLength: 191 } },
      { name: "replacementItemGroupId", in: "query" as const, required: false, schema: { type: "string" as const, minLength: 1, maxLength: 191 } }
    ] } : {}) })),
    clientOperation("get", "/api/client/v1/enterprise/management-requests/{id}/files/{fileId}", "readEnterprisePaymentProofEvidence", "Read this applicant's frozen rental-fee payment evidence under current enterprise, order and financial authority", {
      parameters: ["id", "fileId"].map(name => ({ name, in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191 } })),
      responseSchema: { type: "string", format: "binary" }, rawResponseContentType: "application/octet-stream"
    }),
    clientOperation("get", "/api/client/v1/enterprise/orders/{orderId}/exchange-inspections/{preparationId}/photos/{fileAssetId}",
      "enterpriseExchangeInspectionPhoto", "Read this using customer's exact frozen PNG/JPEG under the current inspection and preparation hash", {
        parameters: [
          ...["orderId", "preparationId", "fileAssetId"].map(name => ({ name, in: "path" as const, required: true,
            schema: { type: "string" as const, pattern: "^[A-Za-z0-9._:-]{1,191}$", minLength: 1, maxLength: 191 } })),
          { name: "preparationHash", in: "query", required: true, schema: { type: "string", pattern: "^[a-f0-9]{64}$", minLength: 64, maxLength: 64 } }
        ], responseSchema: { type: "string", format: "binary" }, rawResponseContentType: "image/*"
      }),
    { method: "get", path: "/api/membership/enterprise-workflows/applications/{id}/files/{fileId}", tag: "Membership", operationId: "readEnterpriseApplicationEvidence", summary: "Read original application evidence under current dual authority; revalidate request and attachment after bytes, no bearer download link", permissions: ["rental-os:corporate:manage", "rental-os:corporate:employee-manage"], authRequired: true, responseSchema: { type: "string", format: "binary" }, rawResponseContentType: "application/octet-stream" },
    backlogOperation("get", "/api/membership/enterprise-workflows/operations/{key}", "Membership", "readMerchantEnterpriseWorkflowOperation", "Read this operator's original workflow result", ["rental-os:corporate:manage"], true, undefined, "EnterprisePortalOperationResponse"),
    backlogOperation("get", "/api/membership/enterprise-workflows/order-delegations/{key}", "Membership", "readMerchantEnterpriseOrderDelegation", "Read this currently authorized merchant's original customer delegation source reference and receipt", ["rental-os:corporate:manage"], true, undefined, "EnterpriseOrderDelegationView"),
    backlogOperation("post", "/api/membership/enterprise-workflows/order-delegations/{key}/execute", "Membership", "executeMerchantEnterpriseOrderDelegation", "Execute this original customer delegation through the sealed Core order port", ["rental-os:corporate:manage"], true, "ExecuteEnterpriseMerchantOrderDelegation", "EnterpriseMerchantOrderDelegationResult"),
    backlogOperation("get", "/api/membership/enterprise-workflows/order-delegations/{key}/result", "Membership", "readMerchantEnterpriseOrderDelegationResult", "Read this authorized operator's original D and Core order result", ["rental-os:corporate:manage"], true, undefined, "EnterpriseMerchantOrderDelegationResult"),
    backlogOperation("post", "/api/membership/enterprise-workflows/orders/{orderId}/exchange-approvals/{id}/execute", "Membership", "executeEnterpriseApprovedExchange", "Execute the bound approved exchange under original merchant order and workspace authority", ["rental-os:corporate:manage"], true, "ExecuteApprovedRentalExchangeRequest", "RentalApprovedExchangeReceipt"),
    backlogOperation("get", "/api/membership/enterprise-workflows/orders/{orderId}/exchange-approvals/{id}/execution-operations/{key}", "Membership", "readEnterpriseApprovedExchangeOriginal", "Read the exact original merchant exchange key and approval-bound receipt", ["rental-os:corporate:manage"], true, undefined, "RentalApprovedExchangeOriginal"),
    backlogOperation("get", "/api/membership/enterprise-workflows/orders/{orderId}/exchange-execution-choices", "Membership", "readEnterpriseMerchantExchangeChoices", "Read this currently authorized merchant's original approval, prepared inspection and applicant consent choices", ["rental-os:corporate:manage"], true, undefined, "EnterpriseMerchantExchangeChoices"),
    backlogOperation("get", "/api/membership/enterprise-workflows/corporates/{corporateId}/policy", "Membership", "readMerchantEnterpriseScopePolicy", "Read explicit enterprise rental upper bounds", ["rental-os:corporate:manage"], true, undefined, "EnterpriseScopePolicyView"),
    backlogOperation("put", "/api/membership/enterprise-workflows/corporates/{corporateId}/policy", "Membership", "saveMerchantEnterpriseScopePolicy", "Set explicit enterprise rental upper bounds", ["rental-os:corporate:manage"], true, "SaveEnterpriseScopePolicyRequest", "EnterpriseScopePolicySaved"),
    { ...backlogOperation("get", "/api/membership/enterprise-workflows/corporates/{corporateId}/policy/save-operations/{key}", "Membership", "readMerchantEnterprisePolicySave", "Read this currently authorized operator's exact original company/key policy-save receipt; no policy body, current limits or new grant", ["rental-os:corporate:manage"], true, undefined, "EnterprisePortalOperationResponse"), parameters: [
      { name: "corporateId", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191 } },
      { name: "key", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 128 } }
    ] },
    { method: "get", path: "/api/membership/enterprise-workflows/management-requests/{id}/files/{fileId}", tag: "Membership", operationId: "readEnterpriseManagementEvidence", summary: "Authenticated request-bound evidence; financial proposals require financial authority", permissions: ["rental-os:corporate:manage"], authRequired: true, responseSchema: { type: "string", format: "binary" }, rawResponseContentType: "application/octet-stream" },
    backlogOperation("get", "/api/membership/enterprise-workflows/management-requests", "Membership", "merchantEnterpriseManagementRequests", "Review-only enterprise requests; financial proposals require current financial authority", ["rental-os:corporate:manage"], true, undefined, "EnterpriseManagementRequestList"),
    backlogOperation("post", "/api/membership/enterprise-workflows/management-requests/{id}/decision", "Membership", "merchantEnterpriseManagementDecision", "Record review without applying master, policy or financial changes", ["rental-os:corporate:manage"], true, "ReviewEnterpriseManagementRequest", "EnterpriseCommandResult"),
    { ...backlogOperation("get", "/api/membership/enterprise-workflows/management-requests/{id}/decision-operations/{key}", "Membership", "readMerchantEnterpriseManagementDecision", "Read this currently authorized operator's exact original request/key review; the stored request type requires current finance authority for credit requests, no material or business changes", ["rental-os:corporate:manage"], true, undefined, "EnterprisePortalOperationResponse"), parameters: [
      { name: "id", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191 } },
      { name: "key", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 128 } }
    ] },
    { ...backlogOperation("get", "/api/rental/v1/enterprise-handoff-requests", "Membership", "listMerchantRentalHandoffQueue", "Pending coordination requests for one currently authorized original-order page; total counts authorized original orders, not handoffs", ["rental-os:corporate:manage", "rental-os:order:view"], true, undefined, "EnterpriseRentalHandoffMerchantQueue"), parameters: [{ name: "page", in: "query" as const, required: false, schema: { type: "integer" as const, minimum: 1, maximum: 999999 } }] },
    backlogOperation("get", "/api/rental/v1/enterprise-handoff-requests/{id}", "Membership", "readMerchantRentalHandoffMaterial", "Read the dedicated request's original material under current corporate and order authority/workspace/data scope; not Core approval", ["rental-os:corporate:manage", "rental-os:order:view"], true, undefined, "EnterpriseRentalHandoffMerchantView"),
    backlogOperation("post", "/api/rental/v1/enterprise-handoff-requests/{id}/review", "Membership", "reviewMerchantRentalHandoff", "Record a frozen original coordination opinion only; no order, subject, funds or grant changes", ["rental-os:corporate:manage", "rental-os:order:view", "rental-os:order:operate"], true, "ReviewEnterpriseRentalHandoffRequest", "EnterpriseRentalHandoffReviewed"),
    backlogOperation("get", "/api/rental/v1/enterprise-handoff-requests/{id}/review-operations/{key}", "Membership", "readMerchantRentalHandoffReview", "Read this currently authorized operator's exact original request/key opinion receipt; never today's state", ["rental-os:corporate:manage", "rental-os:order:view"], true, undefined, "EnterprisePortalOperationResponse"),
    backlogOperation("get", "/api/membership/enterprise-workflows/applications", "Membership", "merchantEnterpriseApplications", "Merchant application queue", ["rental-os:corporate:manage"], true, undefined, "EnterpriseWorkflowList"),
    { ...backlogOperation("get", "/api/membership/enterprise-workflows/applications/{id}", "Membership", "readMerchantEnterpriseApplicationMaterial", "Read registered material of one tenant application under current corporate and employee management authority; not a decision receipt or new grant", ["rental-os:corporate:manage", "rental-os:corporate:employee-manage"], true, undefined, "EnterpriseWorkflowView"), parameters: [
      { name: "id", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191, pattern: "^[a-zA-Z0-9_-]+$" } }
    ] },
    { ...backlogOperation("get", "/api/membership/enterprise-workflows/applications/{id}/claim-material", "Membership", "readMerchantEnterpriseApplicationClaim", "Read current request-bound existing-corporate identity and administrator facts; city is not jurisdiction, no grant or decision receipt", ["rental-os:corporate:manage", "rental-os:corporate:employee-manage"], true, undefined, "EnterpriseApplicationClaimView"), parameters: [
      { name: "id", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191, pattern: "^[a-zA-Z0-9_-]+$" } }
    ] },
    backlogOperation("post", "/api/membership/enterprise-workflows/applications/{id}/decision", "Membership", "merchantEnterpriseApplicationDecision", "Verify representative and atomically bind first admin", ["rental-os:corporate:manage"], true, "ReviewEnterpriseApplicationRequest", "EnterpriseCommandResult"),
    { ...backlogOperation("get", "/api/membership/enterprise-workflows/applications/{id}/decision-operations/{key}", "Membership", "readMerchantEnterpriseApplicationDecision", "Read this currently authorized operator's exact original application/key decision; requires current corporate and employee management authority, no material or new grant", ["rental-os:corporate:manage", "rental-os:corporate:employee-manage"], true, undefined, "EnterprisePortalOperationResponse"), parameters: [
      { name: "id", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 191, pattern: "^[a-zA-Z0-9_-]+$" } },
      { name: "key", in: "path" as const, required: true, schema: { type: "string" as const, minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9_-]+$" } }
    ] },
    backlogOperation("get", "/api/membership/enterprise-workflows/invite-policy", "Membership", "readEnterpriseInvitePolicy", "Read explicit bounded invitation policy", ["rental-os:corporate:manage"], true, undefined, "EnterpriseInvitePolicyView"),
    backlogOperation("put", "/api/membership/enterprise-workflows/invite-policy", "Membership", "saveEnterpriseInvitePolicy", "Configure bounded invitation policy", ["rental-os:corporate:manage"], true, "SaveEnterpriseInvitePolicyRequest", "EnterpriseInvitePolicyView")];
}

export const RENTAL_HTTP_OPERATIONS: ContractOperation[] = [
  backlogOperation("get", "/api/files", "Files", "listFileAssets", "List files authorized by their original business objects; credential and knowledge metadata are excluded", ["system:integration:manage"]),
  backlogOperation("post", "/api/files", "Files", "createFileAsset", "Create file asset", ["system:integration:manage"]),
  backlogOperation("post", "/api/files/upload-sessions", "Files", "createFileUploadSession", "Create or recover the original staging upload; remaining TTL only, completed/freeze_pending never issue PUT", ["system:integration:manage"], true, "CreateFileUploadSessionRequest", "FileUploadSessionSummary"),
  backlogOperation("post", "/api/files/upload-sessions/{id}/complete", "Files", "completeFileUpload", "Hash actual staging bytes and freeze one original server-only content destination; unknown completion only observes that destination", ["system:integration:manage"], true, "CompleteFileUploadRequest", "GenericObject"),
  backlogOperation("post", "/api/files/customer-identity/{customerId}/upload-sessions", "Files", "createCustomerIdentityUploadSession", "Create a customer identity evidence upload session bound to the tenant customer", ["rental-os:member:manage", "rental-os:customer:reveal-sensitive"], true, "CreateCustomerIdentityUploadRequest", "FileUploadSessionSummary"),
  backlogOperation("post", "/api/files/customer-identity/{customerId}/upload-sessions/{id}/complete", "Files", "completeCustomerIdentityUpload", "Freeze actual identity evidence bytes for the same customer/uploader; original staging PUT cannot overwrite completed evidence", ["rental-os:member:manage", "rental-os:customer:reveal-sensitive"], true, "CompleteFileUploadRequest", "GenericObject"),
  backlogOperation("get", "/api/files/customer-identity/{customerId}/{fileAssetId}/download-url", "Files", "customerIdentityDownloadUrl", "Create a short-lived customer identity evidence URL; also requires sensitive-data reveal and member-view permissions", ["rental-os:member:view", "rental-os:customer:reveal-sensitive"], true, undefined, "FileDownloadUrlSummary"),
  backlogOperation("post", "/api/files/rental-orders/{orderId}/carrier-evidence/upload-sessions", "Files", "createCarrierEvidenceUploadSession", "Create an order/workspace-bound carrier shipment evidence upload session", ["rental-os:order:operate"], true, "CreateCarrierEvidenceUploadRequest", "FileUploadSessionSummary"),
  backlogOperation("post", "/api/files/rental-orders/{orderId}/carrier-evidence/upload-sessions/{id}/complete", "Files", "completeCarrierEvidenceUpload", "Freeze actual carrier evidence content for the same order; repeated completion observes the original content identity", ["rental-os:order:operate"], true, "CompleteFileUploadRequest", "GenericObject"),
  backlogOperation("get", "/api/files/rental-orders/{orderId}/carrier-evidence/{fileAssetId}/download-url", "Files", "carrierEvidenceDownloadUrl", "Create a short-lived download URL for evidence attached to the current carrier-shipping order", ["rental-os:order:view"], true, undefined, "FileDownloadUrlSummary"),
  backlogOperation("post", "/api/files/upload-sessions/cleanup-expired", "Files", "cleanupExpiredFileUploads", "Invalidate expired upload sessions and clean their provider objects", ["system:integration:manage"], true, undefined, "FileUploadCleanupSummary"),
  backlogOperation("get", "/api/files/{id}/download-url", "Files", "getFileDownloadUrl", "Create an audited short-lived URL only after the original business permission and current workspace/data/location scope pass", ["system:integration:manage"], true, undefined, "FileDownloadUrlSummary"),
  backlogOperation("get", "/api/platform/mini-program-channel", "Platform", "getMiniProgramChannel", "Get the tenant mini-program channel configuration (secret never returned)", ["system:integration:manage"], true, undefined, "MiniProgramChannelSummary"),
  backlogOperation("put", "/api/platform/mini-program-channel", "Platform", "saveMiniProgramChannel", "Save the tenant mini-program channel configuration", ["system:integration:manage"], true, "SaveMiniProgramChannelRequest", "MiniProgramChannelSummary"),
  backlogOperation("post", "/api/platform/mini-program-channel/test", "Platform", "testMiniProgramChannel", "Verify the mini-program AppID/AppSecret by fetching an access token only", ["system:integration:manage"], true, undefined, "MiniProgramChannelTestResult"),
  backlogOperation("get", "/api/platform/client-channel", "Platform", "getClientChannelProfile", "Get the tenant-level client channel profile (brand, service, agreements, help, published services) shared by mini-program and app", ["system:integration:manage"], true, undefined, "ClientChannelProfileSummary"),
  backlogOperation("put", "/api/platform/client-channel", "Platform", "saveClientChannelProfile", "Save the tenant-level client channel profile with optimistic revision check", ["system:integration:manage"], true, "SaveClientChannelProfileRequest", "ClientChannelProfileSummary"),
  backlogOperation("get", "/api/platform/website-channel", "Platform", "getWebsiteChannelProfile", "Get the tenant-level website channel profile (website-only settings: slogan, hero, secondary color, footer, CTA, SEO)", ["system:integration:manage"], true, undefined, "WebsiteChannelProfileSummary"),
  backlogOperation("put", "/api/platform/website-channel", "Platform", "saveWebsiteChannelProfile", "Save the tenant-level website channel profile with optimistic revision check", ["system:integration:manage"], true, "SaveWebsiteChannelProfileRequest", "WebsiteChannelProfileSummary"),
  backlogOperation("post", "/api/platform/website-channel/assets", "Platform", "uploadWebsiteAsset", "Upload a website brand image (logo/hero/category) and get its public URL", ["system:integration:manage"], true, "GenericObject", "GenericObject"),
  backlogOperation("get", "/api/platform/workspaces", "Platform", "listBusinessWorkspaces", "List business workspaces", ["system:org:manage"]),
  backlogOperation("post", "/api/platform/workspaces", "Platform", "createBusinessWorkspace", "Create business workspace", ["system:org:manage"]),
  backlogOperation("put", "/api/platform/workspaces/{id}", "Platform", "updateBusinessWorkspace", "Update business workspace", ["system:org:manage"]),
  backlogOperation("get", "/api/platform/workspaces/{id}/members", "Platform", "listWorkspaceMembers", "List workspace members", ["system:org:manage"]),
  backlogOperation("get", "/api/platform/workspaces/{id}/fulfillment-locations", "Platform", "listWorkspaceFulfillmentLocations", "List fulfillment locations assignable to a workspace staff member", ["system:org:manage"]),
  backlogOperation("put", "/api/platform/workspaces/{id}/members", "Platform", "saveWorkspaceMember", "Save workspace member", ["system:org:manage"]),
  backlogOperation("get", "/api/platform/tenants/{id}/workspaces", "Platform", "listTenantBusinessWorkspaces", "List target tenant business workspaces", ["system:tenant:manage"]),
  backlogOperation("post", "/api/platform/tenants/{id}/workspaces", "Platform", "createTenantBusinessWorkspace", "Create target tenant business workspace", ["system:tenant:manage"]),
  backlogOperation("put", "/api/platform/tenants/{id}/workspaces/{workspaceId}", "Platform", "updateTenantBusinessWorkspace", "Update target tenant business workspace", ["system:tenant:manage"]),
  {
    method: "get", path: "/api/platform/customers/{customerId}/avatar", tag: "Platform", operationId: "readCustomerAvatar",
    summary: "读取当前获权客户头像，按原指针复验后返回 PNG、JPEG 或 WebP 字节。",
    permissions: ["rental-os:member:view", "rental-os:member:manage"], authRequired: true,
    responseSchema: { type: "string", format: "binary" }, rawResponseContentType: ["image/png", "image/jpeg", "image/webp"],
    responseHeaders: {
      "X-Content-Type-Options": { schema: { type: "string", enum: ["nosniff"] } },
      "Cache-Control": { schema: { type: "string", enum: ["private, no-store"] } }
    },
    errorResponses: {
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "当前租户、经营空间、地点或客户数据范围访问被原 Guard 拒绝。", schema: "RentalHttpErrorResponse" },
      "404": { description: "客户、头像指针或文件不存在，或读取期间已合并、替换。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原文件读取或客户指针复验发生错误。", schema: "RentalHttpErrorResponse" },
      "503": { description: "生产模式尚未装配受控文件存储。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/platform/customers/{customerId}/avatar", tag: "Platform", operationId: "saveCustomerAvatar",
    summary: "上传当前获权客户的单个头像位图，在原事务内复验并保存头像指针。",
    permissions: ["rental-os:member:manage"], authRequired: true, successStatus: 201,
    requestSchema: "CustomerAvatarUploadRequest", requestContentType: "multipart/form-data",
    requestEncoding: { file: { contentType: "image/png, image/jpeg, image/webp" } }, responseSchema: "CustomerAvatarSaveResult",
    errorResponses: {
      "400": { description: "缺少 file、单文件约束、字节长度或位图格式校验失败。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "当前租户、经营空间、地点或客户数据范围访问被原 Guard 拒绝。", schema: "RentalHttpErrorResponse" },
      "404": { description: "客户不存在、已合并，或最终指针写入时已变化。", schema: "RentalHttpErrorResponse" },
      "413": { description: "原 FileInterceptor 拒绝超过 5 MiB 的文件。", schema: "RentalHttpErrorResponse" },
      "500": { description: "文件存储或提交发生错误。提交结果未知时保留原文件 key，沿原客户指针核对。", schema: "RentalHttpErrorResponse" },
      "503": { description: "生产模式尚未装配受控文件存储。", schema: "RentalHttpErrorResponse" }
    }
  },
  backlogOperation("get", "/api/platform/customers", "Platform", "listSharedCustomers", "List tenant shared customers", ["rental-os:member:view"]),
  backlogOperation("post", "/api/platform/customers", "Platform", "registerSharedCustomer", "Register a tenant member using the shared review policy", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/platform/customers/{customerId}", "Platform", "getCustomerDetail", "Get customer detail with masked sensitive fields", ["rental-os:member:view"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/profile", "Platform", "getCustomerProfileOverview", "Read shared customer facts and current workspace partitions; restricted sections are explicit, order amounts require financial permission", ["rental-os:member:view"], true, undefined, "CustomerProfileOverview"),
  backlogOperation("get", "/api/platform/customers/{customerId}/identity-verifications", "Platform", "customerIdentityVerifications", "List append-only customer identity verification records; requires member-view and sensitive-data reveal permissions", ["rental-os:customer:reveal-sensitive"], true, undefined, "CustomerIdentityVerificationList"),
  backlogOperation("post", "/api/platform/customers/{customerId}/identity-verifications", "Platform", "saveCustomerIdentityVerification", "Record an identity verification decision with tenant/customer-bound evidence and reviewer attribution; requires member-manage and sensitive-data reveal permissions", ["rental-os:member:manage"], true, "SaveCustomerIdentityVerificationRequest", "CustomerIdentityVerificationSummary"),
  backlogOperation("put", "/api/platform/customers/{customerId}/addresses", "Platform", "saveCustomerProfileAddress", "Create or update a customer delivery address; the response keeps the phone masked", ["rental-os:member:manage"]),
  backlogOperation("delete", "/api/platform/customers/{customerId}/addresses/{addressId}", "Platform", "removeCustomerProfileAddress", "Soft-delete a customer delivery address", ["rental-os:member:manage"]),
  backlogOperation("post", "/api/platform/customers/{customerId}/account", "Platform", "ensureCustomerAccount", "Open a login account for the customer (idempotent)", ["rental-os:member:manage"]),
  backlogOperation("put", "/api/platform/customers/{customerId}/account-status", "Platform", "changeCustomerAccountStatus", "Change customer account status; close requires customer:close, other states require member:manage", ["rental-os:member:manage", "rental-os:customer:close"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/status-history", "Platform", "listCustomerStatusHistory", "List customer status timeline (account and workspace scope)", ["rental-os:member:view"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/sensitive-access", "Platform", "listCustomerSensitiveAccess", "List sensitive data access audit for the customer", ["rental-os:customer:reveal-sensitive"]),
  backlogOperation("put", "/api/platform/customers/{customerId}/membership-status", "Platform", "changeCustomerMembershipStatus", "Change workspace membership status; close and risk restriction use separate permissions", ["rental-os:member:manage", "rental-os:member:risk-action", "rental-os:customer:close"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/risk-records", "Platform", "listCustomerRiskRecords", "List tenant-wide and current-workspace customer risk records", ["rental-os:member:view", "rental-os:member:risk-action"]),
  backlogOperation("post", "/api/platform/customers/{customerId}/risk-records", "Platform", "createCustomerRiskRecord", "Create an auditable workspace or tenant risk record under the customer gate lock", ["rental-os:member:risk-action"]),
  backlogOperation("post", "/api/platform/customers/{customerId}/risk-records/{riskRecordId}/decision", "Platform", "reviewCustomerRiskRecord", "Move an open risk into review or close it with a required outcome", ["rental-os:member:risk-action"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/transactability", "Platform", "getCustomerTransactability", "Check whether the customer may start new business in the current workspace", ["rental-os:member:view"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/invoice-profiles", "Platform", "listCustomerInvoiceProfiles", "List corporate invoice profiles", ["rental-os:corporate:view"]),
  backlogOperation("put", "/api/platform/customers/{customerId}/invoice-profiles", "Platform", "saveCustomerInvoiceProfile", "Create or update a corporate invoice profile", ["rental-os:corporate:manage"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/contracts", "Platform", "listCustomerContracts", "List corporate contracts", ["rental-os:corporate:view"]),
  backlogOperation("put", "/api/platform/customers/{customerId}/contracts", "Platform", "saveCustomerContract", "Create or update a corporate contract", ["rental-os:corporate:manage"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/credit", "Platform", "getCustomerCredit", "Get corporate credit limit and settlement terms", ["rental-os:corporate:view"]),
  backlogOperation("put", "/api/platform/customers/{customerId}/credit", "Platform", "saveCustomerCredit", "Set corporate credit limit and settlement terms", ["rental-os:corporate:manage"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/credit/account", "Platform", "getCustomerCreditAccount", "Read shared credit balances only with current corporate permission and complete financial read authority in every original ledger workspace; unauthorized portions are never shown as zero", ["rental-os:corporate:view"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/credit/ledger", "Platform", "listCustomerCreditLedger", "Read the append-only corporate ledger only with complete financial read authority in every original workspace; missing legacy binding refuses the complete view", ["rental-os:corporate:view"]),
  { ...backlogOperation("get", "/api/platform/customers/{customerId}/credit/payments/{paymentId}/reverse", "Platform", "customerCreditPaymentReversal", "Read the original repayment reversal receipt under complete original workspace financial authority; null is no confirmed receipt and never a permission to resend", ["rental-os:corporate:view", "rental-os:corporate:manage"]), responseSchema: { oneOf: [ref("CustomerCorporateCreditPaymentReversalReceipt"), { type: "null" }] } },
  backlogOperation("post", "/api/platform/customers/{customerId}/credit/payments/{paymentId}/reverse", "Platform", "reverseCustomerCreditPayment", "Reverse the exact original corporate repayment and all its allocations atomically with a durable source receipt; restores debt without dispatching an external refund; requires corporate manage and complete finance manage access to every original workspace", ["rental-os:corporate:manage"], true, "ReverseCustomerCorporateCreditPaymentRequest", "CustomerCorporateCreditPaymentReversalReceipt"),
  backlogOperation("post", "/api/platform/customers/{customerId}/credit/payments", "Platform", "recordCustomerCreditPayment", "Record an idempotent corporate payment with current corporate manage and full finance manage authority in every original workspace; never omit unauthorized debts or change FIFO to bypass scope", ["rental-os:corporate:manage"]),
  backlogOperation("post", "/api/platform/customers/{customerId}/credit/maturities", "Platform", "recordCustomerCreditMaturity", "Record the original debt maturity explicitly determined by finance under current corporate and full original-workspace financial management authority", ["rental-os:corporate:manage"], true, "RecordCustomerCorporateCreditMaturityRequest", "CustomerCorporateCreditMaturityReceipt"),
  { ...backlogOperation("get", "/api/platform/customers/{customerId}/credit/maturities/{ledgerId}", "Platform", "readCustomerCreditMaturity", "Read the immutable original maturity receipt with current corporate and full original-workspace financial read authority", ["rental-os:corporate:view"]), responseSchema: { oneOf: [ref("CustomerCorporateCreditMaturityReceipt"), { type: "null" }] } },
  backlogOperation("get", "/api/platform/customers/{customerId}/duplicates", "Platform", "findCustomerDuplicates", "List possible duplicate customers within the tenant", ["rental-os:customer:merge"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/merge-preview", "Platform", "previewCustomerMerge", "Preview a manual customer merge (read-only conflict report)", ["rental-os:customer:merge"]),
  backlogOperation("post", "/api/platform/customers/merge", "Platform", "mergeCustomers", "Submit a manual customer merge (keeps original business references)", ["rental-os:customer:merge"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/closability", "Platform", "getCustomerClosability", "Check whether the customer account may be closed", ["rental-os:customer:close"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/membership-closability", "Platform", "getCustomerMembershipClosability", "Check whether the current-workspace membership may be closed", ["rental-os:customer:close"]),
  backlogOperation("get", "/api/membership/qualification-options", "Membership", "listMembershipQualificationOptions", "Read current workspace qualification choices for tenant member submissions", ["rental-os:member:view", "rental-os:member:manage"]),
  backlogOperation("get", "/api/membership/personal-options", "Membership", "listPersonalMembershipOptions", "List active tenant members with minimal fields for employee selection", ["rental-os:member:view", "rental-os:corporate:employee-manage"]),
  backlogOperation("get", "/api/membership/benefit-scope-options", "Membership", "membershipBenefitScopeOptions", "List tenant workspace and category identifiers for membership benefits", ["rental-os:member:view", "rental-os:member:plan:manage"]),
  backlogOperation("get", "/api/rental/v1/booking-members", "RentalCore", "listBookingMembers", "List minimal tenant member summaries for authorized order creation", ["rental-os:order:create"]),
  backlogOperation("get", "/api/rental/v1/booking-members/{customerId}/booking-options", "RentalCore", "listBookingMemberOptions", "List tenant corporate identities available in the current workspace booking", ["rental-os:order:create"]),
  backlogOperation("get", "/api/rental/v1/booking-members/{customerId}/delivery-addresses", "RentalCore", "listBookingMemberDeliveryAddresses", "List a member's saved delivery addresses for authorized delivery-order creation", ["rental-os:order:create"]),
  backlogOperation("get", "/api/membership/registration-settings", "Membership", "getMembershipRegistrationSettings", "Get tenant registration review mode", ["rental-os:member:view"], true, undefined, "MembershipRegistrationSettings"),
  backlogOperation("put", "/api/membership/registration-settings", "Membership", "saveMembershipRegistrationSettings", "Set current workspace registration review mode", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/membership/personal", "Membership", "listPersonalMembershipMembers", "List personal members in current workspace", ["rental-os:member:view"]),
  backlogOperation("post", "/api/membership/personal", "Membership", "registerPersonalMembership", "Register a tenant personal member; onlyNew skips existing memberships", ["rental-os:member:manage"], true, "RegisterPersonalMembershipRequest", "RegisterPersonalMembershipResponse"),
  backlogOperation("put", "/api/membership/personal/{customerId}", "Membership", "savePersonalMembership", "Edit a personal member profile in current workspace", ["rental-os:member:manage"]),
  backlogOperation("put", "/api/membership/personal/{customerId}/temporary-password", "Membership", "setMembershipTemporaryPassword", "Set a one-time temporary password without exposing stored credentials", ["rental-os:member:account-manage"]),
  backlogOperation("post", "/api/membership/personal/{customerId}/qualifications", "Membership", "submitMembershipQualification", "Submit a personal member qualification for separate review", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/membership/personal/{customerId}/qualification-history", "Membership", "listMembershipQualificationHistory", "List immutable qualification submission and review snapshots", ["rental-os:member:view"]),
  backlogOperation("get", "/api/membership/personal/{customerId}/benefits", "Membership", "resolveMembershipBenefits", "Resolve current personal and explicitly selected corporate membership benefits", ["rental-os:member:view"]),
  backlogOperation("get", "/api/membership/personal/{customerId}/booking-options", "Membership", "listMembershipBookingOptions", "List active corporate employee relationships selectable for a personal member booking", ["rental-os:member:view"]),
  backlogOperation("get", "/api/membership/reviews", "Membership", "listMembershipReviews", "List registration and qualification review tasks", ["rental-os:member:view"]),
  backlogOperation("post", "/api/membership/reviews/{reviewId}/decision", "Membership", "decideMembershipReview", "Approve, reject, request supplement, or cancel a membership review", ["rental-os:member:review", "rental-os:member:qualification-review"]),
  backlogOperation("get", "/api/membership/qualification-types", "Membership", "listMembershipQualificationTypes", "List current workspace dynamic qualification types", ["rental-os:member:view"]),
  backlogOperation("put", "/api/membership/qualification-types", "Membership", "saveMembershipQualificationType", "Create or update a current workspace qualification type", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/membership/corporate", "Membership", "listCorporateMembershipMembers", "List enterprise members in current workspace", ["rental-os:corporate:view"]),
  backlogOperation("put", "/api/membership/corporate", "Membership", "saveCorporateMembership", "Create or edit an enterprise member profile in current workspace", ["rental-os:corporate:manage"]),
  backlogOperation("get", "/api/membership/corporate/{corporateCustomerId}/employees", "Membership", "listCorporateMembershipEmployees", "List enterprise administrators and employees", ["rental-os:corporate:view"]),
  backlogOperation("put", "/api/membership/corporate/{corporateCustomerId}/employees", "Membership", "saveCorporateMembershipEmployee", "Create or update an enterprise administrator or employee relation", ["rental-os:corporate:employee-manage"]),
  backlogOperation("get", "/api/membership/plans", "Membership", "listCustomerMembershipPlans", "List current workspace membership plans and versions", ["rental-os:member:view"]),
  backlogOperation("put", "/api/membership/plans", "Membership", "saveCustomerMembershipPlan", "Create or update a membership plan draft", ["rental-os:member:plan:manage"]),
  backlogOperation("post", "/api/membership/plans/{planId}/versions/{versionId}/publish", "Membership", "publishCustomerMembershipPlan", "Publish an immutable membership plan version", ["rental-os:member:plan:publish"]),
  backlogOperation("post", "/api/membership/plans/{planId}/versions/{versionId}/disable", "Membership", "disableCustomerMembershipPlanVersion", "Disable a published membership plan version with an audit reason", ["rental-os:member:plan:publish"]),
  backlogOperation("post", "/api/membership/plans/{planId}/versions/{versionId}/restore", "Membership", "restoreCustomerMembershipPlanVersion", "Create a draft from a historical membership plan version", ["rental-os:member:plan:publish"]),
  backlogOperation("post", "/api/membership/plans/assignments", "Membership", "assignCustomerMembershipPlan", "Grant a published personal or corporate membership plan", ["rental-os:member:plan:manage"]),
  backlogOperation("get", "/api/membership/plans/assignments/{customerId}", "Membership", "listCustomerMembershipPlanAssignments", "List membership plan grants for a customer in the current workspace", ["rental-os:member:view"]),
  backlogOperation("post", "/api/membership/plans/assignments/{assignmentId}/revoke", "Membership", "revokeCustomerMembershipPlanAssignment", "Revoke an active membership plan grant with an audit reason", ["rental-os:member:plan:manage"]),
  { method: "get", path: "/api/rental/v1/category-adoption/candidates", tag: "Rental Core", operationId: "listCategoryAdoptionCandidates", summary: "List same-category published target IDs and labels allowed for the session tenant/space; operation=upgrade|restore; no bodies, pilot lists or platform drafts", permissions: ["rental-os:category:adopt"], responseSchema: "GenericObject" },
  { method: "get", path: "/api/rental/v1/category-adoption/{targetId}/preparation", tag: "Rental Core", operationId: "previewCategoryAdoptionPreparation", summary: "Read current-session-space candidate fields, differences and staged inputs; metadataOnly omits entity rows and patches (not a statement that the space is empty). Conditional readiness uses current scoped model and fulfillment facts. No active facts changed", permissions: ["rental-os:category:adopt"], parameters: [{ name: "operation", in: "query", schema: { type: "string", enum: ["upgrade", "restore"] } }, { name: "metadataOnly", in: "query", schema: booleanSchema }], responseSchema: CATEGORY_PREPARATION_PREVIEW_SCHEMA },
  { method: "get", path: "/api/rental/v1/category-adoption/{targetId}/preparation/entities", tag: "Rental Core", operationId: "listCategoryAdoptionPreparationEntities", summary: "Read one bounded cursor page of authorized current entities and their staged fields; current policy/scope and entity revision remain separate from adoption readiness", permissions: ["rental-os:category:adopt"], parameters: [
    { name: "entityType", in: "query", required: true, schema: { type: "string", enum: ["item_group", "asset"] } },
    { name: "entityId", in: "query", schema: { type: "string", minLength: 1, maxLength: 191 } },
    { name: "operation", in: "query", schema: { type: "string", enum: ["upgrade", "restore"] } },
    { name: "after", in: "query", schema: { type: "string", minLength: 1, maxLength: 191 } },
    { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
    { name: "search", in: "query", schema: { type: "string", maxLength: 100 } }
  ], responseSchema: CATEGORY_PREPARATION_ENTITY_PAGE_SCHEMA },
  { method: "put", path: "/api/rental/v1/category-adoption/{targetId}/preparation", tag: "Rental Core", operationId: "saveCategoryAdoptionPreparation", summary: "Legacy full preparation save with source/entity revisions; refuses to overwrite a batched collection and never adopts or publishes prices/rules", permissions: ["rental-os:category:adopt"], requestSchema: CATEGORY_PREPARATION_REQUEST_SCHEMA, responseSchema: CATEGORY_PREPARATION_SAVE_RESULT_SCHEMA },
  { method: "patch", path: "/api/rental/v1/category-adoption/{targetId}/preparation", tag: "Rental Core", operationId: "saveCategoryAdoptionPreparationBatch", summary: "Accumulate or explicitly withdraw staged fields under the current session space; original batch receipt, collection revision and staged inputs commit together. Partial preparation is not adoption readiness; current permissions and target policy are rechecked on replay", permissions: ["rental-os:category:adopt"], requestSchema: CATEGORY_PREPARATION_BATCH_REQUEST_SCHEMA, responseSchema: CATEGORY_PREPARATION_SAVE_RESULT_SCHEMA },
  { method: "get", path: "/api/rental/v1/category-adoption/{targetId}/preparation/batches/{batchId}", tag: "Rental Core", operationId: "readCategoryAdoptionPreparationBatch", summary: "Read only the current actor's original preparation receipt in the current authorized space. Missing evidence is unknown, not proof that the original request rolled back", permissions: ["rental-os:category:adopt"], responseSchema: CATEGORY_PREPARATION_BATCH_READ_SCHEMA },
  { method: "post", path: "/api/rental/v1/category-adoption/{targetId}/adopt", tag: "Rental Core", operationId: "adoptRentalCategoryVersion", summary: "Explicit upgrade or restore: current whole-space access, source/preparation/policy revisions and bounded final checks; staged data, claims, binding, adoption audit and original-key receipt commit together. Non-production test entry stays disabled by default", permissions: ["rental-os:category:adopt"], requestSchema: CATEGORY_ADOPTION_REQUEST_SCHEMA, responseSchema: CATEGORY_ADOPTION_RESULT_SCHEMA },
  { method: "get", path: "/api/rental/v1/category-adoption/operations/{operationKey}", tag: "Rental Core", operationId: "readRentalCategoryAdoptionReceipt", summary: "Read the original actor's adopted receipt under current workspace authorization and its original audit; later policy or binding changes do not invalidate it. Missing evidence remains unknown, never permission to rerun", permissions: ["rental-os:category:adopt"], responseSchema: CATEGORY_ADOPTION_RECEIPT_SCHEMA },
  ...([
    ["get", "", "listPlatformRentalCategoryGovernance", "List category governance summaries", "view"],
    ["get", "/capability-catalog", "rentalCategoryCapabilityCatalog", "Read executable capability and pricing catalog", "view"],
    ["get", "/tenant-directory", "rentalCategoryTenantDirectory", "Read bounded tenant identifiers and labels for pilot selection; no business facts", "view"],
    ["get", "/{code}", "rentalCategoryDetail", "Read category identity and immutable versions", "view"],
    ["get", "/{code}/candidates/{tenantId}/{operation}", "rentalCategoryAdoptionCandidates", "Read versions allowed by the same opening and adoption scope predicates used at commit", "view"],
    ["post", "/{code}/drafts", "createRentalCategoryDraft", "Clone a published same-category version into a draft", "edit", objectOf({ sourceVersionId: stringSchema, versionLabel: stringSchema, reason: stringSchema }, ["sourceVersionId", "versionLabel", "reason"], false)],
    ["patch", "/{code}/versions/{id}/sections/{section}", "patchRentalCategoryDraftSection", "Save only the selected draft section with revision checking", "edit", objectOf({ expectedRevision: { type: "integer", minimum: 0 }, values: objectSchema, reason: stringSchema }, ["expectedRevision", "values", "reason"], false)],
    ["post", "/{code}/versions/{id}/validate", "validateRentalCategoryDraft", "Validate executable category dependencies without publication", "view"],
    ["get", "/{code}/versions/{id}/preview", "previewRentalCategoryDraft", "Preview section changes without changing tenant facts", "view"],
    ["post", "/{code}/versions/{id}/publish", "publishRentalCategoryDraft", "Publish the whole draft atomically; adoption is closed by default", "publish", objectOf({ expectedRevision: { type: "integer", minimum: 0 }, idempotencyKey: stringSchema, reason: stringSchema }, ["expectedRevision", "idempotencyKey", "reason"], false)],
    ["post", "/{code}/versions/{id}/archive", "archiveRentalCategoryDraft", "Archive an unpublished draft only", "edit", objectOf({ expectedRevision: { type: "integer", minimum: 0 }, reason: stringSchema }, ["expectedRevision", "reason"], false)],
    ["put", "/{code}/opening-policy", "saveRentalCategoryOpeningPolicy", "Set category opening scope independently of existing tenant spaces", "opening", objectOf({ expectedRevision: { type: "integer", minimum: 0 }, scope: { type: "string", enum: ["all", "pilot", "unopened", "stopped"] }, tenantIds: arrayOf(stringSchema), recommendedVersionId: stringSchema, reason: stringSchema }, ["expectedRevision", "scope", "tenantIds", "reason"], false)],
    ["put", "/{code}/versions/{id}/adoption-policy", "saveRentalCategoryAdoptionPolicy", "Set independent create, upgrade and restore qualification", "publish", objectOf({ expectedRevision: { type: "integer", minimum: 0 }, createScope: { type: "string", enum: ["all", "pilot", "none"] }, createTenantIds: arrayOf(stringSchema), upgradeScope: { type: "string", enum: ["all", "pilot", "none"] }, upgradeTenantIds: arrayOf(stringSchema), restoreScope: { type: "string", enum: ["all", "pilot", "none"] }, restoreTenantIds: arrayOf(stringSchema), reason: stringSchema }, ["expectedRevision", "createScope", "createTenantIds", "upgradeScope", "upgradeTenantIds", "restoreScope", "restoreTenantIds", "reason"], false)],
    ["get", "/{code}/audits", "rentalCategoryGovernanceAudits", "Read platform configuration audit records, not tenant business data", "audit"]
  ] as Array<[HttpMethod, string, string, string, string, SchemaObject?]>).map(([method, suffix, operationId, summary, permission, requestSchema]): ContractOperation => ({
    method, path: `/api/platform/rental-categories${suffix}`, tag: "Platform Rental Core",
    operationId, summary, permissions: [`system:rental-category:${permission}`], requestSchema,
    responseSchema: suffix === '/{code}/audits' ? 'AiCategoryGovernanceAuditPage' : "GenericObject"
  })),
  { method: "post", path: "/api/platform/rental-categories", tag: "Platform Rental Core", operationId: "createRentalCategory",
    summary: "Create an independent unopened identity and draft from a verified template or immutable source; original request and audit commit together. Dynamic creation is closed by default.",
    permissions: ["system:rental-category:edit"], requestSchema: CATEGORY_CREATION_REQUEST_SCHEMA, responseSchema: CATEGORY_CREATED_VERSION_SCHEMA },
  { method: "post", path: "/api/platform/rental-categories/creation-preview", tag: "Platform Rental Core", operationId: "previewRentalCategoryCreation",
    summary: "Preview controlled selections and the resulting definition fingerprint without writing merchant facts or opening the category",
    permissions: ["system:rental-category:edit"], requestSchema: CATEGORY_CREATION_PREVIEW_REQUEST_SCHEMA, responseSchema: CATEGORY_CREATION_PREVIEW_SCHEMA },
  { method: "get", path: "/api/platform/rental-categories/creation-requests/{key}", tag: "Platform Rental Core", operationId: "readRentalCategoryCreationReceipt",
    summary: "Read this platform actor's original creation receipt; unknown does not prove non-commit",
    permissions: ["system:rental-category:edit"], responseSchema: CATEGORY_CREATION_RECEIPT_SCHEMA },
  {
    method: "post",
    path: "/api/auth/development/reset-demo-password",
    tag: "Auth",
    operationId: "resetLocalDemoPassword",
    summary: "Reset demo passwords in an explicit personal demo or authorized development maintenance",
    permissions: ["system:params:manage"],
    requestSchema: "ResetLocalDemoPasswordRequest",
    responseSchema: "ResetLocalDemoPasswordResult"
  },
  {
    // SPACE-02：切换当前经营空间。只接受 workspaceId，其余会话范围从令牌与会话推导。
    method: "post",
    path: "/api/auth/switch-workspace",
    tag: "Auth",
    operationId: "switchWorkspace",
    summary: "Switch current business workspace",
    permissions: [],
    authRequired: true,
    requestSchema: "SwitchWorkspaceRequest",
    responseSchema: "LoginResponse"
  },
  backlogOperation("post", "/api/staff/v1/auth/login", "Auth", "staffLogin", "Login and issue a staff-audience access token", [], false, "LoginRequest", "LoginResponse"),
  backlogOperation("post", "/api/staff/v1/auth/refresh", "Auth", "refreshStaffSession", "Rotate a staff-audience refresh token", [], false, "RefreshSessionRequest", "LoginResponse"),
  backlogOperation("post", "/api/staff/v1/auth/logout", "Auth", "logoutStaffSession", "Revoke a staff-audience refresh session", [], false, "RefreshSessionRequest", "GenericObject"),
  backlogOperation("get", "/api/staff/v1/auth/me", "Auth", "getCurrentStaffUser", "Get the authenticated staff account", [], true, undefined, "AuthUser"),
  backlogOperation("get", "/api/staff/v1/auth/session-context", "Auth", "getStaffSessionContext", "Refresh staff identity, workspace, location scope and permissions", [], true, undefined, "SessionContextResponse"),
  backlogOperation("post", "/api/staff/v1/auth/change-password", "Auth", "changeStaffPassword", "Change a staff password and revoke other sessions", [], true, "ChangePasswordRequest", "LoginResponse"),
  backlogOperation("post", "/api/staff/v1/auth/switch-workspace", "Auth", "switchStaffWorkspace", "Switch the current staff workspace", [], true, "SwitchWorkspaceRequest", "LoginResponse"),
  backlogOperation("post", "/api/staff/v1/uploads/sessions", "Files", "createStaffUploadSession", "Create a staff-scoped upload session bound to an order or work order", ["rental-os:order:pickup", "rental-os:order:return", "rental-os:order:offline-payment", "rental-core:maintenance:manage"], true, "CreateFileUploadSessionRequest", "FileUploadSessionSummary"),
  backlogOperation('post', `/api/${STAFF_UPLOAD_OBSERVATION_HTTP.basePath}/${STAFF_UPLOAD_OBSERVATION_HTTP.observe}`, 'Files', 'observeStaffUploadSession',
    'Observe one original employee upload by key or id; metadata only, no upload grant or storage request',
    ['rental-os:order:pickup', 'rental-os:order:return', 'rental-os:order:offline-payment', 'rental-core:maintenance:manage'], true,
    'StaffUploadObservationRequest', 'StaffUploadObservationResponse'),
  backlogOperation("post", "/api/staff/v1/uploads/sessions/{id}/complete", "Files", "completeStaffUpload", "Complete a staff upload after verifying its actor, scope and business owner", ["rental-os:order:pickup", "rental-os:order:return", "rental-os:order:offline-payment", "rental-core:maintenance:manage"], true, "CompleteFileUploadRequest", "GenericObject"),
  {
    method: "post", path: "/api/staff/v1/uploads/{fileAssetId}/inspection-binding", tag: "Files", operationId: "bindStaffInspectionEvidence",
    summary: "原检查权威绑定当前员工上传证据，沿订单、分配、模板与阶段复验原附件修订。",
    permissions: ["rental-os:order:pickup", "rental-os:order:return"], authRequired: true, successStatus: 201,
    requestSchema: "StaffInspectionBindingRequest", responseSchema: "StaffInspectionBindingResult",
    parameters: [{ name: "fileAssetId", in: "path", required: true,
      schema: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" } }],
    errorResponses: {
      "400": { description: "原员工附件场景与业务对象匹配校验失败。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原 Staff 会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原 Staff 白名单、当前空间/地点/阶段权限或附件员工归属核验拒绝访问。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原检查权威的绑定、修订或存储异常沿现有 HTTP 异常路径返回。提交结果未知时按原附件、修订及绑定指纹核对。", schema: "RentalHttpErrorResponse" },
      "503": { description: "检查草稿证据绑定未启用。缺少原 AI 宿主检查权威时，在处理前返回 unavailable。", schema: "RentalHttpErrorResponse" }
    }
  },
  backlogOperation("get", "/api/staff/v1/uploads/{fileAssetId}/download-url", "Files", "getStaffFileDownloadUrl", "Create a staff-scoped short-lived file URL", ["rental-os:order:pickup", "rental-os:order:return", "rental-os:order:offline-payment", "rental-core:maintenance:manage"], true, undefined, "FileDownloadUrlSummary"),
  {
    method: "get", path: "/api/staff/v1/offline-payments", tag: "RentalCore", operationId: "listStaffOfflinePaymentRegistrations",
    summary: "读取当前员工获权订单的线下登记数组，按登记时间倒序返回最多 50 条。", permissions: ["rental-os:order:view"], authRequired: true,
    responseSchema: arrayOf("StaffOfflinePaymentRegistration"),
    parameters: [{ name: "orderId", in: "query", required: true, schema: { type: "string", minLength: 1 }, description: "订单编号必填，经营空间和员工地点沿原服务端上下文核验。" }],
    errorResponses: {
      "401": { description: "原员工会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单查看权限、已验证经营空间、订单编号或员工地点范围缺失。", schema: "RentalHttpErrorResponse" },
      "404": { description: "订单不存在或不在当前员工授权地点范围内。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原订单或登记读取失败。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/staff/v1/offline-payments", tag: "RentalCore", operationId: "registerStaffOfflinePayment",
    summary: "登记原线下收款并等待确认，复用原幂等键和当前订单可收额度。", permissions: ["rental-os:order:offline-payment"], authRequired: true,
    requestSchema: "CreateStaffOfflinePaymentRequest", responseSchema: "StaffOfflinePaymentRegistration", successStatus: 201,
    errorResponses: {
      "400": { description: "原 DTO、非空字段、两位小数金额、线下方式或本订单凭证校验失败。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原员工会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原员工登记权限、已验证经营空间或地点范围缺失。", schema: "RentalHttpErrorResponse" },
      "404": { description: "订单不存在或不在当前员工授权地点范围内。", schema: "RentalHttpErrorResponse" },
      "409": { description: "订单已完成或取消、同键内容冲突、可收额度不足或当前方式未启用。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原登记读取、凭证或事务异常，结果不明时保留原幂等键核对原登记。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/staff/v1/offline-payments/{id}/confirm", tag: "RentalCore", operationId: "confirmStaffOfflinePayment",
    summary: "按原登记 ID 确认收款并在同一事务内写入资金事件，重复确认读取原收据。", permissions: ["rental-os:order:settle"], authRequired: true,
    responseSchema: "StaffOfflinePaymentConfirmation", successStatus: 201,
    errorResponses: {
      "401": { description: "原员工会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原员工确认权限、已验证经营空间或地点范围缺失。", schema: "RentalHttpErrorResponse" },
      "404": { description: "原登记或获权订单不存在。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原收据不一致、登记已处理、待收额度变化或订单拒绝新增收款。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原确认事务或资金读取异常，结果不明时沿原登记 ID 和资金收据核对。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post",
    path: "/api/platform/users/access",
    tag: "Platform",
    operationId: "createUserWithWorkspaceAccess",
    summary: "Create system user with workspace access atomically",
    permissions: ["system:user:manage"],
    requestSchema: "SaveSystemUserAccessRequest",
    responseSchema: "SystemUserRow"
  },
  {
    method: "put",
    path: "/api/platform/users/{id}/access",
    tag: "Platform",
    operationId: "updateUserWithWorkspaceAccess",
    summary: "Update system user and workspace access atomically",
    permissions: ["system:user:manage"],
    requestSchema: "SaveSystemUserAccessRequest",
    responseSchema: "SystemUserRow",
    parameters: [{ name: "id", in: "path", required: true, schema: stringSchema }]
  },
  {
    method: "get", path: "/api/rental/v1/categories", tag: "RentalCore", operationId: "listRentalCategories",
    summary: "List supported rental categories", permissions: ["system:tenant:manage", "rental-os:order:view", "rental-core:catalog:view", "rental-core:asset:view"], responseSchema: "GenericObject"
  },
  {
    // REPORT-01A：当前经营空间的经营报表。空间取自会话，客户端不得传入。
    method: "get", path: "/api/rental/v1/reports/operations", tag: "RentalCore", operationId: "getRentalWorkspaceOperationReport",
    summary: "Get current workspace operation report", permissions: ["rental-os:report:view"], responseSchema: "GenericObject"
  },
  {
    // REPORT-01B：同一份报表的 CSV 导出。与页面共用仓储方法、筛选、权限与空间范围。
    method: "get", path: "/api/rental/v1/reports/operations/export", tag: "RentalCore", operationId: "exportRentalWorkspaceOperationReport",
    summary: "Export current workspace operation report as CSV", permissions: ["rental-os:report:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/tenant-profile", tag: "RentalCore", operationId: "getRentalTenantProfile",
    summary: "Get tenant rental profile", permissions: ["rental-os:order:view", "rental-core:catalog:view", "rental-core:asset:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/tenant-readiness", tag: "RentalBusiness", operationId: "getTenantReadiness",
    summary: "Tenant onboarding readiness status for the current workspace", permissions: ["rental-os:order:view", "rental-os:price:manage", "system:user:manage", "system:role:manage"], responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/tenant-profile", tag: "RentalCore", operationId: "saveRentalTenantProfile",
    summary: "Save tenant rental profile", permissions: ["rental-os:rules:manage", "rental-os:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/business-settings", tag: "RentalCore", operationId: "getRentalBusinessSettings",
    summary: "Get category-constrained tenant rental settings", permissions: ["rental-os:price:manage"], responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/business-settings", tag: "RentalCore", operationId: "saveRentalBusinessSettings",
    summary: "Save category-constrained tenant rental settings", permissions: ["rental-os:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/coupon-templates", tag: "RentalCore", operationId: "listRentalCouponTemplates",
    summary: "List tenant coupon templates", permissions: ["rental-os:marketing:manage", "rental-os:price:manage"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/coupon-templates", tag: "RentalCore", operationId: "createRentalCouponTemplate",
    summary: "Create tenant coupon template", permissions: ["rental-os:marketing:manage", "rental-os:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/coupon-templates/{id}", tag: "RentalCore", operationId: "updateRentalCouponTemplate",
    summary: "Update tenant coupon template", permissions: ["rental-os:marketing:manage", "rental-os:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/locations", tag: "RentalCore", operationId: "listRentalLocations",
    summary: "读取原提交的履约地点配置，沿当前员工地点范围过滤。", permissions: ["rental-os:station:view"],
    responseSchema: arrayOf("RentalFulfillmentLocation")
  },
  {
    method: "post", path: "/api/rental/v1/locations", tag: "RentalCore", operationId: "createRentalLocation",
    summary: "沿原保存入口新建或按请求 id 更新履约地点，经营主体兼容写入共用原事务。", permissions: ["rental-os:station:manage"],
    successStatus: 201, requestSchema: "SaveRentalFulfillmentLocationRequest", responseSchema: "RentalFulfillmentLocation"
  },
  {
    method: "put", path: "/api/rental/v1/locations/{id}", tag: "RentalCore", operationId: "updateRentalLocation",
    summary: "以路径 id 更新原履约地点，在原事务内复验品类、经营主体、组织及存量状态。", permissions: ["rental-os:station:manage"],
    requestSchema: "SaveRentalFulfillmentLocationRequest", responseSchema: "RentalFulfillmentLocation"
  },
  {
    method: "get", path: "/api/rental/v1/item-groups", tag: "RentalCore", operationId: "listRentalItemGroups",
    summary: "读取当前空间原已提交的产品型号、公开图片和套装组成。", permissions: ["rental-core:catalog:view"],
    responseSchema: arrayOf("RentalItemGroup")
  },
  {
    method: "post", path: "/api/rental/v1/item-groups", tag: "RentalCore", operationId: "createRentalItemGroup",
    summary: "沿原保存入口建档或按请求 id 更新产品型号，复验品类字段、组成规则和商品建档 Hook。", permissions: ["rental-core:catalog:manage"],
    successStatus: 201, requestSchema: "SaveRentalItemGroupRequest", responseSchema: "RentalItemGroup",
    errorResponses: {
      "400": { description: "原 DTO、品类字段、库存模式或套装组成校验失败。", schema: "RentalHttpErrorResponse" },
      "404": { description: "请求 id 或组成型号在当前空间不存在。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原型号编码、唯一属性或品类绑定存在冲突。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "put", path: "/api/rental/v1/item-groups/{id}", tag: "RentalCore", operationId: "updateRentalItemGroup",
    summary: "按路径 id 保存原产品型号，沿原配置提交返回公开型号投影。", permissions: ["rental-core:catalog:manage"],
    requestSchema: "SaveRentalItemGroupRequest", responseSchema: "RentalItemGroup",
    errorResponses: {
      "400": { description: "原 DTO、品类字段、库存模式或套装组成校验失败。", schema: "RentalHttpErrorResponse" },
      "404": { description: "原型号或组成型号在当前空间不存在。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原型号编码、唯一属性或品类绑定存在冲突。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/rental/v1/item-groups/{id}/images", tag: "RentalCore", operationId: "uploadRentalItemGroupImage",
    summary: "上传单个型号图片，沿原空间锁重读图片集合并提交原图片指针。", permissions: ["rental-core:catalog:manage"],
    authRequired: true, successStatus: 201,
    requestSchema: "RentalItemGroupImageUploadRequest", requestContentType: "multipart/form-data",
    requestEncoding: { file: { contentType: "image/jpeg, image/png, image/webp" } }, responseSchema: "RentalItemGroup",
    errorResponses: {
      "400": { description: "缺少 file、文件为空、格式或签名不匹配，或图片集合已达六张。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原 Guard 或图片存储权威拒绝当前租户、空间或对象访问。", schema: "RentalHttpErrorResponse" },
      "404": { description: "当前空间型号或原文件对象不存在。", schema: "RentalHttpErrorResponse" },
      "413": { description: "原 FileInterceptor 拒绝超过 5 MiB 的文件。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原文件写入或指针提交失败。提交结果未知时保留原文件和图片 id，沿原图片集合核对。", schema: "RentalHttpErrorResponse" },
      "503": { description: "缺原子图片写入器，或生产模式尚未配置原文件存储。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "get", path: "/api/rental/v1/item-groups/{id}/images/{imageId}", tag: "RentalCore", operationId: "getRentalItemGroupImage",
    summary: "按当前营运会话读取型号图片，本地原图返回字节，已配置文件存储沿原读取权威返回 302。", permissions: ["rental-core:catalog:view"],
    authRequired: true, responseSchema: { type: "string", format: "binary" }, rawResponseContentType: ["image/jpeg", "image/png", "image/webp"],
    responseHeaders: {
      "Content-Disposition": { description: "原文件名的 UTF-8 inline 展示头。", schema: stringSchema },
      "Cache-Control": { schema: { type: "string", enum: ["private, max-age=300"] } }
    },
    redirectResponse: {
      description: "原受控文件读取成功后跳转到当前获权下载地址。",
      headers: { Location: { description: "原文件读取权威供给的跳转地址。", schema: { type: "string", format: "uri" } } }
    },
    errorResponses: {
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原 Guard 或图片存储权威拒绝当前租户、空间或对象访问。", schema: "RentalHttpErrorResponse" },
      "404": { description: "当前空间型号、图片指针或原图文件不存在。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原文件读取失败。", schema: "RentalHttpErrorResponse" },
      "503": { description: "生产模式的原图片尚未迁入受控文件存储。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "delete", path: "/api/rental/v1/item-groups/{id}/images/{imageId}", tag: "RentalCore", operationId: "deleteRentalItemGroupImage",
    summary: "沿原配置事务移除图片指针并重设封面，返回已提交型号，文件清理由原生命周期处理。", permissions: ["rental-core:catalog:manage"],
    successStatus: 200, responseSchema: "RentalItemGroup",
    errorResponses: {
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原 Guard 或图片存储权威拒绝当前租户、空间或对象访问。", schema: "RentalHttpErrorResponse" },
      "404": { description: "当前空间型号或原图片指针不存在。", schema: "RentalHttpErrorResponse" },
      "503": { description: "缺原子图片写入器，或生产模式的原图片尚未迁入受控文件存储。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "get", path: "/api/rental/v1/pricing-groups", tag: "RentalCore", operationId: "listRentalPricingGroups",
    summary: "读取当前空间原已提交的定价分组和产品型号成员。", permissions: ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"],
    responseSchema: arrayOf("RentalPricingGroup")
  },
  {
    method: "post", path: "/api/rental/v1/pricing-groups", tag: "RentalCore", operationId: "createRentalPricingGroup",
    summary: "沿原保存入口提交定价分组与基本价计划，共用原事务和品类绑定复验。", permissions: ["rental-os:price:manage"],
    successStatus: 201, requestSchema: "CreateRentalPricingGroupRequest", responseSchema: "RentalPricingGroup",
    errorResponses: {
      "400": { description: "输入、基本价或型号成员未满足原 DTO、品类和价格校验。", schema: "RentalHttpErrorResponse" },
      "404": { description: "请求 id 对应的定价分组或成员型号不存在。", schema: "RentalHttpErrorResponse" },
      "409": { description: "分组编码或原价格提交条件冲突。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "put", path: "/api/rental/v1/pricing-groups/{id}", tag: "RentalCore", operationId: "updateRentalPricingGroup",
    summary: "以路径 id 保存定价分组及成员配置，沿原提交入口返回已保存分组。", permissions: ["rental-os:price:manage"],
    requestSchema: "SaveRentalPricingGroupRequest", responseSchema: "RentalPricingGroup",
    errorResponses: {
      "400": { description: "输入、成员状态、库存方式或默认计价单位未通过原校验。", schema: "RentalHttpErrorResponse" },
      "404": { description: "路径 id 对应的定价分组或成员型号不存在。", schema: "RentalHttpErrorResponse" },
      "409": { description: "分组编码或当前品类绑定发生冲突。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "patch", path: "/api/rental/v1/pricing-groups/{id}/security-rates", tag: "RentalCore", operationId: "updateRentalPricingGroupSecurityRates",
    summary: "按原完整单位集合维护该组押金与预授权费率，并追加空间价格版本。", permissions: ["rental-os:price:manage"],
    requestSchema: "UpdateRentalPricingGroupSecurityRatesRequest", responseSchema: "RentalPricingGroupSecurityRatesResult",
    errorResponses: {
      "400": { description: "单位集合或资金费率未通过校验，或原数据源不支持该空间价格版本操作。", schema: "RentalHttpErrorResponse" },
      "404": { description: "当前空间不存在该定价分组。", schema: "RentalHttpErrorResponse" },
      "409": { description: "待生效调价、缺失当前价格版本、相同费率、品类绑定或并发版本写入发生冲突。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "get", path: "/api/rental/v1/assets", tag: "RentalCore", operationId: "listRentalAssets",
    summary: "List serialized rental assets", permissions: ["rental-core:asset:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/assets/{id}/status-history", tag: "RentalCore", operationId: "listRentalAssetStatusHistory",
    summary: "List serialized asset status history", permissions: ["rental-core:asset:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/assets", tag: "RentalCore", operationId: "createRentalAsset",
    summary: "Create serialized rental asset", permissions: ["rental-core:asset:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/assets/{id}", tag: "RentalCore", operationId: "updateRentalAsset",
    summary: "Update serialized rental asset", permissions: ["rental-core:asset:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/stock-balances", tag: "RentalCore", operationId: "listRentalStockBalances",
    summary: "List quantity stock balances", permissions: ["rental-core:asset:view"], responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/stock-balances", tag: "RentalCore", operationId: "saveRentalStockBalance",
    summary: "Save quantity stock balance", permissions: ["rental-core:asset:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/stock-ledger", tag: "RentalCore", operationId: "listRentalStockLedger",
    summary: "List quantity stock operation ledger", permissions: ["rental-core:asset:view"], responseSchema: "GenericObject",
    parameters: [queryParam("itemGroupId"), queryParam("locationId"), queryParam("batchNo"), queryParam("sourceDocumentNo"), queryParam("limit")]
  },
  {
    method: "post", path: "/api/rental/v1/stock-operations", tag: "RentalCore", operationId: "applyRentalStockOperation",
    summary: "Apply an auditable quantity stock operation", permissions: ["rental-core:asset:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/stock-dispositions", tag: "RentalCore", operationId: "listRentalStockDispositions",
    summary: "List return stock dispositions", permissions: ["rental-core:maintenance:view", "rental-core:asset:view", "rental-core:asset:manage"], responseSchema: "GenericObject",
    parameters: [queryParam("orderId")]
  },
  {
    method: "post", path: "/api/rental/v1/stock-dispositions/{dispositionId}/restore", tag: "RentalCore", operationId: "restoreRentalStockDisposition",
    summary: "Restore a return stock disposition", permissions: ["rental-core:maintenance:review", "rental-core:asset:manage"] , responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/stock-dispositions/{dispositionId}/write-off", tag: "RentalCore", operationId: "writeOffRentalStockDisposition",
    summary: "Write off quarantined quantity stock with a reason and auditable ledger entry", permissions: ["rental-core:maintenance:review", "rental-core:asset:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/work-orders", tag: "RentalCore", operationId: "listRentalWorkOrders",
    summary: "List maintenance work orders", permissions: ["rental-core:maintenance:view"], responseSchema: "GenericObject",
    parameters: [queryParam("status")]
  },
  {
    method: "get", path: "/api/rental/v1/work-order-assignees", tag: "RentalCore", operationId: "listRentalWorkOrderAssignees",
    summary: "List current workspace work order assignees", permissions: ["rental-core:maintenance:view"], responseSchema: "GenericObject",
    parameters: [queryParam("locationId")]
  },
  {
    method: "post", path: "/api/rental/v1/work-orders", tag: "RentalCore", operationId: "createRentalWorkOrder",
    summary: "Create maintenance work order", permissions: ["rental-core:maintenance:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/work-orders/{id}/assign", tag: "RentalCore", operationId: "assignRentalWorkOrder",
    summary: "Assign maintenance work order", permissions: ["rental-core:maintenance:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/work-orders/{id}/start", tag: "RentalCore", operationId: "startRentalWorkOrder",
    summary: "Start maintenance work order", permissions: ["rental-core:maintenance:manage"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/work-orders/{id}/submit", tag: "RentalCore", operationId: "submitRentalWorkOrder",
    summary: "Submit maintenance work order for review", permissions: ["rental-core:maintenance:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/work-orders/{id}/review", tag: "RentalCore", operationId: "reviewRentalWorkOrder",
    summary: "Review maintenance work order", permissions: ["rental-core:maintenance:review"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/work-orders/{id}/cancel", tag: "RentalCore", operationId: "cancelRentalWorkOrder",
    summary: "Cancel maintenance work order", permissions: ["rental-core:maintenance:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/work-orders/{id}/history", tag: "RentalCore", operationId: "listRentalWorkOrderHistory",
    summary: "List maintenance work order history", permissions: ["rental-core:maintenance:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/availability", tag: "RentalCore", operationId: "checkRentalAvailability",
    summary: "Check generic rental availability", permissions: ["rental-os:order:operate", "rental-os:order:create"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    // ORDER-LIST-01：筛选与分页在服务端执行。不带 page/pageSize 返回纯数组（兼容旧调用方），
    // 带任一分页参数返回 { items, page, pageSize, total } 信封。空间取自会话。
    method: "get", path: "/api/rental/v1/orders", tag: "RentalCore", operationId: "listRentalCoreOrders",
    summary: "List Rental Core orders (server-side filters and sorting before pagination; paged envelope when page/pageSize given)", permissions: ["rental-os:order:view"], responseSchema: "RentalOrderListResponse",
    parameters: [
      queryParam("page", { type: "integer", minimum: 1, maximum: 1000000 }),
      queryParam("pageSize", { type: "integer", minimum: 1, maximum: 200 }),
      queryParam("status", { type: "string", enum: ["draft", "reserved", "pickup_overdue", "ready_for_pickup", "renting", "return_inspection", "settling", "completed", "cancelled", "no_show"] }),
      queryParam("keyword", { type: "string", maxLength: 100 }),
      queryParam("from", { type: "string", description: "原 DTO 接收 ISO8601 日期或时间，筛选当前归还时点晚于 from 的订单。" }),
      queryParam("to", { type: "string", description: "原 DTO 接收 ISO8601 日期或时间，筛选起租时点早于 to 的订单。" }),
      queryParam("assignment", { type: "string", enum: ["pending", "partial", "unlocked", "locked", "issue"] }),
      queryParam("pendingFeeOnly", { oneOf: [{ type: "boolean" }, { type: "string" }], description: "原 DTO 将 true、字符串 true 或 1 转为 true，其余请求值转为 false。" }),
      queryParam("sort", { type: "string", maxLength: 256, description: "Ordered unique field.asc/field.desc priorities, comma-separated, max 8. Fields: createdAt, orderNo, customerName, startAt, endAt, payableAmount, quoteNo, status. Applied before pagination with an id tie-breaker." })
    ]
  },
  {
    method: "get", path: "/api/rental/v1/workbench/todos", tag: "RentalCore", operationId: "listRentalWorkbenchTodos",
    summary: "List actionable workbench todos for the current workspace", permissions: ["rental-os:report:view", "rental-os:order:view", "rental-core:maintenance:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders", tag: "RentalCore", operationId: "createRentalCoreOrder",
    summary: "Create multi-line Rental Core order", permissions: ["rental-os:order:operate", "rental-os:order:create"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/expire-pending", tag: "RentalCore", operationId: "expirePendingRentalCoreOrders",
    summary: "Expire pending-payment soft reservations in the current workspace", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/reconcile-pickup-overdue", tag: "RentalCore", operationId: "reconcilePickupOverdueRentalCoreOrders",
    summary: "Advance overdue pickup orders and finalize eligible no-shows", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}", tag: "RentalCore", operationId: "getRentalCoreOrder",
    summary: "Get Rental Core order", permissions: ["rental-os:order:view"], responseSchema: "RentalOrder"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/carrier-shipment/events", tag: "RentalCore", operationId: "listRentalCarrierShipmentEvents",
    summary: "List carrier shipment milestones and their evidence for one carrier-shipping order", permissions: ["rental-os:order:view"], responseSchema: "RentalCarrierShipmentEventList"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/carrier-shipment/events", tag: "RentalCore", operationId: "createRentalCarrierShipmentEvent",
    summary: "Record outbound dispatch or customer carrier handoff with evidence; rental and inventory effects are derived from verified milestones", permissions: ["rental-os:order:operate"], requestSchema: "CreateRentalCarrierShipmentEventRequest", responseSchema: "RentalCarrierShipmentEventSummary",
    parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 1, maxLength: 191 } }]
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/delivery-address/reveal", tag: "RentalCore", operationId: "revealRentalOrderDeliveryAddress",
    summary: "Reveal an order delivery contact to authorized staff; access is recorded", permissions: ["rental-os:customer:reveal-sensitive"], responseSchema: "GenericObject"
  },
  {
    // DOC-PRINT-01：管理端与 APP 共用的客户可读凭证快照；不代表正式 PDF/法定票据。
    method: "get", path: "/api/rental/v1/orders/{id}/documents/{type}", tag: "RentalCore", operationId: "renderRentalOrderDocument",
    summary: "按原订单事实生成并归档客户凭证，相同内容复用不可变版本。", permissions: ["rental-os:order:view"], responseSchema: "RentalDocumentRenderResult",
    parameters: [{ name: "type", in: "path", required: true, schema: ref("RentalDocumentType") }],
    errorResponses: {
      "400": { description: "原文档类型校验失败。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单查看权限或当前 Rental 访问条件拒绝读取、归档。", schema: "RentalHttpErrorResponse" },
      "404": { description: "当前订单范围内找不到订单。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原订单、检查、资金读取或归档失败，按同一订单和文档类型的原历史目录核对版本。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/documents/{type}/versions", tag: "RentalCore", operationId: "listRentalOrderDocumentVersions",
    summary: "读取当前订单凭证的历史目录，按快照时间和版本 ID 倒序返回。", permissions: ["rental-os:order:view"], responseSchema: arrayOf("RentalDocumentSnapshotSummary"),
    parameters: [{ name: "type", in: "path", required: true, schema: ref("RentalDocumentType") }],
    errorResponses: {
      "400": { description: "原文档类型校验失败。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单查看权限或当前 Rental 访问条件拒绝读取。", schema: "RentalHttpErrorResponse" },
      "404": { description: "当前订单范围内找不到订单。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原订单或历史目录读取失败。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/documents/{type}/versions/{snapshotId}", tag: "RentalCore", operationId: "readRentalOrderDocumentVersion",
    summary: "按当前订单范围读取指定历史凭证，含资金明细时核验当前财务权限。", permissions: ["rental-os:order:view"], responseSchema: "RentalDocumentRenderResult",
    parameters: [{ name: "type", in: "path", required: true, schema: ref("RentalDocumentType") }],
    errorResponses: {
      "400": { description: "原文档类型校验失败。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单访问被拒绝，或当前账号无权读取含资金明细的历史版本。", schema: "RentalHttpErrorResponse" },
      "404": { description: "当前订单范围内找不到订单或指定历史版本，原无存储场景也返回版本不存在。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原订单或指定历史版本读取失败。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/expire-pending", tag: "RentalCore", operationId: "expirePendingRentalCoreOrder",
    summary: "Expire one pending-payment soft reservation when all holds have elapsed", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/mark-pickup-overdue", tag: "RentalCore", operationId: "markPickupOverdueRentalCoreOrder",
    summary: "Move an order past pickup grace into pending no-show", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/no-show-notice", tag: "RentalCore", operationId: "sendNoShowNoticeRentalCoreOrder",
    summary: "Record a simulated customer notice for a pending no-show", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/confirm-no-show", tag: "RentalCore", operationId: "confirmNoShowRentalCoreOrder",
    summary: "Finalize an eligible no-show and release its resources", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/resume-pickup", tag: "RentalCore", operationId: "resumePickupRentalCoreOrder",
    summary: "Resume a pending no-show order back to ready-for-pickup", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/confirm", tag: "RentalCore", operationId: "confirmRentalCoreOrder",
    summary: "Confirm Rental Core reservation", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/allocate", tag: "RentalCore", operationId: "allocateRentalCoreOrder",
    summary: "Allocate Rental Core inventory", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/allocation-candidates", tag: "RentalCore", operationId: "rentalAllocationCandidates",
    summary: "Get scoped allocation candidates, or exchange candidates for a fulfilled order line", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject",
    parameters: [queryParam("exchangeOrderLineId"), queryParam("replacementItemGroupId")]
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/assignments", tag: "RentalCore", operationId: "manageRentalAllocations",
    summary: "Preassign or lock resources; unlock, release and reassign additionally require order:reassign", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/internal-notes", tag: "RentalCore", operationId: "listRentalOrderInternalNotes",
    summary: "List operations-only internal notes for a rental order", permissions: ["rental-os:order:view"], responseSchema: arrayOf("RentalOrderInternalNote")
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/internal-notes", tag: "RentalCore", operationId: "createRentalOrderInternalNote",
    summary: "Add an idempotent operations-only internal note to a rental order", permissions: ["rental-os:order:operate"], requestSchema: "CreateRentalOrderInternalNoteRequest", responseSchema: "RentalOrderInternalNote",
    parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 1, maxLength: 191 } }]
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/operation-lock", tag: "RentalCore", operationId: "rentalOrderOperationLock",
    summary: "Acquire or release a fenced handover operation lock; managers may force-release another employee's active lock with a reason", permissions: ["rental-os:order:operate", "rental-os:order:pickup", "rental-os:order:return", "rental-os:order:reassign"], requestSchema: "RentalOperationLockRequest", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/substitute-bundle-component", tag: "RentalCore", operationId: "substituteRentalBundleComponent",
    summary: "Substitute a reserved bundle component within its configured group", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/partial-return", tag: "RentalCore", operationId: "partialReturnRentalCoreOrder",
    summary: "Return selected allocated assets or quantities while keeping the order renting", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/cancel", tag: "RentalCore", operationId: "cancelRentalCoreOrder",
    summary: "Cancel Rental Core order", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/handover/{stage}", tag: "RentalCore", operationId: "handoverRentalCoreOrder",
    summary: "Complete pickup or return handover when inspection is not required", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/settle", tag: "RentalCore", operationId: "settleRentalCoreOrder",
    summary: "Settle and close a returned Rental Core order", permissions: ["rental-os:order:settle"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/services/{occurrenceId}/execution", tag: "RentalCore", operationId: "updateRentalServiceOccurrenceExecution",
    summary: "记录原服务实际履约。complete 每段使用稳定 Idempotency-Key，重试返回原发生项收据和当前受权订单", permissions: ["rental-os:order:operate"], requestSchema: "UpdateRentalServiceOccurrenceRequest", responseSchema: "RentalServiceExecutionResult", successStatus: 201,
    parameters: [{ name: "Idempotency-Key", in: "header", required: false, description: "complete 必须携带。每个新段使用独立稳定键，重试保留原请求和原键。", schema: { type: "string", minLength: 1, maxLength: 191 } }],
    errorResponses: {
      "400": {
        description: "原 DTO、操作键或履约输入无效。serviceExecutionNotCommitted 仅由执行器前的 complete 参数校验给出。",
        schema: objectOf({
          statusCode: { type: "integer", enum: [400] }, message: { oneOf: [stringSchema, arrayOf(stringSchema)] },
          error: stringSchema, serviceExecutionNotCommitted: { type: "boolean", enum: [true] }
        }, ["statusCode", "message"], false)
      },
      "403": { description: "当前主体缺少原订单操作权限，或订单超出当前租户和经营空间范围。", schema: "RentalHttpErrorResponse" },
      "404": { description: "原订单或服务发生项不存在。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原订单或服务状态冲突，操作键请求不同，或原收据与当前事实核对失败。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原事务或提交后投影失败，沿原操作和原收据核对。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/services/{occurrenceId}/execution-receipt", tag: "RentalCore", operationId: "getRentalServiceExecutionReceipt",
    summary: "按 Idempotency-Key 读取原服务收据，committed 返回原段及当前受权订单，unknown 保留原操作等待核对", permissions: ["rental-os:order:view"], responseSchema: "RentalServiceExecutionReceipt",
    parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 1, maxLength: 191 } }],
    errorResponses: {
      "400": { description: "读取原服务收据的 Idempotency-Key 缺失或无效。", schema: "RentalHttpErrorResponse" },
      "403": { description: "当前主体缺少原订单查看权限，或订单超出当前租户和经营空间范围。", schema: "RentalHttpErrorResponse" },
      "404": { description: "原订单不存在。", schema: "RentalHttpErrorResponse" },
      "409": { description: "操作键属于另一订单，或原段收据与当前发生项事实核对失败。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原收据或当前订单投影读取失败。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/services/{occurrenceId}/refund", tag: "RentalCore", operationId: "refundRentalServiceOccurrence",
    summary: "按已批准金额办理服务模拟退款，原资金事件、服务发生项和操作收据在同一事务提交", permissions: ["rental-os:order:settle"], requestSchema: "RefundRentalServiceRequest", responseSchema: "RentalServiceExecutionResult", successStatus: 201,
    errorResponses: {
      "400": { description: "原退款 DTO、操作键或线下方式无效。", schema: "RentalHttpErrorResponse" },
      "403": { description: "当前主体缺少原订单结算权限，或订单超出当前租户和经营空间范围。", schema: "RentalHttpErrorResponse" },
      "404": { description: "原订单或服务发生项不存在。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原批准金额或审核事实不匹配、已经退款、原操作键冲突，或当前订单及经营空间未满足纯演练资金准入。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原资金和服务事务或提交后投影失败，沿原操作和原收据核对。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/extensions", tag: "RentalCore", operationId: "listRentalOrderExtensions",
    summary: "List order extension records", permissions: ["rental-os:order:view"], responseSchema: arrayOf("RentalOrderExtensionRecord")
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/changes", tag: "RentalCore", operationId: "listRentalOrderChanges",
    summary: "List append-only order change records", permissions: ["rental-os:order:view"], responseSchema: arrayOf("RentalOrderChangeRecord")
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/changes/partial-cancel/preview", tag: "RentalCore", operationId: "previewRentalOrderPartialCancellation",
    summary: "Preview a pre-pickup whole-line cancellation", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/changes/partial-cancel", tag: "RentalCore", operationId: "applyRentalOrderPartialCancellation",
    summary: "Apply a confirmed pre-pickup whole-line cancellation", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  ...RENTAL_EXCHANGE_INSPECTION_OPERATIONS,
  {
    method: "get", path: "/api/rental/v1/orders/{id}/changes/post-pickup-exchange/services", tag: "RentalCore", operationId: "rentalOrderExchangeServiceOptions",
    summary: "Read current exchange service options under original order visibility and operation permission", permissions: ["rental-os:order:operate"], responseSchema: "RentalExchangeServiceOptions"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/changes/post-pickup-exchange/preview", tag: "RentalCore", operationId: "previewRentalOrderPostPickupExchange",
    summary: "Preview remaining-period exchange and independently selected services without reserving capacity", permissions: ["rental-os:order:operate"], requestSchema: "RentalPostPickupExchangeRequest", responseSchema: "RentalPostPickupExchangePreview"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/changes/post-pickup-exchange", tag: "RentalCore", operationId: "applyRentalOrderPostPickupExchange",
    summary: "Apply customer-confirmed exchange, append services and atomically confirm capacity, defer settlement", permissions: ["rental-os:order:operate"], requestSchema: "RentalPostPickupExchangeApplyRequest", responseSchema: "RentalPostPickupExchangeResult"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/extensions/preview", tag: "RentalCore", operationId: "previewRentalOrderExtension",
    summary: "Quote an order extension without persisting", permissions: ["rental-os:order:extend", "rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "RentalOrderExtensionPreview"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/extensions", tag: "RentalCore", operationId: "requestRentalOrderExtension",
    summary: "Apply for an order extension", permissions: ["rental-os:order:extend", "rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "RentalOrderExtensionResult"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/extensions/{extensionId}/pay", tag: "RentalCore", operationId: "payRentalOrderExtension",
    summary: "Confirm extension payment and extend the rental period", permissions: ["rental-os:order:extend", "rental-os:order:operate"], responseSchema: "RentalOrderExtensionResult"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/fee-reviews/{reviewId}/review", tag: "RentalCore", operationId: "reviewRentalOrderFeeReview",
    summary: "Decide a pending fee review; an unknown refund suggestion requires an explicit assessed amount bounded by its original snapshot, not a cash refund", permissions: ["rental-os:order:fee-review"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/extensions/{extensionId}/refund-review", tag: "RentalCore", operationId: "reviewRentalExtensionRefund",
    summary: "Review an extension price reduction without issuing a cash refund", permissions: ["rental-os:order:fee-review"], requestSchema: "GenericObject", responseSchema: "RentalOrderExtensionResult"
  },
  {
    method: "get", path: "/api/rental/v1/inspection-templates", tag: "RentalCore", operationId: "listRentalInspectionTemplates",
    parameters: [queryParam("stage", { type: "string", enum: ["pickup", "return"] }), queryParam("orderId")],
    summary: "List inspection templates; orderId projects immutable original/replacement requirements with allocationIds for separate return batches, otherwise current configuration", permissions: ["rental-os:order:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/inspections", tag: "RentalCore", operationId: "listRentalOrderInspections",
    summary: "List Rental Core inspections", permissions: ["rental-os:order:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections", tag: "RentalCore", operationId: "createRentalOrderInspection",
    summary: "Complete pickup or return inspection", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections/{inspectionId}/usage-correction", tag: "RentalCore", operationId: "correctRentalInspectionUsage",
    summary: "Append a traceable correction to an inspection usage reading", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections/{inspectionId}/exceptions/{exceptionIndex}/review", tag: "RentalCore", operationId: "reviewRentalOrderInspectionException",
    summary: "Approve or reject a suggested inspection exception charge", permissions: ["rental-os:order:fee-review"], requestSchema: "ReviewRentalInspectionExceptionRequest", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections/{inspectionId}/exceptions/{exceptionIndex}/customer-response", tag: "RentalCore", operationId: "recordRentalOrderInspectionExceptionCustomerResponse",
    summary: "Record customer confirmation or dispute for an approved inspection exception charge", permissions: ["rental-os:order:fee-review"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections/{inspectionId}/exceptions/{exceptionIndex}/re-review", tag: "RentalCore", operationId: "reReviewRentalOrderInspectionException",
    summary: "Adjust a disputed inspection exception charge and require customer reconfirmation", permissions: ["rental-os:order:fee-review"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/capabilities", tag: "RentalCore", operationId: "listWorkspaceCapabilities",
    summary: "List workspace capability instances with declared/implemented/enabled state",
    permissions: ["rental-core:capability:view", "rental-core:capability:manage"], responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/capabilities", tag: "RentalCore", operationId: "saveWorkspaceCapability",
    summary: "Enable, pause, disable or reconfigure a workspace capability",
    permissions: ["rental-core:capability:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/capabilities/{code}/upgrade", tag: "RentalCore", operationId: "upgradeWorkspaceCapability",
    summary: "Upgrade a workspace capability to the registry implementation version",
    permissions: ["rental-core:capability:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    // Review P1-3：存量空间的显式对账入口。迁移与租户初始化都不静默补启用，
    // 因此必须有一条由人触发、留 system_initialize 审计的转正路径。
    method: "post", path: "/api/rental/v1/capabilities/initialize-required", tag: "RentalCore", operationId: "initializeRequiredWorkspaceCapabilities",
    summary: "Initialize the category-required capabilities of the current workspace (idempotent reconciliation)",
    permissions: ["rental-core:capability:manage"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/capability-audits", tag: "RentalCore", operationId: "listWorkspaceCapabilityAudits",
    summary: "List workspace capability lifecycle audit events",
    permissions: ["rental-core:capability:view", "rental-core:capability:manage"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/fulfillment-operators", tag: "RentalCore", operationId: "listRentalFulfillmentOperators",
    summary: "读取当前空间原已提交的经营主体配置。", permissions: ["rental-os:station:view"],
    responseSchema: arrayOf("RentalFulfillmentOperator")
  },
  {
    method: "post", path: "/api/rental/v1/fulfillment-operators", tag: "RentalCore", operationId: "createRentalFulfillmentOperator",
    summary: "沿原保存入口新建或按请求 id 更新经营主体，提交后返回原保存投影。", permissions: ["rental-os:station:manage"],
    successStatus: 201, requestSchema: "SaveRentalFulfillmentOperatorRequest", responseSchema: "RentalFulfillmentOperator",
    errorResponses: {
      "400": { description: "输入或经营主体状态未通过原 DTO、保存与仓储校验。", schema: "RentalHttpErrorResponse" },
      "404": { description: "请求 id 对应的经营主体不存在。", schema: "RentalHttpErrorResponse" },
      "409": { description: "编码、当前品类绑定、空间归属或原状态读取发生冲突。", schema: "RentalHttpErrorResponse" },
      "503": { description: "更新省略状态时，原事务无法返回应保留的已存状态。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "put", path: "/api/rental/v1/fulfillment-operators/{id}", tag: "RentalCore", operationId: "updateRentalFulfillmentOperator",
    summary: "以路径 id 更新经营主体，省略状态时使用原事务锁定的已存状态。", permissions: ["rental-os:station:manage"],
    requestSchema: "SaveRentalFulfillmentOperatorRequest", responseSchema: "RentalFulfillmentOperator",
    errorResponses: {
      "400": { description: "输入或经营主体状态未通过原 DTO、保存与仓储校验。", schema: "RentalHttpErrorResponse" },
      "404": { description: "路径 id 对应的经营主体不存在。", schema: "RentalHttpErrorResponse" },
      "409": { description: "编码、当前品类绑定、空间归属或原状态读取发生冲突。", schema: "RentalHttpErrorResponse" },
      "503": { description: "省略状态时，原事务无法返回应保留的已存状态。", schema: "RentalHttpErrorResponse" }
    }
  },
  backlogOperation("get", "/api/rental/v1/pricing-plans", "RentalBusiness", "listRentalPricingPlans", "List generic pricing plans", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans", "RentalBusiness", "createRentalPricingPlan", "Create generic pricing plan", ["rental-os:price:manage"]),
  backlogOperation("put", "/api/rental/v1/pricing-plans/{id}", "RentalBusiness", "updateRentalPricingPlan", "Update generic pricing plan", ["rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/pricing-versions", "RentalBusiness", "listRentalPriceVersions", "List immutable space price versions", ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"]),
  backlogOperation("get", "/api/rental/v1/pricing-versions/{sequence}", "RentalBusiness", "getRentalPriceVersion", "Get immutable space price version", ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"]),
  backlogOperation("post", "/api/rental/v1/pricing-versions/{sequence}/restore", "RentalBusiness", "restoreRentalPriceVersion", "Restore an immutable price snapshot by appending a new version", ["rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/pricing-plans/{id}/versions", "RentalBusiness", "listLegacyRentalPricingPlanVersions", "Compatibility entry for space price versions", ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"]),
  backlogOperation("get", "/api/rental/v1/pricing-plans/{id}/adjustments", "RentalBusiness", "listRentalPriceAdjustments", "List price adjustment plans", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans/adjustments/run-due", "RentalBusiness", "runDueRentalPriceAdjustments", "Apply due scheduled price adjustments", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans/{id}/adjustments", "RentalBusiness", "createRentalPriceAdjustment", "Create a price adjustment plan (diff + final-price preview)", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans/{id}/adjustments/{aid}/confirm", "RentalBusiness", "confirmRentalPriceAdjustment", "Confirm a price adjustment plan (immediate or schedule)", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans/{id}/adjustments/{aid}/cancel", "RentalBusiness", "cancelRentalPriceAdjustment", "Cancel a draft or pending price adjustment plan", ["rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/pricing-adjustments", "RentalBusiness", "listSpaceRentalPriceAdjustments", "List workspace price adjustment plans", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-adjustments", "RentalBusiness", "createSpaceRentalPriceAdjustment", "Create a workspace price adjustment plan", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-adjustments/{aid}/confirm", "RentalBusiness", "confirmSpaceRentalPriceAdjustment", "Confirm a workspace price adjustment plan", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-adjustments/{aid}/cancel", "RentalBusiness", "cancelSpaceRentalPriceAdjustment", "Cancel a workspace price adjustment plan", ["rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/discount-plans", "RentalBusiness", "listRentalDiscountPlans", "List rental discount plans", ["rental-os:marketing:manage"]),
  backlogOperation("post", "/api/rental/v1/discount-plans", "RentalBusiness", "createRentalDiscountPlan", "Create rental discount plan", ["rental-os:marketing:manage"]),
  backlogOperation("put", "/api/rental/v1/discount-plans/{id}", "RentalBusiness", "updateRentalDiscountPlan", "Update rental discount plan", ["rental-os:marketing:manage"]),
  backlogOperation("get", "/api/rental/v1/value-added-services", "RentalBusiness", "listRentalValueAddedServices", "List value-added services", ["rental-os:service:manage"]),
  backlogOperation("post", "/api/rental/v1/value-added-services", "RentalBusiness", "createRentalValueAddedService", "Create value-added service", ["rental-os:service:manage"]),
  backlogOperation("put", "/api/rental/v1/value-added-services/{id}", "RentalBusiness", "updateRentalValueAddedService", "Update value-added service", ["rental-os:service:manage"]),
  backlogOperation("get", "/api/rental/v1/service-capacities", "RentalBusiness", "listRentalServiceCapacities", "List service capacity windows", ["rental-os:service:manage"]),
  backlogOperation("post", "/api/rental/v1/service-capacities", "RentalBusiness", "createRentalServiceCapacity", "Create service capacity window", ["rental-os:service:manage"]),
  backlogOperation("put", "/api/rental/v1/service-capacities/{id}", "RentalBusiness", "updateRentalServiceCapacity", "Update service capacity window", ["rental-os:service:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}", "RentalBusiness", "getRentalBusinessCalendar", "Get annual business calendar", ["rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage", "rental-os:order:view"]),
  backlogOperation("get", "/api/rental/v1/official-calendar-sources", "RentalBusiness", "listRentalOfficialCalendarSourceVersions", "List public official calendar source versions", ["rental-os:calendar:view-history", "rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/apply-official-source", "RentalBusiness", "applyRentalOfficialCalendarSource", "Apply a public official calendar source version to the workspace draft", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/subscription/context", "Subscription", "getStaffSubscriptionContext", "Staff/operator read-only subscription & entitlement context for the staff mini-program (amounts redacted)", []),
  backlogOperation("put", "/api/rental/v1/calendars/{year}/days/{date}", "RentalBusiness", "updateRentalBusinessCalendarDay", "Update tenant calendar day", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("delete", "/api/rental/v1/calendars/{year}/days/{date}", "RentalBusiness", "removeRentalBusinessCalendarDayOverride", "Remove tenant calendar day override", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/days/range-preview", "RentalBusiness", "previewRentalBusinessCalendarRangeOverride", "Preview a date or datetime range override over the annual calendar draft", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/days/range", "RentalBusiness", "applyRentalBusinessCalendarRangeOverride", "Apply an atomic date or datetime range override (shared reason, batch and single revision)", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/days/range-remove-preview", "RentalBusiness", "previewRentalBusinessCalendarRangeRemove", "Preview restoring a date range to its next-priority source", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/days/range-remove", "RentalBusiness", "applyRentalBusinessCalendarRangeRemove", "Remove overrides across a date range atomically", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/publish", "RentalBusiness", "publishRentalBusinessCalendar", "Publish annual business calendar", ["rental-os:calendar:publish", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/versions/{version}/void", "RentalBusiness", "voidRentalBusinessCalendarVersion", "Void annual business calendar draft", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/versions/{version}/restore", "RentalBusiness", "restoreRentalBusinessCalendarVersion", "Restore an annual business calendar version into a new draft", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}/versions", "RentalBusiness", "listRentalBusinessCalendarVersions", "List annual business calendar versions", ["rental-os:calendar:view-history", "rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}/versions/{version}", "RentalBusiness", "getRentalBusinessCalendarVersion", "Get annual business calendar version detail", ["rental-os:calendar:view-history", "rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}/override-audits", "RentalBusiness", "listRentalBusinessCalendarOverrideAudits", "List annual business calendar override audits", ["rental-os:calendar:view-history", "rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}/publish-preview", "RentalBusiness", "previewRentalBusinessCalendarPublish", "Preview annual business calendar publish impact", ["rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions", "RentalBusiness", "listRentalRuleVersionsV1", "List rental rule versions", ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions/current", "RentalBusiness", "getCurrentRentalRuleVersionV1", "Match the rental rule version effective at a moment", ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions/audits", "RentalBusiness", "listRentalRuleVersionAuditsV1", "List rental rule version publish/restore/void audits", ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions/{version}", "RentalBusiness", "getRentalRuleVersionV1", "Get rental rule version detail", ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions/{version}/publish-preview", "RentalBusiness", "previewRentalRuleVersionPublishV1", "Preview rental rule version publish impact", ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/rule-versions", "RentalBusiness", "saveRentalRuleVersionDraftV1", "Create or update a rental rule draft version", ["rental-os:rules:manage"]),
  backlogOperation("post", "/api/rental/v1/rule-versions/{version}/restore", "RentalBusiness", "restoreRentalRuleVersionV1", "Restore a historical rental rule version as a new draft", ["rental-os:rules:manage"]),
  backlogOperation("post", "/api/rental/v1/rule-versions/{version}/publish", "RentalBusiness", "publishRentalRuleVersionV1", "Publish or schedule a rental rule version", ["rental-os:rules:publish"]),
  backlogOperation("post", "/api/rental/v1/rule-versions/{version}/void", "RentalBusiness", "voidRentalRuleVersionV1", "Void a pending or effective rental rule version", ["rental-os:rules:publish"]),
  {
    method: "get", path: "/api/rental/v1/orders/{orderId}/funding-events", tag: "RentalBusiness", operationId: "listRentalOrderFundingEventsV1",
    summary: "读取原订单三类资金余额与按事件时间正序返回的历史流水，保留实款或演练口径及企业原核销投影。",
    permissions: ["rental-os:order:view", "rental-os:order:settle"], authRequired: true, responseSchema: "RentalFundingBalance",
    errorResponses: {
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单查看或结算权限、当前租户及经营空间范围拒绝读取。", schema: "RentalHttpErrorResponse" },
      "404": { description: "订单不存在或不属于当前经营空间。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原企业应收核销或历史资金确认依据不可核实。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原订单、资金或应收投影读取失败。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/rental/v1/orders/{orderId}/funding-events/initiate", tag: "RentalBusiness", operationId: "initiateRentalOrderFundingV1",
    summary: "按原订单及适用待补款续租金额发起租金、押金或预授权演练，沿纯演练准入和原键读取收据。",
    permissions: ["rental-os:order:settle"], authRequired: true, requestSchema: "InitiateRentalFundingRequest", responseSchema: "RentalFundingEvent", successStatus: 201,
    errorResponses: {
      "400": { description: "原 DTO 或线下方式字段校验失败。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单结算权限或当前租户、经营空间、地点与数据范围拒绝动作。", schema: "RentalHttpErrorResponse" },
      "404": { description: "订单不存在或不属于当前经营空间。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原纯演练准入、当前应收、款项动作、终态或原键来源校验拒绝。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原资金事务或提交后恢复保存异常，结果不明时沿同一键与原收据核对。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/rental/v1/orders/{orderId}/funding-events/append", tag: "RentalBusiness", operationId: "appendRentalOrderFundingV1",
    summary: "沿原纯演练准入追加指定款项金额，保证金须已发起，租金追加受原待收额度约束。",
    permissions: ["rental-os:order:settle"], authRequired: true, requestSchema: "RentalFundingAmountRequest", responseSchema: "RentalFundingEvent", successStatus: 201,
    errorResponses: {
      "400": { description: "原 DTO、金额或线下方式字段校验失败。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单结算权限或当前业务范围拒绝动作。", schema: "RentalHttpErrorResponse" },
      "404": { description: "订单不存在或不属于当前经营空间。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原纯演练准入、保证金发起状态、金额、终态或同键来源与金额不符。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原资金事务或提交后恢复保存异常，结果不明时沿同一键与原收据核对。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/rental/v1/orders/{orderId}/funding-events/capture", tag: "RentalBusiness", operationId: "captureRentalOrderFundingV1",
    summary: "抵扣押金或转扣预授权演练余额，带 offlineDeposit 时沿原实收押金与凭证在同一事务确认线下抵扣。",
    permissions: ["rental-os:order:settle"], authRequired: true, requestSchema: "RentalFundingAmountRequest", responseSchema: "RentalFundingEvent", successStatus: 201,
    errorResponses: {
      "400": { description: "原 DTO 校验失败，或线下处置缺少 deposit 款项及当前操作人。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单结算权限或当前业务范围拒绝动作。", schema: "RentalHttpErrorResponse" },
      "404": { description: "订单不存在或不在当前授权范围。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原纯演练准入、余额与尚未支付应收、线下实收和凭证、精确金额或同键收据不满足。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原资金及凭证事务或提交后恢复保存异常，结果不明时核对原键、凭证与资金收据。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/rental/v1/orders/{orderId}/funding-events/refund", tag: "RentalBusiness", operationId: "refundRentalOrderFundingV1",
    summary: "沿原余额与待退额度办理押金或租金演练退款，带 offlineDeposit 时按原实收方式与凭证确认线下押金退还。",
    permissions: ["rental-os:order:settle"], authRequired: true, requestSchema: "RentalFundingAmountRequest", responseSchema: "RentalFundingEvent", successStatus: 201,
    errorResponses: {
      "400": { description: "原 DTO 或方式校验失败，或线下处置缺少 deposit 款项及当前操作人。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单结算权限或当前业务范围拒绝动作。", schema: "RentalHttpErrorResponse" },
      "404": { description: "订单不存在或不在当前授权范围。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原纯演练准入、可退余额、原线下收款方式、实收与凭证、精确金额或同键收据不满足。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原资金及凭证事务或提交后恢复保存异常，结果不明时核对原键、凭证与资金收据。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/rental/v1/orders/{orderId}/funding-events/release", tag: "RentalBusiness", operationId: "releaseRentalOrderFundingV1",
    summary: "沿原纯演练准入释放预授权冻结额度，省略金额时使用当前全部剩余冻结余额。",
    permissions: ["rental-os:order:settle"], authRequired: true, requestSchema: "RentalFundingReleaseRequest", responseSchema: "RentalFundingEvent", successStatus: 201,
    errorResponses: {
      "400": { description: "原 DTO 的金额、幂等键或原因校验失败。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单结算权限或当前业务范围拒绝动作。", schema: "RentalHttpErrorResponse" },
      "404": { description: "订单不存在或不属于当前经营空间。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原纯演练准入、可释放余额、正金额或同键来源与金额校验拒绝。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原资金事务或提交后恢复保存异常，结果不明时沿同一键与原收据核对。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "post", path: "/api/rental/v1/orders/{orderId}/funding-events/fail", tag: "RentalBusiness", operationId: "failRentalOrderFundingV1",
    summary: "沿原纯演练准入记录指定款项的失败码与金额为 0 的原事件，保留当前资金余额。",
    permissions: ["rental-os:order:settle"], authRequired: true, requestSchema: "RentalFundingFailureRequest", responseSchema: "RentalFundingEvent", successStatus: 201,
    errorResponses: {
      "400": { description: "原 DTO、失败码或方式字段校验失败。", schema: "RentalHttpErrorResponse" },
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原订单结算权限或当前业务范围拒绝动作。", schema: "RentalHttpErrorResponse" },
      "404": { description: "订单不存在或不属于当前经营空间。", schema: "RentalHttpErrorResponse" },
      "409": { description: "原纯演练准入、款项动作、原因、幂等键或同键来源校验拒绝。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原资金事务或提交后恢复保存异常，结果不明时沿同一键与原收据核对。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "get", path: "/api/rental/v1/orders/{orderId}/payment-intents", tag: "Payments", operationId: "listRentalPaymentIntents",
    summary: "读取原订单支付单数组，按创建时间正序返回租金、押金和预授权的原结果状态。", permissions: ["rental-os:finance:view", "rental-os:finance:reconcile"], authRequired: true,
    responseSchema: arrayOf("ClientPaymentIntentResponse"),
    errorResponses: {
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原财务权限或当前订单范围拒绝读取。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原支付记录读取失败，结果不明时沿原支付单核对状态。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "get", path: "/api/rental/v1/orders/{orderId}/payment-intents/{intentId}/refunds", tag: "Payments", operationId: "listRentalPaymentRefunds",
    summary: "按原支付单读取退款数组，保留原金额、币种及受理、退款成功和入账时间。", permissions: ["rental-os:finance:view", "rental-os:finance:reconcile"], authRequired: true,
    responseSchema: arrayOf("PaymentRefundResponse"),
    errorResponses: {
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "原财务权限或当前订单范围拒绝读取。", schema: "RentalHttpErrorResponse" },
      "404": { description: "当前租户、空间和订单内找不到原支付单。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原支付单或退款记录读取失败，保留原记录与结果状态核对。", schema: "RentalHttpErrorResponse" }
    }
  },
  backlogOperation("post", "/api/rental/v1/orders/{orderId}/payment-intents/{intentId}/refunds", "Payments", "createRentalPaymentRefund", "Create a real provider refund after an approved order credit", ["rental-os:finance:reconcile"], true, "CreatePaymentRefundRequest", "PaymentRefundResponse"),
  backlogOperation("post", "/api/rental/v1/orders/{orderId}/payment-intents/{intentId}/refunds/{refundId}/refresh", "Payments", "refreshRentalPaymentRefund", "Query and recover a provider refund", ["rental-os:finance:reconcile"], true, undefined, "PaymentRefundResponse"),
  backlogOperation("post", "/api/rental/v1/payment-reconciliation", "Payments", "reconcileRentalPayments", "Reconcile unresolved payments and refunds; requires current full-workspace financial scope", ["rental-os:finance:reconcile"], true, undefined, "PaymentReconciliationSummary", [queryParam("limit", numberSchema)]),
  backlogOperation("post", "/api/rental/v1/payment-reconciliation/statements", "Payments", "importRentalPaymentStatement", "Import a statement under current full-workspace financial scope without mutating payment facts", ["rental-os:finance:reconcile"], true, "ImportPaymentStatementRequest", "PaymentStatementBatchDetail"),
  {
    method: "get", path: "/api/rental/v1/payment-reconciliation/statements", tag: "Payments", operationId: "listRentalPaymentStatements",
    summary: "读取当前完整经营空间获权的对账批次数组，按导入时间倒序返回。", permissions: ["rental-os:finance:reconcile"], authRequired: true,
    responseSchema: "PaymentStatementBatchList",
    parameters: [queryParam("limit", { type: "number", description: "原查询默认 50，非有限值采用 50。服务向下取整，0 采用 50，再限制为 1 到 100 条。", example: 50 })],
    errorResponses: {
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "当前主体缺少完整经营空间财务对账权限，或数据范围、地点范围及 audience 不满足原门禁。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原对账批次读取失败。", schema: "RentalHttpErrorResponse" }
    }
  },
  {
    method: "get", path: "/api/rental/v1/payment-reconciliation/statements/{batchId}", tag: "Payments", operationId: "getRentalPaymentStatement",
    summary: "在当前完整经营空间财务权限下读取原对账批次及按行号排序的差异明细。", permissions: ["rental-os:finance:reconcile"], authRequired: true,
    responseSchema: "PaymentStatementBatchDetail",
    errorResponses: {
      "401": { description: "原会话认证失败。", schema: "RentalHttpErrorResponse" },
      "403": { description: "当前主体缺少完整经营空间财务对账权限，或数据范围、地点范围及 audience 不满足原门禁。", schema: "RentalHttpErrorResponse" },
      "404": { description: "对账文件批次不存在或不属于当前租户和经营空间。", schema: "RentalHttpErrorResponse" },
      "500": { description: "原对账批次或明细读取失败。", schema: "RentalHttpErrorResponse" }
    }
  },
  backlogOperation("post", "/api/rental/v1/payment-reconciliation/statements/{batchId}/lines/{lineId}/review", "Payments", "reviewRentalPaymentStatementLine", "Acknowledge or query a statement difference under current full-workspace financial scope; funding facts stay unchanged", ["rental-os:finance:reconcile"], true, "ReviewPaymentStatementLineRequest", "PaymentStatementBatchDetail"),
  backlogOperation("get", "/api/rental/v1/customer-coupons", "RentalBusiness", "listRentalCustomerCoupons", "List customer coupons", ["rental-os:marketing:manage"]),
  backlogOperation("post", "/api/rental/v1/customer-coupons/{id}/void", "RentalBusiness", "voidRentalCustomerCoupon", "Void an available customer coupon with a reason", ["rental-os:marketing:manage"]),
  backlogOperation("post", "/api/rental/v1/customer-coupons/claim", "RentalBusiness", "claimRentalCustomerCoupon", "Claim customer coupon", ["rental-os:marketing:manage"]),
  backlogOperation("get", "/api/rental/v1/rewards", "RentalBusiness", "listRentalRewardLedger", "List reward ledger", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/rental/v1/benefit-accounts", "RentalBusiness", "listRentalBenefitAccounts", "List customer benefit accounts", ["rental-os:member:manage"]),
  backlogOperation("post", "/api/rental/v1/rewards/grant", "RentalBusiness", "grantRentalReward", "Grant idempotent membership reward", ["rental-os:member:manage"]),
  backlogOperation("post", "/api/rental/v1/rewards/{id}/reverse", "RentalBusiness", "reverseRentalReward", "Reverse membership reward", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/rental/v1/notification-templates", "RentalBusiness", "listRentalNotificationTemplates", "List tenant notification templates", ["system:integration:manage"]),
  backlogOperation("post", "/api/rental/v1/notification-templates", "RentalBusiness", "createRentalNotificationTemplate", "Create tenant notification template", ["system:integration:manage"]),
  backlogOperation("put", "/api/rental/v1/notification-templates/{id}", "RentalBusiness", "updateRentalNotificationTemplate", "Update tenant notification template", ["system:integration:manage"]),
  backlogOperation("get", "/api/rental/v1/notification-logs", "RentalBusiness", "listRentalNotificationLogs", "List notification send logs", ["system:integration:manage"]),
  backlogOperation("post", "/api/rental/v1/notification-logs/retry-due", "RentalBusiness", "retryDueRentalNotifications", "Retry due business SMS notifications", ["system:integration:manage"]),
  backlogOperation("post", "/api/rental/v1/notification-logs/{id}/query-delivery", "RentalBusiness", "queryRentalNotificationDelivery", "Query provider delivery receipt for one SMS notification", ["system:integration:manage"]),
  backlogOperation("post", "/api/rental/v1/notification-logs/{id}/retry", "RentalBusiness", "retryRentalNotification", "Retry one business SMS notification", ["system:integration:manage"]),
  backlogOperation("post", "/api/rental/v1/notifications/send", "RentalBusiness", "sendRentalNotification", "Render and send tenant notification", ["system:integration:manage"]),
  backlogOperation("post", "/api/payments/webhooks/alipay", "Integrations", "receiveAlipayPaymentWebhook", "Receive and verify an Alipay payment notification", [], false, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/payments/webhooks/wechat_pay", "Integrations", "receiveWechatPaymentWebhook", "Receive and verify a WeChat Pay API v3 notification", [], false, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/payments/webhooks/stripe", "Integrations", "receiveStripeWebhook", "Receive and verify a Stripe webhook (checkout session and refund events)", [], false, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/payments/webhooks/alipay/refund", "Integrations", "receiveAlipayRefundWebhook", "Receive a signed Alipay refund notification when the provider supplies a definitive result", [], false, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/payments/webhooks/wechat_pay/refund", "Integrations", "receiveWechatRefundWebhook", "Receive and verify a WeChat Pay API v3 refund result notification", [], false, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/rental/v1/quotes", "RentalBusiness", "createRentalQuote", "Create server-side rental quote", ["rental-os:order:operate"], true, undefined, "RentalQuoteSnapshot"),
  backlogOperation("get", "/api/rental/v1/quotes/{id}", "RentalBusiness", "getRentalQuote", "Get rental quote snapshot in current object scope", ["rental-os:order:view"], true, undefined, "RentalQuoteSnapshot"),
  clientOperation("get", "/api/client/v1/tenants/{tenantCode}/workspaces", "listClientWorkspaces", "List active workspaces for client registration", { responseSchema: "ClientWorkspaceDirectory", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/registration/challenges", "createClientRegistrationChallenge", "Create a client registration verification challenge", { requestSchema: "ClientRegistrationChallengeRequest", responseSchema: "ClientRegistrationChallengeResponse", authRequired: false }),
  clientOperation("get", "/api/client/v1/public/bootstrap", "getClientChannelBootstrap", "Public client channel bootstrap: brand, agreements, service phone, help, banner, published services, login methods and capability flags; client=wechat_miniprogram|app|web overlays channel capabilities, and client=web additionally returns the website-only config block", { responseSchema: "ClientChannelBootstrapResponse", authRequired: false, parameters: [{ name: "tenantCode", in: "query", required: true, schema: stringSchema }, { name: "client", in: "query", schema: { type: "string", enum: ["wechat_miniprogram", "app", "web"] } }, { name: "appId", in: "query", schema: stringSchema }] }),
  clientOperation("get", "/api/client/v1/public/site-resolve", "resolveClientWebsiteHost", "Public host-to-tenant resolution for the tenant website: returns the tenantCode bound to a custom domain (enabled website channel only), or null when unbound", { responseSchema: "ClientWebsiteHostResolution", authRequired: false, parameters: [{ name: "host", in: "query", required: true, schema: stringSchema }] }),
  clientOperation("get", "/api/client/v1/public/documents/{kind}", "getClientPublicDocument", "Public document body (user agreement / privacy policy / help) from the tenant client channel profile; rendered in-client, guest-readable", { responseSchema: "ClientPublicDocumentResponse", authRequired: false, parameters: [{ name: "kind", in: "path", required: true, schema: { type: "string", enum: ["user_agreement", "privacy_policy", "help"] } }, { name: "tenantCode", in: "query", required: true, schema: stringSchema }] }),
  clientOperation("get", "/api/client/v1/public/catalog", "getClientPublicCatalog", "Guest catalog for a service published to the mini-program channel (same whitelisted projection as the member catalog)", { responseSchema: "ClientCatalog", authRequired: false, parameters: [{ name: "tenantCode", in: "query", required: true, schema: stringSchema }, { name: "service", in: "query", required: true, schema: stringSchema }] }),
  clientOperation("get", "/api/client/v1/public/website-assets/{tenantCode}/{assetId}", "getClientWebsiteAsset", "Public tenant brand image (logo/favicon/hero/category) by tenantCode + assetId", { rawResponseContentType: "image/*", authRequired: false, parameters: [{ name: "tenantCode", in: "path", required: true, schema: stringSchema }, { name: "assetId", in: "path", required: true, schema: stringSchema }] }),
  clientOperation("get", "/api/client/v1/public/catalog/items/{itemGroupId}/images/{imageId}", "getClientPublicCatalogItemImage", "Guest catalog image for a published service", { rawResponseContentType: "image/*", authRequired: false, parameters: [{ name: "tenantCode", in: "query", required: true, schema: stringSchema }, { name: "service", in: "query", required: true, schema: stringSchema }] }),
  clientOperation("post", "/api/client/v1/auth/challenges", "createClientChallenge", "Create a purpose-bound verification challenge (registration or login)", { requestSchema: "ClientChallengeRequest", responseSchema: "ClientRegistrationChallengeResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/sms-login", "clientSmsLogin", "Login with a login-purpose SMS proof for an already registered phone", { requestSchema: "ClientSmsLoginRequest", responseSchema: "ClientMembershipSessionResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/wechat/phone-login", "clientWechatPhoneLogin", "WeChat mini-program phone-number login; openid and phone are resolved server-side with the merchant AppSecret", { requestSchema: "ClientWechatPhoneLoginRequest", responseSchema: "ClientMembershipSessionResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/wechat/bind", "bindClientWechatIdentity", "Bind the current WeChat identity to the logged-in customer for mini-program payment", { requestSchema: "ClientWechatBindRequest", responseSchema: "ClientWechatBindResponse" }),
  clientOperation("get", "/api/client/v1/auth/closure/preview", "previewClientAccountClosure", "Tenant-wide closure preflight for the current customer", { responseSchema: "ClientAccountClosurePreview" }),
  clientOperation("post", "/api/client/v1/auth/closure/challenge", "createClientClosureChallenge", "Send the closure verification code to the current account phone", { responseSchema: "ClientRegistrationChallengeResponse" }),
  clientOperation("post", "/api/client/v1/auth/closure", "closeClientAccount", "Close the current membership and login account after preflight and SMS proof", { requestSchema: "ClientAccountClosureRequest", responseSchema: "ClientAccountClosureResponse" }),
  clientOperation("post", "/api/client/v1/auth/registration/challenges/{challengeId}/verify", "verifyClientRegistrationChallenge", "Verify a client registration challenge", { requestSchema: "VerifyClientRegistrationChallengeRequest", responseSchema: "VerifyClientRegistrationChallengeResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/register", "registerClientPersonalMembership", "Register a personal client membership", { requestSchema: "ClientPersonalMembershipRegistrationRequest", responseSchema: "ClientPersonalMembershipRegistrationResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/login", "clientLogin", "Login a customer client account", { requestSchema: "ClientMembershipLoginRequest", responseSchema: "ClientMembershipSessionResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/refresh", "refreshClientSession", "Refresh a customer client session", { requestSchema: "ClientRefreshRequest", responseSchema: "ClientMembershipSessionResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/logout", "logoutClientSession", "Revoke a customer client session", { requestSchema: "ClientRefreshRequest", responseSchema: "ClientActionResult", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/switch-workspace", "switchClientWorkspace", "Switch the current customer client session to an authorized workspace", { requestSchema: "ClientSwitchWorkspaceRequest", responseSchema: "ClientMembershipSessionResponse" }),
  clientOperation("get", "/api/client/v1/auth/me", "getClientMe", "Get the current customer client profile", { responseSchema: "ClientMembershipStatus" }),
  clientOperation("post", "/api/client/v1/auth/change-password", "changeClientPassword", "Change the current customer client password", { requestSchema: "ClientChangePasswordRequest", responseSchema: "ClientActionResult" }),
  clientOperation("get", "/api/client/v1/config", "getClientConfig", "Get client-safe workspace configuration and feature availability", { responseSchema: "ClientConfig" }),
  clientOperation("get", "/api/client/v1/payment/capabilities", "getClientPaymentCapabilities", "Get client payment capability status without exposing a provider", { responseSchema: "ClientPaymentCapabilities" }),
  clientOperation("get", "/api/client/v1/profile", "getClientProfile", "Get the current customer profile and masked contact data", { responseSchema: "ClientProfile" }),
  clientOperation("patch", "/api/client/v1/profile", "updateClientProfile", "Update the editable part of the current customer profile", { requestSchema: "ClientProfileUpdateRequest", responseSchema: "ClientProfile" }),
  clientOperation("put", "/api/client/v1/profile", "updateClientProfileViaPut", "PUT alias of the partial profile update for hosts without PATCH support (WeChat mini program)", { requestSchema: "ClientProfileUpdateRequest", responseSchema: "ClientProfile" }),
  clientOperation("get", "/api/client/v1/profile/contacts", "listClientContacts", "List the current customer contacts", { responseSchema: "ClientContacts" }),
  clientOperation("put", "/api/client/v1/profile/contacts", "saveClientContact", "Create or update a current customer contact", { requestSchema: "ClientContactRequest", responseSchema: "ClientContact" }),
  clientOperation("get", "/api/client/v1/profile/addresses", "listClientDeliveryAddresses", "List the current customer's delivery addresses", { responseSchema: "ClientDeliveryAddressList" }),
  clientOperation("put", "/api/client/v1/profile/addresses", "saveClientDeliveryAddress", "Create or update one of the current customer's delivery addresses", { requestSchema: "ClientDeliveryAddressRequest", responseSchema: "ClientDeliveryAddress" }),
  clientOperation("delete", "/api/client/v1/profile/addresses/{addressId}", "deleteClientDeliveryAddress", "Soft-delete one of the current customer's delivery addresses (order snapshots unaffected)", { responseSchema: "ClientActionResult" }),
  clientOperation("delete", "/api/client/v1/profile/contacts/{contactId}", "deleteClientContact", "Deactivate a current customer contact", { responseSchema: "ClientActionResult" }),
  clientOperation("get", "/api/client/v1/membership/status", "getClientMembershipStatus", "Get current customer membership and review status", { responseSchema: "ClientMembershipStatus" }),
  clientOperation("get", "/api/client/v1/notifications", "listClientNotifications", "List notifications for the current customer orders", { responseSchema: "ClientNotificationList", parameters: [queryParam("page", numberSchema), queryParam("pageSize", numberSchema)] }),
  clientOperation("get", "/api/client/v1/membership/booking-options", "listClientBookingOptions", "List personal and enterprise booking identities", { responseSchema: arrayOf(ref("ClientBookingOption")) }),
  clientOperation("get", "/api/client/v1/membership/plans", "listClientMembershipPlans", "List published APP-visible membership plans for the current workspace", { responseSchema: "ClientMembershipPlans" }),
  clientOperation("get", "/api/client/v1/membership/assignments", "listClientMembershipAssignments", "List the current customer's membership plan assignments", { responseSchema: "ClientMembershipAssignments" }),
  clientOperation("get", "/api/client/v1/membership/benefits", "getClientMembershipBenefits", "Resolve personal and optionally selected enterprise benefits", { responseSchema: "ClientMembershipBenefits", parameters: [queryParam("corporateCustomerId", stringSchema)] }),
  ...enterpriseWorkflowOperations(),
  clientOperation("get", "/api/client/v1/enterprise/entry", "readEnterpriseEntry", "Read current personal customer's explicitly granted enterprise access", { responseSchema: "EnterpriseEntryResponse", parameters: [{ ...queryParam("tenantCode"), required: true }] }),
  clientOperation("get", "/api/client/v1/enterprise/corporates/{corporateCustomerId}/members", "readEnterpriseMembers", "Read minimal enterprise members after current members:read authorization", { responseSchema: "EnterpriseMembersResponse", parameters: [{ ...queryParam("tenantCode"), required: true }, queryParam("page", numberSchema), queryParam("pageSize", numberSchema)] }),
  clientOperation("get", "/api/client/v1/enterprise/corporates/{corporateId}/orders", "listEnterpriseOrders", "Read original enterprise orders after current orders:read authorization", {
    responseSchema: "EnterpriseOrdersResponse",
    parameters: ["group", "keyword", "page", "pageSize"].map(name => queryParam(name, ENTERPRISE_COMPONENT_SCHEMAS.EnterpriseOrdersQuery.properties![name]))
  }),
  clientOperation("get", "/api/client/v1/enterprise/corporates/{corporateId}/orders/export-rows", "exportEnterpriseOrderRows", "Read bounded filtered enterprise order rows after current orders:read and export:create authorization", {
    responseSchema: "EnterpriseOrderExportResponse",
    parameters: ["group", "keyword"].map(name => queryParam(name, ENTERPRISE_COMPONENT_SCHEMAS.EnterpriseOrderExportQuery.properties![name]))
  }),
  clientOperation("get", "/api/client/v1/enterprise/corporates/{corporateId}/orders/{orderId}", "readEnterpriseOrder", "Read curated original enterprise order details after current orders:read authorization", {
    responseSchema: "EnterpriseOrderDetailResponse"
  }),
  clientOperation("get", "/api/client/v1/enterprise/corporates/{corporateId}/history-workspaces", "readEnterpriseHistoryWorkspaces", "Read original order workspace evidence within the current trusted client workspace", {
    responseSchema: "RentalEnterpriseHistoryWorkspaceBasis"
  }),
  clientOperation("get", "/api/client/v1/enterprise/corporates/{corporateId}/finance", "readEnterpriseCorporateFinance", "Read original corporate credit account after current finance:read authorization", {
    responseSchema: "RentalEnterpriseCorporateFinancialProjection"
  }),
  clientOperation("get", "/api/client/v1/enterprise/corporates/{corporateId}/orders/{orderId}/finance", "readEnterpriseOrderFinance", "Read original enterprise-paid order finance after current orders:read and finance:read authorization", {
    responseSchema: "RentalEnterpriseOrderFinancialProjection"
  }),
  clientOperation("get", "/api/client/v1/enterprise/corporates/{corporateId}/finance/export-rows", "exportEnterpriseCorporateFinance", "Read a bounded original corporate account projection after current export:create and finance:read authorization", {
    responseSchema: "RentalEnterpriseCorporateFinancialProjection"
  }),
  clientOperation("get", "/api/client/v1/enterprise/corporates/{corporateId}/orders/{orderId}/finance/export-rows", "exportEnterpriseOrderFinance", "Read bounded original enterprise-paid order financial rows after current export:create, orders:read and finance:read authorization", {
    responseSchema: "RentalEnterpriseOrderFinancialProjection"
  }),
  backlogOperation("get", "/api/membership/enterprise-portal/operations/{operationKey}", "Membership", "readEnterprisePortalOperation", "Read current operator original activation result without reapplying it", ["rental-os:corporate:manage"], true, undefined, "EnterprisePortalOperationResponse"),
  backlogOperation("get", "/api/membership/enterprise-portal/settings", "Membership", "readEnterpriseTenantSettings", "Read tenant enterprise portal activation", ["rental-os:corporate:view", "rental-os:corporate:manage"], true, undefined, "EnterpriseTenantSettings"),
  backlogOperation("put", "/api/membership/enterprise-portal/settings", "Membership", "saveEnterpriseTenantSettings", "Change tenant activation with revision and original operation receipt", ["rental-os:corporate:manage"], true, "SaveEnterpriseTenantSettingsRequest", "EnterpriseTenantSettings"),
  backlogOperation("get", "/api/membership/corporate/{corporateCustomerId}/enterprise-portal", "Membership", "readEnterprisePortalConfiguration", "Read explicit corporate activation and grants", ["rental-os:corporate:view", "rental-os:corporate:manage", "rental-os:corporate:employee-manage"], true, undefined, "EnterprisePortalConfiguration"),
  backlogOperation("put", "/api/membership/corporate/{corporateCustomerId}/enterprise-portal", "Membership", "saveEnterprisePortalConfiguration", "Change activation and grants; service additionally requires corporate:manage", ["rental-os:corporate:employee-manage"], true, "SaveEnterprisePortalConfigurationRequest", "EnterprisePortalChangeResult"),
  clientOperation("get", "/api/client/v1/membership/corporates", "listClientCorporateIdentities", "List active enterprise identities available to the current personal member", { responseSchema: "ClientCorporateIdentities" }),
  clientOperation("get", "/api/client/v1/membership/qualification-types", "listClientQualificationTypes", "List qualification types for the current workspace", { responseSchema: arrayOf(objectSchema) }),
  clientOperation("get", "/api/client/v1/membership/qualifications", "listClientQualifications", "List current customer qualification submissions", { responseSchema: arrayOf(objectSchema) }),
  clientOperation("post", "/api/client/v1/membership/qualifications", "submitClientQualification", "Submit a customer qualification for review", { requestSchema: "ClientQualificationRequest", responseSchema: objectSchema }),
  clientOperation("post", "/api/client/v1/membership/qualifications/files", "createClientQualificationUploadSession", "Create a client qualification evidence upload session bound to the current customer", { requestSchema: "ClientQualificationUploadSessionRequest", responseSchema: "FileUploadSessionSummary" }),
  clientOperation("post", "/api/client/v1/membership/qualifications/files/{sessionId}/complete", "completeClientQualificationUpload", "Complete a client qualification evidence upload", { requestSchema: "ClientQualificationUploadCompleteRequest", responseSchema: objectSchema }),
  clientOperation("get", "/api/client/v1/membership/qualifications/files/{fileAssetId}/download-url", "getClientQualificationFileUrl", "Create a short-lived URL for the current customer's qualification evidence", { responseSchema: "FileDownloadUrlSummary" }),
  clientOperation("get", "/api/client/v1/catalog", "getClientCatalog", "Get the current workspace client catalog", { responseSchema: "ClientCatalog" }),
  clientOperation("get", "/api/client/v1/catalog/items/{itemGroupId}/images/{imageId}", "getClientCatalogItemImage", "Get a client-authenticated catalog item image", { responseSchema: { type: "string", format: "binary" }, rawResponseContentType: "image/*" }),
  clientOperation("post", "/api/client/v1/availability", "getClientAvailability", "Check rental availability for the client", { requestSchema: "ClientAvailabilityRequest", responseSchema: objectSchema }),
  clientOperation("post", "/api/client/v1/quotes", "createClientQuote", "Create a server-side client rental quote", { requestSchema: "ClientQuoteRequest", responseSchema: "ClientQuote" }),
  clientOperation("get", "/api/client/v1/quotes/{id}", "getClientQuote", "Get a client rental quote", { responseSchema: "ClientQuote" }),
  clientOperation("get", "/api/client/v1/coupons", "listClientCoupons", "List current customer coupons", { responseSchema: arrayOf(objectSchema) }),
  clientOperation("post", "/api/client/v1/coupons/{templateId}/claim", "claimClientCoupon", "Claim an available customer coupon", { responseSchema: objectSchema }),
  clientOperation("post", "/api/client/v1/orders", "createClientOrder", "Create a rental order from a client quote", { requestSchema: "ClientCreateOrderRequest", responseSchema: "ClientOrderMutation" }),
  clientOperation("get", "/api/client/v1/my/orders", "listClientMyOrders", "Read-only paginated index of this personal customer's orders across the current tenant's workspaces; does not switch session or grant workspace access", { responseSchema: "ClientMyOrdersResponse", parameters: [queryParam("page", { type: "integer", minimum: 1, maximum: 1000000 }), queryParam("pageSize", { type: "integer", minimum: 1, maximum: 50 })] }),
  clientOperation("get", "/api/client/v1/orders", "listClientOrders", "List the current customer orders", { responseSchema: "ClientOrderList", parameters: [queryParam("page", numberSchema), queryParam("pageSize", numberSchema), queryParam("status")] }),
  clientOperation("get", "/api/client/v1/orders/{id}", "getClientOrder", "Get a customer order", { responseSchema: "ClientOrder" }),
  clientOperation("get", "/api/client/v1/orders/{id}/fulfillment", "getClientOrderFulfillment", "Get customer-visible fulfillment and allocation progress", { responseSchema: "ClientFulfillment" }),
  clientOperation("get", "/api/client/v1/orders/{id}/enterprise-handoff-material", "readClientRentalHandoffMaterial", "Read current-workspace own enterprise-order snapshot material only; no current-member fallback, handoff request, acceptance or authority", { responseSchema: "EnterpriseRentalHandoffMaterial" }),
  clientOperation("post", "/api/client/v1/enterprise/orders/{orderId}/handoff-requests", "createClientRentalHandoffRequest", "Record a frozen original own-order handoff request only; no Core/subject/funds/authority change", { requestSchema: "CreateEnterpriseRentalHandoffRequest", responseSchema: "EnterpriseRentalHandoffCreated" }),
  clientOperation("get", "/api/client/v1/enterprise/orders/{orderId}/handoff-requests/create-operations/{key}", "readClientRentalHandoffCreation", "Read this customer's exact original order/K creation receipt, never today's state", { responseSchema: "EnterprisePortalOperationResponse" }),
  clientOperation("get", "/api/client/v1/enterprise/corporates/{corporateId}/membership-audit", "readCorporateMembershipAudit", "Read original corporate command and reader metadata under current audit and data-read grants", {
    responseSchema: "EnterpriseMembershipAudit",
    parameters: [{ name: "readerCursor", in: "query", required: false, schema: { type: "string", minLength: 1, maxLength: 512, pattern: "^[a-zA-Z0-9_-]+$" } }]
  }),
  clientOperation("get", "/api/client/v1/enterprise/handoff-orders", "readClientOriginalHandoffOrders", "Current-workspace original own enterprise-employee rentals eligible for coordination review, including unrequested orders; not an in-flight or funding total", { responseSchema: "EnterpriseRentalHandoffOrderSource" }),
  clientOperation("get", "/api/client/v1/enterprise/handoff-requests", "listClientRentalHandoffs", "Bounded original own handoff requests in the current authenticated workspace", { responseSchema: "EnterpriseRentalHandoffList" }),
  clientOperation("post", "/api/client/v1/enterprise/handoff-requests/{id}/withdraw", "withdrawClientRentalHandoff", "Withdraw the original own pending request only; no Core or funding change", { requestSchema: "WithdrawEnterpriseRentalHandoffRequest", responseSchema: "EnterpriseRentalHandoffWithdrawn" }),
  clientOperation("get", "/api/client/v1/enterprise/handoff-requests/{id}/withdraw-operations/{key}", "readClientRentalHandoffWithdrawal", "Read this customer's exact original request/K withdrawal", { responseSchema: "EnterprisePortalOperationResponse" }),
  clientOperation("get", "/api/client/v1/enterprise/handoff-requests/{id}", "readClientRentalHandoffRequest", "Read an original own handoff request in the current authenticated workspace", { responseSchema: "EnterpriseRentalHandoffView" }),
  clientOperation("get", "/api/client/v1/orders/{id}/documents/{type}", "getClientOrderDocument", "Render a customer-readable order document snapshot for the current member", { responseSchema: "GenericObject" }),
  clientOperation("get", "/api/client/v1/orders/{id}/documents/{type}/versions", "listClientOrderDocumentVersions", "List immutable document versions for the current member order", { responseSchema: "GenericObject" }),
  clientOperation("get", "/api/client/v1/orders/{id}/fee-items", "listClientFeeItems", "Approved inspection charges that need the customer's confirmation or dispute", { responseSchema: "ClientFeeItemsResponse" }),
  clientOperation("post", "/api/client/v1/orders/{id}/fee-items/{inspectionId}/{exceptionIndex}/response", "respondClientFeeItem", "Record the customer's confirmation or dispute for an approved inspection charge (append-only)", { requestSchema: "ClientFeeResponseRequest", responseSchema: "ClientFeeResponseResult" }),
  clientOperation("post", "/api/client/v1/orders/{id}/cancel/preview", "previewClientCancellation", "Preview the existing cancellation charge without cancelling or refunding; final cancellation rechecks state and time", { responseSchema: "ClientCancellationPreview" }),
  clientOperation("post", "/api/client/v1/orders/{id}/cancel", "cancelClientOrder", "Cancel a customer order", { requestSchema: "ClientCancelOrderRequest", responseSchema: "ClientOrderMutation" }),
  clientOperation("get", "/api/client/v1/orders/{id}/extensions", "listClientOrderExtensions", "List customer order extensions", { responseSchema: "ClientExtensionList" }),
  clientOperation("post", "/api/client/v1/orders/{id}/extensions/preview", "previewClientOrderExtension", "Preview a customer order extension", { requestSchema: "ClientOrderExtensionRequest", responseSchema: "ClientExtensionPreview" }),
  clientOperation("post", "/api/client/v1/orders/{id}/extensions", "applyClientOrderExtension", "Apply a customer order extension", { requestSchema: "ClientOrderExtensionRequest", responseSchema: "ClientOrderMutation" }),
  clientOperation("post", "/api/client/v1/orders/{id}/extensions/{extensionId}/pay", "payClientOrderExtension", "Complete a customer order extension after payment", { responseSchema: "ClientOrderMutation" }),
  clientOperation("get", "/api/client/v1/orders/{id}/funding", "getClientOrderFunding", "Get customer order funding status", { responseSchema: "ClientFunding" }),
  clientOperation("post", "/api/client/v1/orders/{id}/funding/simulate", "simulateClientOrderFunding", "Record a development-only simulated customer funding event", { requestSchema: "ClientPaymentSimulationRequest", responseSchema: objectSchema }),
  clientOperation("post", "/api/client/v1/orders/{id}/payment-intents", "createClientPaymentIntent", "Create a real Alipay or WeChat Pay rental payment intent", { requestSchema: "ClientPaymentIntentRequest", responseSchema: "ClientPaymentIntentResponse" }),
  clientOperation("post", "/api/client/v1/orders/{id}/mini-program-payment-intents", "createClientMiniProgramPaymentIntent", "Create a WeChat JSAPI rental payment intent; the payer openid comes only from the server-side WeChat identity binding (409 wechat_identity_required when absent), never from the request body or Native QR parameters", { requestSchema: "ClientMiniProgramPaymentIntentRequest", responseSchema: "ClientPaymentIntentResponse" }),
  clientOperation("get", "/api/client/v1/orders/{id}/payment-intents/{intentId}", "getClientPaymentIntent", "Get the status of a client payment intent", { responseSchema: "ClientPaymentIntentResponse" }),
  clientOperation("post", "/api/client/v1/orders/{id}/payment-intents/{intentId}/refresh", "refreshClientPaymentIntent", "Query the payment provider and reconcile a client payment intent", { responseSchema: "ClientPaymentIntentResponse" }),
  clientOperation("post", "/api/client/v1/orders/{id}/payment-intents/{intentId}/close", "closeClientPaymentIntent", "Close an unpaid client payment intent", { responseSchema: "ClientPaymentIntentResponse" }),
  { method: "get", path: "/api/platform/tenant-bootstrap/category-options", tag: "Platform Rental Core", operationId: "getRentalCategoryOpeningOptions",
    summary: "Read bounded Core-owned options eligible for a new tenant or the specified existing tenant. Published and explicit builtin-demo sources are distinct; metadata does not authorize creation.",
    permissions: ["system:tenant:bootstrap", "system:tenant:manage"],
    parameters: [{ name: "tenantId", in: "query", schema: { type: "string", minLength: 1, maxLength: 191 } }, { name: "search", in: "query", schema: { type: "string", maxLength: 100 } }],
    responseSchema: objectOf({ structureVersion: { type: "integer", enum: [1] }, source: { type: "string", enum: ["published", "builtin_demo"] }, truncated: booleanSchema,
      options: { type: "array", maxItems: 100, items: objectOf({ categoryCode: rentalCategoryCodeSchema, name: { type: "string", maxLength: 100 }, nameEn: { type: "string", maxLength: 100 },
        versionId: { type: "string", maxLength: 191 }, versionLabel: { type: "string", maxLength: 64 }, recommended: booleanSchema, defaultWorkspaceName: { type: "string", maxLength: 100 } },
      ["categoryCode", "name", "recommended", "defaultWorkspaceName"], false) } }, ["structureVersion", "source", "truncated", "options"], false) }
];
