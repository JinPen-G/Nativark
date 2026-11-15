/// <reference types="vite/client" />
declare module "virtual:core-manifest" {
  import type { CoreManifest } from "@rental-os/core-contracts";
  const manifest: CoreManifest;
  export default manifest;
}
