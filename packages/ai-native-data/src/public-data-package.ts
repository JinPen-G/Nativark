/** Independent fresh-install archive. Older public releases retain their exact
 * package identity and compatibility range when read by the current SDK. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CorePlatformDataCapabilityReleaseSchema, type CorePlatformDataCapabilityRelease } from "@rental-os/core-contracts";
import { createCoreArchive } from "@rental-os/core-contracts/archive";
import { readPlatformDataCapabilityPackage, requirePlatformDataCapabilityFiles } from "@rental-os/core-contracts/platform-data-package";
import { createPublicAiDataContribution, PUBLIC_AI_DATA_FILES, PUBLIC_AI_DATA_OWNER,
  PUBLIC_AI_DATA_PREREQUISITES, type PublicAiDataContribution } from "./public-data";

export const PUBLIC_AI_DATA_PACKAGE_VERSION = "0.2.2";
const entries = ["public-data", "public-data-package", "public-mysql-data"] as const;
const entry = (name: typeof entries[number]) => ({ types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` });
const manifest = {
  name: "@rental-os/ai-native-data", version: PUBLIC_AI_DATA_PACKAGE_VERSION, private: true, license: "MIT",
  main: "dist/public-data.js", types: "dist/public-data.d.ts",
  exports: { ".": entry("public-data"), ...Object.fromEntries(entries.map(name => [`./${name}`, entry(name)])) },
  typesVersions: { "*": Object.fromEntries(entries.map(name => [name, [`dist/${name}.d.ts`]])) },
  dependencies: { "@rental-os/core-contracts": "0.1.0", "@rental-os/platform-core-host": "0.1.0", "@rental-os/core-host": "0.1.0" }
};
const packageJson = (version: string) => Buffer.from(JSON.stringify({ ...manifest, version }, null, 2) + "\n");
const packageFiles = ["package.json", "README.md", "LICENSE", ...PUBLIC_AI_DATA_FILES.map(asset => asset.file),
  ...entries.flatMap(name => [`dist/${name}.js`, `dist/${name}.d.ts`])];

function releaseMetadata(contribution: PublicAiDataContribution, version = PUBLIC_AI_DATA_PACKAGE_VERSION) {
  if (version !== "0.2.0" && version !== PUBLIC_AI_DATA_PACKAGE_VERSION)
    throw new Error("公共 AI 数据发行版本不受本读取器支持");
  return { id: PUBLIC_AI_DATA_OWNER.id, version,
    compatibility: { platform: { minInclusive: "0.1.0", maxExclusive: version === "0.2.0" ? "0.2.0" : "0.3.0" },
      contract: { minInclusive: "0.1.1", maxExclusive: "0.2.0" } },
    runtime: { node: { minInclusive: "22.0.0", maxExclusive: "25.0.0" } },
    schema: PUBLIC_AI_DATA_FILES[0], data: contribution.data, prerequisites: PUBLIC_AI_DATA_PREREQUISITES };
}

/** Input is the byte snapshot of one fixed source build and its public assets. */
export function createPublicAiDataRelease(input: {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly source: CorePlatformDataCapabilityRelease["source"];
}) {
  const files = new Map<string, Uint8Array>();
  for (const file of packageFiles) {
    const bytes = file === "package.json" ? packageJson(PUBLIC_AI_DATA_PACKAGE_VERSION) : input.files.get(file === "README.md" ? "README.public.md" : file);
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error(`公共 AI 发行缺少构建材料：${file}`);
    files.set(file, Uint8Array.from(bytes));
  }
  const contribution = createPublicAiDataContribution(files);
  const archive = createCoreArchive(files);
  const release = CorePlatformDataCapabilityReleaseSchema.parse({ ...releaseMetadata(contribution),
    source: input.source, sha256: archive.sha256, files: [...files].sort(([a], [b]) => a.localeCompare(b))
      .map(([file, bytes]) => ({ file, sha256: createHash("sha256").update(bytes).digest("hex") })) });
  return { files, archive, release };
}

function readVerified(files: ReadonlyMap<string, Uint8Array>, release: CorePlatformDataCapabilityRelease) {
  if (files.size !== packageFiles.length || packageFiles.some(file => !files.get(file)?.byteLength)
    || !packageJson(release.version).equals(files.get("package.json")!)) throw new Error("公共 AI 发行含非本版包文件或缺少正式构建入口");
  const contribution = createPublicAiDataContribution(files);
  const { source: _source, sha256: _sha256, files: _files, ...metadata } = release;
  // Zod returns mutable arrays while fixed metadata is readonly in TypeScript.
  if (!isDeepStrictEqual(metadata, releaseMetadata(contribution, release.version))) throw new Error("公共 AI 发行版本、数据或前置与本版不一致");
  return { release, contribution };
}

export function readPublicAiDataPackage(files: ReadonlyMap<string, Uint8Array>, input: CorePlatformDataCapabilityRelease) {
  return readVerified(files, requirePlatformDataCapabilityFiles(files, input));
}

export function requirePublicAiDataPackage(directory: string, input: CorePlatformDataCapabilityRelease) {
  const installed = readPlatformDataCapabilityPackage(directory, input);
  return { root: installed.root, ...readVerified(installed.files, installed.release) };
}
