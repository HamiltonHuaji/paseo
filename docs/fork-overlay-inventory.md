# Fork overlay 需求与提交清单

本文档是基于更新后的官方 Paseo 版本重建 overlay 时的防遗漏检查清单。它记录每个 fork commit 背后的行为，以便下一次 base bump 能在当前 upstream API 上重新实现所需结果，而不是重放已经过时的代码。

## 审计范围

- 官方 base：`v0.6.1`，SHA 为 `20d7efc46a316f5a274b9943a5c43b0322269825`。
- Overlay 当前提交：`70f86f3ad2ed0c904d9e708f9fe248d0bf5f925c`（`0.6.1023`，fork revision 23）。
- 范围：`v0.6.1..overlay`，95 个非 merge commit。
- 审计来源：每个 commit 的实际 diff，而不只是标题。
- 该范围不包含未提交的 working tree 变更。

由于 overlay 曾经被重放，commit 日期并不能可靠地表示顺序。附录中的编号顺序是 `git log --reverse v0.6.1..overlay`。

## 如何使用此清单

对于下面的每项需求，将下一次官方 release 与验收条件进行比较，并记录一种结果：

- **上游完整实现：** upstream 已满足验收条件；不要重放 fork 代码。
- **上游部分实现：** 保留 upstream 设计，只添加缺失行为。
- **Fork 仍需实现：** 在新的 upstream API 上重新实现该行为。
- **明确决定弃用：** 只有记录产品决策后才能移除。

不要 cherry-pick release number bump、已被取代的中间修复或旧的冲突解决方案。只有在每个 requirement ID 都有处理结果，并且附录中的每个 commit 都已由该结果覆盖时，base bump 才算完成。

## v0.9.0-beta.2 base bump 取舍

本轮版本基线是官方 `v0.9.0-beta.2`（`e9d32a17d6b2443948d9be1499ee00a1572cfcae`）。
`v0.8.0..v0.9.0-beta.2` 包含 69 个 commit、965 个变更路径；其中 76 个路径也被当前
overlay 修改。重建时以官方 0.9 的 session、timeline、subscription、replica 和 history
模型为准，不移植 fork 中用于修补旧模型的一般性 bug fix。

