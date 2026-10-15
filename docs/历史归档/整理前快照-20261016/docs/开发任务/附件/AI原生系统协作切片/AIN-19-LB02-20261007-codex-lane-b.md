# AIN-19 LB02：合法人工材料准备（不是持久草稿）

`composeInspectionAssist(...).manual.prepare` 和 opt-in 模块实际接通人工有限字段输入。请求为当前目标、模板 ID、已观察 bindingFingerprint、有限 results；每次重新走真实模板权限链并返回前重读，不信任客户端 scope/owner。

复用共享字段类型和 Core `optionalUsageReading`。未知字段、类型混淆、非法选择、负 usage、旧资源/模板指纹拒绝；零保留。必填缺失显式返回，photo 没有正式附件证据时 unavailable。返回 prepared_not_saved_or_submitted，不落正式检查表、不调模型、不判责/计算费用。不生成批准或完成凭据。文本字段仅按正式字段类型验证，不宣称已验证 VIN/车牌业务格式。

验证：与 LB01 同一离线 preload/runtime/无效 DB 环境，`node --test tests/ai-native-inspection-assist-template.test.cjs` 4 pass/0 fail/0 skip/0 todo，退出码 0。ts-node transpileOnly:false；diff --check 通过。没有模型/数据库/存储/设备验收。

下一片：复用共享 AiInspectionCandidateDraft 的真实校验与受控候选消费。持久保存、附件版本证据、模型派发及最终提交仍依赖主线公共能力，不能把本片人工材料误记为这些能力完成。
