/** Rental-owned AI tables and relationship extensions for one host Client.
 * Fixed public AI and Rental inputs are mandatory. SQL execution ordering stays
 * with the deployment host; this module does not manufacture migration receipts. */
import { createHash } from "node:crypto";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { composeCorePrismaSchema, type CorePrismaContribution } from "@rental-os/core-contracts/prisma";
import { mysqlForeignKeyExtension, mysqlMigrationStatements, mysqlStructureFromMigrations,
  type MysqlForeignKeyExtension } from "@rental-os/platform-core-host/mysql-structure";
import { readMysqlPhysicalData } from "@rental-os/platform-core-host/mysql-physical";
import { RENTAL_PRISMA_PUBLIC_RELATIONS } from "@rental-os/rental-core/prisma-schema";
import { composePublicAiPrismaSchema, PUBLIC_AI_DATA_VERSION, type PublicAiDataContribution } from "@rental-os/ai-native-data/public-data";
import { createPublicAiMysqlDataPlan } from "@rental-os/ai-native-data/public-mysql-data";

export const RENTAL_AI_EXTENSION_FILES = [
  {
    "file": "prisma/ai-extension/schema.prisma",
    "sha256": "8f22ea1360c7a58752505b511d83936b225465d20836690d38f35e8020b1fcb3"
  },
  {
    "file": "prisma/ai-extension/20261126000000-initial.sql",
    "sha256": "b9bea1ba30d872a76309a9f7d93125b6da3712bdedfc7209f7bec59dbe723962"
  },
  {
    "file": "prisma/ai-extension/provenance.json",
    "sha256": "14cdd718bec9a647d8ed36af83993950b412896db6a5f306ecd3d74987e4f109"
  }
] as const;
export const RENTAL_AI_EXTENSION_MIGRATION = { id: "rental.20261126000000-ai-extension", ...RENTAL_AI_EXTENSION_FILES[1] } as const;
export const RENTAL_AI_EXTENSION_PREREQUISITES = {
  publicAi: { minInclusive: PUBLIC_AI_DATA_VERSION, maxExclusive: "0.2.1" },
  rental: { minInclusive: "0.1.0", maxExclusive: "0.1.2",
    initial: { id: "rental.20261119030000-initial", sha256: "59e69aadf4db0138561ec9233955941da32a2f27f576583bd7915b9f1a7d05ae" } }
} as const;
const rentalRelations = {
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
} as const;
const publicRelations = {
  "AiClientSceneMaterial": [
    "workspace       BusinessWorkspace @relation(fields: [tenantId, workspaceId], references: [tenantId, id], onDelete: Restrict, onUpdate: Restrict, map: \"ai_client_materials_workspace_fk\")",
    "bookingDrafts   AiClientBookingDraft[]"
  ],
  "AiClientTaskPolicy": [
    "workspace    BusinessWorkspace @relation(fields: [tenantId, workspaceId], references: [tenantId, id], onDelete: Restrict, onUpdate: Restrict, map: \"ai_client_task_policy_workspace_fk\")"
  ],
  "AiAutomationSubject": [
    "workspace             BusinessWorkspace @relation(fields: [tenantId, workspaceId], references: [tenantId, id], onDelete: Restrict, onUpdate: Restrict, map: \"ai_automation_subject_workspace_fk\")"
  ],
  "AiAutomationInput": [
    "event                 AiBusinessFailureOutbox @relation(fields: [tenantId, workspaceId, eventId], references: [tenantId, workspaceId, id], onDelete: Restrict, onUpdate: Restrict, map: \"ai_automation_input_event_fk\")"
  ],
  "AiKnowledgePolicyManagementAuthority": [
    "workspace           BusinessWorkspace @relation(fields: [tenantId, workspaceId], references: [tenantId, id], onDelete: Restrict, onUpdate: Restrict, map: \"ai_kp_authority_workspace_fk\")"
  ],
  "AiTaskOriginalRequest": [
    "quoteSelections          AiTaskQuoteSelection[]"
  ],
  "AiScope": [
    "workspace   BusinessWorkspace? @relation(fields: [tenantId, workspaceId], references: [tenantId, id], onDelete: Restrict, onUpdate: Restrict)"
  ],
  "AiRun": [
    "quoteSelections    AiTaskQuoteSelection[]",
    "reprepareTargets   AiApprovalReprepare[]"
  ],
  "AiStep": [
    "reprepareTargets    AiApprovalReprepare[]"
  ],
  "AiProposalVersion": [
    "originalReprepares AiApprovalReprepare[] @relation(\"AiReprepareOriginal\")",
    "replacementReprepares AiApprovalReprepare[] @relation(\"AiReprepareReplacement\")"
  ],
  "AiProposalAction": [
    "snapshots          AiApprovedOrderSnapshot[]",
    "reprepares         AiApprovalReprepare[]"
  ],
  "FileAsset": [
    "aiInspectionBindings AiInspectionEvidenceBinding[]"
  ]
} as const;
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export interface RentalAiDataExtension {
  readonly owner: "rental";
  readonly schema: string;
  readonly sql: string;
}

