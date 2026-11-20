/** 原页面入口。绑定同一 Core 编排实例，微信 I/O 和会话继续由宿主供给。 */
import { createRentalMiniProgramExtensionOperation } from "@rental-os/rental-core/clients/miniprogram";
import { enterpriseExtensionRequestMatches, enterpriseExtensionRequestClosureMatches } from "../vendor/shared-enterprise-expense/enterprise-expense";
import { fetchEnterpriseExtensionApprovals, readEnterpriseExtensionRequestOriginal, readEnterpriseExtensionResult, readEnterpriseOperation, requestEnterpriseExtensionApproval, submitEnterpriseExtensionApproval, closeEnterpriseExtensionExecution, closeEnterpriseExtensionRequest } from "../api/enterprise";
import { PUBLIC_CONFIG } from "../config/public";
import { newKey } from "./keys";
import { contextVersion, currentServiceCode, currentSession } from "./session";
import { STORAGE_KEYS, writeRequiredStorage } from "./storage";

export const enterpriseExtensionOperation = createRentalMiniProgramExtensionOperation({
  currentSession, currentServiceCode, contextVersion, publicConfig: PUBLIC_CONFIG,
  enterpriseOperationsKey: STORAGE_KEYS.enterpriseOperations, newKey,
  storage: {
    read: key => wx.getStorageSync(key),
    writeRequired: writeRequiredStorage,
    remove: key => wx.removeStorageSync(key),
  },
  api: { fetchEnterpriseExtensionApprovals, readEnterpriseExtensionRequestOriginal, readEnterpriseExtensionResult, readEnterpriseOperation, requestEnterpriseExtensionApproval, submitEnterpriseExtensionApproval, closeEnterpriseExtensionExecution, closeEnterpriseExtensionRequest },
  contracts: { enterpriseExtensionRequestMatches, enterpriseExtensionRequestClosureMatches },
});
