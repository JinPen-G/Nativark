# AIN-14/16 第二接续批：差异候选与资料准备

从ad3b5596继续。本片只写Lane A工具、测试与记录，未改Core/Membership/Guard/shared/schema/审批。

## 实际入口

- `openingActions.prepareDifference({expectedVersion, changes})`：只接受 `itemLabel/itemGroupLabel/assetLabel/fulfillmentLabel/pickupLabel/returnLabel` 六个既有租户资料展示字段；要求版本等于当前profile.configVersion，当前读取后再复读。返回before/after、scope、版本、来源、影响；`candidate_only`，不调用saveProfile、不保存提案、不发布。任意路径、apiKey或旧版本拒绝。
- `openingActions.requiredMaterials()`：从原tenantReadiness的必需未完成项生成材料清单，保留实际issue/evidence/manual入口，敏感值不返回，未加载定义继续`not_loaded_use_original_form`；不把AI补造地址/证件/账户/密钥当材料完成。
- `memberProfileDifference.prepare({customerId,expectedName,name})`：当前受权会员候选中只准备正式可见的普通name字段；双读指纹一致才返回，phone/email/身份/企业关系/status等不读、不写，会员共享范围明确。没有revision/提案端口，`persistence:not_attempted_no_verified_proposal_port`，写授权未授予。

## 验证

固定无效DATABASE_URL、本树绝对audit=output/lane-a-second-differences.audit：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-second-differences.test.cjs`
2pass/0fail/0skip/0todo、exit0；实际组合/Guard/Core/Membership投影。API类型audit=output/lane-a-second-differences-types.audit命令按既有tsc preload，exit0；diff check exit0。

验证了版本冲突、任意敏感字段、额外字段、撤权、双读变化和无写入。未连接真实DB/HTTP/模型/支付/设备，不代表资料写入、提案持久化、发布或AIN14/16结项。

主线需提供expectedRevision/正式提案持久化和逐字段审批/发布端口后，才能接入 `proposal`；本线不得直接写审批表。企业/身份/手机号仍只能走原验证流程。
