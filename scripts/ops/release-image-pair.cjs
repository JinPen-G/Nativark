"use strict";

/** 正式镜像 CI 消费同次运行的已核交接材料，只产出配对构建记录。 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { isFullCommit, isSha256, readJson, sha256 } = require("./release-composition.cjs");
const { digestFiles } = require("./release-facts.cjs");
const { readOrdinary, readReleaseFiles, readPrepared } = require("./release-verify.cjs");

const repositories = {
  platform: ["JinPen-G/Zelo", "JinPen-G/Nativark"],
  rental: ["JinPen-G/nativark-rental-core", "JinPen-G/Zelo-rental-core"],
};

function requireReleaseTag(source, version, role, run) {
  const urls = repositories[role].map(repo => `https://github.com/${repo}`);
  if (!urls.some(url => url.toLowerCase() === source.repository.toLowerCase())
    || typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u.test(version)) {
    throw new Error(`缺少 ${role} 正式发行仓库或版本`);
  }
  const ref = `refs/tags/v${version}`, peeled = `${ref}^{}`;
  let raw;
  try {
    raw = run("git", ["ls-remote", "--exit-code", "--tags", `${urls[0]}.git`, ref, peeled],
      { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new Error(`无法取得 ${role} 的正式 Tag v${version}`);
  }
  const lines = raw.trim().split(/\r?\n/u).map(line => line.split("\t"));
  const refs = new Map(lines.map(([commit, name]) => [name, commit]));
  if (refs.size !== lines.length || !refs.has(ref) || lines.some(row => row.length !== 2
    || !isFullCommit(row[0]) || ![ref, peeled].includes(row[1])) || (refs.get(peeled) ?? refs.get(ref)) !== source.commit) {
    throw new Error(`${role} 正式 Tag v${version} 与固定提交不符`);
  }
}

function buildImagePair(directory, inputSha256, env, run = execFileSync) {
  const platformCommit = env.ZELO_COMMIT, rentalCommit = env.RENTAL_COMMIT;
  const runId = Number(env.GITHUB_RUN_ID), runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.GITHUB_REPOSITORY !== "JinPen-G/Zelo"
    || env.GITHUB_REF !== "refs/heads/main" || !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)
    || !isFullCommit(platformCommit) || platformCommit !== env.GITHUB_SHA || !isFullCommit(rentalCommit)
    || ![runId, runAttempt].every(value => Number.isSafeInteger(value) && value > 0) || !isSha256(inputSha256)) {
    throw new Error("正式镜像构建须由固定双 SHA、交接摘要及 Zelo main 的受管 CI 运行发起");
  }

  const inputRoot = path.resolve(directory);
  const inputBytes = readOrdinary(path.join(inputRoot, "input.json"));
  if (sha256(inputBytes) !== inputSha256) throw new Error("镜像交接清单与独立核收摘要不一致");
  const input = readJson(inputBytes, "正式镜像交接清单");
  if (input?.format !== "rental-image-input-1" || !isSha256(input.contextSha256)
    || !isSha256(input.identitySha256) || !isSha256(input.webFilesSha256)) {
    throw new Error("缺少正式宿主、双仓候选身份或 Web 构建产物摘要");
  }
  const host = path.join(inputRoot, "api"), web = path.join(inputRoot, "web");
  const candidate = readPrepared(host, input.contextSha256, { requireFixedBuild: true });
  const { identity, identitySha256, versions } = candidate;
  if (identitySha256 !== input.identitySha256 || identity.platform.commit !== platformCommit || identity.rental.commit !== rentalCommit) {
    throw new Error("镜像交接与正式双仓候选身份不一致");
  }
  requireReleaseTag(identity.platform, versions.platform, "platform", run);
  requireReleaseTag(identity.rental, versions.rental, "rental", run);

  const webFiles = readReleaseFiles(web);
  if (!webFiles.get("index.html")?.length || webFiles.has(".dockerignore")) throw new Error("缺少正式 Web 入口或存在未允许的构建过滤文件");
  const { digest: webFilesSha256 } = digestFiles([...webFiles].map(([file, contents]) => ({ path: file, bytes: contents.length, contents })));
  if (webFilesSha256 !== input.webFilesSha256) throw new Error("Web 文件集合与同次候选的核定摘要不一致");

  const deploymentLockSha256 = identity.deploymentLockSha256, npmLockSha256 = identity.npmLocks.projected;
  const buildProvenanceSha256 = identity.buildProvenanceSha256;
  const labels = {
    "org.opencontainers.image.revision": platformCommit,
    "pro.zelo.rental.commit": rentalCommit,
    "pro.zelo.release.identity": identitySha256,
    "pro.zelo.release.deployment-lock": deploymentLockSha256,
    "pro.zelo.release.npm-lock": npmLockSha256,
    "pro.zelo.release.build-provenance": buildProvenanceSha256,
    "pro.zelo.release.ci": `${runId}/${runAttempt}`,
  };
  const config = path.join(__dirname, "deployment");
  const imageIds = {};
  for (const [role, context, recipe] of [
    ["api", host, ["--file", path.join(host, "Dockerfile"), "--target", "runtime"]],
    ["web", web, ["--file", path.join(config, "Dockerfile.rental-web"), "--build-context", `release_config=${config}`]],
  ]) {
    const tag = `zelo-rental-${role}:ci-${runId}-${runAttempt}`;
    const expectedLabels = { ...labels, "pro.zelo.release.role": role };
    const labelArgs = Object.entries(expectedLabels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
    run("docker", ["build", ...recipe, ...labelArgs, "--tag", tag, context],
      { timeout: 1200000, stdio: ["ignore", process.stderr, process.stderr] });
    const [image] = JSON.parse(run("docker", ["image", "inspect", tag], { encoding: "utf8", timeout: 10000 }));
    if (typeof image?.Id !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(image.Id)
      || Object.entries(expectedLabels).some(([key, value]) => image.Config?.Labels?.[key] !== value)
      || (role === "api" && image.Config.User !== "node")) {
      throw new Error(`构建所得 ${role} 镜像身份或标签不一致`);
    }
    imageIds[role] = image.Id;
  }
  if (imageIds.api === imageIds.web) throw new Error("API 与 Web 需要各自的固定镜像");
  for (const args of [
    ["--entrypoint", "node", imageIds.api, "/app/verify-runtime.cjs"],
    ["--entrypoint", "sh", imageIds.web, "-ec", "test -s /usr/share/nginx/html/index.html && nginx -V >/dev/null 2>&1"],
  ]) run("docker", ["run", "--rm", "--network", "none", ...args], { timeout: 60000, stdio: ["ignore", process.stderr, process.stderr] });
  return { format: "rental-image-pair-1", platformCommit, rentalCommit, identitySha256, selection: identity.selection, buildProvenanceSha256,
    deploymentLockSha256, npmLockSha256, inputSha256, webFilesSha256, runId, runAttempt, imageIds,
    releaseApproved: false, serverUpdateEligible: false };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error("用法：release-image-pair.cjs <交接材料目录> <交接清单SHA256>");
    process.stdout.write(`${JSON.stringify(buildImagePair(process.argv[2], process.argv[3], process.env))}\n`);
  } catch (error) {
    process.stderr.write(`${error.code === "ENOENT" ? "缺少正式镜像材料或构建工具" : error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildImagePair };
