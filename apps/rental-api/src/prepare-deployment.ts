/** 只准备固定公共发行、Rental 与显式所选 tenant Core 的候选迁移/schema/锁；不安装、连接、执行迁移或生成 Client。
 * 新目录完整写成才报告 prepared，已有部署及用户配置始终不覆盖。 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CorePackagePinSchema, CorePlatformReleaseSchema, CorePlatformDataCapabilityReleaseSchema, coreDeploymentHostVersions,
  type CoreDeploymentLock, type CorePlatformDataCapabilityRelease } from "@rental-os/core-contracts";
import { createCoreMigrationDeployment, writeCoreMigrationDeployment } from "@rental-os/core-contracts/deployment";
import { composeCorePrismaSchema } from "@rental-os/core-contracts/prisma";
import { packCoreDirectory } from "@rental-os/core-contracts/install";
import { corePackageFiles, inspectCorePackageFiles, readCorePackageFiles } from "@rental-os/core-contracts/package";
import { readPlatformDataCapabilityPackage } from "@rental-os/core-contracts/platform-data-package";
import { CORE_ARCHIVE_LIMITS, createCoreArchive } from "@rental-os/core-contracts/archive";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";
import { readRentalDataPackage } from "@rental-os/rental-core/data-package";
import { readAiNativeDataPackage } from "@rental-os/ai-native-data/data-package";
import { composeAiNativePrismaSchema } from "@rental-os/ai-native-data/prisma-schema";
import { createRentalOpenApi } from "@rental-os/rental-core/http-openapi";
import { rentalHostLegacyApiRoutes } from "./openapi";

/** 内存准备与命令共用；真实已部署状态仍由原迁移账和物理读取判定。 */
export function createRentalDeploymentFiles(input: {
  release: CoreDeploymentLock["platform"];
  pin: CoreDeploymentLock["cores"][number];
  coreFiles: ReadonlyMap<string, Uint8Array>;
  publicSchema: string;
  publicMigrations: readonly { name: string; sql: Uint8Array }[];
  /** 只接受本宿主已选择的固定完整 AI 数据包；不由环境标记补造迁移或执行收据。 */
  ai?: { release: CorePlatformDataCapabilityRelease; files: ReadonlyMap<string, Uint8Array> };
  /** 本期额外 Core 仅支持 tenant/raw SQL；完整包顺序由调用方固定，不从目录或环境发现。
   * CLI 显式读取每个 --additional-core 完整目录；薄宿主也可直接传入固定包。 */
  additionalCores?: readonly { pin: CoreDeploymentLock["cores"][number]; files: ReadonlyMap<string, Uint8Array> }[];
}) {
  const release = CorePlatformReleaseSchema.parse(input.release);
  const legacyApiRoutes = rentalHostLegacyApiRoutes();
  const rental = readRentalDataPackage(input.coreFiles, input.pin, release.versions, legacyApiRoutes);
  if (!rental.openapi || !isDeepStrictEqual(rental.openapi, JSON.parse(JSON.stringify(createRentalOpenApi()))))
    throw new Error("Rental 部署准备缺少与当前实际处理器同源的 OpenAPI 贡献");
  const platform = createPublicPlatformDataPlan(rental.dataPlan.publicForeignKeys);
  if (!isDeepStrictEqual(release.data, platform.data)) throw new Error("底座发行数据与当前公共宿主不一致");
  const publicRoot = resolve(dirname(require.resolve("@rental-os/platform-api/data-plan")), "..");
  if (input.publicSchema !== readFileSync(resolve(publicRoot, "prisma/schema.prisma"), "utf8"))
    throw new Error("公共 schema 与当前固定宿主源码不一致");
  if (input.publicMigrations.length !== platform.migrationNames.length
    || input.publicMigrations.some((migration, index) => migration.name !== platform.migrationNames[index]))
    throw new Error("公共迁移目录名与宿主原账顺序不一致");
  const ai = input.ai && readAiNativeDataPackage(input.ai.files, input.ai.release);
  const additional = (input.additionalCores ?? []).map(value => ({ pin: CorePackagePinSchema.parse(value.pin), files: value.files }));
  const lock: CoreDeploymentLock = { lockVersion: 1, platform: release, cores: [input.pin, ...additional.map(value => value.pin)],
    ...(ai ? { dataCapabilities: [ai.release] } : {}) };
  const host = coreDeploymentHostVersions(lock), selected = new Map([[rental.manifest.id, input.coreFiles]]);
  for (const { pin, files: source } of additional) {
    if (selected.has(pin.manifest.id)) throw new Error("额外 Core 不能重复选择或替换 Rental");
    if (pin.manifest.scope.kind !== "tenant") throw new Error("本期额外 Core 只支持 tenant 范围");
    const inspected = inspectCorePackageFiles(source, host);
    if (!inspected.ok || !inspected.manifest || !isDeepStrictEqual(inspected.manifest, pin.manifest)
      || createCoreArchive(source).sha256 !== pin.sha256)
      throw new Error(`额外 Core 完整包与固定来源、清单、摘要或宿主合同不一致：${pin.manifest.id}`);
    const declared = new Set(corePackageFiles(inspected.manifest));
    if (source.size !== declared.size || [...source.keys()].some(file => !declared.has(file)))
      throw new Error(`额外 Core 含清单未声明的文件：${pin.manifest.id}`);
    // No extra Prisma contributor is registered in this host. Do not silently
    // omit a package's schema/config/client and report its deployment prepared.
    // The original tickets raw-SQL adapter may still depend on runtime SQL tags.
    const metadataBytes = source.get("package.json");
    const metadata: unknown = metadataBytes && JSON.parse(Buffer.from(metadataBytes).toString("utf8"));
    if ([...source.keys()].some(file => /\.prisma$|(?:^|\/)\.prisma\/|(?:^|\/)prisma\.config\.[cm]?[jt]s$|(?:^|\/)generated\/client\//iu.test(file))
      || metadata !== null && typeof metadata === "object" && "prisma" in metadata)
      throw new Error(`额外 Core 自带 Prisma 贡献或生成物，本期不能合成：${pin.manifest.id}`);
    selected.set(pin.manifest.id, source);
  }
  // Preserve the selected lock order. The original deployment helper alone
  // determines and checks Prisma's migration-directory execution order.
  const files = new Map(createCoreMigrationDeployment({ lock, platform: input.publicMigrations,
    cores: selected, legacyApiRoutes: { rental: legacyApiRoutes },
    ...(ai ? { dataCapabilities: new Map([[ai.release.id, input.ai!.files]]) } : {}) }));
  const baseSchema = composeCorePrismaSchema(input.publicSchema, [rental.prisma]);
  const schema = ai ? composeAiNativePrismaSchema(baseSchema, ai.contribution) : baseSchema;
  // 公共生成器保持单源；仅允许输出到本次新迁移目录旁的专属 generated/client。
  const generators = [...schema.matchAll(/^generator\s+\w+\s*\{([\s\S]*?)^\}/gm)];
  if (generators.length !== 1 || !/provider\s*=\s*"prisma-client-js"/.test(generators[0][1])
    || !/output\s*=\s*"\.\.\/generated\/client"/.test(generators[0][1]))
    throw new Error("Rental 组合生成器须使用本宿主独占的 ../generated/client");
  files.set("schema.prisma", Buffer.from(schema));
  return { status: "prepared" as const, deployment: "pending" as const,
    aiMode: ai ? "enabled" as const : "disabled" as const, lock, files, rental, platform, ai };
}

export interface RentalDeploymentArguments {
  releaseFile: string;
  rentalPackageDirectory: string;
  targetDirectory: string;
  ai?: { releaseFile: string; packageDirectory: string };
  additionalCoreDirectories: readonly string[];
}

/** 只解析显式命令行，不读取目录或环境；额外完整包仍须通过原包校验后才能准备。 */
export function parseRentalDeploymentArguments(args: readonly string[]): RentalDeploymentArguments {
  const firstOption = args.findIndex(value => value.startsWith("--"));
  const positional = args.slice(0, firstOption < 0 ? args.length : firstOption);
  if ((positional.length !== 3 && positional.length !== 5) || positional.some(value => !value))
    throw new Error("用法：prepare-deployment.js <固定底座发行JSON> <已准备Rental包目录> <新迁移目录> [固定AI数据发行JSON 已准备AI数据包目录] [--additional-core <完整固定包绝对目录>]…（最多 8 个）");
  const additionalCoreDirectories: string[] = [];
  // Native resolution handles dot segments; Windows paths also have case-insensitive
  // identity. The package reader separately rejects symbolic links and changed bytes.
  const directoryKey = (value: string) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  const directories = new Set([directoryKey(positional[1])]);
  for (let index = firstOption < 0 ? args.length : firstOption; index < args.length; index += 2) {
    if (args[index] !== "--additional-core") throw new Error(`未知部署准备参数：${args[index]}`);
    const directory = args[index + 1];
    if (!directory || directory.startsWith("--")) throw new Error("--additional-core 缺少完整固定包绝对目录");
    if (!isAbsolute(directory) || process.platform === "win32" && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/iu.test(directory))
      throw new Error("--additional-core 必须使用完整固定包绝对目录");
    if (directories.has(directoryKey(directory))) throw new Error("额外 Core 目录重复或与 Rental 包目录相同");
    if (additionalCoreDirectories.length >= 8) throw new Error("额外 Core 最多显式选择 8 个完整包");
    directories.add(directoryKey(directory));
    additionalCoreDirectories.push(resolve(directory));
  }
  return { releaseFile: positional[0], rentalPackageDirectory: positional[1], targetDirectory: positional[2],
    ...(positional.length === 5 ? { ai: { releaseFile: positional[3], packageDirectory: positional[4] } } : {}),
    additionalCoreDirectories };
}

function prepare(args: string[]) {
  const options = parseRentalDeploymentArguments(args);
  const release = CorePlatformReleaseSchema.parse(JSON.parse(readFileSync(options.releaseFile, "utf8")));
  const packed = packCoreDirectory(options.rentalPackageDirectory, release.versions, rentalHostLegacyApiRoutes());
  const coreFiles = readCorePackageFiles(options.rentalPackageDirectory, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  if (createCoreArchive(coreFiles).sha256 !== packed.sha256) throw new Error("Rental 包在读取期间变化，停止准备");
  const publicRoot = resolve(dirname(require.resolve("@rental-os/platform-api/data-plan")), "..");
  const platform = createPublicPlatformDataPlan();
  const ai = options.ai ? readPlatformDataCapabilityPackage(options.ai.packageDirectory,
    CorePlatformDataCapabilityReleaseSchema.parse(JSON.parse(readFileSync(options.ai.releaseFile, "utf8")))) : undefined;
  const additionalCores = options.additionalCoreDirectories.map(directory => {
    // No Rental legacy route exemption is passed to any additional Core.
    // A second complete read must match the archive inspected on the first read.
    const extra = packCoreDirectory(directory, release.versions);
    const files = readCorePackageFiles(directory, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
    if (createCoreArchive(files).sha256 !== extra.sha256) throw new Error(`额外 Core 包在读取期间变化，停止准备：${extra.manifest.id}`);
    return { pin: { manifest: extra.manifest, sha256: extra.sha256 }, files };
  });
  const prepared = createRentalDeploymentFiles({ release, pin: { manifest: packed.manifest, sha256: packed.sha256 }, coreFiles,
    ai, additionalCores,
    publicSchema: readFileSync(resolve(publicRoot, "prisma/schema.prisma"), "utf8"),
    publicMigrations: platform.migrationNames.map((name, index) => ({ name,
      sql: readFileSync(resolve(publicRoot, platform.data.migrations[index].file)) })) });
  const target = resolve(options.targetDirectory);
  // 编译与运行均使用这个宿主自己的 Client。任意外部迁移目录会让 Prisma
  // 生成到另一位置，留下通过准备却无法启动的部署，因此写入前固定目标关系。
  if (resolve(target, "../generated/client") !== resolve(__dirname, "../generated/client"))
    throw new Error("迁移目录须位于本宿主根目录，使生成器输出到同一 generated/client");
  writeCoreMigrationDeployment(target, prepared.files);
  process.stdout.write(JSON.stringify({ status: prepared.status, deployment: prepared.deployment, aiMode: prepared.aiMode, directory: target,
    schema: resolve(target, "schema.prisma"), clientOutput: resolve(target, "../generated/client"),
    lock: resolve(target, "core.deployment.lock.json"), coreSha256: packed.sha256,
    lockSha256: createHash("sha256").update(prepared.files.get("core.deployment.lock.json")!).digest("hex") }) + "\n");
}

if (require.main === module) {
  try { prepare(process.argv.slice(2)); }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : "Rental 部署准备失败") + "\n"); process.exitCode = 1; }
}
