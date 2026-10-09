#!/usr/bin/env node
/**
 * 员工小程序构建：
 *   1. tsc 编译 src → dist（严格模式，任何类型错误都中止）；
 *   2. 复制 .wxml/.wxss/.json 与 assets 静态资源；
 *   3. 计算公开配置：以 src/config/public.ts 里的常量为默认值，
 *      环境变量 STAFF_MINIPROGRAM_API_ORIGIN / STAFF_MINIPROGRAM_APP_ID 只在非空时覆盖；
 *   4. 校验并写入 dist/config/public.js：
 *      - 默认（本机联调）模式：允许回环 http 地址，并在产物里写 allowLocalApi=true，打印“不可上传”提示；
 *      - `--release` 发布模式：API 地址必须是 HTTPS，任何 http 地址（含回环）一律拒绝，联调开关恒为 false；
 *   5. 校验产物：不含 @rental-os/shared 的运行时依赖（只允许 import type）、不含密钥形态字符串。
 *
 * 与客户小程序的区别：员工端一套包服务所有租户，构建不绑定租户编码。
 *
 * 用法：
 *   node scripts/build.cjs              # 本机联调构建
 *   node scripts/build.cjs --release    # 发布构建（拒绝 http）
 *   node scripts/build.cjs --check      # 只做类型检查
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "src");
const dist = path.join(root, "dist");
const checkOnly = process.argv.includes("--check");
const releaseMode = process.argv.includes("--release");

function fail(message) {
  process.stderr.write(`[staff-miniprogram build] ${message}\n`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function resolveTsc() {
  const packageJson = require.resolve("typescript/package.json", { paths: [root, path.join(root, "..", "..")] });
  return path.join(path.dirname(packageJson), "bin", "tsc");
}

let privateTypeConfig;
function runTsc(args) {
  if (args[0] === '-p' && args[1] === 'tsconfig.json') {
    privateTypeConfig ??= require('../../../scripts/miniprogram-shared-types.cjs').prepareMiniprogramSharedTypes(root);
    args = ['-p', privateTypeConfig, ...args.slice(2)];
  }
  const result = spawnSync(process.execPath, [resolveTsc(), ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) fail("TypeScript 编译失败");
}

const envValue = (name) => (process.env[name] || "").trim();

function publicConfig(defaults) {
  const apiOrigin = (envValue("STAFF_MINIPROGRAM_API_ORIGIN") || defaults.apiOrigin || "").replace(/\/+$/, "");
  const appId = envValue("STAFF_MINIPROGRAM_APP_ID") || defaults.appId || "";
  let allowLocalApi = false;
  if (!apiOrigin) fail("未配置 API 地址：请在 src/config/public.ts 填写 apiOrigin（或设置 STAFF_MINIPROGRAM_API_ORIGIN）");
  if (/^https:\/\/[^/\s]+$/i.test(apiOrigin)) {
    allowLocalApi = false;
  } else if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(apiOrigin)) {
    if (releaseMode) fail(`发布构建拒绝 http 地址 ${apiOrigin}：请把 src/config/public.ts 的 apiOrigin 改为 HTTPS 根地址后再用 --release 构建。`);
    allowLocalApi = true;
  } else {
    fail(`API 地址 ${apiOrigin} 无效：必须是 HTTPS 根地址（不含路径）；只有本机联调构建允许回环 http 地址。`);
  }
  if (appId && !/^wx[0-9a-f]{16}$/i.test(appId)) fail(`AppID ${appId} 格式无效`);
  return { apiOrigin, appId, allowLocalApi, builtAt: new Date().toISOString() };
}

function main() {
  if (checkOnly) {
    runTsc(["-p", "tsconfig.json", "--noEmit"]);
    process.stdout.write("[staff-miniprogram build] 类型检查通过\n");
    return;
  }
  fs.rmSync(dist, { recursive: true, force: true });
  runTsc(["-p", "tsconfig.json"]);

  for (const file of walk(src)) {
    if (file.endsWith(".ts")) continue;
    const target = path.join(dist, path.relative(src, file));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
  }

  const configFile = path.join(dist, "config", "public.js");
  if (!fs.existsSync(configFile)) fail("缺少编译产物 config/public.js");
  const defaults = require(configFile).PUBLIC_CONFIG || {};
  const config = publicConfig(defaults);

  const configSource = fs.readFileSync(configFile, "utf8");
  const literal = JSON.stringify(config, null, 2);
  const replaced = configSource.replace(/^exports\.PUBLIC_CONFIG = \{[\s\S]*?\n\};/m, `exports.PUBLIC_CONFIG = ${literal};`);
  if (replaced === configSource) fail("无法在 config/public.js 中定位 PUBLIC_CONFIG");
  fs.writeFileSync(configFile, replaced);
  fs.writeFileSync(path.join(dist, "config", "public.json"), `${literal}\n`);

  const compiled = walk(dist).filter((file) => /\.(js|json|wxml|wxss)$/.test(file));
  for (const file of compiled) {
    const text = fs.readFileSync(file, "utf8");
    if (file.endsWith(".js") && /require\(["']@rental-os\/shared["']\)/.test(text)) {
      fail(`${path.relative(root, file)} 在运行时依赖 @rental-os/shared；小程序只能使用 import type`);
    }
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) fail(`${path.relative(root, file)} 含私钥`);
    if (/(appSecret|session_key|apiV3Key|mchKey|merchantSecret)\s*[:=]\s*["'][^"']+["']/i.test(text)) fail(`${path.relative(root, file)} 含密钥形态字符串`);
  }
  const appJson = JSON.parse(fs.readFileSync(path.join(dist, "app.json"), "utf8"));
  for (const page of appJson.pages) {
    for (const ext of ["js", "json", "wxml", "wxss"]) {
      if (!fs.existsSync(path.join(dist, `${page}.${ext}`))) fail(`页面 ${page} 缺少 ${ext} 产物`);
    }
  }
  for (const tab of appJson.tabBar?.list ?? []) {
    for (const icon of [tab.iconPath, tab.selectedIconPath]) {
      if (icon && !fs.existsSync(path.join(dist, icon))) fail(`Tab 图标缺少产物：${icon}`);
    }
  }
  const projectConfig = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf8"));
  projectConfig.miniprogramRoot = "./";
  projectConfig.setting = { ...projectConfig.setting, urlCheck: releaseMode };
  if (config.appId) projectConfig.appid = config.appId;
  fs.writeFileSync(path.join(dist, "project.config.json"), `${JSON.stringify(projectConfig, null, 2)}\n`);

  const mode = releaseMode ? "发布构建" : "本机联调构建（产物只能在开发者工具本地预览，不可上传）";
  process.stdout.write(`[staff-miniprogram build] 完成：${mode}，${appJson.pages.length} 个页面 → dist/（API：${config.apiOrigin}${config.appId ? `，AppID：${config.appId}` : ""}）\n`);
}

main();
