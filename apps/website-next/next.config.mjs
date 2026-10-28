import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
if (basePath && !/^\/[a-zA-Z0-9_/-]+$/.test(basePath))
  throw new Error("NEXT_PUBLIC_BASE_PATH must be a local URL path");
export default {
  basePath,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  outputFileTracingRoot: root,
  devIndicators: false,
};
