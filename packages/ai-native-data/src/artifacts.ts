/** Immutable AI persistence assets; hashes refer to the pinned Git blobs, not checkout newline conversion. */
export const AI_NATIVE_DATA_VERSION = "0.1.0";
export const AI_NATIVE_DATA_READABLE = { minInclusive: "0.1.0", maxExclusive: "0.2.0" } as const;
export const AI_NATIVE_DATA_SOURCE = {
  "commit": "a3ba65b408fbc1be97f0f6e1170330b256a1ab29",
  "file": "apps/api/prisma/schema.prisma",
  "sha256": "ba38e13d620d7fca3205410992e4d483f14d3ca6e8ccab532e035b7376b3b1af"
} as const;
export const AI_NATIVE_PRISMA_SCHEMA = {
  "file": "prisma/schema.prisma",
  "sha256": "874f53dfb556563d84eb2f1877c9df771a6fe904db979731c6acdd9590cf67bc"
} as const;
export const AI_NATIVE_DATA_PROVENANCE = {
  "file": "prisma/provenance.json",
  "sha256": "54e3245a1b12cc015f8a21d1323da1277bf1aa8722a5972690d14dd6a1e79604"
} as const;
export const AI_NATIVE_DATA_MIGRATIONS = [
  {
    "id": "ai-native.20261003050000",
    "file": "prisma/migrations/20261003050000_ai_b02_scope_preserve/migration.sql",
    "name": "platform-capability.ai-native.20261003050000",
    "originalName": "20261003050000_ai_b02_scope_preserve",
    "sha256": "26c34f16115cfd08360a265de56d62ca7778befd1a93fa426233a250cf8f05a4"
  },
  {
    "id": "ai-native.20261003060000",
    "file": "prisma/migrations/20261003060000_ai_task_foundation/migration.sql",
    "name": "platform-capability.ai-native.20261003060000",
    "originalName": "20261003060000_ai_task_foundation",
    "sha256": "65a2e86239c5449a7703f96329d0f060c5eae1eccfbcc567b122602e48c6b3cb"
  },
  {
    "id": "ai-native.20261003070000",
    "file": "prisma/migrations/20261003070000_ai_task_creation_identity/migration.sql",
    "name": "platform-capability.ai-native.20261003070000",
    "originalName": "20261003070000_ai_task_creation_identity",
    "sha256": "904c2c11f31ec85bcb937c9955bef10f7bbe72a3abf3dd93a2481e670e266abc"
  },
  {
    "id": "ai-native.20261003160000",
    "file": "prisma/migrations/20261003160000_ai_provider_profiles/migration.sql",
    "name": "platform-capability.ai-native.20261003160000",
    "originalName": "20261003160000_ai_provider_profiles",
    "sha256": "b03cb5022a4983015d5d6d7e7e58f352147abf0035b53936bb521d4553225a33"
  },
  {
    "id": "ai-native.20261004010000",
    "file": "prisma/migrations/20261004010000_ai_budget_subsystem/migration.sql",
    "name": "platform-capability.ai-native.20261004010000",
    "originalName": "20261004010000_ai_budget_subsystem",
    "sha256": "6bae016df50f5daf83f06fb032772c7a60d759f3e3493be5a9bac0d67c9c083e"
  },
  {
    "id": "ai-native.20261004023000",
    "file": "prisma/migrations/20261004023000_ai_budget_ledger_replay_guard/migration.sql",
    "name": "platform-capability.ai-native.20261004023000",
    "originalName": "20261004023000_ai_budget_ledger_replay_guard",
    "sha256": "b67e7f3395680439a5ac26ef13d4dc85ab689949a5ca8ecc26ce194854dce00f"
  },
  {
    "id": "ai-native.20261005010000",
    "file": "prisma/migrations/20261005010000_ai_tenant_model_configuration/migration.sql",
    "name": "platform-capability.ai-native.20261005010000",
    "originalName": "20261005010000_ai_tenant_model_configuration",
    "sha256": "62500c38b2572e59860f7882e49ab9e4b6a0f24c1b79a11ec6cfc2271cec8143"
  },
  {
    "id": "ai-native.20261005020000",
    "file": "prisma/migrations/20261005020000_ai_platform_model_connection/migration.sql",
    "name": "platform-capability.ai-native.20261005020000",
    "originalName": "20261005020000_ai_platform_model_connection",
    "sha256": "7f0ddc5aeed125d7544aae0af6437fa4a3eef42e6196d681bba29e53d606b8d5"
  },
  {
    "id": "ai-native.20261005030000",
    "file": "prisma/migrations/20261005030000_ai_budget_configuration_binding/migration.sql",
    "name": "platform-capability.ai-native.20261005030000",
    "originalName": "20261005030000_ai_budget_configuration_binding",
    "sha256": "99a5ed1230920c543622046b79bd64840bd54f5c7380d33e077dbec531272c9e"
  },
  {
    "id": "ai-native.20261005040000",
    "file": "prisma/migrations/20261005040000_ai_gateway_invocation_binding/migration.sql",
    "name": "platform-capability.ai-native.20261005040000",
    "originalName": "20261005040000_ai_gateway_invocation_binding",
    "sha256": "53a5a7ac0b891415c747c0d2b9263386015cdba55c4d30d53ee79eae2807aefd"
  },
  {
    "id": "ai-native.20261005050000",
    "file": "prisma/migrations/20261005050000_ai_task_execution_resources/migration.sql",
    "name": "platform-capability.ai-native.20261005050000",
    "originalName": "20261005050000_ai_task_execution_resources",
    "sha256": "3c3b27ce1bb79401d76bbd55b01fee1c4e873817aed935108086f59bf19faec7"
  },
  {
    "id": "ai-native.20261005060000",
    "file": "prisma/migrations/20261005060000_ai_gateway_accounting_receipts/migration.sql",
    "name": "platform-capability.ai-native.20261005060000",
    "originalName": "20261005060000_ai_gateway_accounting_receipts",
    "sha256": "cd6842c131b6f4371be29578d65e1b1ab5d3489ad3c379c1a6684dd3cd8886d6"
  },
  {
    "id": "ai-native.20261006010000",
    "file": "prisma/migrations/20261006010000_ai_task_plan_result_evidence/migration.sql",
    "name": "platform-capability.ai-native.20261006010000",
    "originalName": "20261006010000_ai_task_plan_result_evidence",
    "sha256": "178485850f37fef8c44fe40b79dd5dc370e929f5d88c611237b130a92ddda9ba"
  },
  {
    "id": "ai-native.20261006020000",
    "file": "prisma/migrations/20261006020000_ai_task_action_policies/migration.sql",
    "name": "platform-capability.ai-native.20261006020000",
    "originalName": "20261006020000_ai_task_action_policies",
    "sha256": "d6ae8a9ca122c22f44fd029a979c232b5ea9e06fdc3d85199b8b79b55146b26a"
  },
  {
    "id": "ai-native.20261006030000",
    "file": "prisma/migrations/20261006030000_ai_task_input_receipts/migration.sql",
    "name": "platform-capability.ai-native.20261006030000",
    "originalName": "20261006030000_ai_task_input_receipts",
    "sha256": "2a912df1993ec40a9dfc73d262d16e73490e32cd6404517e2f26456d965eddf7"
  },
  {
    "id": "ai-native.20261006040000",
    "file": "prisma/migrations/20261006040000_ai_knowledge_operation_state/migration.sql",
    "name": "platform-capability.ai-native.20261006040000",
    "originalName": "20261006040000_ai_knowledge_operation_state",
    "sha256": "59a918a460b156ab6351b17cb75d3333344b8555fc86f3070430bf98cb01bb04"
  },
  {
    "id": "ai-native.20261006050000",
    "file": "prisma/migrations/20261006050000_ai_memory_persistence_state/migration.sql",
    "name": "platform-capability.ai-native.20261006050000",
    "originalName": "20261006050000_ai_memory_persistence_state",
    "sha256": "282050f8f49d37eeccc40d3d20dc4c5f783c3c337cdd924dc66d2b198f089c72"
  },
  {
    "id": "ai-native.20261006060000",
    "file": "prisma/migrations/20261006060000_ai_approved_order_snapshots/migration.sql",
    "name": "platform-capability.ai-native.20261006060000",
    "originalName": "20261006060000_ai_approved_order_snapshots",
    "sha256": "42037bc99142987ea0b1cda43c7737c45f3122851cbf35a99fd304bb2e82712a"
  },
  {
    "id": "ai-native.20261006070000",
    "file": "prisma/migrations/20261006070000_ai_task_plan_policy_inputs/migration.sql",
    "name": "platform-capability.ai-native.20261006070000",
    "originalName": "20261006070000_ai_task_plan_policy_inputs",
    "sha256": "c1bfa8b2f6e0a0d5c464e93ace16c196a5b3cc16d6894cb6e3e5073f3241431a"
  },
  {
    "id": "ai-native.20261007010000",
    "file": "prisma/migrations/20261007010000_ai_knowledge_action_policies/migration.sql",
    "name": "platform-capability.ai-native.20261007010000",
    "originalName": "20261007010000_ai_knowledge_action_policies",
    "sha256": "9dd971769672b7f026dd8598fb1463ec945050f7cec194c1047fd2ee47bd6222"
  },
  {
    "id": "ai-native.20261007190000",
    "file": "prisma/migrations/20261007190000_ai_native_scene_requests/migration.sql",
    "name": "platform-capability.ai-native.20261007190000",
    "originalName": "20261007190000_ai_native_scene_requests",
    "sha256": "7fd4a037d491274f973bba7339fce8758c503f5dd47ffcdba7cc5e64602e01c7"
  },
  {
    "id": "ai-native.20261007191000",
    "file": "prisma/migrations/20261007191000_ai_native_inspection_drafts/migration.sql",
    "name": "platform-capability.ai-native.20261007191000",
    "originalName": "20261007191000_ai_native_inspection_drafts",
    "sha256": "d5069c811ac7e65032a8c800194cef617154f7ee786ebfa0b9267b9d2e0ae4a0"
  },
  {
    "id": "ai-native.20261007210000",
    "file": "prisma/migrations/20261007210000_ai_native_quote_selection/migration.sql",
    "name": "platform-capability.ai-native.20261007210000",
    "originalName": "20261007210000_ai_native_quote_selection",
    "sha256": "f3f9465441959aa6a1cc4f19d4aba9590103012181466c1402f02edad0d404b5"
  },
  {
    "id": "ai-native.20261007211000",
    "file": "prisma/migrations/20261007211000_ai_inspection_submission_index/migration.sql",
    "name": "platform-capability.ai-native.20261007211000",
    "originalName": "20261007211000_ai_inspection_submission_index",
    "sha256": "1acfb5d3c51d7fd838acf989ba8d6e0764e6fcd686c06483429604694634dac6"
  },
  {
    "id": "ai-native.20261007213000",
    "file": "prisma/migrations/20261007213000_ai_approval_reprepare/migration.sql",
    "name": "platform-capability.ai-native.20261007213000",
    "originalName": "20261007213000_ai_approval_reprepare",
    "sha256": "1d049399a4b5c12f4a891fb9da3a3d9392b64fda1f664fe0cb098ada64573577"
  },
  {
    "id": "ai-native.20261008120000",
    "file": "prisma/migrations/20261008120000_ai_task_execution_phases/migration.sql",
    "name": "platform-capability.ai-native.20261008120000",
    "originalName": "20261008120000_ai_task_execution_phases",
    "sha256": "9f154dd97c89c770ab072d692b1b07baa9387ee07f60ed498112c46ddf7e6535"
  },
  {
    "id": "ai-native.20261008123000",
    "file": "prisma/migrations/20261008123000_ai_business_failure_events/migration.sql",
    "name": "platform-capability.ai-native.20261008123000",
    "originalName": "20261008123000_ai_business_failure_events",
    "sha256": "8b47a2f8635546e1952e0bae8ed702acfa1864f49c3765abae801c3b7a627959"
  },
  {
    "id": "ai-native.20261008133000",
    "file": "prisma/migrations/20261008133000_ai_automation_policy_inputs/migration.sql",
    "name": "platform-capability.ai-native.20261008133000",
    "originalName": "20261008133000_ai_automation_policy_inputs",
    "sha256": "8e9d6cb84bb6af2c14fadab6ba5acdc7034959814c96e10ccd038941280686eb"
  },
  {
    "id": "ai-native.20261008140000",
    "file": "prisma/migrations/20261008140000_ai_client_scene_materials/migration.sql",
    "name": "platform-capability.ai-native.20261008140000",
    "originalName": "20261008140000_ai_client_scene_materials",
    "sha256": "1a0897c749dab96a5de0a5c2b8f7a86c7248909fd2be756c67edfe56bd9c4d59"
  },
  {
    "id": "ai-native.20261008143000",
    "file": "prisma/migrations/20261008143000_ai_automation_human_review/migration.sql",
    "name": "platform-capability.ai-native.20261008143000",
    "originalName": "20261008143000_ai_automation_human_review",
    "sha256": "cbec08bf154bdff7b114ea4e7341a5b4096e84d819b6ce5cd1735e36a13742f0"
  },
  {
    "id": "ai-native.20261008150000",
    "file": "prisma/migrations/20261008150000_ai_automation_policy_management/migration.sql",
    "name": "platform-capability.ai-native.20261008150000",
    "originalName": "20261008150000_ai_automation_policy_management",
    "sha256": "9d429f55f9312974d1e06a29af4cc5cfa2c405b116764da4df84ca0a23f76e56"
  },
  {
    "id": "ai-native.20261008153000",
    "file": "prisma/migrations/20261008153000_ai_client_task_policy/migration.sql",
    "name": "platform-capability.ai-native.20261008153000",
    "originalName": "20261008153000_ai_client_task_policy",
    "sha256": "8350b94c2a5749e64bd7f3cc3041765c263edb4fdb75a4d816e6c866b6ea7ee9"
  },
  {
    "id": "ai-native.20261009130000",
    "file": "prisma/migrations/20261009130000_ai_client_booking_drafts/migration.sql",
    "name": "platform-capability.ai-native.20261009130000",
    "originalName": "20261009130000_ai_client_booking_drafts",
    "sha256": "cfce850bebfe665d7a589250a74ba357ef02d529f6882d20f5416a46540eb45a"
  },
  {
    "id": "ai-native.20261009131000",
    "file": "prisma/migrations/20261009131000_ai_knowledge_policy_management/migration.sql",
    "name": "platform-capability.ai-native.20261009131000",
    "originalName": "20261009131000_ai_knowledge_policy_management",
    "sha256": "498547d21f65c9be1036aec3faf026decdda37cd8e76bba2396c62264b6b7281"
  },
  {
    "id": "ai-native.20261009132000",
    "file": "prisma/migrations/20261009132000_ai_knowledge_policy_preparation_targets/migration.sql",
    "name": "platform-capability.ai-native.20261009132000",
    "originalName": "20261009132000_ai_knowledge_policy_preparation_targets",
    "sha256": "577ec8730abb8782b5ac953037589053cf71b1df5bdf679728daa5ab40e769ca"
  },
  {
    "id": "ai-native.20261009133000",
    "file": "prisma/migrations/20261009133000_ai_run_input_continuation/migration.sql",
    "name": "platform-capability.ai-native.20261009133000",
    "originalName": "20261009133000_ai_run_input_continuation",
    "sha256": "c3103f415b4ab2286031a2318edb56ce4a9d53e7ab01df431ab33a554113c875"
  },
  {
    "id": "ai-native.20261011120000",
    "file": "prisma/migrations/20261011120000_ai_text_capability_receipts/migration.sql",
    "name": "platform-capability.ai-native.20261011120000",
    "originalName": "20261011120000_ai_text_capability_receipts",
    "sha256": "1f2f01d7197070f5950ace62a20a3677370b4a98e499ee8d167a8e7fc285e466"
  },
  {
    "id": "ai-native.20261011153000",
    "file": "prisma/migrations/20261011153000_ai_return_exception_events/migration.sql",
    "name": "platform-capability.ai-native.20261011153000",
    "originalName": "20261011153000_ai_return_exception_events",
    "sha256": "8cefff34d18e09d8805ea11b53d606a4ec686fec274d968f06ea123b6ca8908f"
  },
  {
    "id": "ai-native.20261012000100",
    "file": "prisma/migrations/20261012000100_ai_client_task_execution_gate/migration.sql",
    "name": "platform-capability.ai-native.20261012000100",
    "originalName": "20261012000100_ai_client_task_execution_gate",
    "sha256": "aaa070f714d35d92259376a591b0f18202fd467cc423a3354d3805f6d9551e0c"
  },
  {
    "id": "ai-native.20261012000200",
    "file": "prisma/migrations/20261012000200_ai_client_task_input_actions/migration.sql",
    "name": "platform-capability.ai-native.20261012000200",
    "originalName": "20261012000200_ai_client_task_input_actions",
    "sha256": "c8925a2fa71ca0389ac7d73cc144977bdb8569af3b3e21355b58019d22e1763a"
  },
  {
    "id": "ai-native.20261012000300",
    "file": "prisma/migrations/20261012000300_ai_client_task_cancel_action/migration.sql",
    "name": "platform-capability.ai-native.20261012000300",
    "originalName": "20261012000300_ai_client_task_cancel_action",
    "sha256": "dd31883aab961b08236273c29c6e1de574d1ad0a66bbde9d191b27f22b62fa80"
  },
  {
    "id": "ai-native.20261015120000",
    "file": "prisma/migrations/20261015120000_ai_gateway_pricing_records/migration.sql",
    "name": "platform-capability.ai-native.20261015120000",
    "originalName": "20261015120000_ai_gateway_pricing_records",
    "sha256": "195b8be748eb8798f0024acddce4f5100761cc11d92e6e51adbf6e43906f8663"
  },
  {
    "id": "ai-native.20261015130000",
    "file": "prisma/migrations/20261015130000_ai_data_retention/migration.sql",
    "name": "platform-capability.ai-native.20261015130000",
    "originalName": "20261015130000_ai_data_retention",
    "sha256": "e3cae686bc3951c2ff0cad8c952765b5416c12493c9461158d3c122b7bc08f1d"
  },
  {
    "id": "ai-native.20261018090000",
    "file": "prisma/migrations/20261018090000_ai_tenant_service_gate/migration.sql",
    "name": "platform-capability.ai-native.20261018090000",
    "originalName": "20261018090000_ai_tenant_service_gate",
    "sha256": "c50489d2a85b93d5c9d7283a854f5fb1f7c66e72796ac63190bdd51b6901093b"
  },
  {
    "id": "ai-native.20261018100000",
    "file": "prisma/migrations/20261018100000_ai_model_configuration_operations/migration.sql",
    "name": "platform-capability.ai-native.20261018100000",
    "originalName": "20261018100000_ai_model_configuration_operations",
    "sha256": "5a13d17f000af8d3a2cefeb2a0a9b2f77e9435846531f29d43c04e63483b4c94"
  },
  {
    "id": "ai-native.20261019100000",
    "file": "prisma/migrations/20261019100000_ai_gateway_usage_billing_details/migration.sql",
    "name": "platform-capability.ai-native.20261019100000",
    "originalName": "20261019100000_ai_gateway_usage_billing_details",
    "sha256": "182816729d7b35bdd478355ae368bd9d8ab10d3d6229a9fca46fd88fa368af08"
  },
  {
    "id": "ai-native.20261024000000",
    "file": "prisma/migrations/20261024000000_platform_admission_attribution/migration.sql",
    "name": "platform-capability.ai-native.20261024000000",
    "originalName": "20261024000000_platform_admission_attribution",
    "sha256": "2fa9fcc160040c718eae7dd628b7b398795ebc3e4cbb00ba6f9f56b28fa06c66"
  },
  {
    "id": "ai-native.20261024000100",
    "file": "prisma/migrations/20261024000100_ai_desktop_business_policy/migration.sql",
    "name": "platform-capability.ai-native.20261024000100",
    "originalName": "20261024000100_ai_desktop_business_policy",
    "sha256": "2204b4fe612fca0cc3929993de94437cd68d58880e8a0918c23ed74d6e71a5f1"
  },
  {
    "id": "ai-native.20261026100000",
    "file": "prisma/migrations/20261026100000_ai_migration_contract_alignment/migration.sql",
    "name": "platform-capability.ai-native.20261026100000",
    "originalName": "20261026100000_ai_migration_contract_alignment",
    "sha256": "b13f046ee4cb28aa7eb25432a942e279d032539c395d699f58a441efa01b4a26"
  },
  {
    "id": "ai-native.20261027200000",
    "file": "prisma/migrations/20261027200000_ai_platform_credit_controls/migration.sql",
    "name": "platform-capability.ai-native.20261027200000",
    "originalName": "20261027200000_ai_platform_credit_controls",
    "sha256": "068233d501eff0994a0f5b7b16e9b75b6a343837084d4b48b634cd704a7d21cf"
  },
  {
    "id": "ai-native.20261029010000",
    "file": "prisma/migrations/20261029010000_ai_conversations/migration.sql",
    "name": "platform-capability.ai-native.20261029010000",
    "originalName": "20261029010000_ai_conversations",
    "sha256": "b635a52a8f4bc2db8854148a3a803aeef1c1b3943bfdbd1e9811f95bfafc0a5e"
  },
  {
    "id": "ai-native.20261031000100",
    "file": "prisma/migrations/20261031000100_original_request_creation_fence/migration.sql",
    "name": "platform-capability.ai-native.20261031000100",
    "originalName": "20261031000100_original_request_creation_fence",
    "sha256": "93671fa41803888f69db559d71afc82c2fa4894e89cc1795d85d842b846dc596"
  },
  {
    "id": "ai-native.20261105230000",
    "file": "prisma/migrations/20261105230000_ai_task_event_contract_alignment/migration.sql",
    "name": "platform-capability.ai-native.20261105230000",
    "originalName": "20261105230000_ai_task_event_contract_alignment",
    "sha256": "818deaa1b5fd2f9a7c81e999541461bc3f433edb1aa652824598d8ec9e767a09"
  },
  {
    "id": "ai-native.20261107190000",
    "file": "prisma/migrations/20261107190000_ai_gateway_tool_call_bindings/migration.sql",
    "name": "platform-capability.ai-native.20261107190000",
    "originalName": "20261107190000_ai_gateway_tool_call_bindings",
    "sha256": "861a05b906ff837af8bc2d01e47fb9cbe912ce7da9d33a5c9e15c3838428de38"
  },
  {
    "id": "ai-native.20261107203000",
    "file": "prisma/migrations/20261107203000_ai_task_run_preparation/migration.sql",
    "name": "platform-capability.ai-native.20261107203000",
    "originalName": "20261107203000_ai_task_run_preparation",
    "sha256": "b3281d892509198c98fd3016956e5c4138807744e6f92173b09daab19b75abd0"
  },
  {
    "id": "ai-native.20261108010000",
    "file": "prisma/migrations/20261108010000_ai_task_run_overheads/migration.sql",
    "name": "platform-capability.ai-native.20261108010000",
    "originalName": "20261108010000_ai_task_run_overheads",
    "sha256": "11d02f1dc7c2092d477c5987f5c4f2d08be356725d9713d5c57eb69d5b2bc42f"
  },
  {
    "id": "ai-native.20261111220000",
    "file": "prisma/migrations/20261111220000_ai_failure_resource_sources/migration.sql",
    "name": "platform-capability.ai-native.20261111220000",
    "originalName": "20261111220000_ai_failure_resource_sources",
    "sha256": "e1defb0f15c1664eb64c27fa79fbe547503323227b3f240047056273b9b31433"
  },
  {
    "id": "ai-native.20261114210000",
    "file": "prisma/migrations/20261114210000_ai_failure_resource_boolean_check/migration.sql",
    "name": "platform-capability.ai-native.20261114210000",
    "originalName": "20261114210000_ai_failure_resource_boolean_check",
    "sha256": "6f19d899e2d43d982f05ec954715be422a9b9e3f495679d0cbbb4a9dc0f26daa"
  }
] as const;
