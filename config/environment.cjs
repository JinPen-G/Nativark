"use strict";

/** Project environment files, deployment validation and public build values.
 * Tenant settings and provider credentials remain in their existing business stores.
 * Importing this module does not read environment files or mutate process.env.
 */
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PUBLIC_FIELDS = {
  admin: ["VITE_API_BASE_URL", "VITE_SHOW_ACCOUNT_SHORTCUTS", "VITE_RENTAL_CATEGORY_GOVERNANCE_PREVIEW"],
  tenantWebsite: ["VITE_API_BASE", "VITE_BASE_DOMAIN", "VITE_DEFAULT_TENANT"],
  enterprisePortal: ["VITE_ENTERPRISE_PUBLIC_HOSTS"]
};

/** Highest priority first, matching Nest's envFilePath precedence. */
function environmentFiles({ appDirectory, mode, env = process.env } = {}) {
  const explicit = env.RENTAL_ENV_FILE?.trim();
  if (explicit) {
    const file = path.resolve(PROJECT_ROOT, explicit);
    if (!fs.existsSync(file)) throw new Error("RENTAL_ENV_FILE does not identify an existing environment file");
    return [file];
  }
  if (mode && !/^[a-zA-Z0-9_-]+$/u.test(mode)) throw new Error("Environment mode contains unsupported characters");
  const directories = appDirectory && path.resolve(appDirectory) !== PROJECT_ROOT
    ? [path.resolve(appDirectory), PROJECT_ROOT] : [PROJECT_ROOT];
  const names = mode ? [`.env.${mode}.local`, `.env.${mode}`, ".env.local", ".env"] : [".env.local", ".env"];
  return directories.flatMap(directory => names.map(name => path.join(directory, name)));
}

function readEnvironmentFile(file, { required = false } = {}) {
  try {
    return parseEnv(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && !required) return {};
    throw new Error("Unable to read the selected environment file");
  }
}

/** Existing application files remain overrides. An explicit file replaces all fallbacks. */
function loadProjectEnvironment(options = {}) {
  const env = options.env ?? process.env;
  const values = {};
  for (const file of environmentFiles({ ...options, env }).reverse()) {
    Object.assign(values, readEnvironmentFile(file, { required: Boolean(env.RENTAL_ENV_FILE?.trim()) }));
  }
  return { ...values, ...Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) };
}

