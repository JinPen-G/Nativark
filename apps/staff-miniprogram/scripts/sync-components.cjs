"use strict";
// 按页面 WXML 实际用到的自定义组件生成 usingComponents（组件按页注册，保留 lazyCodeLoading 按需注入）。
const fs = require("node:fs");
const path = require("node:path");
const src = path.resolve(__dirname, "../src");
const components = ["nav-bar", "ui-icon", "state-view", "money-text", "status-tag", "sheet"];
for (const page of fs.readdirSync(path.join(src, "pages"))) {
  const wxml = fs.readFileSync(path.join(src, "pages", page, "index.wxml"), "utf8");
  const jsonPath = path.join(src, "pages", page, "index.json");
  const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const used = components.filter((tag) => wxml.includes(`<${tag} `) || wxml.includes(`<${tag}>`));
  delete json.usingComponents;
  if (used.length) json.usingComponents = Object.fromEntries(used.map((tag) => [tag, `/components/${tag}/index`]));
  fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
  process.stdout.write(`${page}: ${used.join(", ") || "(none)"}\n`);
}