功能 overlay 实际落在上游 `main` 的 `2c8e8a826` 之后；该上游层在 beta.2 之上包含
lockfile、Pi thinking 配置和 macOS Find 修复。随后以独立 upstream-patch commit 吸收
[#5085](https://github.com/getpaseo/paseo/pull/5085)，再开始 fork 功能提交。

保留可独立描述和验收的 fork 产品能力，例如 native Codex fork、公式、vertical tabs、
Experiments、viewer、fork distribution、自助升级和 VS Code surface。对于 native fork 和
rewind，只在官方 0.9 API 上实现该功能所需的最小 provider 集成；不要携带旧 timeline
hydration、分页、tab 初始化或 replica workaround。官方已完整实现的全历史会话搜索不再
由 fork 实现。

以下是 base bump 时已知的官方问题。它们默认归 upstream，不因被发现而成为永久 overlay
需求。只有实际阻断本 fork 的核心使用，并且上游尚无可用修复时，才允许加入带清理条件的
临时补丁：

| Issue                                                  | 状态与影响                                                                                                                   | Overlay 处理                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [#5084](https://github.com/getpaseo/paseo/issues/5084) | 重连后的 sequenced catch-up 可能从侧栏移除未带 placement 的会话；已有 [#5085](https://github.com/getpaseo/paseo/pull/5085)。 | 已在功能 overlay 之前吸收 #5085；上游合并后对齐其 commit。        |
| [#5100](https://github.com/getpaseo/paseo/issues/5100) | `paseo run`/API 创建的 agent 在 beta.2 客户端可能只有标题而没有 timeline。                                                   | 重建后复现；若阻断 CLI 工作流，只做可删除的 upstream-style 修复。 |
| [#5049](https://github.com/getpaseo/paseo/issues/5049) | desktop 偶发重复显示最终 assistant reply，而 daemon/provider 只有一份。                                                      | 不增加 fork 去重 heuristic；交给官方 timeline/replica 修复。      |
| [#5095](https://github.com/getpaseo/paseo/issues/5095) | IndexedDB persist 永久失败时固定间隔重试并占满 CPU；0.8 与 beta.2 都存在。                                                   | 不作为 base bump 条件；仅在本 fork 实际触发时处理。               |
| [#5097](https://github.com/getpaseo/paseo/issues/5097) | macOS `Ctrl+F` 被新的 chat Find 捕获。                                                                                       | 已由上游 #5129 修复，并包含在基底 `2c8e8a826` 中。                |
| [#5073](https://github.com/getpaseo/paseo/issues/5073) | Codex import 未遍历 `thread/list` cursor；已有 [#5074](https://github.com/getpaseo/paseo/pull/5074)。                        | 属于上游 import 行为，不纳入 overlay requirement。                |

`v0.9.0-beta.1` 不可作为 base。beta.2 已修复 beta.1 在重启时污染 workspace activity、丢失
Ready to review 状态，以及为曾经打开的所有会话恢复 provider runtime 的问题。

### v0.9 requirement disposition

| Requirement          | 结论          | 重建规则                                                                                                           |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `FILE-01`            | Fork 仍需实现 | 在 0.9 file service 上恢复 symlink 预览。                                                                          |
| `FILE-02`            | 上游部分实现  | 保留 upstream direct download，只补 active relay/WebSocket 保存路径。                                              |
| `LINK-01`            | Fork 仍需实现 | 恢复可检查和复制 target 的交互式 hover card。                                                                      |
| `MD-01`              | Fork 仍需实现 | 恢复 KaTeX/RaTeX、源码复制和安全 HTML-ish normalization。                                                          |
| `CODEX-01`           | Fork 仍需实现 | 只实现 provider-native fork 能力及其必要 persistence handle 更新；依赖 0.9 自身 history/timeline。                 |
| `CODEX-02`           | 明确不重放    | 一般 reload、history hydration 和 writer lifecycle 由 upstream 负责；native fork 所需 handle 更新并入 `CODEX-01`。 |
| `CODEX-03`           | 明确不重放    | tool/subagent terminal-state bug 交给 upstream，不维持 fork projection 补丁。                                      |
| `CODEX-04`           | 上游完整实现  | 0.9 已包含官方 structured asynchronous question UI 和协议。                                                        |
| `AGENT-01`           | 上游部分实现  | 只保留 Experiments 所需的 agent attribution 和 bundled skill 声明。                                                |
| `COMPOSER-01`        | Fork 仍需实现 | 恢复 Enter newline、modifier+Enter action、Tab queue。                                                             |
| `TABS-01`、`TABS-02` | Fork 仍需实现 | 在 0.9 workspace layout 上恢复顶部 overflow 与 hierarchical vertical rail。                                        |
| `DIST-01`–`DIST-04`  | Fork 仍需实现 | 从 0.9 packaging 重建，不能回退到 upstream distribution identity。                                                 |
| `RELEASE-01`         | Fork 仍需实现 | 以 0.9 workflows 为输入恢复 overlay-only incremental publication。                                                 |
| `SKILL-01`           | Fork 仍需实现 | 保留用户拥有的同名 skill directory。                                                                               |
| `VSCODE-01`          | Fork 仍需实现 | 保留源码，但仍是 unfinished、opt-in artifact。                                                                     |
| `EXP-01`–`EXP-04`    | Fork 仍需实现 | 在 0.9 project/workspace API 上恢复完整 Experiments 产品面。                                                       |
| `VIEWER-01`          | Fork 仍需实现 | 恢复 viewer service、目录 discovery 和 direct/relay tunnel。                                                       |

### v0.9 重建结果

当前重建的版本身份基于官方 `v0.9.0-beta.2`，源码底座包含截至 `2c8e8a826` 的上游修复和
#5085 upstream patch；首个 fork revision 的可安装版本为 `0.9.1`。重建采用新的 0.9 API
重新落地产品能力，没有重放旧提交序列。

- 已保留文件预览/下载、链接 hover、Web/Android 公式、composer 快捷键、vertical tabs、
  Experiments、viewer、native Codex fork、skill ownership、fork distribution/self-update 与
  overlay-only release 流程。
- Native fork 只使用 0.9 history/timeline 和 provider contract；没有移植 `CODEX-02`、
  `CODEX-03` 中的一般 session、timeline、tool 或 subagent 修补。
- 官方 0.9 已提供的全历史消息搜索和 structured question UI 直接使用上游实现。
- VS Code 客户端源码已保留，但仍是 opt-in、unfinished artifact，不属于默认发布。
- 除已吸收的 #5085 外，上表未解决的 0.9 issue 仍归 upstream。只有它们实际阻断 overlay
  产品能力时，才增加带清理条件的临时补丁。

## 需求目录

### 文件、链接和 Markdown

#### FILE-01 — 预览通过工作区符号链接到达的文件

允许受信任的 daemon client 列出、读取和预览通过 workspace symlink 到达的文件，即使解析后的目标位于 workspace 之外。继续规范化请求的相对路径，拒绝 traversal，在适用时要求 regular file，并使用 `O_NOFOLLOW` 保护最终的 open。将 workspace containment 视为导航机制，而不是安全沙箱。

验收：外部 image/result symlink 能成功预览；traversal 和 final-component symlink 攻击仍然失败；安全文档说明 trust boundary。

相关提交： 1。

#### FILE-02 — 通过当前主机连接下载

从当前选中的 host 下载。只有 active connection 是匹配的 direct connection 时才使用带 token 的 HTTP；否则通过 active WebSocket/relay 传输字节。在 web 和 native 上安全保存，清理名称，并避免覆盖已有的本地文件。

验收：direct 和 relay 下载都能工作，绝不猜测过期的已保存 direct endpoint，重复名称获得确定性的后缀。

相关提交： 7。

#### LINK-01 — 检查和复制链接目标

在 web/Electron 上，file link 和普通 Markdown link 都提供带交互能力的 hover card，其中 target 可选择。从 trigger 移到 card 时不能将其关闭；在 card 内选择文本时保持打开。普通的非交互 tooltip 仍保持 pointer-transparent。

验收：跨过 trigger/card 间隙后仍可点击、选择和复制 target，且不能因此让所有 tooltip 都变成交互式。

相关提交： 2–4。

#### MD-01 — 安全渲染技术 Markdown

在 web/Electron 中使用捆绑的 KaTeX asset 渲染 TeX，在 Android 上使用 RaTeX。支持 inline 和 display delimiter；非法公式回退到源码；通过选择或激活公式复制原始 TeX。不要信任任意 KaTeX HTML。在不支持的平台上保留可读源码。规范化常见 README 风格的 HTML-ish paragraph 和 image，但不启用任意 HTML；relative 或不安全的 HTML image 回退到 alt text。

验收：公式渲染和源码复制可离线工作；currency、code span/fence、非法 TeX、长 display formula、theme 和 streaming block boundary 都表现正确；remote badge link 仍然有用，同时不安全 HTML 保持 inert。

相关提交： 9, 15。

### Agent、Codex 和 composer 行为

#### CODEX-01 — 原生对话分叉和回退

当双方都声明支持时，在已完成的 user/assistant boundary 上 fork Codex thread，而不是复制已渲染 context。较新的 turn 仍在运行时，可以使用已经完成的 boundary；不能使用正在进行的 turn 本身。通过 provider ID 或已提交的 client ID，从分页的 native thread item 中解析旧 boundary。使用正确的 `beforeTurnId`/exclusion 语义调用 `thread/fork`，保留 source thread，不回滚文件，并立即更新 Paseo persistence handle。如果 provider 支持，最新的已完成 turn 应走 direct/latest 路径，避免不必要的历史查询。

将 source session 的 tool configuration、developer instruction、model/service tier 和其他 provider configuration 带入 fork。可用性由 capability negotiation 控制，而不是 app/daemon 版本是否相同。message fork tooltip 说明该操作是否为 native。

验收：明确拒绝 stale cursor、cross-provider/host source、未持久化 message 和当前 in-flight turn；即使较新的 turn 正在运行，合法的旧 completed boundary 也能工作；新 tab 立即 hydrate；下一条 prompt 在新的 native thread 中继续并使用相同的 tool，同时旧 thread 仍可恢复。

相关提交： 8, 12, 76, 89, 90。

#### CODEX-02 — 单写者重载和持久身份

绝不能让两个 Codex runtime 同时作为同一个 durable thread 的 writer。恢复 replacement 前先关闭旧 runtime。如果新 configuration 失败，恢复旧 configuration；只有在恢复也失败时才关闭 Paseo agent。保留 Paseo identity、label 和 canonical timeline，并暴露 request method/error diagnostic。

验收：reload 全程只有一个 writer；configuration failure 会恢复服务；变化后的 native thread handle 会在后续操作前持久化并广播。

相关提交： 38, 69, 78, 90。

#### CODEX-03 — 正确的 turn、tool 和 subagent 存活状态

在发出 terminal turn event 之前，将所有仍在运行的 root tool 结算为 completed、canceled 或 failed。不要仅因 parent turn 结束就结算 subagent tool。client 可以根据实时 tool activity 推断 Thinking 和 Waiting，被中断的 wait 必须停止其 running animation。

验收：turn 完成/中断后没有 root tool 继续显示 active shimmer；真实的 child agent 保留自己的 lifecycle。

相关提交： 12–13。

#### CODEX-04 — 异步选择问题

将异步 Codex question 视为持久化的 assistant timeline content，而不是阻塞式 permission request。渲染 answer control，支持多个 question 和 free-form answer，并将 answer 作为带 `replyToMessageId` 的 steer-linked user message 发送。阻塞式 question 仍走 permission path。通过 streaming、projection、reload 和 history 保留 question boundary。

验收：未回答的 question 在 reload 后仍存在；answer 针对 active turn，不会清除其他 permission，成功后不会重新出现；发送失败仍可重试。

相关提交： 94。

#### AGENT-01 — Paseo tool 和 Experiment 归属

除非显式禁用，否则默认向 Agent 提供 Paseo MCP tool。CLI/tool call 传递 `PASEO_AGENT_ID`，使 Experiment touch 能识别调用者。依赖 Paseo MCP 的 skill 要声明这一点，capability/status UI 在判断 tool 不可用前先刷新。

验收：由 Agent 创建/更新的 Experiment 能归属到正确 Agent；没有 agent ID 的手动 CLI 使用仍可工作；reload 失败不能抹掉原本可用的 session 或 timeline。

相关提交： 38, 55, 67, 69, 70。

#### COMPOSER-01 — 明确的多行、发送、steer 和排队快捷键

Enter 插入换行。Ctrl/Cmd+Enter 激活当前 send/steer action，但绝不代替 stop button。Tab 始终入队。Web 和 hardware-keyboard native path 共享相同的 decision logic，保持 IME 安全，并清理 native listener。Settings/help text 必须描述实际行为。

验收：multiline prompt 不需要 modifier；Ctrl/Cmd+Enter 根据当前状态 send 或 steer；Tab 入队；interruption 仍是显式 control。

相关提交： 20–21。

### 工作区 tab

#### TABS-01 — 可扩展的顶部和左侧 tab 导航

用户可以持久化选择顶部或左侧 tab。宽的 web/Electron pane 可以显示 vertical rail；compact/native layout 和窄 split pane 保留既有布局。顶部 tab 支持真正的 overflow、horizontal trackpad/side-wheel 和普通 wheel 滚动、稳定的 active reveal 以及 edge movement。模式变化不能 remount pane content。Mobile menu 也提供 move-to-start 和 move-to-end action。

验收：大量 tab 仍可访问；用户滚动不会被反复的 active reveal 对抗；pane split/变窄时能回退而不丢失 editor/composer state；到达边界时 edge action 会安全禁用。

相关提交： 10, 14, 22。

#### TABS-02 — 分层的垂直 tab 树

Vertical rail 按共享 prefix 对 eligible agent/terminal path 分组，压缩 single-child chain，使用稳定的 group identity，并支持 collapse/expand、计数、active descendant 和自动 reveal。Collapsed group 拒绝有歧义的 drag operation；expanded leaf 保留底层 tab order。Quick-create 和 split control 保持可见，不要折叠到不便使用的 overflow control 中。

验收：重复 path 可区分，而不必给每个 tab 都添加 prefix；即使 tab 不相邻，分组仍是确定性的；active group 会打开/reveal；drag、create 和 split action 仍可使用。

相关提交： 23, 31。Commit 23 的 flat-label 实现已被 31 取代。

### Fork 身份、构建与更新

#### DIST-01 — 单一规范的 fork 版本

`fork-build-info.json` 是 `upstreamBaseVersion`、`forkRevision` 和派生出的可安装
`version` 的唯一来源。对于官方版本 `A.B.C` 和 revision `R`，使用
`A.B.(C*1000+R)`。Git tag、Release、desktop/app display、daemon distribution、Android
以及可选的 VSIX 都使用该版本。Feature 兼容性仍由 capability 决定；版本比较只用于判断
是否存在更新的 distribution。

验收条件：发布前必须拦截 metadata/tag/package 不匹配；client 不能仅因 app 和 daemon 版本
不同就禁用已支持的 feature；base bump 后 revision 重置为 1，且每个 artifact 都派生出新
版本。

相关提交： 11, 39, 41, 56, 65–66, 68, 71, 75, 77, 79, 81, 83, 85, 88, 91, 93, 95.

#### DIST-02 — fork daemon 包与自助更新

将 fork daemon/CLI 作为一个 `@hamiltonhuaji/paseo-fork` distribution 发布，并用 manifest
防止内部 package identity 混用。解析 bundled `bin/paseo`，绝不能解析旁边的官方安装。
self-update 使用 `npm install -g --force` 安装当前 distribution spec，在可选的
`server_info` capability 数据中报告精确的 distribution name/version，并通过现有
supervisor 重启 worker。替换后的 worker 继承 supervisor 的启动环境，并从更新后的 package
路径加载代码。supervisor 进程本身保持在内存中；如果 release 改变了 supervisor 行为，
安装后需要一次完整的 daemon 外部重启或主机重启。

验收条件：package 旁的官方 CLI 不能劫持 terminal/hook/restart 命令；bundled CLI 缺失时
必须 fail closed；Settings 只有在存在更新的 fork daemon 时才提供更新；self-update 后
worker 运行目标 distribution，并且按文档执行的外部重启能在需要时更新 supervisor。

相关提交： 16, 30, 59, 64, 66, 69.

#### DIST-03 — Desktop fork 与官方更新轨道

保留 upstream app identity 和 user-data 目录，使 fork 替换已安装的 desktop app 时不丢失
设置。发布 Windows x64 NSIS 和 Linux x64 `.deb`。普通 auto-update 安装 fork feed；另有
独立的只读 official release check，可显式下载、校验并安装完整的 official package，即使
版本相同或更低也可以。明确提醒切换会停止 agents/terminals；从纯 official Paseo 返回时
需要手动安装 fork。

验收条件：Windows 和 Linux 用户保留设置；fork 绝不静默安装 official asset；显式切换到
official 时校验完整 installer；不能暗示存在 macOS artifact。

相关提交： 18, 57–58.

#### DIST-04 — 独立的 Android fork

使用独立的 package/scheme 和由 EAS 管理的长期 signing identity，使 official app 与 fork
app 可以共存。在 fork 中禁用 official OTA 和 push 集成；渲染 Android formulas，并提供只
属于 fork 的 Settings update row，该 row 只接受预期的 GitHub APK asset/URL。使用标准 EAS
worker 构建，采用最终的节省内存配置：仅 arm64、Gradle/Hermes 串行，并复用原始 build
artifact URL。

验收条件：新的 fork APK 可以升级旧 fork APK，但绝不能升级 official app；official OTA
不能替换 fork JS；标准 worker 能完成构建；update discovery 能打开受信任的 APK，或回退到
其 release page。

相关提交： 17, 19, 25–29.

#### RELEASE-01 — 仅 overlay、增量发布

保持 `main` 为 upstream mirror，保持 `overlay` 为 product branch。移除 upstream-owned 的
cloud、store、npm、release-note 和 bot publication 路径。Quick Checks 与 releases 相互
独立；release workflows 不下载 browser、不运行 smoke tests，也不等待 broad suites。先发布
Release，再在 daemon、Linux、Windows 各自完成时附加结果。Android 和 VSIX 为 opt-in。共享
准备完成后并行构建 server 和 renderer；保持 fork web 与 Electron 输出未压缩并生成 source
maps；保留 official registry lockfile URL。

验收条件：已完成的 artifact 无需等待其他平台即可公开；fork workflows 不能修改 upstream
surface；默认发布包含 daemon、Windows x64 和 Linux x64；release metadata 与 source commit
一致。

相关提交： 5–6, 33, 42, 60–63, 72.

#### SKILL-01 — 保留手动安装的 skill

无论内容 hash 或来源如何，只要 managed Agent skill root 中存在同名目录，就将其视为用户
所有。自动 convergence 只有在每个目标 root 都没有该名称时才能安装 bundled skill；不能
覆盖、删除用户目录，也不能把用户目录复制到其他 root。显式 uninstall/reinstall 是恢复
bundled copy 的路径。

验收条件：daemon 的自动维护不会改变手动编辑的字节内容和目录位置。

相关提交： 73.

### VS Code 客户端

#### VSCODE-01 — 只用一个物理连接的原生远程工作区客户端

提供独立的 Activity Bar container、保存的 hosts/workspace selection、使用真实 remote
absolute path 的单文件夹 `paseo-fs` workspace、由 daemon 提供的 pseudoterminal、Sessions
导航，以及复用 Paseo conversation panel 但不带 tab strip 的 focused WebView。凭据保存在
SecretStorage/extension host 中。每个 VS Code window 固定到一个 host，所有 WebView 通过该
window 的一个 physical direct/relay connection 复用连接；临时的跨 host workspace discovery
在获取列表后立即断开。

当前审计实现有意保持 virtual filesystem 为 read-only。文件编辑需要单独的、由 capability
门控的 daemon protocol，不会默认为本 requirement 的一部分。

验收条件：Explorer 显示 remote directory 内容时不额外增加 root wrapper；普通 new terminal
操作路由到 daemon；打开更多 session 只增加 virtual port，不增加 relay connection；host
selection 不能替换另一个 window 的 client；相同的 conversation UI、permissions、formulas
和 navigation 在 WebView 中正常工作。

相关提交： 24.

### Experiments 与 Viewer

#### EXP-01 — 持久化的项目 Experiment 协调

将 Goal、Experiment、Attempt、touch、layout 及相关 metadata 持久化到项目本地
`.paseo/v1/state.db`，同一 project 的 worktree 共享这些数据。Experiment 是带有 outcome
的持久化独立工作单元；Attempt 是 append-only 的具体操作记录，包括 retry、resume、probe、
debug、visualization 和 build 工作。保持 lineage 与 containment 分离、使用稳定 handle、
区分 null 与 omission 的 update 语义、在不删除用户输出的情况下 repair，并让 RPC/CLI/MCP/UI
契约一致。记录 Agent touch，但不要把 Experiment state 与 Agent lifecycle 混为一谈。

验收条件：另一个 process/worktree 能看到相同记录；并发 Attempts 合法；result 或 conclusion
变更遵循文档化的 lifecycle 规则；doctor/repair 报告问题但不删除输出；MCP 返回稳定的
object-shaped result。

相关提交： 32, 34–38, 55, 67, 70, 73.

#### EXP-02 — 显式的多轴进度

Attempt 可以定义 source unit 加多个 unit、track、total 以及有界的 piecewise-linear
projection。未知的转换区间保持未知。可见/聚焦的 Experiment surface 使用 daemon refresh
hint、初始错峰、retry 和 cancellation 轮询所有未结束的 Attempt；terminal state 会停止
轮询。所有 card、detail、ring 和手动 refresh 共享一个 query cache，并区分 unknown、
indeterminate、running、error 和 ended。

验收条件：非法或重叠的 plan 被拒绝；不能猜测百分比；隐藏 surface 停止轮询；每个 view
都与最新 observation 和 completion state 一致。

相关提交： 32, 43, 47, 55, 71, 80, 84, 86.

#### EXP-03 — 常驻的工作区 surface 与完整历史

从 feature-gated workspace header action 打开 Experiments，将其作为 retained workspace
surface，而不是 workspace tab。surface 挂载期间保留 tab deck、splits、focus、selection
和本地 expansion；inactive 时停止 query。按 oldest-first 显示每个 Attempt，并允许独立
折叠。在 Android 上，back 首先清除 selected detail，不能意外关闭 surface；只有显式的
header toggle 才能切换 surface。

验收条件：不支持的 host 或没有 projectId 的 workspace 不显示入口；toggle 不会重新挂载
tab deck；长 detail 内容可以独立滚动，而 desktop canvas 保持固定。

相关提交： 40, 45, 52–54, 82, 87.

#### EXP-04 — 无界、持久化的 lineage 画布

独立于 Experiment timestamp 持久化 card 的位置/尺寸。使用固定裁剪的 viewport 和无界
camera、确定性默认值、连续的 drag/resize 预览、release 时 snap、安全的 web pointer
ownership 以及 native gesture handling。保持 card 紧凑：显示最新 progress，并将并行的未
结束 Attempts 放入 hover panel。提供按 lineage 确定性执行的全 board Arrange，并支持一步
Undo；默认布局要尊重手动放置的 card。

验收条件：pan/wheel 不被 content extent clamp，也不会在 viewport 外被抢走；越过 card 边界
拖动时只完成一次；重新打开能恢复 layout；Arrange/Undo 可重复，手动移动会使 Undo 失效。

相关提交： 43, 46, 48–51, 80, 84, 86, 92.

#### VIEWER-01 — 安全的 Viewer 服务、目录发现与隧道

通过仅监听 loopback 的 viewer service 提供 Experiment 静态输出，并具备 traversal protection、
longest-prefix mount、inheritance/cycle detection、files/ranges/cache 语义以及安全的
relative namespace。Relay 和 direct TCP desktop client 都使用 local forwarder；不要在 daemon
主 HTTP port 暴露 viewer path。目录发现使用 `?paseo=list`，提供排序后的 snapshot 分页、
有界 limit、不透明的 path-bound cursor、过期处理和不泄露 host filesystem path 的同源 href。

验收条件：direct 与 relay 行为一致；dynamic result directory 可以分页且不重复；无效或过期
cursor 返回清晰错误；普通 viewer file 和 index page 继续正常工作。

相关提交： 32, 74, 90.

## 下一次 base bump 的依赖顺序

1. 建立 `DIST-01` metadata 和新的 official base，但暂不发布。
2. 在 client 之前恢复 Codex、Experiments、distribution metadata、viewers 以及未来 writable
   filesystem 所需的 protocol/capability 原语。
3. 然后恢复 server/provider 行为，之后再恢复 app/desktop/Android/VS Code consumer。
4. 在运行 release workflows 前恢复 packaging 和 updater invariants。
5. 最后恢复 fork workflows，以新的 upstream workflow 文件为起点。
6. 对照 upstream 检查上述每个需求，并记录其结果为上游完整实现、上游部分实现、Fork
   仍需实现或明确决定弃用。
7. 将 `forkRevision` 重置为 1，派生新版本；只有在需求矩阵没有未分类条目后才发布。

## 逐提交附录

处理标签：

- **保留：** 保留该行为，并适配新的 base。
- **最终形态：** 保留该提交的结果，而不是其链条中更早的实现。
- **已取代：** 不要重放该实现；其需求已由后续行体现。
- **重建元数据：** 从新的 base 重新创建，而不是保留历史 diff。

### 提交 1–32

|   # | Commit                                                                 | 变更内容                                                                                                                                     | 恢复出的需求                                                                             | 处理建议                                                                |
| --: | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
|   1 | `2720d0e80` `fix(server): preview files through external symlinks`     | 移除对解析后目标的 containment 限制，同时保留规范化路径、最终的 `O_NOFOLLOW` 和普通文件检查；记录 trust boundary。                           | 允许通过 workspace symlink 访问外部存储的结果进行预览，但不把 workspace 假装成 sandbox。 | 保留（`FILE-01`）。                                                     |
|   2 | `31c0b2dae` `fix(web): keep file link tooltips interactive`            | 增加交互式 tooltip context，以及 trigger 到 content 的 safe-zone 跟踪。                                                                      | 允许用户进入卡片点击/选择 file target，同时不改变普通 tooltip 行为。                     | 作为 `LINK-01` 的一部分保留。                                           |
|   3 | `2d1742187` `fix(web): retain selected file link tooltips`             | 当浏览器选择范围与卡片内容相交时保持交互式卡片打开。                                                                                         | 拖动复制路径时不能中途关闭卡片。                                                         | 作为 `LINK-01` 的一部分保留。                                           |
|   4 | `41d91ce5b` `feat(web): preview external link targets`                 | 抽取通用的 link-hover card，并将其应用到 Markdown URL 和 file link。                                                                         | 让 file link 和 external link 具备相同的检查/复制交互。                                  | `LINK-01` 的最终形态；保留第 2–3 行的语义。                             |
|   5 | `dafc254c6` `docs(fork): document rebaseable overlay workflow`         | 定义 upstream mirror、overlay branch、stable-tag rebase/rebuild、验证和 force-with-lease 策略。                                              | 在 upstream release 后保持 fork 历史可审计、可重建。                                     | 重建文档（`RELEASE-01`）。                                              |
|   6 | `5952c8374` `ci(fork): route checks through overlay branch`            | 将检查/发布目标改到 overlay，并禁用 upstream 所有的部署路径。                                                                                | 永远不要从 upstream mirror 发布 fork code，也不要要求 upstream credentials。             | 保留策略；从新 upstream 重建 workflows（`RELEASE-01`）。                |
|   7 | `27dbcf0f2` `feat(app): download files through active host connection` | 增加 transfer routing 和各平台保存流程；只有 active 且匹配的 connection 才直接使用 HTTP。                                                    | 不猜 endpoint，通过 direct 或 relay connection 可靠下载。                                | 保留（`FILE-02`）。                                                     |
|   8 | `b470ce5d6` `feat(agent): add native Codex conversation forks`         | 增加 fork protocol/capability、boundary validation、Codex `thread/fork` 和新 session hydration。                                             | 在已完成的 conversation boundary 创建 provider-native branch。                           | 保留基础能力（`CODEX-01`）；采用第 76/89/90 行的最终语义。              |
|   9 | `dfe423d9c` `feat(app): render TeX in web and Android markdown`        | 增加 Markdown TeX tokens、内置 KaTeX web rendering、Android RaTeX、安全 fallback 和 source copying。                                         | 让技术 conversation 中的数学内容可读、离线可用、安全且可复制。                           | 保留（`MD-01`）。                                                       |
|  10 | `f7949ddb5` `feat(app): improve desktop tab navigation`                | 增加移到边缘、显示 active tab 和 web 横向 wheel scrolling 操作。                                                                             | 保持大量顶部 tabs 可导航。                                                               | 保留（`TABS-01`）。                                                     |
|  11 | `133daabf0` `chore(fork): set upstream baseline to v0.6.1`             | 引入 base/revision metadata 和最初的 fork display version。                                                                                  | 标识确切的官方 base 和 fork iteration。                                                  | 被第 66 行取代；重建 metadata（`DIST-01`）。                            |
|  12 | `b0b183531` `feat(app): add native forks and active turn states`       | 增加 capability-gated native/fallback fork UI、waiting states、即时 navigation/hydration，以及 Thinking/Waiting footer 逻辑。                | 解释 fork 是否可用，并让结果立即可使用。                                                 | 保留（`CODEX-01`、`CODEX-03`）。                                        |
|  13 | `4796f49ad` `fix(codex): settle tools when turns end`                  | 在 terminal turn events 前结算正在运行的 root tools，但不触碰 child-agent tools。                                                            | 防止已完成/被中断的 turn 留下 active tool 动画。                                         | 保留（`CODEX-03`）。                                                    |
|  14 | `5ccd60ae7` `feat(app): add responsive vertical tabs`                  | 增加持久化的 top/left placement、width fallback、vertical DnD/reveal、rail 和 pane controls。                                                | 利用多余的桌面宽度，同时保持窄 pane 可用。                                               | 保留基础行为（`TABS-01`）；与第 31 行合并。                             |
|  15 | `03c9000ee` `fix(app): normalize common HTML-ish markdown`             | 将常见 paragraph tags 视为透明内容，并把不安全/相对路径的 HTML images 转换为可读的 alt text。                                                | 渲染类似 README 的内容，但不启用任意 HTML，也不暴露原始 tags。                           | 保留（`MD-01`）。                                                       |
|  16 | `9c3a099ad` `feat(server): package the fork daemon for npm installs`   | 增加外层 fork npm distribution、manifest/version validation、bundled launcher 和 distribution-aware updater。                                | 将 daemon 作为一个不混用的 fork package 安装和更新。                                     | 保留（`DIST-02`）。                                                     |
|  17 | `37466c72f` `feat(android): add fork APK distribution`                 | 增加独立的 app identity/EAS profile，禁用官方 services，并接入可信的 GitHub APK update plumbing。                                            | 发布可与官方 Paseo 共存、独立签名的 fork Android app。                                   | 保留基础能力（`DIST-04`）。                                             |
|  18 | `5efe18531` `feat(desktop): add fork and official update tracks`       | 增加 fork auto-update、只读 official checks 和经验证的一次性切换；限制 desktop platforms。                                                   | 正常更新 fork，同时保留明确切换到纯官方 Paseo 的 escape hatch。                          | 保留（`DIST-03`）。                                                     |
|  19 | `e33911bba` `feat(android): expose fork APK updates in settings`       | 增加仅 fork 使用的 Android update status，以及可信的 APK/release navigation。                                                                | 让后续 fork APK release 可被发现，同时不污染其他 variants。                              | 保留（`DIST-04`）。                                                     |
|  20 | `85f36d9b7` `feat(app): make composer shortcuts explicit`              | 在 web/iOS hardware paths 中明确 Enter 换行、modifier+Enter action 和 Tab queue。                                                            | 支持多行 prompt，并明确 send/steer/queue action。                                        | 保留（`COMPOSER-01`）。                                                 |
|  21 | `b19d8abf5` `docs(app): explain composer shortcut behavior`            | 更新本地化的 settings/help text，说明新的 keyboard matrix。                                                                                  | 保持 UI 说明与实际 shortcuts 同步。                                                      | 与第 20 行一起保留（`COMPOSER-01`）。                                   |
|  22 | `44832712e` `feat(app): move mobile tabs to list edges`                | 通过 mobile menus 将 move-to-start/end 连接起来，并使用安全的 optional callbacks。                                                           | 也为 mobile 用户提供高效的 tab ordering。                                                | 保留（`TABS-01`）。                                                     |
|  23 | `2c2709b5d` `feat(app): disambiguate vertical tab paths`               | 为重复的 rail entries 增加最小化的 flat path-prefix labels。                                                                                 | 区分同名 sessions。                                                                      | 被第 31 行取代（`TABS-02`）。                                           |
|  24 | `d7a2776db` `feat(vscode): add relay-backed workspace client`          | 增加 VS Code extension、relay/direct workspace FS、daemon terminal、Sessions/WebView UI、host pinning 和 one-connection broker。             | 像 Remote-SSH 一样把 Paseo 用作 VS Code workspace，同时不增加 relay connections。        | 作为独立 product surface 保留（`VSCODE-01`）。                          |
|  25 | `8d7641b60` `fix(android): use standard EAS build resources`           | 移除对大型 EAS worker 的要求。                                                                                                               | 让 personal-fork Android builds 保持可负担。                                             | 中间步骤；保留最终的 `DIST-04` build profile。                          |
|  26 | `c9013c3a7` `fix(android): fit fork APK builds on standard workers`    | 将 fork APK 限制为 arm64，以降低 build pressure。                                                                                            | 让 standard worker 能够完成构建。                                                        | 保留最终约束（`DIST-04`）。                                             |
|  27 | `380c49a10` `fix(android): leave memory for Hermes on EAS`             | 串行执行 Gradle，限制 workers/JVM memory，并分阶段执行 bundle/assemble。                                                                     | 避免 standard-worker OOM。                                                               | 保留最终 build 行为（`DIST-04`）。                                      |
|  28 | `c874e9dca` `fix(android): reduce fork Hermes compiler memory`         | 增加 fork-only、幂等的 Expo plugin，使用更低内存的 Hermes flags 和 source maps。                                                             | 完成 APK 编译，同时不影响 official/F-Droid builds。                                      | 保留最终 build 行为（`DIST-04`）。                                      |
|  29 | `812270c08` `fix(ci): reuse EAS Android artifact URL`                  | 复用原始 EAS build output，而不是再次查询。                                                                                                  | 只发布一次确切的 build，并减少 release latency/failure points。                          | 保留最终 workflow 行为（`DIST-04`）。                                   |
|  30 | `e715de543` `fix(server): force daemon distribution updates`           | 为全局 npm installs 增加 `--force`。                                                                                                         | 在切换/更新 distributions 时替换冲突的 `paseo` shim。                                    | 保留（`DIST-02`）。                                                     |
|  31 | `d4a82c1dc` `fix(app): restore hierarchical vertical tabs`             | 用稳定的可折叠 groups、active reveal、安全 drag rules 和可见的 quick/split actions 取代 flat labels。                                        | 将 session paths 表示为可用的 tree，而不是装饰性的 prefixes。                            | `TABS-02` 的最终形态；取代第 23 行。                                    |
|  32 | `d600de7cf` `feat(experiments): add project experiment coordination`   | 增加 project SQLite/blob model、Goal/Experiment/Attempt APIs、progress、viewer mounts、relay tunnel、CLI/MCP/UI、skill 和初始 release bump。 | 协调持久且可审计的工作，并独立于 agent lifecycle 远程检查其 outputs。                    | 保留基础能力（`EXP-01`–`EXP-04`、`VIEWER-01`）；重建 release metadata。 |

### 提交 33–64

|   # | Commit                                                                       | 变更内容                                                                                                                                                        | 恢复出的需求                                                                                    | 处理建议                                                                              |
| --: | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
|  33 | `f28b02b18` `chore(lockfile): use npm registry URLs`                         | 将 mirror `resolved` URLs 替换为官方 npm registry URLs，不改变 versions 或 integrity。                                                                          | 保持 dependency acquisition 可审计，并独立于 private/local mirror。                             | 重建 lockfile metadata（`RELEASE-01`）。                                              |
|  34 | `cb52e16a5` `fix(protocol): keep experiment requests flat`                   | 将 discriminated-union storage request 替换为 flat schema 和可选的 scoped handles。                                                                             | 保持 wire schemas 便于生成且向后兼容；在 handler 中验证语义要求。                               | 保留（`EXP-01`）。                                                                    |
|  35 | `6f6df9c52` `fix(server): validate experiment storage targets`               | 根据请求的 storage scope 拒绝缺失的 Experiment/Attempt handles。                                                                                                | flat protocol 不能让未定义的 storage target 进入 path resolution。                              | 保留（`EXP-01`）。                                                                    |
|  36 | `7bddab5d9` `test: align capability fixtures and app optimizer`              | 更新 capability fixtures 和 RN Vitest dependency optimization。                                                                                                 | 保持 fixtures/tooling 与 optional native-fork capability 及 RN module behavior 对齐。           | 重建配套 test/tool metadata；没有独立 product requirement。                           |
|  37 | `ee6d352ba` `fix(server): omit absent experiment touches`                    | 仅在已加载/存在时序列化 `experimentTouches`，并对齐 relay mock。                                                                                                | 保留 absent metadata 与显式 empty value 之间的区别。                                            | 保留 serializer 语义（`EXP-01`）；重建 test fixture。                                 |
|  38 | `8cd17675b` `fix(agents): restore Paseo tools and reload state`              | 默认启用 MCP injection，传递 caller identity/touches；reload 时保留 timeline；使 history hydration 非致命；保留 CLI error metadata，并恢复 bundled skill path。 | Agent 默认应获得 Paseo tools 和 attribution；history refresh 失败时 reload 不得破坏可用 state。 | 保留 product behavior（`AGENT-01`、`CODEX-02`、`EXP-01`）；采用后续 reload 最终形态。 |
|  39 | `b4e8e0ebc` `chore(release): bump fork revision`                             | 将历史 fork revision 从 2 提升到 3。                                                                                                                            | 为前述行为用新的 install version 发布。                                                         | 重建 metadata（`DIST-01`）。                                                          |
|  40 | `462fc880c` `feat(app): expose experiments from workspace header`            | 在 desktop 和 mobile workspace headers 中增加 feature/project-gated Experiments action。                                                                        | 仅当 host/workspace 支持时，让 project experiments 可直接访问。                                 | 保留（`EXP-03`）。                                                                    |
|  41 | `0dcbdd284` `chore(release): bump fork revision`                             | 将历史 fork revision 从 3 提升到 4。                                                                                                                            | 发布 workspace entry point。                                                                    | 重建 metadata（`DIST-01`）。                                                          |
|  42 | `880ecad11` `chore(fork): restore overlay release workflows`                 | 移除 upstream-owned deploy/publish automation，并恢复 manual fork desktop、Android、daemon、rollout 和文档路径。                                                | overlay 只能发布 fork-owned artifacts，永远不能依赖或修改 upstream infrastructure。             | 保留策略；从新 upstream 重建 workflows（`RELEASE-01`）。                              |
|  43 | `93d71ed8d` `feat(experiments): add grid canvas and schedule tracks`         | 增加持久化 board layout、可拖动/调整大小的 cards、lineage connectors、parallel progress tracks 和 validation。                                                  | 在空间中协调 Experiments，并表示 parallel scheduled work，同时不改变 Experiment timestamps。    | 保留基础能力（`EXP-02`、`EXP-04`）；采用后续 camera/progress 形态。                   |
|  44 | `971da67af` `fix(app): render segmented control icons as components`         | 将 segmented-control icons 从被调用的 render functions 改为 component types。                                                                                   | 保持 React component identity 和 icon renderers 的 hook correctness。                           | 若 upstream 仍需要则保留；属于小型适配，不是 overlay architecture。                   |
|  45 | `5afba57b2` `feat(experiments): show chronological attempt history`          | 将单 Attempt picker 替换为按 oldest-first 渲染全部 Attempts 及其 details/progress/viewers。                                                                     | Attempt 是 append-only history，必须持续可见，不能互相替换。                                    | 保留（`EXP-03`）。                                                                    |
|  46 | `40a794bb9` `fix(experiments): improve canvas navigation`                    | 增加独立 Attempt collapse、稳定的 chronological defaults、连续的 drag/resize preview、release 时 snap，以及不缩小的 bounds。                                    | 保持 dense history 可浏览，并防止操作卡片时 canvas 抖动。                                       | 保留用户行为；实现被第 49–51 行取代（`EXP-03`、`EXP-04`）。                           |
|  47 | `1144fb019` `feat(experiments): improve canvas navigation and progress axes` | 将单 progress 替换为 source/multiple units、tracks 和 projections；增加 unit selection/projected markers，并强化 canvas navigation。                            | 用 steps/samples/frames 等真实 axes 表达 progress，不臆造未知 conversions。                     | 最终 data-model 基础（`EXP-02`）；camera mechanics 延续到第 51 行。                   |
|  48 | `67c430f23` `fix(experiments): guard canvas pointer capture`                 | 防护 web-only pointer capture 和 release races。                                                                                                                | pointer lifecycle races 不能使 canvas gestures 崩溃。                                           | 保留 invariant；helper 实现被第 49 行取代（`EXP-04`）。                               |
|  49 | `fadb586fb` `fix(experiments): make canvas mouse-draggable`                  | 使用 web pointer/window listeners 可靠地完成 handle 外部的 drag/resize，同时保留 native PanResponder。                                                          | 即使离开起始 element，desktop mouse 操作也必须完成。                                            | 保留 invariant；基于 scroll 的 mechanics 被第 51 行取代（`EXP-04`）。                 |
|  50 | `8b6e6dd08` `fix(experiments): add canvas pan space`                         | 增加周围的 pan margin，并分离 content/background layers。                                                                                                       | 卡片位于边缘时仍需要空的 camera space。                                                         | 被第 51 行的 unbounded camera 取代（`EXP-04`）。                                      |
|  51 | `c1d948b2c` `refactor(experiments): use an unbounded canvas camera`          | 将嵌套 ScrollViews/content bounds 替换为 clipped viewport 和 local camera translation。                                                                         | 将 board 视为不受 selection 或 content extent 影响的 unbounded plane。                          | canvas navigation 的最终形态（`EXP-04`）。                                            |
|  52 | `1ec439290` `feat(experiments): open board as workspace tab`                 | 将 Experiments 注册为持久化 workspace tab/panel target。                                                                                                        | 保留 board-local state，并集成 workspace navigation。                                           | 被第 53 行的 retained surface 取代（`EXP-03`）。                                      |
|  53 | `7950be017` `fix(experiments): make board a workspace surface`               | 移除 tab target，将 Experiments 变为 retained workspace surface，同时保留 tabs/splits/focus 并暂停 inactive work。                                              | Experiments 属于 workspace-level navigation，不应污染或 remount tab deck。                      | 最终 architecture（`EXP-03`），由第 54 行细化。                                       |
|  54 | `d872ff936` `fix(experiments): keep surface dismissal explicit`              | 移除隐式/back-button dismissal；保留 header toggle ownership，并让 Android back 先清除 detail。                                                                 | canvas/back gestures 不能意外退出 Experiment surface。                                          | 最终 dismissal 语义（`EXP-03`）。                                                     |
|  55 | `2de68bac2` `docs(experiments): update bundled tracking skill`               | 让 bundled skill 采用 append-only Attempt 规则，以及明确的 progress unit/track/projection 语义。                                                                | Agent 必须为 retries/probes 新建 Attempts，永远不要猜测 progress conversions。                  | 保留当前 skill 中的意图（`AGENT-01`、`EXP-01`、`EXP-02`）。                           |
|  56 | `59f6bbe41` `chore(release): bump fork revision`                             | 将历史 fork revision 从 4 提升到 5。                                                                                                                            | 发布 Experiment surface/progress work。                                                         | 重建 metadata（`DIST-01`）。                                                          |
|  57 | `ae5a3597f` `test(desktop): follow fork update label`                        | 更新 fork-specific update heading 的 desktop locator。                                                                                                          | 测试 fork channel，而不是通用/官方 update UI。                                                  | 仅重建配套 test；没有独立 requirement。                                               |
|  58 | `79b08919b` `test(desktop): disambiguate fork update check`                  | 让 update `Check` locator 精确匹配。                                                                                                                            | 不要点击名称相近的 official-update control。                                                    | 仅重建配套 test；没有独立 requirement。                                               |
|  59 | `a4f023279` `fix(fork): keep daemon CLI within distribution`                 | 只从 bundled fork package 解析 terminal CLI，解析失败时 closed fail，而不是 fallback 到 official Paseo。                                                        | fork daemon 不能通过另一个 distribution 的 CLI 重启或启动 hooks。                               | 保留（`DIST-02`）。                                                                   |
|  60 | `3f97e9726` `ci(overlay): disable long-running checks`                       | 在 overlay CI 中禁用慢速 browser/server/desktop/relay/CLI checks，以及 browser installation。                                                                   | 让 routine overlay feedback 和 publication 保持在 personal fork 的时间/资源预算内。             | 被第 61 行更清晰的 workflow split 取代（`RELEASE-01`）。                              |
|  61 | `2e4d493d5` `ci(fork): decouple release from test suites`                    | 缩减 Quick Checks，移除 heavy release validation/smoke steps，并让 release 独立于 test workflows。                                                              | 发布不能等待 broad tests 或 browser downloads；tests 只在明确请求时运行。                       | 最终策略基础（`RELEASE-01`）。                                                        |
|  62 | `b380e9f3c` `ci(fork): publish artifacts as they finish`                     | 每个完成的平台 artifact 立即发布，并让 VSIX 变为 opt-in。                                                                                                       | 慢平台不能隐藏已经可用的 builds。                                                               | 保留（`RELEASE-01`），由第 72 行细化。                                                |
|  63 | `83c043c96` `build(fork): parallelize release compilation`                   | 共享 dependency preparation/cache，并并发运行 server/renderer compilation。                                                                                     | 在不改变 artifact identity 的前提下减少 release wall time。                                     | 在兼容时保留 build topology（`RELEASE-01`）。                                         |
|  64 | `48b4941b1` `fix(fork): expose daemon distribution updates`                  | 给 `server_info` 增加可选的精确 distribution name/version，并在 Settings 暴露 fork daemon update state/actions。                                                | 区分同一 official base 上的 fork revisions，并根据实际 distribution availability 更新 daemon。  | 保留 capability/version 语义（`DIST-01`、`DIST-02`）。                                |

### 提交 65–95

|   # | Commit                                                                     | 变更内容                                                                                                                                                      | 恢复出的需求                                                                                 | 处理建议                                                                                              |
| --: | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
|  65 | `f15f1c0c1` `chore(release): bump fork revision`                           | 将旧 schema 的历史 revision 从 7 提升到 8。                                                                                                                   | 发布另一个 fork build。                                                                      | 被第 66 行的 metadata 取代；重建（`DIST-01`）。                                                       |
|  66 | `11e96088b` `fix(fork): unify distribution versioning`                     | 在 desktop、app、daemon、Android、VSIX、tags 和 update UI 中引入 canonical `version`/`forkRevision` 推导与校验。                                              | 让每个可安装组件拥有一个单调版本，同时保留 official-base identity。                          | 最终 version model（`DIST-01`）。                                                                     |
|  67 | `2a52b7e74` `refine bundled experiment skill model`                        | 将 Experiment 重新定义为独立的持久工作单元，将 Attempt 定义为一个 append-only operation，并补充 probe/retry/build guidance。                                  | 防止 agent lifecycle 或单个正式 training run 成为错误的 experiment history 单位。            | 保留 model/skill intent（`AGENT-01`、`EXP-01`）。                                                     |
|  68 | `a8dfa8315` `chore(release): bump fork revision`                           | 将 canonical fork revision 从 9 提升到 10（`0.6.1010`）。                                                                                                     | 发布 unified-version work。                                                                  | 重建 metadata（`DIST-01`）。                                                                          |
|  69 | `44942a9cf` `fix(fork): refresh agent capabilities reliably`               | 输出未压缩且带 source map 的 web builds；打开时刷新 Skills status；声明 MCP dependency；移除阻塞性的 post-reload history hydration，并提升 revision。         | 保持 production errors 可诊断且 capability UI 新鲜；不要让冗余 hydration 阻塞有效 session。  | 保留 diagnostics/capability 行为；reload 实现延续到第 78 行（`AGENT-01`、`CODEX-02`、`RELEASE-01`）。 |
|  70 | `95bf4f37b` `fix(experiments): stabilize detail selection and MCP results` | 稳定派生的 agent selection，并将 `list_experiments` 结果包在带 `experiments` 数组的 object 中。                                                               | 避免 selector churn，并为 MCP/skills 提供稳定且可扩展的结果形状。                            | 保留（`EXP-01`）。                                                                                    |
|  71 | `39e3e62f1` `chore(release): bump fork revision`                           | 将 revision 从 11 提升到 12（`0.6.1012`）。                                                                                                                   | 发布 capability/Experiment fixes。                                                           | 重建 metadata（`DIST-01`）。                                                                          |
|  72 | `b5f224d70` `fix(release): publish fork release before artifacts`          | 先公开 GitHub Release，再让 artifacts 独立出现；明确 Android/VSIX 的选择规则。                                                                                | 用户/update clients 应在无需等待慢速 optional platforms 的情况下看到已完成 outputs。         | 发布时序的最终形态（`RELEASE-01`）。                                                                  |
|  73 | `f22645df3` `feat(skills): preserve manually installed copies`             | 将 convergence 从内容 hashes 改为同名目录 ownership，并停止自动 overwrite/delete/cross-root copying。                                                         | 永远不要销毁或静默替换手动安装/编辑的 skill。                                                | 保留（`SKILL-01`）。                                                                                  |
|  74 | `2ff007035` `fix(experiments): tunnel direct viewer traffic`               | 将 desktop viewer tunneling 从仅 relay 扩展为经由 local forwarder 的 relay/direct TCP connections。                                                           | 为 direct users 提供同等受保护的 viewer path，同时不暴露 daemon 的 primary HTTP port。       | 保留（`VIEWER-01`）。                                                                                 |
|  75 | `b2e86c3ff` `chore(release): bump fork revision`                           | 将 revision 从 12 提升到 13（`0.6.1013`）。                                                                                                                   | 发布 direct viewer tunneling。                                                               | 重建 metadata（`DIST-01`）。                                                                          |
|  76 | `634d60584` `fix(codex): preserve tools across thread forks`               | 通过 native fork/rewind 传递当前 inner Codex config 和合并后的 developer instructions。                                                                       | branched thread 不能丢失 tools、system constraints 或 execution configuration。              | 保留（`CODEX-01`）。                                                                                  |
|  77 | `ba23586e0` `chore(release): bump fork revision`                           | 将 revision 从 13 提升到 14（`0.6.1014`）。                                                                                                                   | 发布 fork tool preservation。                                                                | 重建 metadata（`DIST-01`）。                                                                          |
|  78 | `cfefc9dc1` `fix(codex): make agent reload single-writer safe`             | 增加 exclusive reload locking、close-before-resume、回退到旧 config，以及更丰富的 RPC diagnostics。                                                           | 在保持 reload 可恢复的同时保护 durable Codex threads 不被 concurrent writers 破坏。          | reload 基础的最终形态（`CODEX-02`）。                                                                 |
|  79 | `dc8665430` `chore(release): bump fork revision`                           | 将 revision 从 14 提升到 15（`0.6.1015`）。                                                                                                                   | 发布 safe reload。                                                                           | 重建 metadata（`DIST-01`）。                                                                          |
|  80 | `71d5f431c` `feat(app): clarify experiment progress state`                 | 增加 progress rings/success styling/remaining masks，并将 wheel handling 限制在 canvas viewport 内。                                                          | 让 running、remaining 和 completed progress 清晰可读，同时不抢占无关 scrolling。             | 保留 UX 语义（`EXP-02`、`EXP-04`）。                                                                  |
|  81 | `d46c5ede8` `chore(release): bump fork revision`                           | 将 revision 从 15 提升到 16（`0.6.1016`）。                                                                                                                   | 发布 progress-state UI。                                                                     | 重建 metadata（`DIST-01`）。                                                                          |
|  82 | `9e693912f` `fix(app): isolate experiment detail scrolling`                | 在大 canvas mode 禁用 outer scroll，并为 detail 提供自己的 scroll container。                                                                                 | 滚动长 detail 时不能移动 board。                                                             | 被第 87 行的最终 container model 取代（`EXP-03`）。                                                   |
|  83 | `00d8d70f6` `chore(release): bump fork revision`                           | 将 revision 从 16 提升到 17（`0.6.1017`）。                                                                                                                   | 发布首次 scroll isolation fix。                                                              | 重建 metadata（`DIST-01`）。                                                                          |
|  84 | `3e0f79864` `feat(app): monitor active experiment attempts`                | 增加 shared progress states/cache，以及面向 surface、为每个未完成 Attempt 调度的 polling。                                                                    | 即使 detail 折叠也监控 experiments；不进行 daemon-side busy polling，也不产生不一致 views。  | 保留 data/lifecycle layer（`EXP-02`）；card layout 由第 86 行细化。                                   |
|  85 | `cad66c8b5` `chore(release): bump fork revision`                           | 将 revision 从 17 提升到 18（`0.6.1018`）。                                                                                                                   | 发布 active Attempt monitoring。                                                             | 重建 metadata（`DIST-01`）。                                                                          |
|  86 | `f4f7d8c1b` `fix(app): move parallel progress into hover panel`            | 通过显示最新 progress 并将 parallel unfinished rows 移到 hover panel，使 canvas cards 保持紧凑。                                                              | parallel attempts 必须可检查，同时不能使 lineage cards 任意变高。                            | 第 84 行之上的最终 canvas presentation（`EXP-02`、`EXP-04`）。                                        |
|  87 | `25efe6bf0` `fix(app): give experiment detail independent scroll`          | 引入明确的 fixed desktop content frame 和 independent detail scroll；compact layouts 保留 outer scroll。                                                      | 在 canvas 和 compact modes 中正确确定 scroll ownership。                                     | 取代第 82 行的最终形态（`EXP-03`）。                                                                  |
|  88 | `f34b6309a` `chore(release): bump fork revision`                           | 将 revision 从 18 提升到 19（`0.6.1019`）。                                                                                                                   | 发布最终 progress/scroll presentation。                                                      | 重建 metadata（`DIST-01`）。                                                                          |
|  89 | `8eb8e5010` `fix(server): fork Codex threads for rewind`                   | 用 native before-turn fork/exclusion 替换 deprecated rollback，增加 paginated item support/mappings，并拒绝当前 in-flight user turn。                         | rewind 必须保留 source thread 和 files，同时将 Paseo session 移到新的 durable thread。       | 保留基础能力；boundary lookup 由第 90 行细化（`CODEX-01`）。                                          |
|  90 | `e491c193d` `feat(server): list viewer directories and harden rewind`      | 增加 snapshot-paginated viewer directory listing；将 rewind boundary resolution 改为 native item pages/provider-or-client IDs；同步新的 persistence handles。 | 安全发现动态 output，并让旧消息 rewind 不依赖 reconstructed/paginated Paseo history。        | 最终形态（`VIEWER-01`、`CODEX-01`、`CODEX-02`）。                                                     |
|  91 | `ef5fd86cc` `chore(release): bump fork revision`                           | 将 revision 从 20 提升到 21（`0.6.1021`）。                                                                                                                   | 发布 viewer/rewind hardening。                                                               | 重建 metadata（`DIST-01`）。                                                                          |
|  92 | `0d6c5ecf7` `feat(app): arrange experiment lineage trees on canvas`        | 增加能够感知 stored position 的 defaults，以及确定性的 whole-board lineage Arrange 和单步 Undo。                                                              | 让大型 lineage boards 易读，同时默认不覆盖手动位置。                                         | 保留最终 layout controls（`EXP-04`）。                                                                |
|  93 | `fdc016041` `chore(release): bump fork revision`                           | 将 revision 从 21 提升到 22（`0.6.1022`）。                                                                                                                   | 发布 lineage arrangement。                                                                   | 重建 metadata（`DIST-01`）。                                                                          |
|  94 | `a2011cd7c` `fix(codex): render asynchronous choice prompts`               | 增加持久化的 structured assistant questions、reply linkage、answer/steer UI，以及 projection/coalescing boundaries。                                          | 允许用户在 streaming/reload 后回答 nonblocking Codex questions，而不把它们当作 permissions。 | 保留（`CODEX-04`）。                                                                                  |
|  95 | `70f86f3ad` `chore(release): bump fork revision`                           | 将 revision 从 22 提升到 23（`0.6.1023`），即审计范围的 head。                                                                                                | 发布 asynchronous choice prompts。                                                           | 从下一个 base 重建 metadata（`DIST-01`）。                                                            |

## 取代关系图

- Link hover：2 → 3 → 4。第 4 行是共享组件；第 2–3 行仍是必需行为。
- Native fork/rewind：8 → 12 → 76 → 89 → 90。保留最终的 provider-boundary 和 persistence 语义，不保留早期的 historical lookup code。
- Vertical tabs：14 → 23 → 31。第 31 行取代第 23 行的 flat labels。
- Android build：17 → 25 → 26 → 27 → 28 → 29。将最终 profile 作为一个整体重建。
- Experiment canvas：43 → 46 → 48 → 49 → 50 → 51，之后是 80/84/86/92。unbounded camera、compact progress hover 和 Arrange/Undo 构成最终交互模型。
- Experiment navigation：52 → 53 → 54。保留的 workspace surface 取代 tab target。
- Experiment detail scrolling：82 → 87。第 87 行是最终形态。
- Fork CI/release：42 → 60 → 61 → 62 → 63 → 72。使用最终的 independent/incremental release contract，不使用已禁用的 legacy jobs。
- Fork versions：11 和 65 使用过时的 metadata shapes；第 66 行拥有 canonical model。所有 `chore(release)` 行都是历史 publication markers，不是要重放的 code。
- Agent reload：38/69 → 78 → 90。将 nonfatal history behavior、single writer、recovery 和 native handle synchronization 一并保留。

## 未来重建时的覆盖检查

替换 `overlay` 前，运行 `git log --reverse --format=%h <old-base>..<old-overlay>`，并确认每个旧 short SHA 在本附录中恰好出现一次。然后生成一份需求矩阵，为每个 requirement ID 提供新 overlay 中的证据。Release-number commits 可以映射到 `DIST-01 / 重建元数据`；已取代的行可以映射到其最终后继，但不能留下任何未解释的 commit。
