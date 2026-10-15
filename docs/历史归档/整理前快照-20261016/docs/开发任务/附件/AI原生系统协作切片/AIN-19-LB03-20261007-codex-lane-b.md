# AIN-19 LB03：共享候选消费及主线接入缺口

## 实际功能

`composeInspectionAssist(...).candidates.consume` 与 `InspectionAssistModule.register` 实际接通。输入有限 target、观察 bindingFingerprint 和原 AiInspectionCandidateDraft 数组；共享 leaf schema 通过现有 Ajv 严格验证，不另造候选 DTO。单批最多 100 条/256KiB，字段/candidate 去重、类型/枚举/计量读数、图像区域及音频时段边界校验。photo 候选必须关联其 sources。候选永远 untrusted_data/awaiting_human_review，不产生业务完成状态。

正式 `InspectionEvidenceAuthority.verify(binding, source)` 必需核对当前持久附件业务证据，缺依赖直接 STORAGE_UNAVAILABLE。每条来源二次验证，模板和当前身份在等待后重读；本线没有默认成功实现，没有把模型输出 attachmentId 当归属证明。现有真实上传生产者缺 allocation/template/revision 绑定，故尚无可交付的正式 evidence adapter；不能把该端口存在算成证据链完成。

另补具体阶段地点复核：原订单 GET 可见不等于本次交付/归还地点可见，按原身份 locationScope 核查对应地点，不扩权限。

## 快检

`node --test tests/ai-native-inspection-assist-template.test.cjs`，相同本树绝对 preload/runtime、无效 DB 与 audit 配置。
初次因 Ajv validator 未显式声明 type predicate 产生类型失败（0 pass/1 fail），修复后 5 pass/0 fail/0 skip/0 todo，退出码 0。实际 ts-node transpileOnly:false 编译所有新应用和 composition；diff --check 通过。测试 Auth/Guard 是实际实现；Core/DB/证据均离线替身，不是模型/存储/MySQL/微信验收。

## 八包剩余队列与具体阻塞（不能宣布完成）

1. 模板来源：已接受权订单冻结及换货投影、当前资源/阶段/身份复核；未验真库。
2. 附件：正式上传目前只生产订单、阶段、交接批次、地点。主线需定义并持久验证 tenant/workspace/order/allocation/asset/stage/templateId/templateVersion/attachmentId/attachmentRevision/上传完成状态关联；自由 metadata 不能当权威凭据。尚未实现正式关联和 IO。
3. 多模态输入：共享已有 image/audio 资源引用，不代表实际 Gateway 已能安全读取媒体。主线需提供真实版本媒体解析、内容 hash、媒体能力证据、调用输入指纹与 invocation 绑定消费端口；本线未调用 Gateway/SDK，未识别。
4. 候选：严格消费已实现，但正式证据 source 未装配；现共享候选只有值/定位/置信，没有独立原始转录文本、定位缺失表达，不能私扩 shared。模糊结果按 missing/blurred 保留；没有声称 VIN/车牌领域规则全部验证。
5. 人工更正/持久草稿：人工字段材料已接，持久编辑/采用/拒绝尚未实现。主线需正式草稿模型及 operation receipt，唯一 scope+operation、expectedRevision CAS、输入/template/evidence fingerprint、owner/audience、候选与更正对应。不能写 RentalInspectionRecord/Memory/Knowledge/日志 JSON 绕过。
6. 读取/并发/迟到：模板变化拒绝已实现；持久草稿列表、CAS、未知提交收据恢复依赖上述模型，尚未实现，不能用 Map 冒充持久。
7. 正式交接：目前仅 prepared_not_saved_or_submitted。现 Core createInspection 是推进事实与费用的业务入口，不能直调替代原 Controller 的证据/幂等/事务。主线需受权最终提交及按原 action 查询 receipt 的合法端口；本线不写完成/责任/金额。
8. 模块：实际 opt-in module/composition 已接，无 AppModule/HTTP/worker。正式 API DTO、动作政策、媒体与持久化未齐，不创建平行公共 DTO 或开放默认路由。

## 可替换性与现场

Runtime 替换只消费模板/候选/草稿应用，不依赖 node/checkpoint；Provider 替换必须由唯一 Gateway 保持媒体/usage/证据绑定，不迁移授权和预算单账。
固定依赖顺序：LB01 → LB02 → LB03。本轮保留旧 Knowledge module 未提交 WIP，不附带提交。公共依赖未交付前，剩余核心链明确不可用；后续从正式附件 producer 和草稿 schema 协调点继续，不重复包装已交付入口。
