/** 运行前核定同一已准备工单包。只读包/元数据，不下载或执行包内安装脚本。 */
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { CoreManifestSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { packCoreDirectory } from "@rental-os/core-contracts/install";
import type { CoreHostVersions } from "@rental-os/core-contracts";

export function requireTicketsDeploymentPackage(pin: CoreDeploymentLock["cores"][number], host: CoreHostVersions) {
  const root = resolve(dirname(require.resolve("@rental-os/example-tickets-core")), "..");
  const manifest = CoreManifestSchema.parse(JSON.parse(readFileSync(resolve(root, "core.manifest.json"), "utf8")));
  if (manifest.id !== pin.manifest.id || manifest.version !== pin.manifest.version
    || manifest.source.repository !== pin.manifest.source.repository || manifest.source.commit !== pin.manifest.source.commit)
    throw new Error("实际工单包的标识、版本或来源与部署锁不一致");
  const packed = packCoreDirectory(root, host);
  if (packed.sha256 !== pin.sha256) throw new Error("当前工单包字节与锁定发布包摘要不一致，先重新核对待部署组合");
  return { root, manifest };
}
