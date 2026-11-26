"use strict";

/** 比较已独立核收的候选、CI 运行、构建记录和镜像观察。调用方负责证据来源与记录摘要的核收。 */
const { isFullCommit, isSha256, sha256 } = require("./release-composition.cjs");

const isGitHubId = value => Number.isSafeInteger(value) && value > 0;
const isImageId = value => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);

function verifyPairedBuildEvidence(candidate, policy, evidence) {
  const { identity, identitySha256 } = candidate ?? {};
  const platformCommit = identity?.platform?.commit, rentalCommit = identity?.rental?.commit;
  const selection = identity?.selection, locks = identity?.npmLocks;
  if (identity?.format !== "rental-release-identity-1" || !isFullCommit(platformCommit) || !isFullCommit(rentalCommit)
    || selection?.host !== "rental" || !["host", "full"].includes(selection.profile)
    || !Array.isArray(selection.coreIds) || selection.coreIds.length !== 1 || selection.coreIds[0] !== "rental"
    || typeof selection.ai !== "boolean" || typeof selection.mcp !== "boolean" || (selection.mcp && !selection.ai)
    || ![locks?.platform, locks?.projected, locks?.runtime].every(isSha256) || (locks.rental !== null && !isSha256(locks.rental))
    || !isSha256(identity.contextSha256) || !isSha256(identity.deploymentLockSha256)
    || !isSha256(identitySha256) || sha256(JSON.stringify(identity)) !== identitySha256) {
    throw new Error("需要已核的双仓候选身份与完整摘要");
  }

  const { origin, repositoryId, workflowId, workflowPath, headSource, runId, runAttempt, buildRecordSha256 } = policy ?? {};
  if (!["automatic", "manual"].includes(origin) || !["platform", "rental"].includes(headSource)
    || ![repositoryId, workflowId, runId, runAttempt].every(isGitHubId) || !isSha256(buildRecordSha256)
    || typeof workflowPath !== "string" || !/^\.github\/workflows\/[a-zA-Z0-9_.-]+\.ya?ml$/u.test(workflowPath)) {
    throw new Error("缺少已核定的 CI 来源、运行或构建记录锚点");
  }
  const { run, verifiedBuild, inspectedImageIds } = evidence ?? {};
  const event = origin === "automatic" ? "push" : "workflow_dispatch";
  if (run?.id !== runId || run.run_attempt !== runAttempt || run.workflow_id !== workflowId || run.path !== workflowPath
    || run.repository?.id !== repositoryId || run.head_repository?.id !== repositoryId || run.event !== event
    || run.head_branch !== "main" || run.head_sha !== identity[headSource].commit
    || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error("CI 仓库、触发来源、固定提交或成功运行不一致");
  }

  if (verifiedBuild?.sha256 !== buildRecordSha256 || verifiedBuild.identitySha256 !== identitySha256
    || verifiedBuild.platformCommit !== platformCommit || verifiedBuild.rentalCommit !== rentalCommit
    || verifiedBuild.runId !== runId || verifiedBuild.runAttempt !== runAttempt) {
    throw new Error("缺少同一 CI 运行的双仓构建记录，或与候选身份不一致");
  }
  const { api, web } = verifiedBuild.imageIds ?? {};
  if (!isImageId(api) || !isImageId(web) || api === web || inspectedImageIds?.api !== api || inspectedImageIds?.web !== web) {
    throw new Error("API 与 Web 镜像 ID 必须逐项匹配同一已核构建记录");
  }
  return { scope: "paired-build-evidence", origin, runId, runAttempt, platformCommit, rentalCommit, identitySha256, buildRecordSha256,
    imageIds: { api, web }, releaseApproved: false, databaseChecked: false };
}

module.exports = { verifyPairedBuildEvidence };
