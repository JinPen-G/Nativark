/** Independent fresh-install archive. The workspace also builds the legacy
 * reader, but none of its migrations or entry points belong to this release. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CorePlatformDataCapabilityReleaseSchema, type CorePlatformDataCapabilityRelease } from "@rental-os/core-contracts";
import { createCoreArchive } from "@rental-os/core-contracts/archive";
import { readPlatformDataCapabilityPackage, requirePlatformDataCapabilityFiles } from "@rental-os/core-contracts/platform-data-package";
import { createPublicAiDataContribution, PUBLIC_AI_DATA_FILES, PUBLIC_AI_DATA_OWNER,
  PUBLIC_AI_DATA_PREREQUISITES, type PublicAiDataContribution } from "./public-data";

export const PUBLIC_AI_DATA_PACKAGE_VERSION = "0.2.0";
const entries = ["public-data", "public-data-package", "public-mysql-data"] as const;
const entry = (name: typeof entries[number]) => ({ types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` });
const manifest = {
  name: "@rental-os/ai-native-data", version: PUBLIC_AI_DATA_PACKAGE_VERSION, private: true, license: "MIT",
  main: "dist/public-data.js", types: "dist/public-data.d.ts",
  exports: { ".": entry("public-data"), ...Object.fromEntries(entries.map(name => [`./${name}`, entry(name)])) },
  typesVersions: { "*": Object.fromEntries(entries.map(name => [name, [`dist/${name}.d.ts`]])) },
  dependencies: { "@rental-os/core-contracts": "0.1.0", "@rental-os/platform-core-host": "0.1.0", "@rental-os/core-host": "0.1.0" }
};
const packageJson = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
const packageFiles = ["package.json", "README.md", "LICENSE", ...PUBLIC_AI_DATA_FILES.map(asset => asset.file),
  ...entries.flatMap(name => [`dist/${name}.js`, `dist/${name}.d.ts`])];

function releaseMetadata(contribution: PublicAiDataContribution) {
  return { id: PUBLIC_AI_DATA_OWNER.id, version: PUBLIC_AI_DATA_PACKAGE_VERSION,
    compatibility: { platform: { minInclusive: "0.1.0", maxExclusive: "0.2.0" },
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
    const bytes = file === "package.json" ? packageJson : input.files.get(file === "README.md" ? "README.public.md" : file);
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
    || !packageJson.equals(files.get("package.json")!)) throw new Error("公共 AI 发行含非本版包文件或缺少正式构建入口");
  const contribution = createPublicAiDataContribution(files);
  const { source: _source, sha256: _sha256, files: _files, ...metadata } = release;
  // Zod returns mutable arrays while fixed metadata is readonly in TypeScript.
  if (!isDeepStrictEqual(metadata, releaseMetadata(contribution))) throw new Error("公共 AI 发行版本、数据或前置与本版不一致");
  return { release, contribution };
}

export function readPublicAiDataPackage(files: ReadonlyMap<string, Uint8Array>, input: CorePlatformDataCapabilityRelease) {
  return readVerified(files, requirePlatformDataCapabilityFiles(files, input));
}

export function requirePublicAiDataPackage(directory: string, input: CorePlatformDataCapabilityRelease) {
  const installed = readPlatformDataCapabilityPackage(directory, input);
  return { root: installed.root, ...readVerified(installed.files, installed.release) };
}
