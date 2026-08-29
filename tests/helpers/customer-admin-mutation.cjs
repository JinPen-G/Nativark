const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const TEST = path.join(ROOT, "tests/customer-admin-acceptance.test.cjs");

const REPO = "apps/api/src/modules/platform/shared-customer.repository.ts";
const OPS_REPO = "apps/api/src/modules/platform/customer-operations.repository.ts";
const SERVICE = "apps/api/src/modules/platform/customer-operations.service.ts";
const NAV = "apps/admin/src/app/navigation.tsx";
const PAGE = "apps/admin/src/features/customers/CustomerMasterPage.tsx";

/** 每个变异都是一个「真实可能犯的错」，而不是随便改个字符。 */
const mutations = [
  [REPO, `        contacts: { where: { status: "active" }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },`, "", "详情不再带出联系人"],
  [REPO, `contacts: { where: { status: "active" }, orderBy:`, `contacts: { orderBy:`, "详情把已失效联系人也带出来"],
  [REPO, `        phoneMasked: contact.phoneMasked,`, `        phoneMasked: contact.phoneMasked,\n        phone: (contact as unknown as { phone: string }).phone,`, "联系人明文号码随详情外传"],
  [REPO, `      include: { workspaceLinks: { where: { workspaceId } } },`, `      include: { workspaceLinks: true },`, "列表带出其他空间的会员关系"],
  [SERVICE, `    if (revealed) return profile;`, `    if (true) return profile;`, "无解密权限也返回明文"],
  [SERVICE, `    await this.operations.recordSensitiveAccess(tenantId, {\n      workspaceId,\n      customerId,\n      field: "customer_detail",`, `    if (revealed) await this.operations.recordSensitiveAccess(tenantId, {\n      workspaceId,\n      customerId,\n      field: "customer_detail",`, "脱敏读取不留痕"],
  [SERVICE, `    if (!this.canReveal(user)) {\n      throw new ForbiddenException("查看敏感资料访问审计需要「客户敏感资料解密」权限");\n    }\n`, "", "访问审计对只读账号开放"],
  [OPS_REPO, `        ...(workspaceId ? { OR: [{ workspaceId }, { scope: "account" }] } : {})`, `        ...(workspaceId ? { workspaceId } : {})`, "时间线丢掉账号级事件"],
  [NAV, `routes: [APP_ROUTES.customerMaster, APP_ROUTES.customers]`, `routes: [APP_ROUTES.customers]`, "主档页不进菜单"],
  [PAGE, `        // 取舍结论原样固化进合并映射，事后才能解释「保留了谁的值、谁决定的」。\n        fieldResolutions\n`, "", "合并请求不回传人工取舍"],
  [PAGE, `        : unresolvedFields.length\n          ? \`还有 \${unresolvedFields.length} 个冲突字段未做取舍\`\n`, "", "未取舍的冲突字段不再阻止提交"],
  [PAGE, `            reason: values.reason,\n            acknowledgedManualChecks: values.acknowledgedManualChecks\n`, `            reason: values.reason\n`, "注销不回传人工核对确认"]
];

let killed = 0;
const survivors = [];
for (const [relative, search, replace, label] of mutations) {
  const file = path.join(ROOT, relative);
  const original = fs.readFileSync(file, "utf8");
  if (!original.includes(search)) {
    survivors.push(`${label}（变异目标未找到，等于没测——必须修好再算）`);
    console.log(`  ! 目标未找到：${label}`);
    continue;
  }
  fs.writeFileSync(file, original.replace(search, replace));
  try {
    execFileSync(process.execPath, [TEST], { cwd: ROOT, stdio: "pipe" });
    survivors.push(label);
    console.log(`  ✗ 存活：${label}`);
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    const hit = out.split(/\r?\n/).find((line) => /AssertionError|Error:/.test(line)) ?? "";
    killed += 1;
    console.log(`  ✓ 被抓到：${label} → ${hit.slice(0, 96)}`);
  } finally {
    fs.writeFileSync(file, original);
  }
}

console.log(`\n变异结果：${killed}/${mutations.length} 被抓到，存活 ${survivors.length}`);
if (survivors.length) {
  console.log("存活项（说明这些口径没有被真正覆盖）：");
  for (const item of survivors) console.log(`  - ${item}`);
  process.exit(1);
}
