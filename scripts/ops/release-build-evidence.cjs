"use strict";

/** 比较已独立核收的候选、CI 运行、构建记录和镜像观察。调用方负责证据来源与记录摘要的核收。 */
const { isSha256, isVerifiedFixedBuildCandidate } = require("./release-composition.cjs");

const isGitHubId = value => Number.isSafeInteger(value) && value > 0;
const isImageId = value => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);

function verifyPairedBuildEvidence(candidate, policy, evidence) {
  if (!isVerifiedFixedBuildCandidate(candidate)) {
    throw new Error("需要经本进程核验固定构建证明的双仓候选身份");
  }
  const { identity, identitySha256 } = candidate;
  const { platform, rental, buildProvenanceSha256 } = identity;
  const platformCommit = platform.commit, rentalCommit = rental.commit;

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
    buildProvenanceSha256, imageIds: { api, web }, releaseApproved: false, databaseChecked: false };
}

module.exports = { verifyPairedBuildEvidence };
