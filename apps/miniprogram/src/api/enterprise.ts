/** 原客户运输供给当前会话与范围，业务请求由 Rental 小程序工厂维护。 */
import { createRentalMiniProgramEnterpriseApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "../core/http";

export const {
  fetchEnterpriseExchangeChoices,
  requestEnterpriseExchangeApproval,
  readEnterpriseExchangeRequestOriginal,
  closeEnterpriseExchangeRequest,
  confirmEnterpriseExchangeExpense,
  readEnterpriseExchangeConfirmation,
  fetchEnterpriseOrderExchangeApprovals,
  fetchEnterpriseExtensionEligibility,
  readEnterpriseExtensionRequestOriginal,
  closeEnterpriseExtensionRequest,
  fetchEnterpriseExtensionApprovals,
  requestEnterpriseExtensionApproval,
  submitEnterpriseExtensionApproval,
  closeEnterpriseExtensionExecution,
  readEnterpriseExtensionResult,
  fetchEnterpriseRentalPolicies,
  fetchEnterpriseApprovals,
  requestEnterpriseApproval,
  submitEnterpriseApproval,
  readEnterpriseOperation,
  readEnterpriseApprovalResult,
  createEnterpriseOrder,
  readEnterpriseOrderOriginal,
  issueEnterpriseOrderDelegation,
  readEnterpriseOrderDelegation,
  revokeEnterpriseOrderDelegation,
} = createRentalMiniProgramEnterpriseApi({ request });
