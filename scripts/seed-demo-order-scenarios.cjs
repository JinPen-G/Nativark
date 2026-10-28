/** Scoped local-demo scenario preflight. Business writes must use the existing API, never SQL status edits.
 * Inspection only while valid demo authentication/scenario inputs are unavailable; --apply fails closed.
 * Does not initialize settings, change existing orders or call real payment providers.
 */
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://127.0.0.1:3000/api";
const RUN = "ui-order-scenarios-20261017";
const RECEIPT = path.join(ROOT, "apps/admin/build", `${RUN}.json`);

function configuration() {
  const result = {};
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const match = raw.match(/^\s*(E2E_DEMO_PASSWORD|DATABASE_URL)\s*=\s*(.*?)\s*$/u);
    if (match) result[match[1]] = match[2].replace(/^(["'])(.*)\1$/u, "$2");
  }
  for (const key of ["E2E_DEMO_PASSWORD", "DATABASE_URL"]) if (process.env[key]) result[key] = process.env[key];
  const db = new URL(result.DATABASE_URL || "invalid:");
  if (db.protocol !== "mysql:" || !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || db.pathname !== "/rental_os") throw new Error("Only the existing local rental_os demo database is allowed");
  if (!result.E2E_DEMO_PASSWORD) throw new Error("Local demo credential is not configured");
  return result;
}
async function request(route, token, method = "GET", body, headers = {}) {
  const response = await fetch(`${API}${route}`, { method, signal: AbortSignal.timeout(30000), headers: { "content-type": "application/json", ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${route}: ${Array.isArray(result.message) ? result.message.join("; ") : result.message || response.status}`);
  return result?.data ?? result;
}
async function connect(authenticatedSession) {
  const config = configuration();
  const session = authenticatedSession ?? await request("/auth/login", undefined, "POST", { tenantCode: "demo", account: "admin", password: config.E2E_DEMO_PASSWORD });
  if (!session.accessToken || session.tenant?.tenantId !== "tenant_001" || session.tenant?.tenantCode !== "demo") throw new Error("Not the fixed local demo tenant");
  const workspace = session.workspaces?.find(item => item.id === session.currentWorkspaceId);
  if (!workspace || workspace.code !== "default" || workspace.status.toLowerCase() !== "active") throw new Error("Current demo login space is not the expected camera space; no business writes performed");
  const token = session.accessToken;
  const [profile, settings, items, pricingGroups, plans, assets, locations, members, templates] = await Promise.all([
    "tenant-profile", "business-settings", "item-groups", "pricing-groups", "pricing-plans", "assets", "locations", "booking-members", "inspection-templates",
  ].map(part => request(`/rental/v1/${part}`, token)));
  return { token, workspace, profile, settings, items, pricingGroups, plans, assets, locations, members, templates };
}
async function main() {
  if (process.argv.includes("--temporary-session")) {
    const identity = await require("./seed-demo-order-session.cjs").provision(configuration());
    const cleanup = async () => { await identity.disable(); console.log(JSON.stringify({ temporaryAccountDisabled: true, account: identity.account })); };
    const interrupt = () => { cleanup().then(() => process.exit(130)).catch(() => process.exit(1)); };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    try {
      const session = await request("/auth/login", undefined, "POST", { tenantCode: "demo", account: identity.account, password: identity.password });
      identity.password = undefined;
      let context = await connect(session);
      console.log(JSON.stringify({ authenticated: true, account: identity.account, workspace: { id: context.workspace.id, code: context.workspace.code },
        settings: { fulfillment: context.settings.fulfillment, payment: context.settings.payment }, items: context.items, pricingGroups: context.pricingGroups, plans: context.plans,
        locations: context.locations, templates: context.templates, demoMembers: context.members.filter(item => /演示/.test(item.name || "")).map(({ customerId, name }) => ({ customerId, name })),
        assets: context.assets.map(({ id, itemGroupId, status }) => ({ id, itemGroupId, status })),
      }));
      const lines = require("node:readline").createInterface({ input: process.stdin, terminal: false });
      for await (const line of lines) {
        try {
          const command = JSON.parse(line);
          if (command.action === "exit") break;
          if (command.action === "apply") { console.log(JSON.stringify(await require("./seed-demo-order-scenarios-apply.cjs").apply(context))); continue; }
          console.log(JSON.stringify({ error: "Unsupported local-demo command" }));
        } catch (error) { console.log(JSON.stringify({ error: error.message })); }
      }
      context = null;
    } finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); await cleanup(); }
    return;
  }
  if (process.argv.includes("--interactive")) {
    configuration(); // Validate local database boundary before prompting.
    const { execFile } = require("node:child_process");
    const session = await new Promise((resolve, reject) => {
      execFile("pwsh.exe", ["-NoProfile", "-STA", "-File", path.join(__dirname, "local-demo-login.ps1")], { windowsHide: true, maxBuffer: 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
        if (error) return reject(new Error("本机授权未完成或验证失败；没有创建订单。"));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error("本地会话响应无法读取；没有创建订单。")); }
      });
    });
    let context = await connect(session);
    console.log(JSON.stringify({ authenticated: true, tenant: "demo", workspace: { id: context.workspace.id, code: context.workspace.code },
      settings: { fulfillment: context.settings.fulfillment, payment: context.settings.payment }, items: context.items,
      pricingGroups: context.pricingGroups, plans: context.plans, locations: context.locations, templates: context.templates,
      demoMembers: context.members.filter(item => /演示/.test(item.name || "")).map(({ customerId, name }) => ({ customerId, name })),
      assets: context.assets.map(({ id, itemGroupId, status }) => ({ id, itemGroupId, status })),
    }));
    const lines = require("node:readline").createInterface({ input: process.stdin, terminal: false });
    for await (const line of lines) {
      try {
        const command = JSON.parse(line);
        if (command.action === "exit") break;
        if (command.action === "refresh") { context = await connect(session); console.log(JSON.stringify({ refreshed: true })); continue; }
        if (command.action === "apply") { console.log(JSON.stringify(await require("./seed-demo-order-scenarios-apply.cjs").apply(context))); continue; }
        console.log(JSON.stringify({ error: "Unsupported local-demo command" }));
      } catch (error) { console.log(JSON.stringify({ error: error.message })); }
    }
    context = null;
    return;
  }
  const context = await connect();
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ workspace: { id: context.workspace.id, code: context.workspace.code }, category: context.profile.categoryCode,
      settings: { fulfillment: context.settings.fulfillment, payment: context.settings.payment },
      items: context.items.map(({ id, name, inventoryMode, status }) => ({ id, name, inventoryMode, status })),
      pricingGroups: context.pricingGroups.map(({ id, name, memberItemGroupIds, status }) => ({ id, name, memberItemGroupIds, status })),
      plans: context.plans.map(({ id, name, status }) => ({ id, name, status })),
      assets: context.assets.map(({ id, itemGroupId, status }) => ({ id, itemGroupId, status })),
      locations: context.locations.map(({ id, name, status }) => ({ id, name, status })),
      demoMembers: context.members.filter(item => /演示/.test(item.name || "")).map(({ customerId, name }) => ({ customerId, name })),
      templates: context.templates.map(({ id, name, stage, enabled, fields }) => ({ id, name, stage, enabled, fields })),
    }, null, 2));
    return;
  }
  throw new Error("Apply is not implemented yet; no orders created");
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { configuration, request, connect, RUN, RECEIPT };
