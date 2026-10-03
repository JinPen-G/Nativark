"use strict";
// Historical author evidence references only; this module does not run any suite.
const base = "docs/开发任务/附件/AI原生系统协作切片/";
const definitions = [
  ["tool-baseline", "a8cdd30742d0d17a5f36050e2726f984fa88a336", 3, "static_inventory", "AIN-01-20261002-codex.md"],
  ["fact-baseline", "a9cd10c548ceb13325324f62011ca99a33f19cba", 32, "method_characterization", "AIN-01-S02-20261002-codex.md"],
  ["authorization-baseline", "47e425b21009d831a18f29779f44ae1e34b4ce84", 22, "method_characterization", "AIN-01-S03-20261002-codex.md"],
  ["history-context-baseline", "de52ea74c632e0120141558451694415ac0580a3", 23, "method_characterization", "AIN-01-S04-20261003-codex.md"],
  ["evidence-index", "1ba352be5edfc4edaa42a4dd0dd49d166bf0b1b3", 3, "metadata_structure", "AIN-01-S05-20261003-codex.md"],
  ["threat-matrix", "bb7d30b33d54f9f38c62de3cab4f7977801e0dfc", 5, "offline_descriptor", "AIN-24-S01-20261003-codex.md"],
  ["threat-sequences", "a8e6475cf47f216aea969a66b0620b9557310760", 4, "offline_descriptor", "AIN-24-离线多步补充-20261003-codex.md"],
  ["replay-differential", "be19ae022ef60c4c25d652719dc6f2c9066187bf", 12, "method_characterization", "AIN-01-幂等差分补充-20261003-codex.md"],
  ["refund-differential", "7b67a98e0403afa04b8561ec31ee4d94cc252cf0", 17, "method_characterization", "AIN-01-退款差分补充-20261003-codex.md"],
  ["inspection-differential", "9972d67296f9dca9e8642eb0b8dd608448c04c6a", 32, "method_characterization", "AIN-01-检查差分补充-20261003-codex.md"],
  ["closure-differential", "f4eede8e00b2b525e0461c4b4463dfe703220c40", 22, "method_characterization", "AIN-01-关单差分补充-20261003-codex.md"],
  ["outbound-differential", "978af630830d78a7b4370d6940b89cbb9e3ee08b", 32, "method_characterization", "AIN-24-外部地址差分补充-20261003-codex.md"]
];
const suites = definitions.map(([name, commit, authorTestCount, evidence, record]) => ({
  name, commit, test: `tests/ai-native-${name}.test.cjs`, record: base + record,
  authorTestCount, evidence, independentReview: "pending", acceptance: "not_claimed"
}));
module.exports = {
  version: "supplement-handoff-1", purpose: "reference_metadata_only", suites,
  sourceBaseline: "978af630830d78a7b4370d6940b89cbb9e3ee08b",
  knownGaps: "remain_open", metrics: "not_collected", centralRecordModified: false,
  contractConsumer: "waiting_explicit_coordinator_commit", aiHandlerEnabled: false,
  unrunEvidence: ["contract", "real_database", "browser", "wechat_host", "real_device", "real_model", "external_payment", "production_canary"]
};
