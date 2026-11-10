# Harness 插件：开发任务与接入设计

> 专项：Rental OS Harness 插件。
> 版本：v1.1；建立日期：2026-10-28；修订日期：2026-10-28。
> 正式依据：[插件需求](Harness插件-需求.md)。按负责人确认改为MCP优先、Harness首个接入端；服务端生产者统一见[MCP开发任务](../MCP服务/MCP服务-开发任务.md)，本册只管理Harness消费和必要增强。
> 原AGP-01～10和验收分母保持；本次明确调整职责 / 依赖，不重复建设服务端，不提高原0%进度。原AGC任务与v1.5两册在原专项封存，不修改。
> 阶段证据见[开发记录](Harness插件-开发记录.md)，当前现场见[协作接续](Harness插件-协作接续.md)。本轮仅文档修订，不授权实施、安装、真实联调、迁移、提交或发布。

## 1. 实施原则

1. 第一片就经标准MCP访问Rental业务。优先原Harness MCP客户端；原生足够可直接连接，确有缺口才交付独立增强Bundle，不先做插件专用业务API，不重复注册native业务工具。
2. 插件固定UI限于连接、授权状态、空间 / 会话绑定和断开；业务事实、统一说明来自MCP，Harness原Agent自主组织回答 / 文件 / 合规展示，不新建固定业务页、renderer或Agent循环，不改定制Electron / preload / 全局登录。
3. OAuth / grant、后台治理、字段投影、原持久目标 / 限额及业务工具适配由MCP专项及原作者唯一交付。AGP做消费、客户端生命周期与组合验证，不把公共生产者重复算在两项。
4. 未登录只禁Rental访问，原个人功能正常。每个客户端 / 用户 / 空间独立授权，同一MCP连接只由一方持有凭据、刷新、重连和派发；Host会话ID、提示词和UI不是权限。
5. 本地模型自配直连自付，实际云任务沿原Gateway / 单账；不借本地Key，不为确定性工具调用嵌套服务端Agent。
6. 默认凭据文件、同用户进程和插件命名空间不是隔离。按实际外发 / 留存政策消费材料，无法控制的普通Host副本不承诺远程删除；必要选择 / 批准沿原Web，不复制表单。
7. 原客户端、服务端、Web、测试、依赖、下载 / 构建 / 隔离产物及WIP全部原地保留。复用只接唯一作者固定成果，不追活动HEAD或抢写公共文件。
8. 各完整片一次定向冒烟及必要类型检查，实际原版Host / OAuth / 业务 / 发布分别验收；不把本树定制窗口、旧测试或MCP连通代替整体完成。

## 2. 交付架构与复用接点

### 2.1 单一调用通路

```text
Harness原Agent
    ↓
原MCP客户端（Rental Bundle按需补连接 / 授权 / 会话 / 提示词）
    ↓ HTTPS标准MCP，不走插件私有业务API
Rental OS MCP Server
    ↓ 当前grant / 原Auth、Guard、ALS / 字段政策 / 原目标计量
原reader / Core / 请求、批准、Task / 原收据
    ↓ 最少安全结果与版本化业务说明
Harness自主组织内容 → 原聊天 / 文件 / 合规预览
```

插件不是MCP服务可用的前置。原生直连若满足要求，应先验证该路径；独立增强代码拟放`clients/harness-plugin/`，不搬动`clients/agent-desktop/`。具体包名 / manifest / SDK及接入方式由AGP-01与MCP-01固定，本轮不创建源码工程。

控制面OAuth授权 / token / 撤销和原可信Web仍经正式HTTP，这不等于另建业务工具通路。原MCP客户端的能力不足时，只补受支持的MCP客户端授权或连接适配；不注入长期静态headers、不增加私有业务HTTP代理、不让两套驱动同时执行。

### 2.2 已核对接点与缺口

