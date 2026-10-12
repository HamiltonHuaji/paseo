# Works 工具参考

使用当前 MCP 命名空间下的 list_cards、get_card、create_card、update_card、list_items、get_item、create_item、update_item。项目和自动 touch 身份由调用会话确定，不填写 projectId，也不冒用其他会话。v1 experiment 工具属于另一套独立记录。

## 查找与读取

先缩小 Card 范围，例如 `{"query":"导出","label":"topic","limit":10}`。可按 goal、basedOn、sessionId、sessionRelation（linked／touched／any）、archive（active／archived／all）和 order（默认 desc，可改 asc）筛选。Card 的会话筛选也涵盖其 Item。

列表只返回一页，包含完整 ID、标题、正文和 nextCursor。顺序为 `(createdAt,id)`，修改不改变分页位置。续页保持相同筛选和排序；找到相关工作就停止，不自动读完所有页。

list_items 必须提供 parentCardId；不要遍历所有 Card 来收集全部 Item。get_item／update_item 只需 itemId。get_card 可通过 includeItems 附带一页 Item，参数与 Item 列表相同，但不重复 parentCardId。

get 默认返回身份、label、标题、正文和 componentNames。按需选择内容：

```json
{ "cardId": "card_1234abcd", "select": ["sessions", "touches", "viewers", "metrics", "storage"] }
```

其他 select 值为 timestamps、progress、result、config、viewerEntries。选中的组件不存在时返回 null；未选中的字段不返回。viewers 区分直接配置 configured、有效配置 resolved、继承来源 inheritedFrom。progress 包含配置与缓存观测，普通 get 不执行进度命令。

storage 返回 path 和 sharedPath，并补建缺失目录。写入的 returning 使用同样选择规则。不要把只读时间、touches 或缓存观测抄回更新请求。

## 创建与更新

Card 用 preset experiment／topic，Item 用 preset attempt／issue；标题和正文必填。预设只确定 label，不强制附加组件。创建回执包含 storage 和 viewerEntries，可一次创建 Card 与首批 Item：

```json
{
  "preset": "topic",
  "title": "导出模块",
  "body": "维护 CSV 导出及验证结果。",
  "items": [
    {
      "preset": "issue",
      "title": "保留中文",
      "body": "修复输出编码并验证导出文件。",
      "result": { "completed": false }
    }
  ]
}
```

需要长期关联时显式填写 `sessions:{agentIds:["真实会话ID"]}`。linkCaller 默认 true，记录本次执行者 touch，与 Sessions 无关；false 跳过本次自动参与记录。Item 活动会传递到父 Card。

Card 的 goal、basedOn、viewerSource 可以填值或 null；Item 始终属于一个 Card。label 可显式修改，不改变身份或 storage。archived:true／false 负责归档／恢复，不等于完成或结束会话。

至少更新一个可修改字段。省略的字段不变，组件值 null 表示移除：

- Sessions 用 `{add:["id"],remove:["id"]}`，先移除再加入。
- Viewers 按 mounts／sources／entries 的键修改，键值 null 删除该键。
- Result 的 text、completed 分别修改。附加时补缺失的 startedAt，完成时补缺失的 endedAt，重新打开时清空 endedAt。显式时间优先，用于登记过去的实际执行。
- Progress、Metrics、Config 整体替换；只想改部分内容时先读取已有组件。

```json
{
  "itemId": "item_1234abcd",
  "result": { "text": "已实现并验证中文导出。", "completed": true },
  "returning": ["result", "timestamps"]
}
```

先提交数据库，再建目录。回执包含 committed 和 storageError 时，保留返回 ID；处理文件系统问题后重新获取该对象的 storage，不要新建重复记录。

## Viewer 与本地指标

一次挂载整个目录。路径可以是项目相对路径或绝对路径，可使用 `${project.root}`、`${project.blobDir}`、`${storage.path}`、`${storage.sharedPath}`、`${card.id}`、`${card.blobDir}`、`${item.id}`、`${item.blobDir}` 和标量 `${config.KEY}`。Item 变量只在 Item 上存在。entry 指向挂载命名空间内的相对路径；嵌套挂载取最长匹配前缀。

