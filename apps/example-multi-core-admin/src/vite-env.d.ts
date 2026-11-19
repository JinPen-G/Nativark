/// <reference types="vite/client" />

declare module "virtual:core-manifests" {
  import type { CoreManifest } from "@rental-os/core-contracts";
  const manifests: { rental: CoreManifest; tickets: CoreManifest };
  export default manifests;
}
