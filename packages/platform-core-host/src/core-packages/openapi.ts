/** Core 包管理的同版本接口片段，路径复用实际 Controller 的协议常量。
 * 资料描述当前校验与原结果读取，不登记路由、不授予权限或执行包与迁移。 */
import {
  CORE_PACKAGE_FILE_LIMIT, CoreArtifactHashSchema, CoreDataContractSchema, CoreDeploymentLockSchema,
  CoreIdSchema, CoreManifestSchema, CoreMigrationSchema, CorePackagePathSchema, CorePlatformDataCapabilityReleaseSchema,
  CoreRegisteredSummarySchema, CoreReleaseVersionSchema, CoreSourceSchema, CoreVersionRangeSchema,
  coreOpenApiSchema, type CoreOpenApiContribution, type PlatformOpenApiDocument
} from "@rental-os/core-contracts";
import { GitHubCoreDiscoveryQuerySchema } from "@rental-os/core-contracts/github-discovery";
import { GitHubCoreReleasePinSchema, GitHubCoreReleaseSelectionSchema, GitHubCoreRepositorySchema } from "@rental-os/core-contracts/github";
import { CORE_PACKAGE_HTTP, CORE_PACKAGE_HTTP_BASE } from "../core-package-ports";
import { CORE_PACKAGE_PREFLIGHT_HTTP, CorePackageInspectRequestSchema, CorePackageUpdatePlanRequestSchema } from "../core-package-preflight/ports";
import { CORE_PACKAGE_SELECTION_HTTP } from "../core-package-selection/protocol";
import { CorePackageReleaseReceiptRequestSchema, CorePackageReleaseReferenceSchema } from "../core-package-selection/ports";
import { CORE_PACKAGE_PREPARATION_HTTP } from "../core-package-preparation/protocol";
import { CorePackagePreparationRequestSchema, CorePackagePrepareRequestSchema, CorePackagePreparationQuerySchema } from "../core-package-preparation/ports";

