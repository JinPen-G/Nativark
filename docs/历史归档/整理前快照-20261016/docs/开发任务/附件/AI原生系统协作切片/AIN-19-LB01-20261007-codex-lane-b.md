# AIN-19 LB01：当前受权冻结检查模板

继承 HEAD `560880e8`。负责人确认 Claude 已停止本树写入。保留其未提交 validation 和旧 `human-knowledge.module.ts` WIP；本片仅收口 inspection-assist 模板能力。

## 实际入口

`composeInspectionAssist({guard, credentials, core}).templates.read({orderId, allocationId, templateId, stage})`。
显式 `InspectionAssistModule.register`，不注册全局或 HTTP。
使用现有 `AiOrderRouteContextAuthority` 的真实 Guard/ALS 身份及订单权限；Core 的 `getOrder` 和 `listInspectionTemplates(..., order)` 读取订单冻结/换货模板，不回退当前配置。按共享字段类型有界投影、双读检查资源/模板变化，返回绑定指纹。不是识别、写入或最终检查授权。

`RentalOrder` 公共投影无 workspaceId：空间由原 Guard 与 Core ALS 仓储负责，不新增 DTO 字段冒充授权。

## 验证

固定无效 DATABASE_URL、本树绝对 AI_OFFLINE_AUDIT，预加载 prisma-offline-preload.cjs 和 lane-b-local-runtime.cjs。
`node --test tests/ai-native-inspection-assist-template.test.cjs`：首次类型检查发现公共 Order 无 workspaceId，已修；一次行为冒烟 2 pass/1 fail（测试使用全范围身份错误预期资源过滤），改为正式 own-scope 负例后 3 pass/0 fail/0 skip/0 todo，退出码 0。ts-node transpileOnly:false 编译实际入口和依赖成功。
`git diff --check` 通过。Auth/Guard 为实际实现，Core/数据库是明确离线替身；未验真实 MySQL/微信/模型。

## 当前公共缺口

- schema 仅有正式 RentalInspectionRecord，无 AiInspection 草稿与操作收据，不能将正式完成表当草稿表。主线需提供 scope/owner/order/allocation/asset/stage/frozenTemplate/inputFingerprint/revision/candidates/corrections/status 与同操作幂等收据/CAS 的正式持久化。
- 员工 FileAsset 当前证据生产绑定 rental_order、阶段、batch/location，未正式生产 allocationId、assetId、template/version、attachmentRevision 的联合关联。不能根据任意 metadata 自报值补成可信证据。
- 多模态媒体 intent、能力与最终检查受控提交端口由主线提供；本片不派发/不写 Core。

## 可替换性

模板应用不依赖 Runtime node/checkpoint/SDK 类型；以共享 Core 类型与服务器 Guard/ALS 为边界。未来 Runtime 替换继续调用同入口；Provider 替换不改变本片任何授权事实。无迁移/后台循环/生产开关。
