# v0.13.2 Viewer 连续性修正

本轮修复 v0.13.1 在 baseline bump 中替换已调优代理并中断混合版本访问的问题。
行为基准是已发布 v0.9.20（`1bd70fb5056d623e8da784dce82d8ee72fa5f486`），
修复起点为 v0.13.1（`38e8b2d33901c6a456a18f50f6fa66dc465e77b8`）。
Works 记录：`item_3857a847`；契约：[VIEWER-02](../viewers.md#viewer-02--directrelay-下可持续使用的本地入口)。

## 纠正的边界

用户于 2026-10-23 要求保留 v0.9.20 已验证的交互表现。此前把 VIEWER-05
目标规格当作迁移中替换产品传输的依据，没有性能对照和混合版本证据。
[原 TCP 验收](../../qa-evidence/viewer-contracts-2026-10-22.md)保留为历史记录，
其同版本正确性结果不能证明这次替换成立。固定规格没有改动；目标继续单独评审。

桌面、Android 和统一打开入口恢复 HTTP 资源代理。请求调度、连接池、窗口和
帧大小沿用 v0.9.20。保留新基线的来源所有权和 Android serviceId 生命周期修复。
已发布 v0.13.1 使用的 TCP API 仍可调用，产品 Viewer 不再要求该能力。

## 跨版本与 Connected Hosts

| 连接                       | Viewer 格式       | Connected Hosts        |
| -------------------------- | ----------------- | ---------------------- |
| 新客户端 → v0.9.20 daemon  | 原有 `0x30..0x35` | 旧 daemon 不提供此能力 |
| v0.9.20 客户端 → 新 daemon | 原有 `0x30..0x35` | 旧客户端不调用此能力   |
| 新客户端 → 新 daemon       | `0x40..0x45`      | 保留上游 `0x30`        |

格式在连接边界按对端能力选择，不从负载内容猜测。每个物理来源单独协商，
普通 Viewer 请求与 Connected Hosts 的路由命名空间不会互相替换。
这里验证兼容和共存；没有把 Viewer 经 A→B 的多跳产品入口列为交付能力。

## 实际检查

- 从 GitHub 下载已发布 v0.9.20 daemon 包，使用包内原始 server/client 代码，
  外部依赖复用本机兼容版本；独立临时 home、端口和 skill 目录，不启动 agent。
  新 SDK → 旧 daemon、旧 SDK → 新 daemon 均通过 6 路并发、range、取消、
  2 MiB 内容逐字节校验和客户端重连；旧包文件未修改。结果为
  `mixed-version-result.json`，不包含旧安装版 GUI 或跨版本 relay 的实际体验。
- 编解码覆盖字面旧帧与 Connected Hosts 帧：6 项通过。
- SDK 接收新旧 Viewer 格式并回送对应控制帧：2 项通过。
- 真实隔离 daemon：两种格式的并发资源、range、取消、2 MiB 完整内容、
  listener 冲突回退、失败回滚和 origin 保持通过。
- 实际本地 Wrangler 加密 relay：两种格式下 direct→relay→direct，
  暂停大资源时 6 个小资源仍完成，取消后 8 MiB 内容逐字节一致，origin 保持。
- Connected Hosts 现有真实 daemon 场景：不同来源复用 clientId 时，终端二进制、
  路由隔离和连接关闭边界通过。
- 恢复后的打开入口 8 项、Android JS 服务生命周期 2 项通过。
- workspace 构建、全库 typecheck、lint 和 format 通过。
- 源码比对：HTTP upstream 调度器、本地 HTTP proxy、打开入口及 Kotlin
  loopback proxy 与 v0.9.20 一致。控制器仅适配来源所有权和协商后的格式，
  没有调节流控参数。

第一次旧格式真实 daemon 检查超时。原因是普通客户端首次 RPC 也会创建
`hostLinks` 条目，不能用该条目判断连接类型。改为物理来源能力协商后，两种格式
均通过；失败日志保留为 `bootstrap-http-first-failure.log`。

日志和发布包交叉验证材料保存在该 Works issue storage，源码工作区之外。
本机检查不代表用户网络下的卡顿已由量化对照排除；此次通过恢复已调优实现控制
行为差异，安装后的实际体验由用户复核。Android APK、设备 Chrome 后台、
通知交互和配置的 Electron 44 安装版没有在本地复验。

## 发行

同一修复还关闭桌面构建的重复 `--publish never` 参数来源，构建包装器统一负责
禁用隐式发布，workflow 仅在发布步骤上传。对应 `RELEASE-01` issue
`item_4ef3c29e`；新版本使用独立 tag 和资产，保留 v0.13.1。
