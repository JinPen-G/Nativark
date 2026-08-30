const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { requiredPermissions } = require("../apps/api/src/common/api-auth.guard");

/**
 * RULE-01A 专项：规则编辑与发布分权（需求 4.6.14「权限分为规则编辑、规则发布」）。
 *
 * 这里只测「端点要求哪些权限码」这层纯判定——它是分权是否成立的唯一开关。
 * 守卫的 hasAnyPermission 用 `some()`：拥有要求集合里任一权限即放行，
 * 因此下面用同样的 `some()` 语义模拟「只有 manage / 只有 publish」两种账号。
 */

const ok = (message) => console.log(`  PASS  ${message}`);
const MANAGE = "store-rental:rules:manage";
const PUBLISH = "store-rental:rules:publish";
const PRICE = "store-rental:price:manage";

// 判定一律用归一化后的小写路径（无 /api 前缀），与守卫 canActivate 传入的一致。
const req = (method, path) => requiredPermissions(method, path);
// 守卫放行语义：账号权限与要求集合有交集即通过。
const allows = (userPerms, required) => required.some((code) => userPerms.includes(code));

// ============ 1. 端点要求的权限码：读放行两权限，写按动作分权 ============
{
  const list = req("GET", "/rental/v1/rule-versions");
  const detail = req("GET", "/rental/v1/rule-versions/1.0");
  const preview = req("GET", "/rental/v1/rule-versions/1.0/publish-preview");
  const audits = req("GET", "/rental/v1/rule-versions/audits");
  for (const [label, perms] of [["列表", list], ["详情", detail], ["发布预览", preview], ["审计", audits]]) {
    assert.ok(perms.includes(MANAGE) && perms.includes(PUBLISH), `${label}读取应 manage 或 publish 任一即可`);
  }

  assert.deepEqual(req("POST", "/rental/v1/rule-versions"), [MANAGE], "存草稿只认编辑权限");
  assert.deepEqual(req("POST", "/rental/v1/rule-versions/1.0/restore"), [MANAGE], "恢复为新草稿属编辑动作");
  assert.deepEqual(req("POST", "/rental/v1/rule-versions/1.0/publish"), [PUBLISH], "发布只认发布权限");
  assert.deepEqual(req("POST", "/rental/v1/rule-versions/1.0/void"), [PUBLISH], "作废属发布级动作");
  ok("读取放行 manage/publish 任一；存草稿与恢复认 manage，发布与作废认 publish");
}

// ============ 2. 反向用例：只有 manage —— 能编辑，不能发布 ============
{
  const manageOnly = [MANAGE];
  assert.equal(allows(manageOnly, req("POST", "/rental/v1/rule-versions")), true, "manage 可存草稿");
  assert.equal(allows(manageOnly, req("POST", "/rental/v1/rule-versions/1.0/restore")), true, "manage 可恢复为新草稿");
  assert.equal(allows(manageOnly, req("GET", "/rental/v1/rule-versions")), true, "manage 可读取列表");
  // 关键分权：只有编辑权限的账号在发布端点被拒，不能把草稿直接对客户生效。
  assert.equal(allows(manageOnly, req("POST", "/rental/v1/rule-versions/1.0/publish")), false, "manage 不能发布");
  assert.equal(allows(manageOnly, req("POST", "/rental/v1/rule-versions/1.0/void")), false, "manage 不能作废");
  ok("只有 rules:manage 的账号能编辑草稿但发布/作废被拒");
}

// ============ 3. 反向用例：只有 publish —— 能发布已有草稿，不能改草稿 ============
{
  const publishOnly = [PUBLISH];
  assert.equal(allows(publishOnly, req("POST", "/rental/v1/rule-versions/1.0/publish")), true, "publish 可发布");
  assert.equal(allows(publishOnly, req("POST", "/rental/v1/rule-versions/1.0/void")), true, "publish 可作废");
  assert.equal(allows(publishOnly, req("GET", "/rental/v1/rule-versions/1.0/publish-preview")), true, "publish 可看发布预览");
  // 关键分权：只有发布权限的账号在编辑端点被拒，不能修改草稿内容。
  assert.equal(allows(publishOnly, req("POST", "/rental/v1/rule-versions")), false, "publish 不能存草稿");
  assert.equal(allows(publishOnly, req("POST", "/rental/v1/rule-versions/1.0/restore")), false, "publish 不能恢复为新草稿");
  ok("只有 rules:publish 的账号能发布已有草稿但编辑草稿被拒");
}

// ============ 4. 前缀顺序：rule-versions 分支必须先于合并的 rewards 分支命中 ============
{
  // 若被后面 `/rental/v1/rewards|...` 的合并分支吃掉，发布端点会退化成认 rules:manage。
  assert.equal(req("POST", "/rental/v1/rule-versions/1.0/publish").includes(MANAGE), false, "发布端点不得混入编辑权限");
  // price:manage 作为既有超集对读取放行，但不对发布/作废放行。
  assert.equal(allows([PRICE], req("POST", "/rental/v1/rule-versions/1.0/publish")), false, "price:manage 不越权发布");
  assert.equal(allows([PRICE], req("GET", "/rental/v1/rule-versions")), true, "price:manage 可读取");
  ok("rule-versions 分支先于合并分支命中，发布端点不被前缀退化");
}

console.log("\nAll rule-version permission-split assertions passed.");
