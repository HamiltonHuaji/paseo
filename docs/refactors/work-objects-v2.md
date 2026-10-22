# Paseo Works v2：需求与模块设计

状态：0.9 fork 已有实现和发行记录；[当前阶段迁移](../contracts/README.md#当前迁移范围)尚未迁入本模块。长期行为与 baseline bump 验收由
[Paseo Works 契约](../contracts/works.md)维护。本文保留接口、模块与实现参考；
§10 是验证范围，不是每个版本都已通过的证明。`paseo-works` 是随项目打包的 agent skill，随正式 daemon 更新安装；开发和测试不将其写入用户的全局 skills。客户端功能名为 **Works**（中文“工作”）。

## 1. 目标与边界

让用户从 Paseo 找到正在进行的工作、相关会话和已经产生的成果，无需记住 agent 把文件放在哪里，也无需维护一套工单流程。工作可以是实验、软件开发、资料整理、分析或其他成果制作。

保留两层展示：Canvas 上的 Card 表达用户能认出的工作领域或成果；Card 内的 Item 列表表达具体工作。对象组合可选组件，不采用类继承。Experiment、Topic、Attempt、Issue 是创建预设，不是四套独立服务。

| 场景                                          | Card                | Item 与可选能力                                               |
| --------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| 训练、评估、比较配置                          | Experiment          | 各次运行用 Attempt；按需附加进度、指标、结果和 viewer         |
| 同一 run 的初次运行与续跑                     | Experiment          | 两个 Attempt 分别记录执行；Metrics、Progress 可引用同一数据源 |
| 维护模块、修 bug、增加功能、跟随上游 backport | Topic               | 具体工作用 Issue；排障、实现、验证和整合可以属于同一个 Issue  |
| 建立论文库或主题资料库                        | Topic               | 首次整理和后续更新可用 Item；索引、材料与查看入口归入该工作   |
| 制作分析报告、图表、可交互页面                | Topic 或 Experiment | Item 记录具体制作或分析；一次性交付也可以有稳定归属和入口     |
| 按条件筛选文献、检查网站并交付问题清单        | Topic               | 交付整理后的材料或检查结果；不要求修改源文件或持续维护        |

不因任务产生了文件、用了工具或耗时较长就强制登记。咨询建议、聊天内创作和常规文件操作的适用边界由 [paseo-works skill](https://github.com/HamiltonHuaji/paseo/blob/1bd70fb5056d623e8da784dce82d8ee72fa5f486/skills/paseo-works/SKILL.zh-CN.md)规定。产品提供记录与展示能力，skill 负责让 agent 在适当的时候查找、创建、维护记录并交付入口。

保留 v1 的 Goal 分组、Card 间的 basedOn 来源关系、viewer 配置继承、会话参与记录和 CLI。首版不包含第三层工作对象、评论流、指派人、优先级、排期、通用任务状态机、自动委派、作业调度或 worktree 管理。本地 W&B 来源提供指标和可用的 artifacts；云端指标暂列 TODO，见 §6.5。不在 daemon 运行完整 W&B 前端让客户端代理访问。

## 2. 与 v1 并存及复用范围

v1 保留原有行为。两版的数据、业务入口和对象引用互不连通；不导入、不迁移、不双写，也不提供 v1 字段或工具调用的兼容层。

| 部分                         | v2 决定                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| 项目、workspace、agent 会话  | 使用现有独立实体及其标识；不复制这些基础设施                                          |
| 工作记录和 storage           | 使用项目根目录下的 `.paseo/v2/`；不读取 `.paseo/v1/`                                  |
| 客户端入口与缓存             | 新增 Works 入口，放在原 v1 入口旁边；路由、查询键、布局及选择状态独立                 |
| 控制接口                     | 新增 `work.*` RPC 和本文定义的 MCP 工具；v1 的 experiment 接口保留                    |
| Skill                        | v2 为 `paseo-works`；v1 的 `track-experiments` 保留，不作为 v2 回退入口               |
| Viewer host                  | 共用现有服务实例、监听端口、启动配置和内部 `viewers` 服务注册                         |
| Viewer HTTP 转发与客户端代理 | 共用现有 GET／HEAD 传输、连接、流控、端口管理和取消机制                               |
| Viewer 业务路由              | v1 路由和首页保留；v2 使用 `/view/v2/`，各自解析本版记录                              |
| 可复用纯逻辑                 | 静态文件响应、目录枚举、Canvas 布局与进度轨道绘制可提取复用；不让 v2 依赖 v1 记录形状 |

共享 host 的路由装配分离传输设施与业务 resolver。v2 resolver 只读取 v2 的 Viewers；W&B reader 不引用 ExperimentService。v2 路由先于 v1 的通配路由匹配，未知的 v2 路径不得落入 v1。

新增 `server_info.features.works` 能力位，在入口与工具注册处判断一次。缺少能力时说明 daemon 不支持 Works，不通过 v1 模拟。沿用仓库的[协议规则](../protocol-compatibility.md)增加独立消息；这不要求两版业务模型兼容。

## 3. 对象、预设与生命周期

### 3.1 内置字段

Card 和 Item 是不同结构类型，复用字段和组件 schema；统一处理使用 `Card | Item`。不引入 ECS 框架、继承链或 Placement 组件。

| 字段                     | 约束                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `id`                     | daemon 生成，Card 用 `card_`，Item 用 `item_`，后接 8 位随机小写十六进制；碰撞时重新生成，创建后不变 |
| `kind`                   | 分别为 `card`、`item`，由操作入口决定                                                                |
| `parentCardId`           | 仅 Item 存在且必填，引用同一项目的 Card                                                              |
| `label`                  | 必填、持久保存的业务身份，创建预设确定                                                               |
| `title`                  | 必填，非空标题；不人为限制字数                                                                       |
| `body`                   | 必填，非空白 Markdown；完整保存，保留原始排版                                                        |
| `createdAt`、`updatedAt` | UTC 时间；createdAt 为创建时间，updatedAt 表示最近实际活动，规则见 §3.5                              |
| `startedAt`、`endedAt`   | 可选的实际工作／执行起止时间；未有依据时为 null，不用创建、归档时间替代                              |
| `touches`                | daemon 维护的自动参与记录，每个对象与会话保留最近参与时间；与 Sessions 组件分开                      |
| `archivedAt`             | 默认 `null`；用于隐藏与恢复记录，不表达完成或成功                                                    |
| `goal`                   | 仅 Card 的可选分组，接口使用名称，内部引用项目内的 Goal 记录                                         |
| `basedOn`                | 仅 Card 的可选来源 Card ID；与 Item 的父关系分别保存                                                 |
| `viewerSource`           | 仅 Card 的可选 viewer 配置来源 Card ID；不改变 basedOn 血缘                                          |

标题与内容让每个对象都能被辨认和独立阅读，因此是内置必填字段。Label 决定基础展示，不从组件反推；两个不带任何组件的 Card 也必须能区分 Experiment 和 Topic。

父关系只有 Item 上的一份 parentCardId，不保存冗余子项数组。Card 不能有父对象，Item 不能包含子项；首版不提供改换 kind 或父对象的操作。label 应稳定使用，但允许显式更新为同一 kind 下的其他 label；修改不增删组件，也不改 ID 或 storage。

### 3.2 创建预设

| `preset`     | 创建类型 | 持久化 `label` |
| ------------ | -------- | -------------- |
| `experiment` | Card     | `experiment`   |
| `topic`      | Card     | `topic`        |
| `attempt`    | Item     | `attempt`      |
| `issue`      | Item     | `issue`        |

预设接收标题、内容和可选组件，一次完成创建。调用者不重复传 label。以后修改预设不会重写已有对象。

所有预设都有 storage，但默认不附加组件。通过 agent 工具创建或更新时，linkCaller 默认为 true：有调用会话则按 §3.5 记录 touch；显式 false 或没有调用会话也能写入。嵌套创建的 Item 各自使用相同规则。没有直接 Viewers 配置时仍可按 §5.3 继承可用配置。

所有预设配对均可用：Experiment 下可以有 Issue，Topic 下也可以有 Attempt。创建对象不会创建会话、worktree、进程或外部任务。

Attempt 的身份是一次执行：新运行、重试、续跑都创建独立 Attempt，分别保存当次输入、代码状态、时间和结果，即使使用同一个 W&B run。一次执行的失败、成本和部分产物也是有用事实，不能用下一次覆盖。开发关注最终代码状态，中间编辑过程通常不需要逐次保存为工作记录。Issue 的身份是待解决的问题或要实现的变化；排障、修改方案、编译失败后的修正和验证通常都在推进同一个交付，继续更新该 Issue。需要独立保留和比较的开发方案或执行也可另建 Item，不按 ML／非 ML 的名称机械划分。

### 3.3 结果、归档与引用

完成状态属于可选 Result 组件。它同时保存结果文字与 completed 状态；附加 Result 不等于完成，完成也不等于成功或归档。不带 Result 的 Item 仍显示在列表中，只不显示完成状态控件。Issue 不要求走一套工单流程，用户继续反馈时可更新同一 Issue 并重新标为未完成。

`update_*({archived:true|false})` 设置或清除 `archivedAt`。默认列表只显示未归档对象；`archive` 筛选接受 `active`、`archived`、`all`。Card 的归档不批量改写其 Item；恢复 Card 后，Item 仍保留各自的归档状态。按 ID 读取归档对象仍可用，详情明确标记归档。

归档不停止进程、不清理 storage、不取消会话关联，也不撤销已发布的数据或 viewer URL。取消发布时清空当前对象的 mounts、sources、entries，并保留空的 Viewers 组件；仅移除组件可能恢复继承。首版不提供永久删除对象或清空 storage 的操作，避免把整理展示与删除代码、checkpoint、源数据绑定。

组件按各自契约处理配置，Viewers 保留 §5.3 的配置继承。配置继承不建立 OOP 类型继承。显式跨对象引用限于同一项目的 v2 对象；会话被删除、文件不可读或来源配置被移除时保留引用及原因。

### 3.4 Card 之间的关系与分组

basedOn 保留 v1 的来源关系，例如从基线实验派生另一个实验，或从已有工作继续一个独立方向。创建、更新 Card 时直接填写来源 ID，清空用 null；不增加专用 derive 工具，也不限制两张 Card 的 label。详情显示来源与派生 Card，Canvas 绘制连线并保留按来源树整理布局的能力。它不建立对象包含关系或复制文件；Viewers 可按自己的规则用它查找配置来源。

Goal 保留 v1 的按名称分组方式，Card 创建、更新可指定名称，未存在时建立分组；null 表示不分组。Goal 只有分组用途，不成为第三层工作对象，也不管理 Card 生命周期。列表有未分组区域，来源关系可以跨分组。Goal 目录仍属本项目的 v2 数据，不与 v1 共用；不因支持分组而要求 agent 先建目录或填写额外元数据。

### 3.5 活动与时间

updatedAt 用来回答“这项工作上次有动静是什么时候”。元数据修改、自动 touch、读取到新的进度／日志／W&B 记录或新的 artifact 都可更新它；Item 有活动时也更新所属 Card，使实验卡片反映其执行的最近动静。展示时给出距今时间，不能将长时间无变化直接判定为作业死亡。

成功发起查询、重复读取相同数据、重复遇到相同错误都不算工作的新活动。checkedAt 记录最近检查时间。活动时间优先使用来源的实际事件时间，没有时使用首次观察到该变化的时间；updatedAt 取已有值与新活动时间的较晚者。不能每次打开页面都把历史数据当成刚发生的活动。后台、无客户端时仍沿用按需观测，显示的是已知的最近活动。

startedAt／endedAt 可由 agent 在有已知执行时间时填写，也可从与该执行一一对应的进度来源取得。首次附加 Result 时自动填写尚未记录的 startedAt；completed 变为 true 时自动填写 endedAt，重新打开时清除 endedAt 并保留 startedAt。调用方显式提供的实际时间优先；再次更新已完成结果不重置完成时间。设置起止时间不强制附加 Result。共享 W&B run 的起止信息不自动写成每个消费者 Item 的执行起止时间，也不自动完成它们。

touches 是对象的内置字段，条目为 `{agentId,lastTouchedAt}`。agent 成功创建或更新对象后记一次 touch；修改 Item 同时 touch 父 Card，各对象分别保留每个会话的最新时间，后续修改另一个 Item 不抹掉旧 Item 的参与记录。linkCaller 默认为 true，显式 false 可跳过本次自动记录；没有调用会话也能写入。

根据活跃会话最近 touch 的对象与 Agent 状态展示当前执行情况，根据对象的 touches 展示过去参与者。普通读取、进度轮询不制造 agent touch；它们发现新活动时可更新 updatedAt。CLI 在有 PASEO_AGENT_ID 时沿用调用会话传递。自动参与属于 v2 对象状态，不再保存为 Agent 上的 v2 workTouches，也不读取 v1 experimentTouches。

## 4. 持久化、storage 与写入一致性

### 4.1 项目归属与目录

使用现有 Project 的持久化 `root` 与 `projectId`。同一项目的多个 workspace 访问同一组记录；agent 的 cwd 和 worktree 路径不决定项目归属。MCP 从调用上下文解析项目；不能唯一解析时返回 `project_required`，不猜测最近使用的项目。

```text
<project-root>/.paseo/v2/
  state.db
  blobs/
    shared/
    cards/<card-directory>/
      items/<item-directory>/
  cache/
    wandb/<source-cache-key>/
```

沿用 v1 的文件组织约定：Item 目录嵌套在所属 Card 下，保留可读、可按时间排序的目录名，以及项目共享的 `blobs/shared/`。按 Item ID 独立寻址由数据库完成，不要求文件系统平铺。`storage` 是接口中的存储信息字段，不要求物理目录也叫 storage。

| 目录 | 命名规则                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------- |
| Card | `YYYYMMDD-HHmmssZ-<slug>-<card-id>`，使用创建时的 UTC 时间                                     |
| Item | `DDDDd-HHhMMmSSs-<slug>-<item-id>`，使用距 Card 创建时的非负经过时间；天数至少四位，其余各两位 |

slug 由 daemon 根据创建时的 title 生成：Unicode NFKC 规范化、转小写、保留 Unicode 字母和数字（含中文），其余连续字符转换为一个 ASCII 连字符，合并连字符并去除首尾连字符；按完整 Unicode 码点截到最多 96 UTF-8 字节，再去除末尾连字符。结果为空时分别用 card、item。完整目录相对路径创建时持久保存，后续标题修改不重命名目录。

Card 自身的文件直接放在其目录中，Item 的文件放在各自目录中；不专门划出 viewer 文件目录。`blobs/shared/` 存放不同 Card 共用的脚本或材料。`cache/` 只存新增指标功能可重建的派生数据，不替代任何产物目录。

state.db 保存 Card、Item、Goal、内置 touches、组件配置、最新进度观测及 Canvas 布局。Card、Item 使用各自的表，touches 按对象与 agent 建索引，Sessions 单独保存。支持父关系、basedOn、Goal、label、归档状态、创建顺序和两种会话关联查询。指标历史的派生索引放在 cache，不写入对象正文或控制消息。

对象创建时先保存记录与目录相对路径，再创建目录；归档或修改组件不改路径。获取 storage 时使用 recursive mkdir 补齐缺失目录，返回对象的绝对 `storage.path` 和项目共用的 `storage.sharedPath`，不要求 agent 拼接目录。此操作可以重试；创建空目录不代表恢复了原有文件，具体成果是否存在仍由实际访问判断。

不强制迁移已有文件到 storage。用户指定的路径和既有数据可通过正文或 Viewers 登记。缓存可重建，storage 不按缓存策略回收；数据库、storage 和外部挂载文件的备份范围应能分别识别。

### 4.2 Worktree 使用原则

**不增加 worktree 组件、专用 API、资源表或后台生命周期管理。** Agent 获取对象的 storage 后，自行使用普通 Git 工具在其中创建 worktree、分支和需要的子目录。

需要保留的产物与可清理的 worktree 分开放置，例如 `<storage.path>/worktrees/<name>` 与 `<storage.path>/results/`。这些子目录由 agent 按任务选择，不是 daemon 强制建立的结构。代码基线、整合目标、已保存的 ref 和恢复说明写入 body 或 Result。

并行修改或运行中的实验需要相互隔离的代码副本。保存可恢复代码、检查活跃进程、整合和清理由 agent 负责；对象归档、会话退出和 daemon 重启都不触发 worktree 删除。继续使用 skill 里的保存与释放原则，但不承诺 daemon 会替 agent 完成它们。

### 4.3 创建、更新与并发

组合创建先在一个数据库事务内保存 Card、首批 Item 和分配的目录路径，提交后再建目录。数据库事务失败不产生目录；提交后 mkdir 失败保留记录，返回已创建对象的 ID 和 storage 错误，下次获取 storage 时重试。无需目录预分配、失败清理或启动扫描清理，也不把文件系统和数据库拼成跨资源事务。

写入量按个人项目使用规模设计，使用普通串行写入与短数据库事务。更新只合并请求中出现的字段；同一字段后写生效，不同字段和集合键互不覆盖。不增加 revision 条件写、幂等 key 或高并发写入机制。创建响应不明时先查询，避免盲目重发创建。

元数据事务不执行外部命令、不解析 W&B 历史。挂载、来源与条目允许先登记后产出文件；实际读取时报告不可用原因，不要求创建前探测资源。对象是否已保存与页面是否可访问分别报告。

## 5. 组件契约

每种组件在一个对象上最多出现一次，内部可包含集合。使用确定的组件 schema，配置与 daemon 维护的观测分开。只保留操作所需的类型、必填信息和所属关系约束，沿用已有传输与文件访问边界；不增加任意文本长度、集合数量、资源就绪或未知附加字段的拒绝规则。

创建输入用小写具名字段：sessions、viewers、progress、metrics、result、config。未提供就不附加直接配置。更新时省略表示不改，null 表示移除直接配置；Viewers 移除后可恢复继承，其余组件移除后不显示。Result 按字段更新，Sessions 与 Viewers 按成员或键修改，Progress、Metrics、Config 完整替换。

### 5.1 Sessions 与 Result

Sessions 保存适合持续讨论或继续这项工作的会话，是显式、稳定的关联。自动 touches 记录实际参与操作的会话；执行一次操作不会自动加入 Sessions，加入 Sessions 也不伪造 touch。两者分别读取和展示，用户可以找到熟悉该工作的会话，也可以查看最近谁执行过操作。

Sessions 创建值为 `{agentIds:string[]}`，更新用 `{add:string[],remove:string[]}`，先移除再加入并去重。移除 Sessions 不影响 touches。工作可以没有 Sessions，也可以关联多个会话；不强制负责人或相同 workspace。会话无法找到时保留关联并显示不可用。关联不构成创建 agent、委派、唤醒或打断会话的授权。

Result 配置为 `{text?:string,completed?:boolean}`，text 是完整保存的 Markdown，completed 默认 false。二者可独立修改，允许只有完成状态而尚未填写结果文字，不要求为了显示控件编造结果。`result:null` 移除整个组件；`result:{completed:false}` 重新打开具体工作，不删除已有 text。

有 Result 时显示完成状态控件（可用复选框）及结果文字；没有 Result 时不显示这项控件，不能给每个 Item 画一个默认未完成框。completed 只表示工作已结束，失败或否定结论也可以完成；成功与否写在 text 中。完成不自动归档、不完成父 Card、不停止进程，也不清理 storage。

### 5.2 公共路径与数据源引用

文件配置继续使用路径字符串：相对路径基于项目根目录，绝对路径直接使用。支持 `${project.root}`、`${project.blobDir}`、`${storage.path}`、`${storage.sharedPath}`、`${card.id}`、`${card.blobDir}`，以及 Item 上的 `${item.id}`、`${item.blobDir}`。storage.path 指当前对象目录，card.blobDir 在 Item 上指父 Card；blobDir 名称沿用 v1 含义，project.blobDir 指 v2 的 blobs 目录。

先展开变量再解析路径，命令 argv 的每一项也支持相同变量，不进行 shell 展开。未有值的变量在实际使用时报告原因，不回退到其他路径。配置是可信项目配置，允许指向项目外目录；符号链接沿用 v1 的普通文件路径处理方式。不引入 `{base,path}` 包装。

Config 顶层的字符串、数字与布尔值可通过 `${config.<key>}` 用于同样的变量展开，例如 `${config.jobId}` 或 `${config.outputDir}`。对象、数组与 null 不转换成命令参数；嵌套内容可由使用它的脚本读取。变量按目标对象的 Config 解析。

`SourceRef = {objectId:string,source:string}` 指向某个对象 Viewers 中的具名来源；存储时使用真实对象 ID。写入时额外接受 `objectId:"self"`，以及 Item 的 `objectId:"parent"`，在事务内展开为真实 ID，方便组合创建。它们是显式引用，不是继承或回退规则。

Progress 和 Metrics 使用同一种 SourceRef，可以引用当前事务中的 source，也可以先登记引用再发布来源。实际查询时解析来源，缺失则显示原因。移除消费者不移除来源。

### 5.3 Viewers

```ts
interface Viewers {
  mounts?: Record<string, string>;
  sources?: Record<
    string,
    {
      type: "wandb-local";
      paths: string[];
      runId?: string;
    }
  >;
  entries?: Record<string, string>;
}
```

mounts 沿用 v1 的“相对 URL 前缀 → 文件系统目录”，一次挂载整个目录树，包含子目录与后来新增的文件。entries 沿用“展示名称 → 挂载命名空间内的相对路径”；可指向 HTML、图片、PDF 或目录，不要求每个文件登记 entry。sources 的键为 URL 中编码的来源名称，与 mounts 的路径分别解析。三个集合均可省略，空集合也可保存。

嵌套挂载继续按最长 URL 前缀匹配，匹配需落在路径段边界。例如 `report` 挂 `${storage.path}/report`，`report/data` 挂 `/data/eval`，则 `report/index.html` 由前者提供，`report/data/scores.json` 由后者提供。页面可用相对 URL 组合多个目录，不需要搬动文件或逐文件挂载。

更新 Viewers 时，各集合内的值表示添加或完整替换该键，null 删除该键；省略的集合与键不变。没有直接组件时，patch 从空配置开始并附加为自己的 Viewers，不隐式复制继承配置。条目与来源允许暂时不可用，删除 mount 或 source 不要求同步修复所有引用，使用时显示原因。删除配置不删除文件。

wandb-local 的 paths 挂载读取所需的文件或目录：可以只有一个 run 目录，也可以包括多份记录、files、artifact manifest、缓存或额外内容目录。reader 按实际 W&B 布局解析指标与 artifacts，不要求一个目录只有一份直属 .wandb。所有路径仍是 §5.2 的字符串配置；发布可早于文件产生。只挂载使用该来源所需的范围，不扫描整台机器寻找缺失内容。

同一个逻辑 run 的记录可以分布在多个文件中，按记录身份与续跑关系解析。包含多个独立 run 时列出可识别的 run，使用 runId 选择；没有指定且只有一个 run 时直接读取，不因文件数量多而报歧义，也不自动把不同 run 混合或改读最新 run。缺失本地 artifact 内容时仍可显示其元信息和缺失原因。

配置继承沿用 v1：Card 优先用自己的 Viewers；未配置时，有 viewerSource 就沿它查找，否则沿 basedOn 查找，并递归应用同一规则。Item 优先用自己的 Viewers，否则用所属 Card 解析出的配置。显式空配置禁用继承，移除直接配置恢复继承；无需复制 JSON。继承环在解析时报告涉及的对象，不能无限递归。

继承得到的路径变量在目标 Card／Item 上展开，同一种输出布局可复用模板；绝对路径仍指向原位置。SourceRef 则解析其明确引用对象上的来源，沿用该对象的上下文，因而多个 Attempt 引用父 Card 同一个 source 时不会各自重挂目录。继承关系与解析出的配置来源在详情中可见。

来源属于 Viewers，host 根据它发布查询 API。Progress、Metrics 和普通 HTML viewer 都可以消费同一个来源，各自配置需要读取的数据；消费者不重复保存目录或解析器配置，也不要求其他消费者存在。来源的稳定标识是对象 ID 与 source 名称，不依赖消费者数量。

### 5.4 Progress

Progress 包含可选 `plan`、可选 `source`，至少存在一项。source 可以读取日志、执行命令，也可以引用 Viewers 已挂载的 W&B 数据源。plan 单独定义 schedule／curriculum，由所选 source 提供实际位置；Progress 与 Metrics 各自配置，即使共用来源也不要求两者绑定。

```ts
interface ProgressPlan {
  sourceUnit: string;
  units: Array<{
    unit: string;
    total: number;
    tracks?: Array<{
      label: string;
      segments: Array<{ label: string; start: number; end: number }>;
    }>;
    projection?: Array<{
      sourceStart: number;
      sourceEnd: number;
      targetStart: number;
      targetEnd: number;
    }>;
  }>;
}

type ProgressSource =
  | { type: "log"; path: string; progressRegex: string; endRegex?: string }
  | {
      type: "command";
      argv: string[];
      cwd?: string;
      timeoutMs?: number;
      parse: { type: "json" } | { type: "regex"; regex: string };
    }
  | {
      type: "viewer-source";
      source: SourceRef;
      current: { kind: "step" } | { kind: "metric"; key: string[] };
      total?: number | { key: string[] };
    };
```

计划沿用 v1 的单位、轨道、分段与 projection 含义。sourceUnit 指定观测单位，其他单位通过分段线性 projection 映射；未覆盖区间不推算位置，不按总量比值补映射。不增加单位、轨道或分段数量上限。

viewer-source 的 current 选择来源的最新 step，或某个数值指标的最新记录值，例如 `trainer/global_step`、epoch、已处理样本数；不取历史最大值，不自动给零基 step 加一。total 可以是明确的常量或另一个数值字段；省略时使用 plan 中 sourceUnit 的总量，无计划则为 null。current 与 total 的单位必须一致，不按字段名猜测换算关系。

此方式通过共享数据查询模块读取最新原始标量，不下载曲线、不读取 Metrics 配置、不从降采样结果推断进度。查询与普通 viewer／Metrics 共用来源解析、索引和缓存；daemon 内部可直接调用同一查询模块，无需经客户端代理绕回 host，也不另写一套 W&B reader。索引未完成时返回正在追赶的状态；所选字段缺失、非数值或 source 不可用时保留上次有效观测并报告原因，不补零。

来源有明确的结束记录时才映射 ended；没有结束证据时为 false，不代表进程仍然存活，也不能根据 current 达到 total 或暂时没有新数据推断结束。此处反映被引用 run 的状态，不自动表示某个 Issue／Attempt 的任务状态。尚未追上来源时不基于旧快照停止刷新；来源 generation 改变时清除旧观测，避免把两个数据代际混在一起。此 source 不提供 phase／message，二者为 null。

例如 Item 可引用父 Card 已发布的 training 来源，并用其中的训练步数定位自己的计划：

```json
{
  "plan": { "sourceUnit": "step", "units": [{ "unit": "step", "total": 100000 }] },
  "source": {
    "type": "viewer-source",
    "source": { "objectId": "parent", "source": "training" },
    "current": { "kind": "metric", "key": ["trainer/global_step"] }
  }
}
```

同一 run 的多个消费者默认读取该 run 的累计位置，不按 Item 创建时间自动切出局部进度。需要某次执行的局部计数时，选择实际记录的对应字段，或使用日志／命令来源。

日志正则使用命名捕获：必需 current，可选 total、phase、message。endRegex 命中表示观测结束。命令 JSON 输出 `{current,ended,total?,phase?,message?}`，忽略其他字段；正则命令解析还必须捕获 ended，接受 true／false／1／0。沿用 v1 解析语义，不新增文本长度限制。

这里的 command 是 Progress 读取外部进度的命令，例如读取调度器状态或运行项目的进度解析脚本，不是训练启动命令。用 argv 执行，支持路径变量，不隐式经 shell；cwd 默认项目根目录，也可以显式指定 worktree 或其他目录，以便多个对象复用同一个脚本和配置。默认超时 10 秒、捕获输出上限 1 MiB，沿用 v1。显式进度刷新才执行命令，创建、普通读取、列表和 viewer 访问不执行它。

日志 reader 沿用 v1 的字节游标与未完成行处理，最后匹配值生效；首次读取取末尾至多 4 MiB，随后读取新增数据，轮转或截断重置游标。不新增每轮 1 MiB 或单行 64 KiB 的拒绝规则。结束信号属于当次日志代际；source 变更或轮转后不沿用旧的结束信号。

daemon 保存 `observation:{current,total,ended,phase,message,observedAt}`，以及独立的 `checkedAt`、`error`、`catchingUp`。observedAt 表示取得该观测的时间，不因刷新成功就更新对象 updatedAt；实际活动按 §3.5 判定。未配置 total 且无计划时为 null；错误保留上次有效观测，首次失败不伪造 0。修改 source 清除旧游标与观测；只修改 plan 可保留同一 source 的观测。

客户端仅为当前可见且有 source 的对象自动请求刷新，默认间隔沿用 v1 的 15 秒；后台、断线或面板隐藏时停止。daemon 合并同一对象与 source 配置的并发刷新，不新增刷新完成后的时间缓存。日志与命令来源在 `ended:true` 且没有尚待追赶的数据时停止自动刷新；viewer-source 继续检查共享 run 的后续续跑。手动刷新可重新观测。没有客户端就不轮询；首版不承诺后台监测、作业完成通知或自动清理。

计划存在时画轨道，有有效观测再叠加位置；无观测不当作 0。保留 v1 的多单位选择控件，切换时一起切换坐标轴、轨道、总量和投影后的当前位置。观测 total 可用于当前源单位的数值摘要，但不能偷偷缩放已配置的计划或 projection。越过计划范围时显示真实数值与超出标记。

### 5.5 Metrics

```ts
interface Metrics {
  panels: Array<{
    id: string;
    title?: string;
    source: SourceRef;
    display: "line" | "value";
    series: Array<{ key: string[]; label?: string }>;
    x?: { kind: "step" } | { kind: "time" } | { kind: "metric"; key: string[] };
    range?: { from?: number; to?: number };
    scale?: "linear" | "log";
    statistic?: "last" | "min" | "max" | "mean";
  }>;
}
```

panel ID 在组件内用于区分配置。默认 x 为 step，scale 为 linear，statistic 为 last。范围按 `[from,to)` 筛选，省略表示完整可用范围。statistic 用于 value 展示，line 使用实际数值绘制；不是通用图表配置语言。不为已保存的 panel 或指标配置设数量上限，也不以少传流量为由固定返回点数。

指标 key 使用非空路径段数组，避免把含 `/` 或 `.` 的原始键与嵌套键混淆。`["train/loss"]` 和 `["train","loss"]` 是不同指标。选择不存在的指标显示未产生数据；无值、零、读取失败必须区分。Log 轴不绘制非正数，并标示被排除的数据量。

Metrics 的来源后续失效时保留展示配置及最近成功结果，并标注不可用和数据时间，不用旧值假装仍在更新。

Metrics renderer 使用客户端图表组件绘制，不通过 iframe、WebView 或完整 HTML 页面渲染卡片指标。支持在 Canvas 卡片内显示；各组件的折叠、密度与具体布局按屏幕空间安排，不额外规定始终展开或必须不经点击。

### 5.6 Config

Config 是用于展示额外配置表项的可选组件，值为 JSON 对象：`config:Record<string,JsonValue>`。允许嵌套对象、数组和 null；完整保存，不要求为 jobId、outputDir、wandbId、超参数等分别添加对象内置字段。

客户端将顶层条目显示为键值表，嵌套值可展开或查看原始 JSON；不为这些普通配置项附加执行、进度或完成语义。Config 中写一个 wandbId 不会自动发布数据源，写一个路径也不会自动成为 viewer 挂载。更新 Config 完整替换，config:null 移除组件，JSON 对象内的 null 保留为数据。

```json
{
  "config": {
    "jobId": "73142",
    "outputDir": "/data/runs/baseline",
    "wandbId": "baseline-run",
    "optimizer": { "name": "adamw", "learningRate": 0.0001 }
  }
}
```

## 6. Viewer host 与 W&B 数据接口

### 6.1 路由与发布

扩展现有 viewer host，在同一 HTTP server 内提供静态文件、结构化数据和 artifact 内容。不要另起完整 W&B 服务、每源监听端口或独立离线查看服务；不在 daemon 渲染完整前端后让客户端通过代理访问。

```text
Viewers.mounts ──→ 共用 viewer host ──→ 静态文件／任意 HTML 前端
Viewers.sources ─→ 共享来源解析、W&B reader 与查询模块
                      ├─ host 数据／artifact API ─┬─ 普通 HTML 前端
                      │                          └─ 现有 HTTP 转发 → 客户端 Metrics
                      └─ Progress adapter → 进度刷新结果 → 客户端进度展示
```

| 路由                                                                                | 用途                                            |
| ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| `/view/v2/`                                                                         | v2 项目与对象的 viewer 索引                     |
| `/view/v2/<projectId>/<objectId>/files/<path>`                                      | 在挂载命名空间中按最长前缀解析静态文件或目录    |
| `/view/v2/<projectId>/<objectId>/data/<source>/meta`                                | 来源状态、可识别的 run、选中 run 及指标目录     |
| `/view/v2/<projectId>/<objectId>/data/<source>/query`                               | 指标历史、摘要或最新值                          |
| `/view/v2/<projectId>/<objectId>/data/<source>/artifacts`                           | 选中 run 的 artifact 元信息、内容条目与可用状态 |
| `/view/v2/<projectId>/<objectId>/data/<source>/artifacts/<artifactId>/files/<path>` | 读取可用的本地 artifact 内容                    |

objectId 区分 Card 与 Item，Item URL 无需重复父 ID。files 与 data 分开解析，URL 不含物理目录。静态文件和 artifact 内容复用已有 GET、HEAD、MIME、Range、ETag、Last-Modified 及流式文件响应；普通目录继续支持 index.html 和 ?paseo=list。保持现有文件访问边界和可信配置的符号链接语义。

viewerEntries 返回名称、同源 path、可用状态与配置来源；source 返回 SourceRef、同源 apiPath 及状态。客户端使用现有代理或可访问的 host origin，不持久保存客户端临时端口。普通前端挂到 mounts 后即可通过同源 URL 查询数据，包括显式引用其他 v2 对象的来源；无需 Metrics、Paseo 页面或额外完整 W&B 前端。

v2 索引沿用 v1 的入口发现方式，按项目、Card 与 Item 展示 viewer，不套用 MCP 分页；归档默认隐藏，已知 URL 保持可访问。直接浏览器访问仍取决于监听地址和网络可达性，登记来源不改变监听范围。

### 6.2 本地读取与实现约束

读取范围由“能取得指标与 artifacts 所需的本地记录和内容”决定。需要识别 run 元信息、history、已有 summary／配置、结束证据，以及 artifact manifest、文件引用和本地内容。`.wandb` 只是可能的输入之一，不要求 agent 将目录预处理成某份指定文件。manifest 引用的内容若在额外目录中，可把该目录加入 source.paths；只在已挂载的范围内解析。仅存在远程引用时展示元信息和不可用原因，不假装本地已有内容。

同一逻辑 run 的多文件与续跑记录按其实际身份和顺序读取，不以 Item 创建时间切分，不按文件名猜测“最新一次运行”。源文件只读；查看不执行 sync、resume、改名或写回。同一来源供 HTML、Metrics、Progress 共用读取模块与派生索引，消费者不会各实现一套解析器。普通前端可以通过 API 读取或下载 artifact，不要求客户端为每种 artifact 实现专用 renderer。

**读取能力随 daemon 交付，运行时和安装时都不得依赖 Python。** 可以使用对口的官方 Node 包。已找到官方 [wandb-js／@wandb/sdk](https://github.com/wandb/wandb-js)，其 README 展示了基础日志写入；这不足以确认它覆盖本地 history 和 artifact 读取。实现时先评估实际读取能力，适用部分直接复用，缺失部分再实现 Node 适配，不因为包名相同就假定格式读取已经解决。

自行解析 .wandb 时，以官方 [datastore 实现](https://github.com/wandb/wandb/blob/v0.19.0/wandb/sdk/internal/datastore.py)和 [Record／History protobuf](https://github.com/wandb/wandb/blob/main/wandb/proto/wandb_internal.proto)为依据；处理分块和完整记录，运行中的半写尾部留待下次读取。记录所用 schema 来源与许可证。artifact 内容可能分布在单独的缓存与文件目录，参照官方 [artifact cache 实现](https://github.com/wandb/wandb/blob/main/wandb/sdk/artifacts/artifact_file_cache.py)处理其引用，而不是只从 history 猜测内容路径。

解析与查询不得阻塞 daemon 的会话控制。工作线程、增量索引与缓存可按实际数据规模使用；不硬编码两个 worker、64 MiB 单记录或其他未经验证的功能上限。派生状态可放在 v2 cache；同一实际来源复用缓存，源替换或重写时丢弃不适用的派生状态，同 run 的正常追加和续跑继续读取。

记录来源 generation、revision、最后实际活动时间和读取是否追上当前输入。这些用于避免混用替换前后的数据及显示活动状态，不因查询次数递增。读取未完成时可以先返回已有快照并标记 catchingUp；错误保留最近有效快照并显示原因。来源明确结束与暂时读到文件末尾分别处理，后续续跑记录可更新 run 状态。

### 6.3 数据接口

沿用现有 GET／HEAD 转发。meta 返回可识别的 run、当前选择、来源状态、generation、revision、实际活动时间与指标 key。存在多个不同 run 且尚未选择时返回候选，由 source.runId 选择；同 run 多份文件不需要逐文件选择。指标名以路径段数组表示，保持 `['train/loss']` 与 `['train','loss']` 的区别。

query 的 q 参数为 URL 编码 JSON；使用既有转发的请求路径长度限制，不新增解码后 6 KiB 或每次八个 key 的限制。路径放不下时分批查询指标，不拆指标值本身。

```json
{
  "series": [["train/loss"], ["eval/loss"]],
  "x": { "kind": "step" },
  "range": { "from": 0, "to": 100000 },
  "mode": "series"
}
```

mode 为 series、summary 或 latest，默认 series。series 返回所选指标与范围的点；summary 返回原始值计算的 count、last、min、max、mean；latest 返回最新原始标量，供 Progress 与任意前端使用。响应包含来源身份、generation、revision、实际活动时间、caughtUp 与逐指标状态。缺失数据、无效值、空集合、零与来源错误分别表达。

x、range 与 Metrics 配置一致。step 使用 history 的 \_step 或记录的 step 元信息，time 使用 \_timestamp；自定义横轴按 W&B 记录语义解析。latest 不需要横轴与曲线，返回 lastStep、明确或未知的 ended，以及每个 key 的最新值与记录时间。daemon 内 Progress adapter 直接使用同一查询模块，不经客户端代理绕回 host。

默认返回所选范围的完整数据，不强制降采样。为绘图需要可显式请求 maxPoints；结果标明是否采样，摘要和最新值始终取自原始记录。无需规定固定点数上限、JSON 响应字节上限、since token 或 append／replace 协议；是否增加这些优化由实际性能问题决定。

artifacts 返回记录中的 ID、名称、类型、版本信息（如有）、条目路径、可用状态和同源内容 href。由 href 取得本地字节；表格、图片或其他内容可交给普通 HTML 前端或现有文件查看器。缺失本地内容不隐藏整个 artifact，也不阻塞指标读取。这里提供数据与文件访问，不复刻完整 W&B UI。

### 6.4 客户端刷新与错误

取消“尽量少传流量”作为需求约束。客户端读取结构化数据并自己绘制卡片；daemon 可提供任意普通 viewer 的静态前端和数据 API，但不能以代理完整 W&B 前端替代客户端 Metrics renderer。

复用现有 HTTP 条件请求、取消和连接机制即可，不要求额外的增量传输协议。可见指标可沿用进度的 15 秒刷新默认值；后台、隐藏和断线时停止自动刷新。相同来源的读取可合并；已结束 run 后仍允许检查后续续跑。完整历史与 artifact 下载按普通 HTTP 内容处理，不塞进对象列表或 MCP 默认回包。

数据 API 使用明确的状态与 `{error:{code,message}}`，区分尚未产出、run 待选择、文件缺失、格式不支持、数据损坏和 host 断线。运行中的半写尾部不是损坏。单个来源错误不影响其他来源、v1 静态页面或 agent 控制；取消请求可以停止其等待，不删除来源配置或数据。

### 6.5 TODO：云端 Metrics 来源

未来可以在 Metrics 中增加 W&B 云端来源，使用客户端的网络与凭证直接读取。它不必先伪装成 daemon 上的 Viewers 本地挂载，也不要求把凭证传给 daemon。

待该能力实现时再定义云端 source 配置、认证／凭证存放、各客户端访问方式与缓存。首版实现本地 SourceRef；保持 Metrics 的数据获取层可接入其他来源，不提前实现云端 API 或编造必需字段。

## 7. MCP 与控制接口

### 7.1 八个对象工具

工具名称决定操作类型，输入不带 kind。项目由 MCP 上下文解析，按 Item ID 读取或更新不要求重复父 ID。以下接口由支持 Works 的 daemon 提供；旧 daemon 不提供这些工具。

| 工具          | 必需输入                                  | 可选输入及行为                                                                                                         |
| ------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `list_cards`  | 无                                        | `query`、`goal`、`basedOn`、`label`、`sessionId`、`sessionRelation`、`archive`、`order`、`limit`、`cursor`             |
| `get_card`    | `cardId`                                  | `select`、`includeItems`                                                                                               |
| `create_card` | `preset`、`title`、`body`                 | `goal`、`basedOn`、`viewerSource`、起止时间、六种组件、`linkCaller`、`items`、`returning`                              |
| `update_card` | `cardId`                                  | `title`、`body`、`label`、`goal`、`basedOn`、`viewerSource`、起止时间、组件更新、`archived`、`linkCaller`、`returning` |
| `list_items`  | `parentCardId`                            | `query`、`label`、`sessionId`、`sessionRelation`、`archive`、`order`、`limit`、`cursor`                                |
| `get_item`    | `itemId`                                  | `select`                                                                                                               |
| `create_item` | `parentCardId`、`preset`、`title`、`body` | 起止时间、六种组件、`linkCaller`、`returning`                                                                          |
| `update_item` | `itemId`                                  | 与 update_card 相同，但不含 goal、basedOn、viewerSource                                                                |

Card preset 使用 experiment／topic，Item 使用 attempt／issue。create_card.items 各项复用 Item 创建结构，父关系来自当前新建 Card，不重复传 parentCardId；返回顺序与输入顺序一致。Item 列表不使用 goal、basedOn 筛选，这两者属于 Card。

更新请求至少包含一个可修改字段；没有组件时提交组件值即附加直接配置。Sessions 用 add／remove，Viewers 用键级 patch，Result 按 text／completed 字段修改，Progress、Metrics、Config 完整替换。startedAt／endedAt 接受已知的 UTC 时间或 null；createdAt、updatedAt、touches 与观测由 daemon 维护，不从读取结果回填。

includeItems 为可选对象，接受 Item 列表的筛选和分页参数，父范围来自当前 Card，默认只取一页。MCP 普通读取只返回缓存进度；沿用 v1 的分工，agent 配置来源，客户端或 CLI 请求刷新，不给 get 增加执行外部命令的隐含语义。

### 7.2 查找、顺序与分页

`list_items` 必须指定一个 Card。不提供全项目 Item 遍历，即使分页也不提供。未知归属时先查 Card，再查其 Item；首版不另设跨 Card Item 搜索。

所有筛选在排序分页之前执行。query 是匹配 title 和 body 的普通文本，采用 Unicode 规范化后的大小写不敏感子串匹配，适用于中文。goal 按名称匹配，basedOn 按来源 Card ID 匹配，label 按业务身份匹配。

sessionId 通过 sessionRelation 选择 Sessions（linked）、自动 touches（touched）或两者（any，默认）。返回命中哪一种关系，不将两者合成 Sessions。Card 查询包含其 Item 的关联，包括已归档 Item；Item 查询自己的关联与 touch。不因客户端未加载 Item 而漏掉会话关系，也不因命中而自动展开全部 Item。Card 本身的 archive 筛选独立生效。

默认 `order:"desc"`，按 `(createdAt DESC,id DESC)` 排序；asc 同时反转两项。修改正文、结果和观测不改变位置。使用排序边界游标，不使用 offset；后续页不因前面新插入记录而偏移。游标绑定项目、父范围、筛选和顺序，条件改变必须重读首页，错误游标返回 `invalid_cursor`。

分页不是冻结快照；归档或内容修改可能改变筛选成员，新记录通过重读首页看到。MCP 的 limit 默认 20，调用者按需要调整；nextCursor 为 null 表示已读完。工具和 skill 不因存在 nextCursor 自动遍历到末尾。这里的分页用于控制进入 LLM 上下文的对象数量，不规定客户端必须逐页展示。

### 7.3 按需返回，保留内容

默认对象信息包含 id、title、label 和完整 body，Item 另含 parentCardId。body 就是描述内容，不另造截断预览或让 agent 维护第二份摘要。Card 同时返回 goal、basedOn，便于辨认分组与来源。

| 操作 | 默认结果                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------- |
| 列表 | 一页 objects、createdAt／updatedAt 与归档信息、nextCursor；不展开组件或子项                       |
| 读取 | 对象信息、componentNames；不隐式附带 Item 列表                                                    |
| 创建 | 新对象信息、storage；本次配置的 viewer entry／source 引用与状态；组合创建包含首批 Item 的相同信息 |
| 更新 | committed:true 与目标对象信息；变更的入口状态，不回显所有组件                                     |

select 选择额外内容：timestamps、touches、sessions、viewers、progress、metrics、result、config、storage、viewerEntries。timestamps 包含创建、最近活动和起止时间。返回所选字段的完整值，不切正文、不切数组，也不返回全部指标历史。请求不存在的组件返回 null，未请求的字段不出现。returning 使用同样规则，使写入后需要的信息能随回执取得。

viewerEntries 返回页面的 HTTP path、用于聊天的 href、来源 API 路径和可用状态。href 使用 `paseo://h/<serverId>/view/...`，携带 Host 身份，由客户端通过已有 Viewer 通道打开；裸 `/view/...` 与 daemon 真实文件路径可能冲突，不能靠前缀识别为 Viewer。viewers 返回直接配置 configured、解析后的 resolved 和 inheritedFrom，便于区别自己配置与继承所得。progress 返回配置和缓存观测。componentNames 表示可展示的组件，包括有效继承的 Viewers；自动 touches 是内置信息，不因此出现 Sessions 组件。

节省 token 依靠限定查询范围、对象分页、按需选择组件、组合创建与写入回执，以及不重复输出同一份工具结果。只向模型呈现一份紧凑 JSON，不同时注入等价的文本和 structured payload。不设 24 KiB 内容上限，不新增字段分片协议，不截短 ID、标题、正文或结果。需要少读时减少对象或字段，而不是丢弃所选内容。

错误返回 `{error:{code,message,field?}}`，包含 project_required、not_found、wrong_kind、invalid_input、invalid_cursor、storage_unavailable 等操作错误。目录创建失败发生在数据库提交之后时，响应仍保留 committed:true 与已建对象信息，便于直接重试获取 storage。

### 7.4 客户端 RPC 与变更通知

RPC 复用相同领域服务，输入额外含 projectId 与 requestId；调用会话沿用 §3.5 的 MCP／CLI 上下文取得，客户端点击不冒充 agent touch。每种操作使用成对的 `.request`／`.response`：

| 命名空间                 | 操作                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| `work.card`、`work.item` | `list`、`get`、`create`、`update`                                  |
| `work.progress`          | `refresh`：按 objectId 列表逐项返回观测、错误与 nextRefreshAfterMs |
| `work.board`             | `get`、`update`：读取当前筛选下的完整 board，按 Card ID 更新位置   |
| `work.storage`           | `get`：获取对象或 shared storage，并创建缺失目录                   |
| `work.project`           | `subscribe`、`unsubscribe`：订阅当前项目元数据失效通知             |

MCP、CLI 与客户端共用领域操作，返回投影按用途构建。客户端可取得整个 board 的 Card、Goal、来源连线、Sessions、自动 touches、Item 数量及 Canvas 位置；打开 Card 详情时可一次读取全部 Item、内容与组件。客户端接口不套用 MCP 的分页或 token 预算。UI 所需集合可批量获取，不让用户点击“加载更多”才能看到原有工作记录。指标历史与 artifact 内容走 viewer 数据 API。

订阅事件 work.project.changed 传对象 ID 与受影响字段，可批量合并；对象 touch、updatedAt、Result 和 Sessions 的变化都通过它通知。Agent 运行状态仍沿用会话通知，供当前执行情况展示。连接恢复后重读 board 和当前详情，不重放完整对象历史。进度刷新响应更新观测缓存；指标历史不塞进此事件或控制 RPC。

Canvas 布局单独保存 `{cardId,column,row,width,height}`，不在对象字段或组件内。沿用 v1 的网格和可选位置／尺寸覆盖值；未指定的值使用默认布局。board.update 按键修改，支持整个 board 的整理与撤销；拖动和缩放不改变对象 updatedAt。各 host、project 的布局与 v1 独立，项目内 workspace 共用 v2 布局。

### 7.5 组合操作示例

创建 Topic 和一个具体 Issue，不要求先建会话或 worktree：

```json
{
  "preset": "topic",
  "title": "结果查看器",
  "body": "维护结果浏览与导出功能。",
  "items": [
    {
      "preset": "issue",
      "title": "增加 CSV 导出",
      "body": "导出当前筛选结果，并验证内容和编码。"
    }
  ]
}
```

得到 Item ID 与 storage 后用普通 Git 和文件工具执行工作。结果与页面一次登记到 update_item：

```json
{
  "itemId": "item_01234567",
  "result": { "text": "已实现导出，中文编码与筛选结果验证通过。", "completed": true },
  "viewers": {
    "mounts": { "report": "${storage.path}/report" },
    "entries": { "验证结果": "report/index.html" }
  }
}
```

在 Experiment 上发布一次已有训练目录，并为新建 Attempt 选择 loss：

```json
{
  "preset": "experiment",
  "title": "深度预测基线",
  "body": "记录基线训练及后续续跑。",
  "viewers": {
    "sources": {
      "training": {
        "type": "wandb-local",
        "paths": ["/data/runs/baseline"]
      }
    }
  },
  "items": [
    {
      "preset": "attempt",
      "title": "首次训练",
      "body": "使用已记录的配置训练基线。",
      "metrics": {
        "panels": [
          {
            "id": "loss",
            "display": "line",
            "source": { "objectId": "parent", "source": "training" },
            "series": [{ "key": ["train/loss"] }]
          }
        ]
      }
    }
  ]
}
```

续跑时创建另一个 Attempt，引用该 Experiment 的 training source，无需重挂目录。若希望 Experiment 卡片自身显示 loss，可给它附加引用 self 的 Metrics；这与任意 HTML viewer 是否存在无关。

### 7.6 CLI

保留独立 CLI 使用方式。v1 的 paseo experiment 不变；v2 增加 paseo work，沿用现有 host 选择、项目参数、表格／JSON／YAML 输出和 daemon 连接设施。CLI 调用同一领域服务，不直接操作数据库，也不要求使用者先经过 MCP。

| 命令                                                           | 用途                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `paseo work card ls`                                           | 列出 Card，支持 query、goal、basedOn、label、sessionId、sessionRelation、archive、order 筛选 |
| `paseo work card show <cardId>`                                | 显示 Card，按需包含其 Item 和组件                                                            |
| `paseo work card create`                                       | 创建 Card，可同时创建首批 Item                                                               |
| `paseo work card update <cardId>`                              | 修改内容、分组、来源、组件或归档状态                                                         |
| `paseo work item ls <cardId>`                                  | 显示某 Card 下的 Item                                                                        |
| `paseo work item show <itemId>`                                | 显示 Item 与组件，无需重复父 ID                                                              |
| `paseo work item create <cardId>`                              | 在指定 Card 下创建 Item                                                                      |
| `paseo work item update <itemId>`                              | 修改 Item 内容、组件或归档状态                                                               |
| `paseo work storage <objectId>`／`paseo work storage --shared` | 获取 storage，补建缺失目录                                                                   |
| `paseo work progress <objectId>`                               | 手动刷新进度，包括日志、命令与 viewer source                                                 |
| `paseo work viewer configure <objectId> --file <json>`         | 通过普通对象更新登记 Viewers                                                                 |
| `paseo work viewer ls <objectId>`                              | 列出页面入口及数据源 API                                                                     |

创建与更新支持 preset、title、body 等常用文本选项，以及完整输入的 JSON／@file 方式；支持从文件读取正文，不要求把长文本转义进 shell 参数。组件配置遵循相同的 patch 规则。show 保留完整内容，列表默认使用适合终端的列；结构化输出不截断字段。列表可显式传 limit／cursor，未指定时可列全当前 Card 范围的 Item 或筛选后的 Card；这不改变 MCP 的分页默认值。

没有自动归档或清理子命令。Goal 名称通过 Card 创建／更新管理，独立 Goal 目录管理沿用 v1 的后续范围，不把尚未实现的 doctor／repair 当作必须迁移的现有功能。

## 8. 客户端入口与展示

### 8.1 入口、图标与容器

在现有 v1 Experiments 按钮旁边放 Works 按钮，顺序为 v1、Works；桌面 workspace header 与移动端对应工具栏都如此。保留 v1 的图标与入口，不把 Works 放进 v1 页面内，也不另加全局侧栏体系。按钮文案、tooltip 和无障碍名称使用 Works／工作。

Works 图标为**传送带上放着一个烧瓶**：下部带两个滚轮的传送带，上部为放在带面上的烧瓶，合成一个图标。使用与现有按钮一致的单色描边、尺寸、颜色 token 和点击区域；用跨平台 SVG 绘制，不拼 emoji、不加载 HTML，也不要求动画。在小尺寸下应能分辨传送带与烧瓶。

UI 容器层级参考当前 v1 实现：

```text
Workspace screen
  Header：…… / Experiments / Works / ……
  内容区的同级 RetainedPanel
    原 workspace 会话与标签内容
    v1 Experiments surface
    Works surface
      原层级的 header + centerContent
      Works screen：筛选／视图工具栏
        Canvas 或列表视图
          Card 容器
            标题、label、正文与组件区域
            Item 列表
              Item 行及其展开内容／组件
```

三种 surface 同时只能有一个 active。首次打开才挂载，切走保留滚动、选择、展开和视图状态；隐藏面板停止刷新与测量，不能继续占用键盘、返回手势或绘制覆盖层。再次点击当前 Works 按钮回到原 workspace 内容；从 v1 点击 Works 直接切换到 Works。Android 沿用 v1 的返回处理：清除所选 Card 与详情后，继续消费系统返回，不因 Canvas 边缘拖动退出 surface。

保留独立深链接 `/h/[serverId]/works/[projectId]`，对应 screen 也能 embedded 在 workspace 中。按[路由所有权规则](../expo-router.md)注册 host leaf，不改首页 workspace 恢复逻辑。Works 的 route、query cache、展示偏好、保留面板 key 均与 v1 区分。

### 8.2 两层内容与组件 renderer

Card 容器由 kind 决定，基础展示由 label 决定：Experiment 使用实验标题标识与运行列表措辞，Topic 使用主题标识与工作列表措辞；仍显示混合 Item 的真实 label。总数表示记录数；显示完成数量时依据 Result.completed，没有 Result 的 Item 不当作未完成任务计数。

通过组件名称到 renderer 的注册表补充展示，Card 和 Item 共用语义，可采用不同密度：

| 组件     | 展示内容                                                     |
| -------- | ------------------------------------------------------------ |
| Sessions | 显式关联、适合持续讨论或继续工作的会话与入口；不强制负责人   |
| Viewers  | 页面入口、文件类型和可用状态；按现有 viewer 打开方式访问     |
| Progress | schedule／curriculum 轨道、位置、数值、观测时间及错误        |
| Metrics  | 所选指标的曲线或数值摘要，空值、加载和错误状态               |
| Result   | 完成状态控件、结果内容与产物链接；组件不存在时不显示完成控件 |
| Config   | JSON 配置的键值表、可展开的嵌套内容与原始 JSON               |

内置区域显示最近活动时间、已知起止时间，以及 touches 中当前或过去执行过操作的会话，和 Sessions 区域分开。组件不存在时不绘制其区域；Viewers 可展示有效继承配置并标明来源。父 Card 展示某 Item 的组件时标出 Item 来源，不把并行 Item 的进度相加。详情沿用 v1 的连续条目列表：共用列表容器，以分隔线区分 Item；序号、时间与展开动作同排，标题和简述在折叠时仍可读。进度、结果、Viewer 留在所属 Item 的展开区，不按组件类型集中到跨条目的页签。不为 Issue 再创建 Attempt 容器。

Canvas 与列表模式都能浏览 Card。列表按 Goal 分组，保留未分组区域；Card 详情展示 basedOn 来源与派生项。Canvas 保留 v1 的来源连线、按来源树整理与撤销，以及 Goal 分块、创建顺序和来源深度参与的默认布局。位置与大小属于 board 状态，筛选与刷新不重新排列已有手动位置；新 Card 参照现有实际布局放置，不挤走原有 Card。

沿用 v1 的完整 board 和 Card 内列表体验。所选 Card 的 Item 按创建时间从旧到新全部呈现，显示序号、时间、标题和内容；每项独立展开，最新项默认展开，保留用户的展开选择。不把 MCP 的分页变成 UI 的“加载更多”。底层可按需取得详情或分批传输，但不改变用户能看到的记录范围、来源连线和排序。

Canvas 默认显示摘要与简短进度，不展开 Viewer、会话列表或全部 Metrics。用户可按 Card 选择直接显示的指标面板，也可全部隐藏；选中的曲线同时可见，无需轮播或悬停。选择按客户端、host、project、Card 保存，与 Metrics 配置分开。默认尺寸只随所选面板调整，不因登记了更多 Viewer 或指标自动膨胀；保留手动调整与重置尺寸。

Metrics 在客户端绘制曲线或数值，按需要读取历史或 summary；不设首版 512 点上限，也不要求客户端通过完整 W&B 页面展示。曲线面板标明指标、run 与刻度类型，提供自适应刻度、网格、图例和读数。光标读数使用实际采样点并保留各序列的采样位置，与 latest/min/max/mean 摘要明确区分；支持固定读数及单独隐藏序列。对数轴跳过非正值并断开相应线段。普通 HTML viewer 使用同一数据 API 并可读取 artifact 内容。

首版客户端提供查找、浏览、打开会话／成果、Result 完成状态切换、手动刷新、进度单位选择、调整布局和归档／恢复。其他组件配置通过对象工具完成，不要求实现通用 JSON 编辑器或传统 issue 管理表单。无关联会话、无可选组件的 Card 仍是可用对象。

加载、空列表、无匹配、未配置、文件未产生、数据索引中、源错误和 host 断线要分别显示。缓存可在断线时继续阅读，标明状态；离线不排队执行对象写入或进度命令。浏览器、Electron、iOS、Android 共用对象和 renderer 逻辑；打开 viewer 时沿用各平台已有直接访问或代理能力。

## 9. 实现模块与交付

模块按下表分工，v1 继续使用独立的业务模型与存储。

| 模块                   | 实现内容                                                                                             | 落点与复用                                                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 对象契约               | Card／Item、预设、组件配置、投影、错误、分页与 RPC schema；只导出运行时可校验的确定类型              | `packages/protocol/src/work-objects.ts`；不扩展 v1 experiments schema                                                                                                                                  |
| 项目 store 与 service  | 独立 SQLite、Goal／basedOn、对象 touches、活动与起止时间、Result 状态、storage、归档与布局           | `packages/server/src/server/work-objects/`；复用 Project registry 与底层数据库设施                                                                                                                     |
| Agent 及客户端控制适配 | 八个 MCP 工具、项目上下文、筛选与按需返回；work RPC handler；Sessions 与对象 touches 分别查询        | 现有 [agent 工具目录](../../packages/server/src/server/agent/tools/paseo-tools.ts)、session 路由及 `packages/client`；领域逻辑不复制到适配层                                                           |
| CLI                    | Card／Item 操作、storage、进度刷新、viewer 配置与入口；沿用文本和结构化输出                          | `packages/cli/src/commands/work/`；复用 CLI 输出、host 选择和 daemon client                                                                                                                            |
| 进度观测               | 日志与命令 reader、viewer-source adapter、并发合并与刷新结果；W&B 来源复用数据查询模块               | `work-objects` 下独立模块；可提取 v1 纯解析逻辑，v1 状态与配置保持独立                                                                                                                                 |
| 共用 viewer host       | 从当前 bootstrap 的 host 装配中分出业务路由注册；接入 v1 resolver 与 v2 resolver，保持同一个监听服务 | [bootstrap.ts](../../packages/server/src/server/bootstrap.ts)、现有静态文件和目录枚举模块；保留原监听配置与服务注册                                                                                    |
| W&B 本地 reader        | 无 Python 的指标与 artifact 读取、run／多文件识别、只读内容解析与共享派生状态                        | server 下独立 viewer-data 模块；不放入 Metrics renderer 或 agent tool handler                                                                                                                          |
| 数据查询服务           | 指标目录、历史／最新标量／摘要、artifact 目录与内容、HTTP 响应；供三类消费者共用                     | 共用 host 的 v2 data 路由；[现有 HTTP controller](https://github.com/HamiltonHuaji/paseo/blob/1bd70fb5056d623e8da784dce82d8ee72fa5f486/packages/server/src/server/viewer-http/controller.ts)只继续转发 |
| Works surface          | 相邻按钮与传送带烧瓶图标、同级 RetainedPanel、独立 route、完整 board／Item 列表、分组、血缘与归档    | `packages/app/src/screens/works/` 与 workspace screen；参考 [v1 容器](../../packages/app/src/screens/workspace/workspace-screen.tsx)                                                                   |
| 组件展示与数据获取     | kind／label 基础 renderer、Sessions／touches 区分、完成控件、Config 表格、进度单位与指标图表         | Works screen 内消费共享 UI 原语；复用 viewer proxy 和 `fetchViewerHttp`，不复制传输栈                                                                                                                  |
| Skill 与打包           | `paseo-works` 英文入口、中文译文、调用示例、可用性说明、真实工具引用                                 | `skills/paseo-works/`；沿用 server 构建时复制 skills 的现有流程                                                                                                                                        |

客户端和 CLI 通过 `server_info.features.works` 判断 host 是否支持 v2。共用 viewer 服务，无需独立 viewer 服务启动器或 worktree 管理模块。

Skill 的名称和目录统一为 `paseo-works`，不保留 `paseo-experiments` 的重复副本。原有适用范围和枚举不因改名重写。工具使用规则已提炼到 skill，较长参数示例放 skill 自带 references，安装后不依赖本仓库 docs。构建只打包 skill；隔离 daemon 测试通过注入临时 skill 目标目录避免全局安装，见[测试 daemon 约定](../ad-hoc-daemon-testing.md)。

指引至少覆盖：先找已有工作；为成果安排 storage 与入口；Sessions 与自动 touch 分开；开发继续同一 Issue，实验新运行／重试／续跑新建 Attempt；Config 保存额外配置；Result 表达结果和完成；先筛选 Card 再查询 Item；不自动读完所有分页；worktree 使用普通 Git 管理；viewer 配置继承与本地 W&B 挂载；完成、归档、会话生命周期互不等同。不能声称尚未登记的入口已经可用，不能暗示 v1 与 v2 互通。

## 10. 验收要求

以下是验收行为标准。自动验证使用真实临时 SQLite、文件、隔离 daemon、CLI 子进程、HTTP 转发及 W&B 记录；浏览器测试覆盖指标绘制、错误与隐藏状态，布局测试覆盖分组与血缘整理。完整应用切换交互及 Electron、iOS、Android 真机访问仍需平台验收，不能用类型检查代替。沿用现有测试框架，不为 v2 建一套新测试框架。

| 验收场景                    | 必须观察到的结果                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| v1／v2 并存                 | 创建、查找、归档和 viewer 索引互不串数据；v1 原有入口、URL、静态文件、Range 和代理行为保持可用                                      |
| 两个 workspace 属于同一项目 | 看到同一组 v2 对象和布局；其他项目、其他 host 的记录不混入                                                                          |
| 无可选组件的对象            | title、body、label 足以读取与展示；Experiment 与 Topic 身份明确                                                                     |
| Result 与完成展示           | 有 Result 才显示完成控件；text 与 completed 可独立更新；无 Result 的 Item 仍展示且不算未完成；完成不自动归档父项                    |
| 活动与起止时间              | 新执行或新数据更新对象和父 Card 的 updatedAt，重复查询不制造活动；已知起止可记录，共享 run 不自动完成所有 Item                      |
| Config 与 label             | JSON 配置能完整保存和查看嵌套值；label 可显式修改，不改变对象身份、文件或组件                                                       |
| 执行记录的身份              | 实验新运行、重试与续跑分别有 Attempt；开发对同一交付的修改、修复和验证复用 Issue，不覆盖独立执行结果                                |
| 组合创建与 storage          | 数据库提交后建目录；mkdir 失败保留对象与路径，获取 storage 可补目录；无需回滚或清理目录                                             |
| 普通更新                    | 不同 Viewers 键和 Sessions 成员保留；同字段后写生效；无 revision 条件写或额外并发流程                                               |
| MCP 按需读取                | 查询限定 Card 范围、筛选和分页，不自动遍历；ID、标题、描述完整；组件按需返回；模型上下文只有一份工具结果                            |
| Goal 与 Card 血缘           | 按名称分组，保留未分组区域；跨 Goal 的 basedOn 可查、可显示连线，并参与整理布局，不成为第三层对象                                   |
| 会话参与                    | 自动 touch 写在对象上，保留各 Item 参与者；Sessions 不被自动填充或合并；当前执行与长期关联分别可查；无强制负责人                    |
| Viewer 目录挂载             | 一次挂载后可读子目录与新文件；嵌套前缀选择更具体挂载，页面相对路径可组合目录；资源未产生时可先保存配置                              |
| Viewer 配置继承             | Item／Card 按自己的配置、viewerSource 和 basedOn 规则解析；空配置禁用，移除恢复；路径变量使用目标上下文，SourceRef 保持明确来源     |
| CLI                         | 通过本地或远程 daemon 操作 Card／Item、storage、进度和 viewer；结构化输出内容完整，有调用会话时沿用自动参与记录                     |
| 开发中的代码隔离            | agent 可在已返回 storage 下用 Git 建两个 worktree；记录与会话生命周期不自动删除它们；无需额外 v2 管理接口                           |
| 报告或资料库交付            | 从 Card 找到 Item、关联会话与已登记入口；不依赖用户翻聊天或记物理路径                                                               |
| 进度观测                    | 计划可单独画轨道，多单位切换同步更新轴与投影位置；log／command 观测保留；普通读取不执行命令，隐藏时停刷新                           |
| W&B reader                  | 官方 SDK 生成的旧版 JSON value 与新版 typed value fixtures 可读；跨块、半写尾部、校验失败、稀疏指标、结束记录、重启与源替换分别覆盖 |
| W&B 输入与 artifacts        | reader 无 Python 依赖；实际 run 目录、多文件与所需缓存可挂载；指标、artifact 元信息及本地内容可读，缺失内容有明确状态               |
| Progress 共享数据源         | 与 Metrics／HTML 共用 source、索引和缓存；按最新原始标量取 current／total，不下载曲线；字段缺失不补零，generation 更换清除旧观测    |
| 同一 run 续跑               | 两个 Attempt 引用一处 source，无需重挂目录；曲线与累计进度可读取追加数据；移除消费者不影响来源；追赶中不凭旧结束状态停止刷新        |
| 普通离线前端                | 仅配置静态前端 mount 与 W&B source，就能通过 host HTTP 在 Paseo 页面外读取数据；没有额外完整 W&B 服务                               |
| Canvas 指标                 | Card 内使用客户端图表绘制曲线或数值，不附加 Progress 也能工作；不依赖代理完整 W&B 前端，不设固定点数限制                            |
| 数据读取与传输              | 完整历史与 artifact 内容可读；复用现有 HTTP、取消与文件响应；不要求额外 since 协议、强制降采样或固定字节上限                        |
| 大记录与故障隔离            | 用实际大历史和 artifact 验证可访问、可取消及内存使用；解析和文件传输不阻塞会话控制，失败不影响其他来源                              |
| UI 并列入口                 | 桌面和移动端在 v1 旁显示传送带烧瓶按钮；三个同级 surface 切换、返回、隐藏刷新与恢复状态符合容器约定                                 |
| UI 完整记录                 | board 显示分组与血缘，所选 Card 的全部 Item 按旧到新排列、最新默认展开；无 MCP 分页带来的加载更多和正文截断                         |
| 各平台访问                  | 浏览器、Electron、iOS、Android 能浏览同样的两层内容；在已有可用的直接访问／代理链路上测试静态 viewer 与指标请求                     |
| Skill 交付                  | 构建产物只有一个 paseo-works skill 名称，保留中文译文；实际 provider 输入不重复注入工具结果；工具不可用时不伪造登记                 |

实施时运行受影响的具体测试文件，以及仓库要求的 typecheck、lint 和格式检查；不在本地运行全套测试。共享 host 与传输层改动必须覆盖 v1 回归，新增业务字段无需为 v1 编写迁移或兼容测试。
