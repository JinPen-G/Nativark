# CB-06/07 继承的 Memory 模块消费收口

原 human-knowledge.module.ts 为本对话前序 WIP，本次核对差异后单独收口，不夹带其他作者文件。HumanKnowledgeModule.register 在显式 Memory 依赖存在时提供并导出 PersistentMemoryConsentService，复用 preparation.memory 同一个实例；无正式 Memory 依赖时不注册或返回默认授权实现。没有创建第二确认状态机。

原实际组合测试继续驱动创建→解析→索引→发布→偏好提议/明确确认→带偏好材料收集→消费前复验→撤销→读取排除。新增模块消费者检查确实读到同一已确认持久偏好，并验证缺依赖时不导出 Memory 服务。政策/数据库仍为受控替身，不能据此声称正式动作政策目录或文件生产者已齐。

命令 node --test tests/ai-native-knowledge-lane-b-input-composition.test.cjs；1 pass/0 fail/0 skip/0 todo，退出码0。继承 WIP 已有实现，本片没有声称新红测。ts-node transpileOnly:false 加载实际模块；diff --check 通过。绝对本树 prisma-offline-preload.cjs/lane-b-local-runtime.cjs；固定无效 DATABASE_URL；AI_OFFLINE_AUDIT=本树 output/knowledge-cb06-audit；TEMP/TMP=本树 output/inspection-lb05-tmp。

Runtime 消费原门面和 operation/confirmation/revision，不把 checkpoint 当确认；Provider 无关，不安装 SDK、不触发模型。未注册 HTTP/AppModule/worker，不调整 AIN 完成率。

剩余：正式 Knowledge/Memory 动作政策生产者、知识文件真实资源读取仍须主线合法装配；现有 Formal*AuthorizationAdapter 只是当前身份+版本政策的验证消费者，不能假定 owner 或通用订单权限等同知识权。A/R 的最终冻结消费者不归 B 修改，接收固定输入材料合同后再对齐，不跨写。
