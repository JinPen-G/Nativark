// Make Next.js segment payloads usable on plain static hosts without rewrites.
// The source runtime remains native Next.js; only generated out/ files are copied.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
let aliases = 0;
async function visit(directory, segmentRoot) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    const marker = segmentRoot || (entry.isDirectory() && entry.name.startsWith("__next.") ? filename : undefined);
    if (entry.isDirectory()) await visit(filename, marker);
    else if (segmentRoot && entry.name.endsWith(".txt")) {
      const suffix = path.relative(segmentRoot, filename).split(path.sep).join(".");
      await fs.copyFile(filename, segmentRoot + "." + suffix);
      aliases++;
    }
  }
}
await visit(root);
await fs.writeFile(path.join(root, ".nojekyll"), "");
await fs.writeFile(path.join(root, "site-config.json"), JSON.stringify({ basePath }) + "\n");
console.log(JSON.stringify({ staticSegmentAliases: aliases, basePath }));
