/** Original AI relation back-references on the already-composed public + Rental base.
 * No host scalar, key, index or existing relation is changed. */
import type { CorePrismaPublicRelations } from "@rental-os/core-contracts/prisma";

export const AI_NATIVE_PRISMA_BASE_RELATIONS = {
  "Tenant": [
    "aiModelConfiguration              AiTenantModelConfiguration?",
    "aiCreditAllowance                 AiTenantAiAllowance[]",
    "aiCreditRequests                  AiTenantAiCreditRequest[]",
    "aiScopes                          AiScope[]"
  ],
  "BusinessWorkspace": [
    "aiInspectionDrafts                AiInspectionDraft[]",
    "aiBusinessFailureEvents           AiBusinessFailureOutbox[]",
    "aiAutomationSubjects              AiAutomationSubject[]",
    "aiKnowledgePolicyAuthorities      AiKnowledgePolicyManagementAuthority[]",
    "aiClientSceneMaterials            AiClientSceneMaterial[]",
    "aiClientTaskPolicies              AiClientTaskPolicy[]",
    "aiInspectionEvidenceBindings      AiInspectionEvidenceBinding[]",
    "aiScopes                          AiScope[]"
  ],
  "RentalCoreStateSnapshot": [
    "aiFailureConfigurationEvents AiBusinessFailureOutbox[] @relation(\"AiFailureConfigurationSnapshot\")"
  ],
  "FileAsset": [
    "aiInspectionBindings AiInspectionEvidenceBinding[]"
  ],
  "TenantRentalProfile": [
    "aiFailureConfigurationEvents AiBusinessFailureOutbox[] @relation(\"AiFailureConfigurationProfile\")"
  ],
  "RentalFulfillmentLocation": [
    "aiFailureLocationEvents AiBusinessFailureOutbox[] @relation(\"AiFailureLocation\")"
  ],
  "RentalOrder": [
    "aiFailureFulfillmentEvents AiBusinessFailureOutbox[] @relation(\"AiFailureFulfillment\")"
  ],
  "RentalPaymentRefund": [
    "aiFailureEvents  AiBusinessFailureOutbox[] @relation(\"AiFailureRefund\")"
  ],
  "RentalInspectionRecord": [
    "failureEvents     AiBusinessFailureOutbox[] @relation(\"AiFailureInspection\")"
  ],
  "RentalTenantBusinessSettings": [
    "aiFailureConfigurationEvents AiBusinessFailureOutbox[] @relation(\"AiFailureConfigurationSettings\")"
  ],
  "RentalNotificationLog": [
    "aiFailureEvents      AiBusinessFailureOutbox[]  @relation(\"AiFailureNotification\")"
  ]
} as const satisfies CorePrismaPublicRelations;