type Schema = Record<string, unknown>;
const namespace = "PlatformCorePackage";
const text: Schema = { type: "string" };
const flag: Schema = { type: "boolean" };
const integer: Schema = { type: "integer" };
const timestamp: Schema = { type: "string", format: "date-time" };
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${namespace}.${name}` });
const list = (items: Schema): Schema => ({ type: "array", items });
const values = (...options: Array<string | number | boolean>): Schema => ({ type: typeof options[0], enum: options });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema =>
  ({ type: "object", properties, required, additionalProperties: false });
const variants = (...oneOf: Schema[]): Schema => ({ oneOf });
const nullableObject = (name: string): Schema => variants(ref(name), { type: "object", nullable: true, enum: [null] });
const extend = (base: Schema, properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  ...base, properties: { ...base.properties as Record<string, Schema>, ...properties },
  required: [...(base.required as string[] | undefined ?? []), ...required]
});

function schemas(): CoreOpenApiContribution["schemas"] {
  const sha256 = coreOpenApiSchema(CoreArtifactHashSchema);
  const version = coreOpenApiSchema(CoreReleaseVersionSchema);
  const coreId = coreOpenApiSchema(CoreIdSchema);
  const range = { ...coreOpenApiSchema(CoreVersionRangeSchema.innerType()),
    description: "包含 minInclusive，不包含 maxExclusive。原版本合同要求上限大于下限。" };
  const packagePath = { ...coreOpenApiSchema(CorePackagePathSchema.innerType()),
    description: "由原路径合同校验包内可移植相对路径，禁止绝对路径、上级目录、链接语法和保留文件名。" };
  const source = extend(coreOpenApiSchema(CoreSourceSchema.omit({ repository: true })), {
    repository: { ...coreOpenApiSchema(CoreSourceSchema.shape.repository.innerType()),
      description: "原来源合同只接受不含凭据、查询或片段的 HTTPS 仓库地址。" }
  });
  const compatibility = object({ platform: ref("VersionRange"), contract: ref("VersionRange") });
  const migration = extend(coreOpenApiSchema(CoreMigrationSchema.omit({ file: true })), { file: ref("PackagePath") });
  const data = extend(coreOpenApiSchema(CoreDataContractSchema.innerType().omit({ readable: true, migrations: true })), {
    readable: ref("VersionRange"), migrations: { ...list(ref("Migration")), maxItems: 1000 }
  });
  data.description = "迁移标识和文件各自唯一，当前实现能够读取自己的数据版本。摘要沿原不可变迁移链核验。";
  const manifest = extend(coreOpenApiSchema(CoreManifestSchema.innerType().omit({
    source: true, compatibility: true, runtime: true, entries: true, data: true, requires: true, assets: true
  })), {
    source: ref("Source"), compatibility: ref("Compatibility"), runtime: object({ node: ref("VersionRange") }),
    entries: object(Object.fromEntries(Object.keys(CoreManifestSchema.innerType().shape.entries.shape)
      .map(name => [name, ref("PackagePath")])), ["server"]),
    data: ref("DataContract"),
    requires: { ...list(extend(coreOpenApiSchema(CoreManifestSchema.innerType().shape.requires.element.omit({ version: true })), {
      version: ref("VersionRange")
    })), maxItems: 100 },
    assets: { ...list(ref("PackagePath")), maxItems: CORE_PACKAGE_FILE_LIMIT - 1 }
  }, ["source", "compatibility", "runtime", "entries", "data", "requires"]);
  manifest.description = "权限和必需能力声明各自唯一，同时提供租户和容器绑定要求接入合同 0.1.1 或更新版本。清单由原 CoreManifestSchema 核验。";
  const registered = extend(coreOpenApiSchema(CoreRegisteredSummarySchema.omit({ source: true, compatibility: true })), {
    source: ref("Source"), compatibility: ref("Compatibility")
  });
  const capability = extend(coreOpenApiSchema(CorePlatformDataCapabilityReleaseSchema.innerType().omit({
    source: true, compatibility: true, runtime: true, schema: true, files: true, data: true, prerequisites: true
  })), {
    source: ref("Source"), compatibility: ref("Compatibility"), runtime: object({ node: ref("VersionRange") }),
    schema: ref("PackageFile"), files: { ...list(ref("PackageFile")), minItems: 1, maxItems: CORE_PACKAGE_FILE_LIMIT },
    data: ref("DataContract"), prerequisites: object({ platform: ref("VersionRange"),
      cores: { ...list(object({ coreId, version: ref("VersionRange"), migrations: {
        ...list(coreOpenApiSchema(CoreMigrationSchema.pick({ id: true, sha256: true }))), maxItems: 1000
      } }, ["coreId", "version"])), maxItems: 100 }
    })
  });
  capability.description = "完整包文件和数据前置 Core 各自唯一，schema 与迁移摘要须在文件清单中相符，迁移使用所属能力命名空间并保留 schema 文件。原能力发行合同执行这些跨字段校验。";
  const lock = extend(coreOpenApiSchema(CoreDeploymentLockSchema.innerType().pick({ lockVersion: true })), {
    platform: ref("PlatformRelease"), cores: list(ref("CorePin")),
    dataCapabilities: { ...list(ref("CapabilityRelease")), maxItems: 100 }
  }, ["platform", "cores"]);
  lock.description = "固定组合中的 Core 标识和数据能力标识分别唯一。省略 dataCapabilities 表示原未选装组合。";
  const repository = { ...coreOpenApiSchema(GitHubCoreRepositorySchema.innerType()),
    description: "使用 https://github.com/owner/repository 规范地址，不带 .git 后缀，仓库名不能是 . 或 ..。" };
  const releaseSelection = extend(coreOpenApiSchema(GitHubCoreReleaseSelectionSchema.innerType().omit({ repository: true })), {
    repository: ref("RepositoryURL")
  });
  releaseSelection.description = "Tag 与版本对应，使用 v<版本> 或 <Core ID>/v<版本>，由原发行选择合同核验。";
  const releasePin = extend(coreOpenApiSchema(GitHubCoreReleasePinSchema.innerType().omit({ repository: true })), {
    repository: ref("RepositoryURL")
  });
  releasePin.description = "固定 Tag、解析后的提交、Release/资产 ID、包长度和 SHA-256。Tag 与版本的关联沿原发行合同核验。";
  const query = extend(coreOpenApiSchema(GitHubCoreDiscoveryQuerySchema.omit({ text: true })), {
    text: { type: "string", maxLength: 80, default: "", "x-normalization": "trim",
      description: "原 Unicode 关键词合同接受文字、数字、空格及 . _ -，拒绝 GitHub 查询表达式。" }
  }, []);
  const failure = object({ code: text, message: text, retryAfterSeconds: integer }, ["code", "message"]);
  const unavailable = object({ status: values("unavailable"), error: ref("ReadFailure") });
  const issue = object({ owner: text, code: text, field: text, message: text });
  const availability = variants(object({ status: values("available") }),
    object({ status: values("unavailable"), issues: list(ref("UpdateIssue")) }));
  const versions = variants(ref("Unavailable"), object({ status: values("observed"),
    platform: object({ locked: ref("PlatformRelease"), current: nullableObject("PlatformRelease"), availability: ref("Availability") }),
    cores: list(object({ locked: ref("CorePin"), current: nullableObject("CorePin"), registered: flag, availability: ref("Availability") })),
    dataCapabilities: list(object({ locked: ref("CapabilityRelease"), current: nullableObject("CapabilityRelease"), availability: ref("Availability") }))
  }, ["status", "platform", "cores"]));
  const catalogue = object({ checkedAt: timestamp, registered: list(ref("RegisteredCore")), versions: ref("Versions") });
  const discoveryPage = object({ topic: values("nativark-core"), query: ref("DiscoveryQuery"), pageSize: values(20),
    checkedAt: timestamp, total: { ...integer, minimum: 0 }, incomplete: flag, nextPage: { ...integer, nullable: true },
    repositories: { ...list(object({ id: { ...integer, minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, name: text, repository: ref("RepositoryURL"),
      description: { ...text, nullable: true }, license: { ...text, nullable: true }, updatedAt: timestamp,
      review: values("unreviewed"), package: values("unchecked") })), maxItems: 20 }
  });
  const discovery = variants(object({ status: values("fresh", "cached"), page: ref("DiscoveryPage") }),
    object({ status: values("unavailable"), error: ref("ReadFailure"), stale: ref("DiscoveryPage") }, ["status", "error"]));
  const repositoryCore = object({ manifestFile: ref("PackagePath"), manifest: ref("Manifest"),
    releaseSelection: ref("ReleaseSelection"), release: ref("ReleasePin"),
    state: values("metadata_only", "release_available", "source_only", "invalid", "unavailable"),
    review: values("unreviewed"), package: values("unchecked"),
    issues: list(object({ code: text, field: text, message: text, retryAfterSeconds: integer }, ["code", "message"]))
  }, ["manifestFile", "state", "review", "package", "issues"]);
  const repositoryRead = variants(ref("Unavailable"), object({ status: values("observed"),
    inspection: object({ repository: ref("RepositoryURL"), commit: coreOpenApiSchema(CoreSourceSchema.shape.commit),
      checkedAt: timestamp, state: values("identified", "no_manifest", "invalid", "partial"), cores: list(ref("RepositoryCore")) }),
    compatibility: list(object({ manifestFile: ref("PackagePath"), status: values("checked", "unavailable"),
      issues: list(object({ coreId, code: values("duplicate_core", "platform_version", "contract_version", "node_version", "missing_capability", "capability_version"),
        field: text, message: text })) }))
  }));
  const artifact = variants(object({ kind: values("core"), pin: ref("CorePin") }),
    object({ kind: values("platform"), release: ref("PlatformRelease") }),
    object({ kind: values("platform-capability"), release: ref("CapabilityRelease") }));
  const inspection = object({ ok: flag, scope: values("package-static"), compatibilityChecked: flag,
    manifest: ref("Manifest"), issues: list(object({ code: text, file: text, field: text, message: text }, ["code", "file", "message"]))
  }, ["ok", "scope", "compatibilityChecked", "issues"]);
  const inspected = object({ status: values("inspected"), reference: ref("ArtifactReference"), checkedAt: timestamp,
    review: values("unreviewed"), artifact: ref("Artifact"), inspection: ref("PackageInspection") });
  const planResult = variants(
    object({ ok: values(false), scope: values("install-preflight", "update-preflight"), issues: list(ref("UpdateIssue")) }),
    object({ ok: values(true), scope: values("install-preflight"), status: values("unchanged", "candidate"),
      candidate: ref("DeploymentLock"), initialMigrations: list(ref("Migration")) }),
    object({ ok: values(true), scope: values("update-preflight"), status: values("unchanged", "candidate", "migration_required"),
      candidate: ref("DeploymentLock"), migrations: list(object({ owner: text, fromVersion: version, toVersion: version, entries: list(ref("Migration")) })) })
  );
  const planned = extend(inspected, { plan: variants(ref("Unavailable"), object({ status: values("checked"),
    deployment: values("pending"), result: ref("PlanResult") })) });
  const releaseReference = coreOpenApiSchema(CorePackageReleaseReferenceSchema);
  const selected = object({ format: values("core-release-reference-1"), reference: ref("ReleaseReference"), selectedAt: timestamp,
    release: ref("ReleasePin"), review: values("unreviewed"), package: values("unchecked") });
  selected.description = "reference 由完整 Release pin 的原确定性指纹生成，同一引用只追加同一发行记录。";
  const preparationPlan = object({ format: values("core-preparation-1"), deployment: values("pending"),
    request: ref("PreparationRequest"), artifact: ref("Artifact"), base: ref("DeploymentLock"), candidate: ref("DeploymentLock"),
    files: list(object({ file: { type: "string", minLength: 1, maxLength: 1024,
      description: "原候选路径合同逐段校验受控相对路径，排除 .git、node_modules 和实际环境配置。大小写归一后的文件路径唯一。" },
      sizeBytes: { ...integer, minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, sha256 }))
  });
  const preparationRecord = object({ sha256, preparedAt: timestamp, plan: ref("PreparationPlan") });
  preparationRecord.description = "sha256 对应完整候选 plan 的原确定性指纹，回读同时核对候选锁和全部文件字节。";
  return {
    [`${namespace}.VersionRange`]: range,
    [`${namespace}.PackagePath`]: packagePath,
    [`${namespace}.Source`]: source,
    [`${namespace}.Compatibility`]: compatibility,
    [`${namespace}.Migration`]: migration,
    [`${namespace}.DataContract`]: data,
    [`${namespace}.Manifest`]: manifest,
    [`${namespace}.RegisteredCore`]: registered,
    [`${namespace}.PackageFile`]: object({ file: ref("PackagePath"), sha256 }),
    [`${namespace}.CapabilityRelease`]: capability,
    [`${namespace}.CorePin`]: object({ manifest: ref("Manifest"), sha256 }),
    [`${namespace}.PlatformRelease`]: object({ versions: object({ platform: version, contract: version, node: version,
      capabilities: { type: "object", additionalProperties: version } }), source: ref("Source"), sha256, data: ref("DataContract") }),
    [`${namespace}.DeploymentLock`]: lock,
    [`${namespace}.RepositoryURL`]: repository,
    [`${namespace}.ReleaseSelection`]: releaseSelection,
    [`${namespace}.ReleasePin`]: releasePin,
    [`${namespace}.DiscoveryQuery`]: query,
    [`${namespace}.ReadFailure`]: failure,
    [`${namespace}.Unavailable`]: unavailable,
    [`${namespace}.UpdateIssue`]: issue,
    [`${namespace}.Availability`]: availability,
    [`${namespace}.Versions`]: versions,
    [`${namespace}.Catalogue`]: catalogue,
    [`${namespace}.DiscoveryPage`]: discoveryPage,
    [`${namespace}.DiscoveryResult`]: discovery,
    [`${namespace}.RepositoryCore`]: repositoryCore,
    [`${namespace}.RepositoryRead`]: repositoryRead,
    [`${namespace}.ArtifactReference`]: (coreOpenApiSchema(CorePackageInspectRequestSchema).properties as Record<string, Schema>).reference,
    [`${namespace}.Artifact`]: artifact,
    [`${namespace}.PackageInspection`]: inspection,
    [`${namespace}.InspectedArtifact`]: inspected,
    [`${namespace}.ArtifactRead`]: variants(ref("Unavailable"), ref("InspectedArtifact")),
    [`${namespace}.PlanResult`]: planResult,
    [`${namespace}.PlanRead`]: variants(ref("Unavailable"), planned),
    [`${namespace}.ReleaseReference`]: releaseReference,
    [`${namespace}.SelectedRelease`]: selected,
    [`${namespace}.ReleasePreview`]: variants(ref("Unavailable"), object({ status: values("inspected"),
      reference: ref("ReleaseReference"), release: ref("ReleasePin"), checkedAt: timestamp,
      review: values("unreviewed"), package: values("unchecked") })),
    [`${namespace}.ReleaseSelectResult`]: variants(ref("Unavailable"),
      object({ status: values("unknown"), reference: ref("ReleaseReference"), error: ref("ReadFailure") }),
      object({ status: values("selected", "already_selected"), record: ref("SelectedRelease") })),
    [`${namespace}.ReleaseReferenceRead`]: variants(ref("Unavailable"),
      object({ status: values("absent"), reference: ref("ReleaseReference") }),
      object({ status: values("recorded"), record: ref("SelectedRelease") })),
    [`${namespace}.PreparationPlan`]: preparationPlan,
    [`${namespace}.PreparationRecord`]: preparationRecord,
    [`${namespace}.PreparationPreview`]: variants(ref("Unavailable"), object({ status: values("ready"), sha256, plan: ref("PreparationPlan") })),
    [`${namespace}.PreparationResult`]: variants(ref("Unavailable"),
      object({ status: values("unknown"), sha256, error: ref("ReadFailure") }),
      object({ status: values("prepared", "already_prepared"), record: ref("PreparationRecord") })),
    [`${namespace}.PreparationRead`]: variants(ref("Unavailable"), object({ status: values("recorded"), record: ref("PreparationRecord") })),
    [`${namespace}.DiscoverRequest`]: object({ query: ref("DiscoveryQuery"), refresh: { ...flag, default: false } }, ["query"]),
    [`${namespace}.RepositoryRequest`]: object({ repository: ref("RepositoryURL"), includeReleases: { ...flag, default: false } }, ["repository"]),
    [`${namespace}.InspectRequest`]: coreOpenApiSchema(CorePackageInspectRequestSchema),
    [`${namespace}.UpdateRequest`]: coreOpenApiSchema(CorePackageUpdatePlanRequestSchema),
    [`${namespace}.SelectReleaseRequest`]: object({ release: ref("ReleasePin") }),
    [`${namespace}.ReleaseReceiptRequest`]: coreOpenApiSchema(CorePackageReleaseReceiptRequestSchema),
    [`${namespace}.PreparationRequest`]: coreOpenApiSchema(CorePackagePreparationRequestSchema),
    [`${namespace}.PrepareRequest`]: coreOpenApiSchema(CorePackagePrepareRequestSchema),
    [`${namespace}.PreparationQuery`]: coreOpenApiSchema(CorePackagePreparationQuerySchema)
  };
}

/** 四组模块全部登记后由宿主组合此片段，记录与实体结果沿原 requestId 包装。 */
export function createCorePackageOpenApi(): CoreOpenApiContribution {
  const operations: Array<{ id: string; route: { method: string; path: string }; summary: string;
    request?: string; response: string; effect: "read" | "write" }> = [
    { id: "catalogue", route: CORE_PACKAGE_HTTP.catalogue, summary: "读取当前 Core 目录和实际版本证据", response: "Catalogue", effect: "read" },
    { id: "discover", route: CORE_PACKAGE_HTTP.discover, summary: "分页发现 GitHub Topic 仓库", request: "DiscoverRequest", response: "DiscoveryResult", effect: "read" },
    { id: "repository", route: CORE_PACKAGE_HTTP.repository, summary: "核对仓库固定提交、清单和发行", request: "RepositoryRequest", response: "RepositoryRead", effect: "read" },
    { id: "inspect", route: CORE_PACKAGE_PREFLIGHT_HTTP.inspect, summary: "检查宿主登记的固定包", request: "InspectRequest", response: "ArtifactRead", effect: "read" },
    { id: "install", route: CORE_PACKAGE_PREFLIGHT_HTTP.install, summary: "预检新增 Core 安装组合", request: "InspectRequest", response: "PlanRead", effect: "read" },
    { id: "update", route: CORE_PACKAGE_PREFLIGHT_HTTP.update, summary: "预检底座、Core 或数据能力的单项更新", request: "UpdateRequest", response: "PlanRead", effect: "read" },
    { id: "previewRelease", route: CORE_PACKAGE_SELECTION_HTTP.preview, summary: "重新核对所选固定发行", request: "ReleaseSelection", response: "ReleasePreview", effect: "read" },
    { id: "selectRelease", route: CORE_PACKAGE_SELECTION_HTTP.select, summary: "追加保存固定发行引用", request: "SelectReleaseRequest", response: "ReleaseSelectResult", effect: "write" },
    { id: "releaseReceipt", route: CORE_PACKAGE_SELECTION_HTTP.receipt, summary: "读取同一原发行引用", request: "ReleaseReceiptRequest", response: "ReleaseReferenceRead", effect: "read" },
    { id: "previewPreparation", route: CORE_PACKAGE_PREPARATION_HTTP.preview, summary: "预览完整待部署候选", request: "PreparationRequest", response: "PreparationPreview", effect: "read" },
    { id: "prepare", route: CORE_PACKAGE_PREPARATION_HTTP.prepare, summary: "按原预览摘要准备待部署文件", request: "PrepareRequest", response: "PreparationResult", effect: "write" },
    { id: "preparationReceipt", route: CORE_PACKAGE_PREPARATION_HTTP.receipt, summary: "读取同一原候选摘要与全部文件证据", request: "PreparationQuery", response: "PreparationRead", effect: "read" }
  ];
  const definitions = schemas(), paths: CoreOpenApiContribution["paths"] = {};
  const content = (schema: Schema) => ({ "application/json": { schema } });
  for (const operation of operations) {
    const name = `${operation.id}.Response`;
    definitions[`${namespace}.${name}`] = object({ data: ref(operation.response), requestId: text });
    paths[`/api/${CORE_PACKAGE_HTTP_BASE}/${operation.route.path}`] = { [operation.route.method.toLowerCase()]: {
      operationId: `${namespace}.${operation.id}`, summary: operation.summary, tags: ["Core packages"], security: [{ bearerAuth: [] }],
      "x-requiredPermissions": ["system:tenant:manage"], "x-core-management-audience": "saas", "x-effect": operation.effect,
      description: "需要原 operator 签名会话、当前 SaaS 管理身份和对应权限，返回前复验当前主体。发行元数据、包校验、待部署、注册和租户/成员授权分别成立。unknown 继续沿原引用或 SHA-256 读取，准备结果始终 pending。",
      ...(operation.request ? { requestBody: { required: true, content: content(ref(operation.request)) } } : {}),
      responses: {
        200: { description: "原读取结果、不可用原因或原操作回执", content: content(ref(name)) },
        400: { description: "输入不符合原请求 schema" },
        401: { description: "原签名会话缺失、撤销或到期" },
        403: { description: "当前 SaaS 管理身份或权限不足" },
        409: { description: "原会话、部署、发行或候选摘要冲突，沿原标识核对" },
        503: { description: "当前必需部署或参加者不可用" },
        500: { description: "读取或发布未完成，写入失应答时核对原结果" }
      }
    } };
  }
  return { paths, schemas: definitions };
}

/** 宿主装配全部包管理 Controller 后合并同版本片段，重复路径或 schema 立即拒绝。 */
export function createPlatformCorePackageOpenApi(platform: PlatformOpenApiDocument): PlatformOpenApiDocument {
  const document = structuredClone(platform), contribution = createCorePackageOpenApi();
  for (const [path, operations] of Object.entries(contribution.paths)) {
    if (Object.hasOwn(document.paths, path)) throw new Error("Core 包管理接口文档路径与宿主重复");
    document.paths[path] = operations;
  }
  for (const [name, schema] of Object.entries(contribution.schemas)) {
    if (Object.hasOwn(document.components.schemas, name)) throw new Error("Core 包管理接口文档 schema 与宿主重复");
    document.components.schemas[name] = schema;
  }
  return document;
}
