# CB-04：继承逐项人工交接材料 WIP

执行者 Codex B，唯一树 codex-ai-native-lane-b、分支 ai/codex-ai-native-lane-b-20261007，接续 c7c4cf1f。总册 CB-01～CB-12 全部纳入本线连续目标，不认领 A/R/P 树。保留 human-knowledge.module.ts 旧 WIP 和 output，不重复合并 LB05～LB08。

## 本片实际入口

继承 submission.prepareReview，在原受权模板、草稿、字段/附件校验及 Prisma operation/CAS 上生成持久逐 allocation 人工材料。使用既有 shared mode=manual_review_only；与 prepare 的原整单 original_single 区分请求指纹。多资源/承运路径可准备人工汇总材料，不冒充整单可提交命令。submit 在任何占位或原 Controller 调用前拒绝 manual_review_only；原单资源限制、真实提交和未知收据处理不变。

同原 operation 重放返回原 revision，不能悄悄升级为执行模式；更换材料需要原 revision/CAS。材料不是批准、提交或履约完成。Runtime 可消费原服务/收据，不依赖 checkpoint；Provider 边界未变，无 SDK/第二 Gateway。

## 一次定向冒烟

node --test tests/ai-native-inspection-media-submission.test.cjs。
使用本树绝对 prisma-offline-preload.cjs、lane-b-local-runtime.cjs、固定 mysql://offline:offline@127.0.0.1:1/rental_os_offline、AI_OFFLINE_AUDIT=本树 output/inspection-cb04-audit，TEMP/TMP=本树 output/inspection-lb05-tmp。
新增实际流程红测：7 pass / 1 fail / 0 skip / 0 todo，退出码1；prepareReview 错误走 singleAllocation。
修复后：8 pass / 0 fail / 0 skip / 0 todo，退出码0。ts-node transpileOnly:false 检查实际被加载应用，不等于全 API 类型检查；diff --check 退出码0。
实际 Auth/Guard、DTO、Prisma 适配、文件 runtime 与流读取；DB/Core/Controller 执行/ObjectReader 为离线替身，不是真库/存储/模型验收。

## 连续队列

CB-01 生产 ObjectReader/不可变媒体证明及 CB-03 正式媒体 Gateway 依赖继续核对；不能沿用上一轮“没有草稿表”的旧阻塞结论。CB-02 已有持久 create/edit/read/list/receipt/saveCandidates，复用并检查实际消费者。CB-04 本片完成原 WIP 的人工材料出口，不代表聚合正式提交已支持。
随后 CB-05/06/07 复用 Knowledge/Memory 正式生产者并接消费；CB-08/09 核对原事件/影子机制及同事务接线归属；CB-10 员工后端合同；CB-11 原 CAT-GOV 应用；CB-12 最少集中证据。没有公共依赖的部分继续，不用空接口或重复报告算包完成。