| 职责 | 依据 | 采用方式与限制 |
| --- | --- | --- |
| 原MCP客户端 | [MCP组](../../clients/agent-desktop/harness/packages/mcp/README.md)、[客户端](../../clients/agent-desktop/harness/packages/mcp/mcp-client/README.md) | 已有工具发现、命名空间注册、资源和server instructions；首选复用，原工具完整value仍需安全投影 |
| HTTP与授权 | [运输工厂](../../clients/agent-desktop/harness/packages/mcp/mcp-client/src/transport.ts)、[授权flow](../../clients/agent-desktop/harness/packages/credentials/authorization/src/index.ts) | 所读HTTP工厂只传config.headers，不能据此宣称PKCE / 安全refresh完成；authorization扩展只提供交互，AGP-03落实实际MCP授权适配 |
| Bundle | [打包安装](../../clients/agent-desktop/harness/docs/user/develop/basic/publish.zh.md)、[Plugin Manager](../../clients/agent-desktop/harness/packages/boot/plugin-manager/README.md) | 确需增强才定义`dsh.bundle` / peer / engines及预构建包，不依赖相邻源码或定制壳 |
| 凭据 | [credentials-local限制](../../clients/agent-desktop/harness/packages/credentials/credentials-local/README.md#who-can-read-the-file) | 默认文件不隔离同OS用户工具，需实际读取面、短期凭据及单刷新所有者证据，不用普通配置文件承载长期grant |
| 注册及执行生命周期 | [tools](../../clients/agent-desktop/harness/packages/core/tools/src/index.ts)、[工具约定](../../clients/agent-desktop/harness/docs/cookbook/adding-a-tool.md) | MCP客户端注册业务Tools，Rental不重复注册；scoped绑定、取消 / 重连与释放须核对，guard不替代服务器复验 |
| 提示词 | [system-prompt](../../clients/agent-desktop/harness/packages/core/system-prompt/src/index.ts)、[组装说明](../../clients/agent-desktop/harness/docs/subsystems/system-prompt.md) | 消费MCP同源instructions / 指引；必要时用会话section / context补加载和Host能力说明，不用complete覆盖原提示词，不重复注入 |
| 输出 | [Tools](../../clients/agent-desktop/harness/docs/subsystems/tools.md)、[Document Preview](../../clients/agent-desktop/harness/packages/client/ui-sidebar-documentpreview/README.md) | 保留完整value / 文本 / meta语义；静态HTML与脚本模式分别验实际权限，不因iframe存在就当同等隔离 |
| 连接UI与可信页面 | [Slots](../../clients/agent-desktop/harness/docs/subsystems/slots.md)、[Browser限制](../../clients/agent-desktop/harness/packages/client/ui-sidebar-browser/README.md) | 原公开插槽及可信系统浏览器；不依赖`sidebar.rental.*` / `globalThis.rentalDesktop`，不复制后台选择 / 批准页 |

接口存在与源码核对不代表原版安装、真实OAuth或安全组合已验收。MCP客户端默认等待 / 重连与SDK行为不能直接沿用为业务限额，必须落实15秒只读、30秒提交、只读瞬时最多1重试与副作用不自动重发等原要求。

### 2.3 登录到调用顺序

1. MCP-01 / 02交付固定资源、登记client、OAuth / PKCE / issuer / callback、grant / scope及撤销；AGP-02核对接入合同，03消费真实授权并落实安全凭据。
2. 人在可信Web登录 / 改密、同意并选空间；Host只取得安全状态，敏感凭据不进模型、普通配置或日志。原客户端可用则不另做登录驱动，缺口由必要适配补齐。
3. 当前会话明确绑定MCP连接 / grant及scope，AGP-04消费MCP工具及说明，其他会话 / fork / 子Agent不自动继承。
4. 首次自动调用先经MCP-04原持久目标准入。Harness捕获原关联，MCP逐次复验当前权限 / 版本 / 额度后调用原业务；客户端不能靠隐藏工具或自报人工免计量。
5. MCP-05投影后的完整事实与说明交Host；AGP-05落实可控输入 / 文件 / 派生材料与256 KiB组装上限，缺严格控制证据不消费该类资料。Harness自主呈现，不返回固定业务页面。
6. 保存 / 建单 / 云任务只经MCP对接原请求 / 提案 / 批准 / 执行与收据；unknown只读原键。退出 / 停用停止新调用，不推定远端回滚；连接重试不重放原动作。

### 2.4 唯一作者与消费者

| 生产者 | 唯一交付 | AGP消费者责任 |
| --- | --- | --- |
| MCP-01 / 02及原身份作者 | 协议 / client合同、OAuth / grant、后台政策 / 撤销 | 01 / 02核对原版兼容和状态；03只做客户端授权 / 凭据，不再实现AS或治理页 |
| MCP-03 / 05及原能力作者 | 标准工具发现、参数 / 结果schema、字段与业务说明版本 | 04单连接 / scoped消费与指引加载，05安全材料适配，不重复工具定义 |
| MCP-04及原操作 / 资源作者 | 持久目标、原子计量、原键 / 本人索引和收据 | 06消费引用、限额 / unknown及独立核对，不建本地替代账本 |
| MCP-06 | 目录 / 可用性 / 原订单事实 | 07实际Harness端工具到自主回答链 |
| MCP-07 / 08与原Web / Core作者 | 原选择、报价提案、批准 / 唯一建单 | 08固定Web导航、MCP输入 / 状态 / 收据消费，无模型批准按钮 |
| MCP-09与原Task / Gateway作者 | 已有任务回读、有限云受理和原取消 | 09费用 / 状态 / 原键及跨端消费，不建第二执行器 |
| MCP-10 / AGP-10 | 服务端标准与跨Host矩阵 / Harness适配验收 | 共用同一端到端证据，分别声明范围，不能自动互算完成 |

共同安排的是固定交付，不是在两个专项派两个人写同一个后端。实施并行须独立工作树，公共schema / Guard / OpenAPI / 迁移 / 后台各有唯一作者。

### 2.5 自主呈现

MCP-05唯一维护通用业务说明与展示指引；Tools描述提供必需语义，server instructions按Host支持加载，Prompts只是可选模板，不能假设自动生效。AGP-04只补当前会话加载 / 去重 / Host能力说明及版本追踪，更新和卸载不残留新的执行资格、不污染个人会话。

MCP结果是必要事实、单位 / 币种、范围 / 覆盖、来源 / 时点、版本及原状态，不是整页HTML模板。Harness可按用户目标生成文字 / 表格 / 图表 / 报告 / 展示文件；AGP不新建业务renderer。生成物、代码字面量、隐藏节点、截图和导出遵守同一字段释放 / 保存政策，普通Host副本不冒充插件可控缓存。

静态 / 交互预览按真实脚本、网络、凭据、文件、存储和消息能力验证；不为呈现关闭保护，不在可信插件Host执行生成代码。不能满足材料要求时用安全文本 / 静态结果或拒绝该类资料，不建私有权限旁路。纯展示重排不重新报价或重执行业务，必要原事实核对与批准仍在可信Web。

## 3. 插件任务与跨专项依赖

| ID | Harness侧交付 | 研发进度 | 依赖 | 对应需求 | 主验收 |
| --- | --- | --- | --- | --- | --- |
| AGP-01 | 原生MCP兼容核实与必要增强Bundle / 复用清单 | 75% | MCP-01共同固定协议 / 客户端合同 | R01、R10 | A01、A10 |
| AGP-02 | MCP授权 / 后台准入合同及安全状态消费 | 0% | 01；MCP-01 / 02固定合同 | R02、R03 | A02、A03 |
| AGP-03 | MCP客户端登录、凭据、刷新 / 恢复与断开适配 | 25% | 01、02；MCP-02身份 / 撤销出口 | R02、R05 | A02、A04 |
| AGP-04 | 单MCP连接的会话绑定、工具 / 指引消费与释放 | 50% | 01、02、03；MCP-03 / 05说明出口 | R03、R04 | A03、A06 |
| AGP-05 | Host输入 / 输出、凭据旁路与生成材料生命周期 | 25% | 03、04；MCP-05字段 / 材料政策 | R04、R05 | A04、A05 |
| AGP-06 | 原目标 / 限额 / 操作引用及unknown恢复消费 | 0% | 02、04；MCP-04原计量 / 收据出口 | R08 | A08、A09 |
| AGP-07 | Harness目录 / 可用性 / 原事实MCP调用与自主呈现 | 0% | 04、05、06只读部分；MCP-06 | R04、R06 | A06 |
| AGP-08 | 原选择 / 报价 / 批准建单的MCP与可信Web消费 | 0% | 07、05 / 06副作用部分；MCP-07 / 08固定交付 | R06～R08 | A07、A08 |
| AGP-09 | 原任务结果与有限云任务MCP协同消费 | 0% | 04、05、06；MCP-09；建单协同追加AGP-08 | R09 | A09 |
| AGP-10 | Harness原版连接 / 增强、呈现与故障升级验收 | 25% | 随01～09各片，与MCP-10共享固定组合证据 | R01～R10 | A01～A10 |

登记研发等权汇总 **20%**；正式验收 **0/10**。AGP-02 / 06等不再重复承担服务端建设：MCP生产者通过只是AGP的依赖到位，只有真实Harness消费者达到本项门槛才记AGP进度。原生能力覆盖无需新增代码时须说明覆盖证据和仍需验收的行为，不能以“无需开发”自动填100%。

## 4. 联合切片与验证

### 4.1 合同、授权与目录首片

MCP-01与AGP-01先固定目标Host及协议、原生足够 / 增强缺口、client / resource与材料合同；MCP生产者不等待插件Bundle完成。02 / 03消费统一授权，04 / 05 / 06按固定出口衔接。MCP-02 / 03 / 04只读计量 / 05 / 06目录齐备后，07与两侧10闭合后台开通、OAuth、当前会话、Tools读取、自主呈现、撤权拒绝。

- 独立包仅含必要增强，不含后台构建副本、业务凭据或相邻源目录依赖。原版直连不强制安装空包。
- 使用实际OAuth / callback / refresh / 撤销入口；验证取消 / 迟到、并发刷新、断开远端失败状态、跨scope及伪造缓存。默认headers例子不是安全存储方案。
- 验证一个连接只一份业务工具注册及驱动；已缓存 / 嵌套调用仍在MCP服务器拒绝。原MCP重连不能重复模型动作、原报价或任务。
- scoped提示词与instructions固定版本、去重、更新 / 释放；缺Prompts支持时Tools可用，指引未加载或被忽略仍不能越权。不得只放没有消费者的提示词文件。
- 完整value / 文本 / PTC / meta / 错误投影一致；有界资料用于多种形式时保留必要事实 / 缺项，不把目录首片报告为报价或建单完成。

### 4.2 材料、计量与恢复

AGP-05明确Host实际输入、暂存、日志 / 历史、摘要 / 文件 / 附件、导出 / 恢复的读取与控制范围；30天业务缓存 / 7天临时附件及更短期限只对真实可控链作保证，普通副本不能伪称已删除。精确目的地、组装256 KiB和每次发送等需要Host证据的要求不因MCP单结果受限就自动满足。

AGP-06读取MCP-04原目标 / 操作关联，跨重启 / refresh不重置；保留原键与unknown，首应答丢失走本人原索引，不猜latest。人工复核、协议发现、自动调用和原收据核对分类由服务端决定，客户端不自报豁免。SDK / HTTP自动重试、等待和取消的实际行为必须纳入验证，不拿断线证明回滚。

### 4.3 业务扩展

| 功能片 | 消费路径 | 拒绝 / 恢复 |
| --- | --- | --- |
| 可用性 / 原订单事实 | MCP-06受权事实 → Harness自主解释 | 不支持品类 / 缺资格 / 缺支付记录 / 缺历史如实表示，读不发云模型 |
| 报价 / 提案 | MCP-07 → 原Web真实选择 / 绝对时间 / 时区 → Core结果回读 | 人类选择不由模型声明；保存丢应答读原键，不重复创建 |
| 原批准建单 | MCP-08唯一执行 → 原收据 | 模型自批 / 旧批准 / 双端竞争拒绝，unknown不换连接重发，资金不开放 |
| 协同 | MCP-09先读已有结果，再有限云发起，后建单协同 | 读不新建run，费用分路，关Host / 取消不伪称任务丢失或回滚，无递归委托 |

依赖均是固定子交付，不制造AGP-08整体等MCP-08、MCP-07又等全部客户端的循环。正式选择页与报价片一起接，建单仍后置；09先已有结果，不等全部建单。

AGP-10记录Host / MCP SDK / 插件 / schema / 说明 / Web版本及原生安全呈现模式，做必要真实Host验证；其他客户端归MCP-10，不在插件册再计一份。自动化、类型、构建、真实模型 / OAuth / 数据库、正式验收和发布分别报告。

## 5. 成果保留与原职责映射

| 保留成果 | 可复用 | 不能继承的结论 |
| --- | --- | --- |
| 原AGC完整Harness、许可、runtime和构建资料 | 上游扩展点、兼容与依赖参考 | 定制窗口启动不等于原版MCP / 插件组合通过 |
| 原生桥、preload、`sidebar.rental.*` / workbench | 撤回、来源期限与纯展示参考，原源码 / WIP全部保留 | 不作为新插件强依赖，不将人工`human_preview / not_sent`直接变MCP模型结果 |
| 原admin / desktop-business / shared协议 | 原Web、Auth / 政策、schema / 有界读取与审计 | Web token不交插件，旧合同不冒充MCP资源身份 |
| 原Core / 任务 / 批准 / 操作 / 资源 | 由MCP及原作者提供固定业务生产者 | 实现存在不等于任何客户端消费完成，不接管并行WIP |
| 插件v1.0文档与调研 | 原安全 / 自主呈现要求保留，改向前像在开发记录定位 | 私有API先行不再是当前安排；服务器部分分别归MCP-02 / 04 / 05～09 |

原[AGC需求](../Agent接入改造/Agent接入改造-需求.md)、[任务](../Agent接入改造/Agent接入改造-开发任务.md)与[封存接续](../Agent接入改造/Agent接入改造-协作接续.md)不改原字节、编号和进度。提取复用保留出处 / 许可，不删除实现、测试、output或隔离产物；恢复定制客户端须另授权。

## 6. MCP与独立服务端路线

MCP正式任务是[MCP-01～10](../MCP服务/MCP服务-开发任务.md)，不再按旧v0.3的MCP-P1～P7另派工。当前联合首片、独立分母：MCP记服务生产者 / 标准兼容，AGP记Harness消费 / 增强，原AGC及AI Native不并入。

原AI Native仍按[原任务](<../AI Native/AI Native-开发任务.md>)服务Web / 官网 / 小程序 / 巡检 / 协作，不因本次MCP方向取消或改Runtime。MCP只复用原业务，不借客户端Key或让同一模型 / 业务动作由两套驱动执行。

## 7. 进度与执行边界

沿G1真实入口 / 消费者与可实施设计、G2主实现、G3装配及定向自动化 / 类型、G4完整变体和所需真实环境四个连续25%门槛。下载、文档、接口名或原生产者通过不等于客户端达到门槛，不合成两专项总百分比。

验证前读实际package及脚本；离线Node使用本树既有preload、固定无效DATABASE_URL与绝对audit / writeRoot / TEMP / cache，不覆盖shared / Prisma产物或复制别树绕保护。本轮只核查文档链接、编号、职责依赖及保全，不启服务 / 浏览器 / DB / 模型，不安装、迁移、提交、合main、推送或部署。
