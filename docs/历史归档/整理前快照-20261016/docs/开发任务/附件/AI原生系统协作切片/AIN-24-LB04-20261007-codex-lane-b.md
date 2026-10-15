# Lane B 04：冻结入口的统一离线威胁回归

前置 `ae1d4221`。施工树/分支不变；只写 evaluation、新测试及自己的文档，公共鉴权、runner、审批、预算、shared 和 schema 均未改。

## 实际实现与文件

- `evaluation/offline-threat-suite.cjs`：17个冻结真实测试入口、两进程上限、每文件60秒/输出1MB上限，固定无效DB及显式guard/local preload。只接受清单ID，拒绝路径/URL/重复ID，默认导入不启动。输出白名单计数/证据级别，退出码非0、超时、计数缺失、skip/todo不变绿；不透传原始异常。
- `evaluation/evaluation-audit.ts`：自查发现任意大写result.code可能成为不可信文本通道，改为消费shared现有AI_ERROR_CODES和内部OK标记；成功/错误码不能混淆。新增SSR证据分类，未升级为浏览器证据。
- `ai-native-lane-b-threat-runner.test.cjs`：运行器的选择、失败/缺计数/超时/skip与脱敏投影测试；这些是工具测试，不是业务安全通过。
- `ai-native-lane-b-render-security.test.cjs`：实际ModelText React SSR转义HTML/危险链接、工具候选不执行及超长文本上限。只读导入既有组件，不修改UI或vendor。
- `ai-native-lane-b-audit.test.cjs`：补结果码闭集红测。
- `AIN-24-威胁模型-20261007-codex-lane-b.md`：攻击者/资产/信任边界、实际方法/套件/证据及未覆盖项。
- 本记录。没有新建服务器工具目录或任意网络/终端执行功能；CLI只执行冻结的本地Node测试文件，不注册生产模块。

## 红测、失败过程与绿测

全部命令：两个preload见LB01；固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`，AI_OFFLINE_AUDIT 为本树绝对 output/lane-b-*.audit。CLI子进程通过argv显式加载相同preload，NODE_OPTIONS置空以免Windows参数转义；实际网络执行仍是明确替身。

1. `node --test tests/ai-native-lane-b-threat-runner.test.cjs`：实现前模块缺失，pass0/fail3/skip0，退出1；不是已有业务缺陷。
2. 工具实现后同命令：pass3/fail0/skip0，退出0。
3. 首次CLI17项尚未扩展（当时14套）：所有子进程快速退出1、无测试计数，CLI正确退出1。修正预加载参数传递为显式argv后，14套共205项通过；不把最初失败删掉。
4. 审计码自查红测 `node --test tests/ai-native-lane-b-audit.test.cjs`：pass3/fail1/skip0，退出1，任意结果字符串被接受。闭集修复后pass4/fail0/skip0。
5. 追加实际SSR与既有资源争抢、预算unknown/replay入口，单独回归通过；最终以以下一轮为准，不相加历史数字。

### 最终同轮

`node apps/api/src/modules/ai-native/evaluation/offline-threat-suite.cjs`：17/17文件退出0；测试pass240/fail0/skip0/todo0，CLI退出0。逐套计数：access11、cache8、parser6、knowledge-flow24、memory11、authority3、memory-revocation2、egress43、config6、router29、approval3、budget-C03 4、budget-C01 5、execution-budget28、authorized-recovery15、capability40、SSR2。

之后 `node --test tests/ai-native-lane-b-audit.test.cjs tests/ai-native-lane-b-threat-runner.test.cjs`：pass7/fail0/skip0/todo0，退出0。未把这7项工具验证称为新的业务威胁通过。

全API TypeScript noEmit：方法同LB03（读取API tsconfig，解析本树shared源码/隔离Client，不生成文件），diagnostics=0，退出0。`git diff --check` 退出0。MERGE_HEAD检查不存在的退出1为正常只读状态探测，不是测试失败；分支仍为lane-b。

## 交接与准确剩余

本批已有固定提交：LB01 `50615b3c`（3红→185绿）；LB02 `1f24635f`（2红→74绿）；LB03 `ae1d4221`（格式3红→3绿）；本片SHA由git提交输出取得。不要把各阶段重叠回归相加为主线全量。

AIN-10当前代码侧：原解析失败显式新操作重试、支持格式/上限、记忆修改/删除和文档注入边界通过实际既有服务回归。本批确实修复了授权等待别名与身份变化、下载权限修订、记忆确认撤销传播。没有另造知识系统或默认成功授权。

仍需主线接线/后续用例：正式ACL/确认生产来源、共享/外部索引传播、真实下载HTTP门；财务预算最后额度并发的service+Prisma完整负例（本集资源争抢不能替代它）、审批Core同事务组合与真实Vault隔离。详见威胁模型。这些未覆盖项不能标完成，不以“只剩环境”概括。

真实DB/锁/迁移、HTTP/DNS/模型/支付、浏览器/微信设备、生产灰度均未验；语言质量/人工耗时/修正率未采样。没有确认的跨模块生产缺陷，不跨边界修复；独立Review待主线。17套通过仅说明冻结入口的本轮离线结果，不代表全部威胁或任何AIN整项验收。