function integerSetting(value, name, minimum, maximum, errors) {
  if (!/^\d+$/u.test(String(value)) || !Number.isSafeInteger(Number(value))
    || Number(value) < minimum || Number(value) > maximum) {
    errors.push(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

/** Validates values, not only their presence. Error text never includes submitted values. */
function validateApiEnvironment(input, { release = false } = {}) {
  const env = {
    NODE_ENV: "development",
    PLATFORM_DATA_SOURCE: "mysql",
    RENTAL_OS_DATA_SOURCE: "mysql",
    API_PORT: "3000",
    TRUST_PROXY_HOPS: "0",
    DATABASE_CONNECT_ON_START: "false",
    LOCAL_DEMO_PASSWORD_RESET_ENABLED: "false",
    ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  };
  env.INFRA_DATA_SOURCE ??= env.RENTAL_OS_DATA_SOURCE;
  const errors = [];
  env.NODE_ENV = String(env.NODE_ENV ?? "development").trim().toLowerCase();
  if (!["development", "test", "production"].includes(env.NODE_ENV)) {
    errors.push("NODE_ENV must be development, test or production");
  }
  const production = env.NODE_ENV === "production";
  const profile = String(env.RENTAL_DEPLOYMENT_PROFILE ?? (production ? "production" : "development")).trim().toLowerCase();
  env.RENTAL_DEPLOYMENT_PROFILE = profile;
  const personalDemo = profile === "personal-demo";
  if (!["development", "personal-demo", "production"].includes(profile)) {
    errors.push("RENTAL_DEPLOYMENT_PROFILE must be development, personal-demo or production");
  }
  if (profile === "production" && !production) {
    errors.push("NODE_ENV must be production for the production deployment profile");
  }
  if (release && profile === "development") {
    errors.push("RENTAL_DEPLOYMENT_PROFILE must select personal-demo or production for a release");
  }
  if (release && env.NODE_ENV === "test") errors.push("NODE_ENV cannot be test for a release");
  const persistent = production || release;
  for (const name of ["PLATFORM_DATA_SOURCE", "RENTAL_OS_DATA_SOURCE", "INFRA_DATA_SOURCE"]) {
    env[name] = String(env[name] ?? "mysql").trim().toLowerCase();
    if (!["mysql", "memory"].includes(env[name]) || persistent && env[name] !== "mysql") {
      errors.push(`${name} must use ${persistent ? "mysql for deployment" : "mysql or memory"}`);
    }
  }
  for (const name of ["DATABASE_CONNECT_ON_START", "RENTAL_DUE_JOBS_DISABLED", "FILE_UPLOAD_CLEANUP_DISABLED", "LOCAL_DEMO_PASSWORD_RESET_ENABLED"]) {
    if (env[name] === undefined) continue;
    const value = String(env[name]).trim().toLowerCase();
    if (!["true", "false", "1", "0"].includes(value)) errors.push(`${name} must be true or false`);
    else env[name] = value === "true" || value === "1" ? "true" : "false";
  }
  if (!personalDemo && (production || profile === "production") && env.LOCAL_DEMO_PASSWORD_RESET_ENABLED === "true") {
    errors.push("LOCAL_DEMO_PASSWORD_RESET_ENABLED requires an explicit personal-demo deployment");
  }
  integerSetting(env.API_PORT, "API_PORT", persistent ? 1 : 0, 65535, errors);
  integerSetting(env.TRUST_PROXY_HOPS, "TRUST_PROXY_HOPS", 0, Number.MAX_SAFE_INTEGER, errors);
  if (persistent && !env.DATABASE_URL?.trim()) errors.push("DATABASE_URL is required for deployment");
  if (env.DATABASE_URL?.trim()) {
    try {
      const database = new URL(env.DATABASE_URL);
      if (database.protocol !== "mysql:" || !database.hostname || database.pathname.length < 2) throw new Error();
    } catch { errors.push("DATABASE_URL must identify a MySQL database"); }
  }
  if (persistent) {
    for (const name of ["AUTH_TOKEN_SECRET", "INTEGRATION_ENCRYPTION_KEY"]) {
      const value = env[name]?.trim() ?? "";
      if (Buffer.byteLength(value, "utf8") < 32 || new Set(value).size < 8
        || /^(.{1,16})\1+$/u.test(value) || /^(?:change-this|replace[-_ ]|your[-_ ]|example[-_ ])/iu.test(value)) {
        errors.push(`${name} requires an independent random secret of at least 32 bytes`);
      }
    }
  }
  if (errors.length) throw new Error(`Invalid project configuration. ${errors.join(". ")}`);
  return env;
}

/** Root values use the same parser as the API and CLI. Legacy application files
 * retain Vite expansion. Root NODE_ENV never changes Vite's build/serve mode.
 */
function loadViteEnvironment(mode, appDirectory, loadEnv, { offline = false } = {}) {
  if (offline) return {};
  const root = loadProjectEnvironment({ mode });
  const legacy = process.env.RENTAL_ENV_FILE?.trim() ? {} : loadEnv(mode, appDirectory, "");
  const env = { ...root, ...legacy, ...process.env };
  const errors = [];
  for (const name of ["REACT_ADMIN_PORT", "TENANT_WEBSITE_PORT", "ENTERPRISE_PORTAL_PORT"]) {
    if (env[name] !== undefined) integerSetting(env[name], name, 1, 65535, errors);
  }
  if (env.VITE_SHOW_ACCOUNT_SHORTCUTS !== undefined && !["true", "false"].includes(env.VITE_SHOW_ACCOUNT_SHORTCUTS)) {
    errors.push("VITE_SHOW_ACCOUNT_SHORTCUTS must be true or false");
  }
  if (errors.length) throw new Error(`Invalid public build configuration. ${errors.join(". ")}`);
  return env;
}

function apiProxyTarget(env) {
  const publicBase = env.VITE_API_BASE_URL ?? "";
  const target = env.API_PROXY_TARGET || env.VITE_API_TARGET
    || (/^https?:\/\//u.test(publicBase) ? publicBase.replace(/\/api\/?$/u, "") : `http://127.0.0.1:${env.API_PORT || "3000"}`);
  try {
    const url = new URL(target);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { throw new Error("API_PROXY_TARGET must be an HTTP or HTTPS server URL without credentials, query or fragment"); }
  return target;
}

/** Each application receives only its declared public fields. */
function publicEnvironmentDefinitions(application, env) {
  const fields = PUBLIC_FIELDS[application];
  if (!fields) throw new Error("Unknown public configuration application");
  return Object.fromEntries(fields.filter(name => env[name] !== undefined)
    .map(name => [`import.meta.env.${name}`, JSON.stringify(env[name])]));
}

module.exports = {
  PROJECT_ROOT,
  environmentFiles,
  readEnvironmentFile,
  loadProjectEnvironment,
  validateApiEnvironment,
  loadViteEnvironment,
  apiProxyTarget,
  publicEnvironmentDefinitions
};
