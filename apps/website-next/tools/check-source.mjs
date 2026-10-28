// Offline structure and localization checks. Does not build, run the site or call APIs.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function files(dir) {
  return (
    await Promise.all(
      (await fs.readdir(dir, { withFileTypes: true })).map((item) =>
        item.isDirectory()
          ? files(path.join(dir, item.name))
          : [path.join(dir, item.name)],
      ),
    )
  ).flat();
}
let count = 0;
for (const directory of ["app", "components", "lib"])
  for (const file of await files(path.join(root, directory))) {
    if (!/\.(jsx?|mjs)$/.test(file)) continue;
    const source = await fs.readFile(file, "utf8");
    parse(source, { sourceType: "module", plugins: ["jsx"] });
    assert(
      !/webpackChunk_N_E|brandResponse|deepseek-harness-(?:clone|original)|\b(?:eval|new Function)\s*\(/.test(
        source,
      ),
      "Captured runtime dependency: " + file,
    );
    count++;
  }
const zh = JSON.parse(
  await fs.readFile(path.join(root, "messages/zh.json"), "utf8"),
);
const en = JSON.parse(
  await fs.readFile(path.join(root, "messages/en.json"), "utf8"),
);
function keys(value, prefix = "") {
  return Object.entries(value).flatMap(([key, item]) =>
    typeof item === "object" ? keys(item, prefix + key + ".") : [prefix + key],
  );
}
assert.deepEqual(keys(zh).sort(), keys(en).sort());
assert(
  !(await fs.readdir(path.join(root, "public"))).includes("_next"),
  "Old chunks must not live under public/",
);
console.log(
  JSON.stringify({
    sourceModules: count,
    matchingTranslationKeys: keys(zh).length,
    capturedRuntimeDependencies: 0,
  }),
);
