# CB-11 原品类草稿应用消费

在 B 树新增 category-assist/CategoryDraftApplication 与显式 CategoryAssistModule，复用原 CategoryGovernanceController/Service、原 DTO、ApiAuthGuard、平台身份/ALS及 CategoryGovernancePreviewGuard。不是另一套治理内核，也不接全局 AppModule。

实际入口 detail/create/patch/validate/review：原已发布版本复制草稿→分区 CAS 修改→原校验/差异/影响审阅。只接原品类定义，不能自定义代码或脚本。调用者不传 user/scope；平台当前凭据由服务器依赖提供。读回前再次原 Guard 复核；写后撤权会拒绝正文，并标 writeMayHaveCommitted，不能据此盲重建草稿。

publish/adoption 未开放，审阅返回 unavailable。原治理仍处 preview gate，P 适用审批及原正式采用路径未装配；不使用 order 批准消费品类发布，不修改治理开关/内核或政策，不声称 CB-11 整包完成。

定向 node --test tests/ai-native-category-assist-application.test.cjs：2 pass/0 fail/0 skip/0 todo，exit0；补写后撤权后相关复验仍2/0/0/0。实际 Guard/Auth/CAT-GOV Service/Controller/DTO，DB与能力注册依赖为离线替身。ts-node transpileOnly:false；diff --check通过。固定无效 DATABASE_URL、本树绝对 prisma-offline-preload.cjs/lane-b-local-runtime.cjs；AI_OFFLINE_AUDIT=本树 output/category-cb11-audit；TEMP/TMP沿用本树 inspection-lb05-tmp。没有真实DB/发布/部署验证。

Runtime只消费原草稿id/revision和审阅事实，不把checkpoint变批准；Provider无关。本应用只提供明确人类草稿办理，不注册模型工具。后续依赖：P的正式品类批准及原发布/采用合法消费合同、原治理正式开放条件；当前不编造批准接口。

负责人最新要求减少测试脚本：后续优先复用已有定向冒烟，不扩测试框架或深矩阵。