```json
{
  "itemId": "item_1234abcd",
  "viewers": {
    "mounts": { "report": "${storage.path}/report" },
    "entries": { "报告": "report/index.html" }
  },
  "returning": ["viewerEntries"]
}
```

没有直接配置时，Item 从父 Card 继承；Card 从 viewerSource，否则 basedOn 递归继承。显式空对象禁用继承；viewers:null 恢复继承。继承配置中的变量按目标对象展开；SourceRef 始终按其中明确引用的对象展开。

W&B 来源属于 Viewers，独立于 Metrics／Progress 消费者：

```json
{
  "cardId": "card_1234abcd",
  "viewers": {
    "sources": {
      "training": {
        "type": "wandb-local",
        "paths": ["/data/runs/baseline", "/data/wandb-artifact-cache"]
      }
    }
  },
  "metrics": {
    "panels": [
      {
        "id": "loss",
        "title": "训练损失",
        "source": { "objectId": "self", "source": "training" },
        "display": "line",
        "series": [{ "key": ["train/loss"] }]
      }
    ]
  },
  "returning": ["viewerEntries"]
}
```

挂载实际运行记录及 artifacts 所需的文件／缓存目录，不需要 Python 或 W&B sync 服务。同一来源内有多个不同 run 时，通过 meta 查看候选并配置 runId。首次运行与续跑的两个 Attempt 引用同一 SourceRef，例如 `{objectId:"card_1234abcd",source:"training"}`。创建时还支持 self 和 parent 占位符，保存为真实 ID。删除 Metrics 不会删除来源。

Metrics panel 支持 line／value、series（key 路径段数组及可选 label）、x（step／time／metric 加 key）、range（from、to，to 为开区间）、scale（linear／log）、statistic（last／min／max／mean）。`["train/loss"]` 与 `["train","loss"]` 不同。直接在 Card 附加 Metrics 就能在 Canvas 看指标，无需 Progress。云端 W&B 读取尚未实现。

viewerEntries 返回 source 的 apiPath。使用 viewer host 的 origin 访问 GET `apiPath/meta`、`apiPath/query?q=<URL编码JSON>` 和 `apiPath/artifacts`。查询示例：`{"series":[["train/loss"]],"mode":"series"}`。summary／latest 不返回曲线。artifact 列表提供本地内容 href 和缺失原因。普通静态前端可以直接访问这些 API，无需 Paseo 客户端。使用已有可访问 origin 或客户端转发，不编造公网地址。

## Progress 与 CLI

Progress 至少有 plan 或 source。source 有三种：

- 日志：`{"type":"log","path":"${storage.path}/train.log","progressRegex":"step=(?<current>\\d+)/(?<total>\\d+)","endRegex":"Training finished"}`。达到 total 不自动等于结束。
- 命令：`{"type":"command","argv":["node","scripts/progress.mjs"],"parse":{"type":"json"}}`。默认 cwd 为项目根，可指定 cwd 和 timeoutMs。stdout 为 `{current,total?,ended,phase?,message?}`。也可用 regex parser，必须捕获 ended。
- Viewer 来源：`{"type":"viewer-source","source":{"objectId":"card_1234abcd","source":"training"},"current":{"kind":"step"},"total":10000}`。current 可改为 `{kind:"metric",key:["epoch"]}`，total 可引用 `{key:["total_steps"]}`。共享 run 结束不自动完成所有消费者，也不为每个 Attempt 填写执行时间。

plan 使用 `{sourceUnit,units:[{unit,total,...}]}`，沿用 v1 的 schedule／curriculum 单位、投影与轨道；配置前查看工具 schema 的 segments／tracks／projection 字段。客户端可见时刷新来源，隐藏或断线后停止；这不等于后台作业监督。

CLI 为 `paseo work card ls/show/create/update`、`item ls/show/create/update`、`storage <id>`（或 --shared）、`progress <id>`、`viewer ls <id>`、`viewer configure <id> --file <json>`。提供 --project，远端使用常规 --host。写入支持 --input @file、--title、--body-file；--json 输出完整结构。CLI 列表默认读完筛选后的 Card 或一个 Card 下的 Item，--limit／--cursor 指定只读一页。PASEO_AGENT_ID 提供自动参与身份。worktree 在返回的 storage 下使用普通 Git 管理，没有专用分配或清理 API。
