// 原静态官网与旧API CORS的历史用例。固定Git读取，不证明当前公共宿主跨域配置。
const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const legacyCors = execFileSync("git", ["show", "46db0945dee92ac916f7265e95948943fc8b641d:apps/api/src/common/cors-origins.ts"],
  { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
const legacyModule = { exports: {} };
new Function("exports", ts.transpileModule(legacyCors, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(legacyModule.exports);
const { apiCorsOrigins } = legacyModule.exports;

test("CORS allows only explicit secure origins plus local HTTP preview", () => {
  const allowed = apiCorsOrigins("https://site.example.test, https://site.example.test/");
  assert.equal(allowed.filter((x) => x === "https://site.example.test").length, 1);
  assert.ok(allowed[0].test("http://localhost:4180"));
  for (const origin of ["*", "http://site.example.test", "https://*.example.test", "https://site.example.test/path", "https://site.example.test/?token=1", "https://name:password@site.example.test"]) {
    assert.throws(() => apiCorsOrigins(origin));
  }
});

test("website links stay local or disabled and all demo entry points open the dialog", () => {
  // The old static site is no longer distributed with Zelo. Keep its original assertions on fixed historical bytes.
  const readLegacyWebsite = file => execFileSync("git", ["show", `2bbe41ba50c8a4c85023171d2a5e4740dde75fd7:apps/website/2.0/${file}`],
    { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
  const html = readLegacyWebsite("index.html");
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(anchors.length > 20);
  for (const tag of anchors) {
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
    if (href) assert.match(href, /^(?:#|\.\/)/, tag);
    else assert.match(tag, /data-link-pending/, tag);
  }
  assert.equal(anchors.filter((tag) => tag.includes("data-demo-open")).length, 6);
  const assets = ["styles.css", "js/i18n.js", "js/main.js", "js/config.js", "js/demo-request.js"];
  const versions = assets.map((asset) => {
    const reference = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).find((url) => url.startsWith(`${asset}?v=`));
    assert.ok(reference, `${asset} must bypass pre-demo asset caches`);
    return reference.split("?v=")[1];
  });
  assert.equal(new Set(versions).size, 1);
  assert.match(html, /id="demo-name"[^>]*required/);
  assert.match(html, /id="demo-contact"[^>]*required/);
  const js = readLegacyWebsite("js/demo-request.js");
  assert.doesNotMatch(js, /(?:localStorage|sessionStorage)\s*\.\s*[a-zA-Z_$]/);
  assert.match(js, /credentials: "omit"/);
  assert.match(js, /result\?\.data\?\.received !== true/);
  assert.ok(js.indexOf('new Event("rentalos:demo-open")') < js.indexOf("previousOverflow = document.body.style.overflow"));
});
