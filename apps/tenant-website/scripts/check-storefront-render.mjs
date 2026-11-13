// Offline component smoke test. No browser, network calls or real customer storage.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, relative, isAbsolute } from "node:path";
import { mkdir, rm } from "node:fs/promises";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = resolve(
  root,
  "../../output/.tmp/tenant-website-redesign/render-check",
);
const taskRelative = relative(resolve(root, "../.."), temporary);
if (taskRelative.startsWith("..") || isAbsolute(taskRelative))
  throw new Error("Render check temporary path escaped the worktree");
await mkdir(temporary, { recursive: true });
try {
  await build({
    root,
    configFile: false,
    envFile: false,
    envDir: false,
    envPrefix: [],
    plugins: [react()],
    logLevel: "error",
    cacheDir: resolve(temporary, "cache"),
    resolve: {
      extensions: [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
      alias: {
        "@rental-os/shared": resolve(
          root,
          "../../packages/shared/src/index.ts",
        ),
        "@rental-os/web-client": resolve(
          root,
          "../../packages/web-client/src/index.ts",
        ),
      },
    },
    build: {
      ssr: resolve(root, "scripts/storefront-render-cases.tsx"),
      outDir: resolve(temporary, "ssr"),
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: "render-cases.mjs" } },
    },
  });
  const { verify } = await import(
    pathToFileURL(resolve(temporary, "ssr/render-cases.mjs")).href
  );
  await verify(root);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