export function readRentalAiDataExtension(files: ReadonlyMap<string, Uint8Array>): RentalAiDataExtension {
  const content = new Map<string, string>();
  for (const asset of RENTAL_AI_EXTENSION_FILES) {
    const bytes = files.get(asset.file);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 32 * 1024 * 1024 || hash(bytes) !== asset.sha256)
      throw new Error("Rental AI 固定扩展材料缺失或变化");
    content.set(asset.file, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  for (const file of files.keys()) if (file.startsWith("prisma/ai-extension/") && !content.has(file))
    throw new Error("Rental AI 扩展包含未登记材料");
  return Object.freeze({ owner: "rental", schema: content.get(RENTAL_AI_EXTENSION_FILES[0].file)!,
    sql: content.get(RENTAL_AI_EXTENSION_FILES[1].file)! });
}

function assertRentalAiDataExtension(extension: RentalAiDataExtension): void {
  if (extension.owner !== "rental" || hash(extension.schema) !== RENTAL_AI_EXTENSION_FILES[0].sha256
    || hash(extension.sql) !== RENTAL_AI_EXTENSION_MIGRATION.sha256)
    throw new Error("Rental AI 扩展材料已变化");
}

/** The generic composer requires relation targets in this same contribution.
 * Bundle Rental's own models with its AI extension before adding back-references. */
export function createRentalAiPrismaContribution(rentalSchema: string, extension: RentalAiDataExtension): CorePrismaContribution {
  assertRentalAiDataExtension(extension);
  if (hash(rentalSchema) !== "08dd7ecebeb5cc1f4a389ee13e062501e89cd7e5ef86bb821e9d58eaf050f7b1")
    throw new Error("Rental AI 组合的原 Rental schema 已变化");
  let schema = rentalSchema;
  for (const [name, fields] of Object.entries(rentalRelations)) {
    const block = [...schema.matchAll(/^model (\w+) \{[\s\S]*?^\}/gm)].find(match => match[1] === name);
    if (!block) throw new Error("Rental AI 关系缺少原业务模型");
    const existing = new Set(block[0].split(/\r?\n/).flatMap(line => /^\s*(\w+)\s+\w/.exec(line)?.[1] ?? []));
    if (fields.some(field => existing.has(field.split(/\s/)[0]))) throw new Error("Rental AI 关系已存在");
    schema = schema.replace(block[0], block[0].slice(0, -1) + fields.map(field => "  " + field).join("\n") + "\n}");
  }
  const relations: Record<string, readonly string[]> = { ...RENTAL_PRISMA_PUBLIC_RELATIONS };
  for (const [name, fields] of Object.entries(publicRelations)) relations[name] = [...(relations[name] ?? []), ...fields];
  return { id: "rental", schema: schema + "\n" + extension.schema, publicRelations: relations };
}

export function composeRentalPublicAiPrismaSchema(base: string, ai: PublicAiDataContribution,
  rentalSchema: string, extension: RentalAiDataExtension): string {
  return composeCorePrismaSchema(composePublicAiPrismaSchema(base, ai), [createRentalAiPrismaContribution(rentalSchema, extension)]);
}

/** Observe the public tables with their selected keys and the Rental-owned
 * tables separately. Registration of the extension's receipt needs the host's
 * ordered deployment contract; physical evidence alone cannot mark it applied. */
export function createRentalAiMysqlPlans(ai: PublicAiDataContribution, extension: RentalAiDataExtension) {
  assertRentalAiDataExtension(extension);
  const created = new Set<string>(), own: string[] = [], keys: MysqlForeignKeyExtension[] = [];
  for (const sql of mysqlMigrationStatements(extension.sql)) {
    const create = /^CREATE TABLE `([^`]+)`/iu.exec(sql);
    if (create) created.add(create[1]);
    const alter = /^ALTER TABLE `([^`]+)`/iu.exec(sql);
    if (alter && !created.has(alter[1])) keys.push(mysqlForeignKeyExtension(sql));
    else own.push(sql);
  }
  const expected = mysqlStructureFromMigrations([own.join(";\n") + ";"]);
  return {
    publicAi: createPublicAiMysqlDataPlan(ai, keys),
    extension: {
      installation: "fresh-public" as const, owner: extension.owner, migration: { ...RENTAL_AI_EXTENSION_MIGRATION },
      prerequisites: structuredClone(RENTAL_AI_EXTENSION_PREREQUISITES), sql: extension.sql,
      readPhysical: (database: Pick<CoreHostSqlTransaction, "$queryRaw">) => readMysqlPhysicalData(database, expected, PUBLIC_AI_DATA_VERSION)
    }
  };
}
