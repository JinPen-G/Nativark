# LB24 确认与偏好中断恢复（包D）

PersistentMemoryConsentService新增confirmationStatus(原confirm输入)、resumeConfirmation(原confirm输入)。状态明确not_created/confirmation_saved/confirmed/unknown/invalidated；当前身份和动作授权必需。按原tenant/workspace/idempotencyKey读证明，再用原仓储复验owner/audience、内容、revision/ACL、期限及对应_memory操作收据fingerprint，最后复读偏好/证明与当前授权。不创建新操作。

resume对not_created拒绝，不把恢复视作新的同意；只接续已保存证明。完整confirm复用为existing-only内部路径，核对与接续之间证明消失仍unknown，绝不产生新confirmationId。两个COMMIT边界仍不称原子；结果不明只能原operationId核对。修改内容/删除/撤销/过期不复活；输入hash通过既有operationFingerprint和MemoryConfirmationHash关联，不接受caller已批准状态。

一次定向冒烟node --test tests/ai-native-memory-lane-b-resume.test.cjs：1pass/0fail/cancel/skip/todo、exit0。实际服务/身份resolver/Prisma仓储，数据库替身依次模拟确认提交后丢应答、偏好提交后丢应答；证明ID保持一个，查询状态推进saved→confirmed，重放不再消费，修改后invalidated。未生成与恢复拒绝也验证。ts-node真实类型检查；diff --check退出0。固定offline环境和output/lb24-audit。

正式MemoryAuthorization依赖仍需主线提供；真实MySQL提交/并发及HTTP未验。读源不可用可能直接unavailable，不伪报未生成；原始数据库查询异常返回unknown。未新增Controller/模型工具，不扩偏好schema、不读.env/联网/启服务/推送/main/部署。
