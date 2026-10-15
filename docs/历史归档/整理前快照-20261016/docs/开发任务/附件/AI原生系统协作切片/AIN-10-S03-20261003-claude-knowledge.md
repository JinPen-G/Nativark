# AIN-10/S03 有界缓存与索引传播

2026-10-03；树 `.worktrees/claude-ai-native-knowledge-20261003`，分支 `ai/ai-native-knowledge-20261003`，起始 HEAD `6d6a5d7fac64b555a309660be0a7e2a039b37aa3`。

## 实现与接线语义

- 可选本地cache只保存授权后的chunk/source，key含scope、actor、audience、实时accessKey、documentVersion、ACL、chunkId、head revision。每次hit仍读取真实head并再次授权snippet/resolve及read_body，前后比较revision和accessKey。只缓存正文读取，查询结果不缓存。
- 必填maxEntries/maxBytes/ttlMs，零/缺省/过大拒绝；LRU、绝对TTL边界、克隆值、UTF-8序列化字节预算（不是V8实际heap测量）。无定时器；实例自身上限1000条/16MiB/5分钟。
- publication/withdraw/delete/newVersion/ACL变更通过同一repo CAS保存indexJob pending，cache在提交后本地失效；不是跨系统原子事务。即便进程在失效前崩溃，head/version/ACL与publication门控仍使旧cache不可见。
- index coordinator读持久job、调用注入index port，结果按operation/version/ACL/generation匹配且CAS；completed/failed留证，失败不盲重试，新operation重试或人工核对。重复完成无新revision，旧job不能覆盖新tombstone。
- 外部adapter必须实现scope+document单调generation与operation幂等，remove清除该document先前generation（包括旧版本）的检索投影；不得只检查发出时状态。若adapter不支持提交时fencing，不能当生产可用。现有测试只证明服务/内存逻辑，不虚构外部索引已删除。
- ACL修订输入同时交必需authorize回调核对实际ACL记录，不在本模块写权限。正文版本不可变，adapter应读取冻结chunk正文并JOIN当前head ACL投影；不要改写旧正文的内容/locator。查到旧ACL的source一律拒绝。
- parse/index失败枚举写入操作记录，在新尝试成功后仍保留失败证据，不存原异常或凭据。

## 实测

`node --test <本树>/tests/ai-native-knowledge-{lifecycle,access,cache,contracts}.test.cjs`（实际列出4文件）：47/47，0失败/跳过。真正knowledge noEmit零诊断包含本片模块。作者复查修正cache-hit不能续延绝对TTL、remove job不能被解析状态覆盖，补操作失败证据。

覆盖miss/hit、精确TTL、LRU/字节预算/0配置、角色租户版本ACL key差异、撤权hit拒绝、withdraw传播失败仍拒绝来源、ACL修订失效、删除后迟到结果、重复完成、重索引/重新发布。自复查与必要回归；不是独立review。

## 限制

只有内存依赖与离线类型/契约层。没有DB/分布式cache/真实索引、HTTP/Guard、真实附件/供应商/模型/设备验收；未启动服务/端口/定时器，不读.env、无网络尝试、不迁移/安装/推送/合main。根目录/其他树产物未改。公共接线与持久事务/ACL版本来源、fencing adapter、失败重试调度仍归主Claude，不改三份主文档或完成率。

新增knowledge-cache.ts、knowledge-index-coordinator.ts、cache测试及本记录；更新本线ports/validation/document/publication/source。下一片纯文本解析和结构化偏好记忆。
