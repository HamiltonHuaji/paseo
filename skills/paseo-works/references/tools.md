# Works tools

Use the installed MCP namespace's `list_cards`, `get_card`, `create_card`, `update_card`, `list_items`, `get_item`, `create_item`, and `update_item`. The current agent determines the project and automatic touch identity; do not supply projectId or impersonate another caller. V1 experiment tools are separate.

## Find and read

Start with a focused `list_cards` request, for example `{"query":"export","label":"topic","limit":10}`. Filters include goal, basedOn, sessionId, sessionRelation (`linked`, `touched`, `any`), archive (`active`, `archived`, `all`), and order (`desc` by default, or `asc`). Card session filters also find related Items. Lists return one page with complete id/title/body and nextCursor. Order is immutable `(createdAt,id)`; edits do not reshuffle pages. Keep filters and order when continuing a cursor, and stop when you have the relevant records.

`list_items` requires parentCardId. Never enumerate all Cards merely to collect every Item. `get_item` and `update_item` require only itemId. `get_card` can include one Item page with `includeItems` using the same Item filters, excluding parentCardId.

A get returns the identity, label, title, body and componentNames. Request details explicitly:

```json
{ "cardId": "card_1234abcd", "select": ["sessions", "touches", "viewers", "metrics", "storage"] }
```

For a clickable chat link, copy `viewerEntries.entries[].href` verbatim into `[title](href)`. This explicit `paseo://h/<host>/view/...` URI opens through the client’s Viewer transport. `path` and `apiPath` are HTTP resource paths for pages and data access; do not publish them as chat links or prepend a daemon hostname, localhost, or port. A bare `/view/...` can also name a real daemon file.

Other select values: timestamps, progress, result, config, viewerEntries. A missing selected component returns null. `viewers` distinguishes configured, resolved and inheritedFrom. `progress` includes configured and cached state; reading does not execute a command. `storage` creates missing directories and returns path/sharedPath. Writes use `returning` with the same selectors. Do not copy read-only timestamps, touches or cached observations back into updates.

## Create and update

Title and body are required, including for an initial Item. Create a Card with preset experiment/topic and an Item with preset attempt/issue. Presets set labels; they do not force components or extra fields. A create receipt includes storage and viewerEntries. Card creation can include Items in one call:

```json
{
  "preset": "topic",
  "title": "Export module",
  "body": "Maintain CSV export and its verification results.",
  "sessions": { "agentIds": ["actual-session-id"] },
  "items": [
    {
      "preset": "issue",
      "title": "Preserve Unicode",
      "body": "Fix exported text and validate the resulting CSV.",
      "result": { "completed": false }
    }
  ]
}
```

Omit Sessions when no standing association is useful. `linkCaller` defaults true and records an automatic touch, independently of Sessions. False skips that operation's touch. Item activity propagates to its Card.

Card fields goal, basedOn and viewerSource accept a value or null. An Item always belongs to one Card. Label may be explicitly changed without changing identity or storage. `archived:true/false` hides/restores the object; completion and session termination do not archive it.

Update only intended fields. At least one mutable field is required. Omitted fields stay unchanged; null removes a component. Patch rules:

- Sessions: `{"add":["id"],"remove":["id"]}`; remove first, then add.
- Viewers: patch individual mounts/sources/entries keys; a null key deletes that key.
- Result: patch text and completed independently. Attaching it fills missing startedAt, completion fills missing endedAt, reopening clears endedAt. Explicit startedAt/endedAt win; use them for known historical execution times.
- Progress, Metrics and Config: replace the complete component value. Read the existing component before editing only part of it.

For example, finish an Issue without losing its other components:

```json
{
  "itemId": "item_1234abcd",
  "result": { "text": "Implemented and verified Unicode export.", "completed": true },
  "returning": ["result", "timestamps"]
}
```

Database writes commit before directory creation. If the receipt says committed and includes storageError, retain the returned ID; fix the filesystem issue and get its storage again. Do not create a duplicate record.

## Viewers and local metrics

Choose user-facing entries using the skill's [delivery guidance](../SKILL.md#deliver-an-accessible-result). The three Viewers maps are independent:

| Field     | Purpose                                                                                      |
| --------- | -------------------------------------------------------------------------------------------- |
| `mounts`  | URL prefixes for directory trees, including supporting files a page fetches or links.        |
| `sources` | Structured data providers consumed by Metrics, Progress, or a frontend.                      |
| `entries` | Names and paths shown in the user's Viewer list. Optional even when mounts or sources exist. |

Mount an entire directory once. Paths are project-relative or absolute strings; available substitutions are `${project.root}`, `${project.blobDir}`, `${storage.path}`, `${storage.sharedPath}`, `${card.id}`, `${card.blobDir}`, `${item.id}`, `${item.blobDir}`, and scalar `${config.KEY}`. Item variables exist only for Items. A viewer entry is a relative path in the mount namespace. The longest matching mount prefix wins.

```json
{
  "itemId": "item_1234abcd",
  "viewers": {
    "mounts": { "report": "${storage.path}/report" },
    "entries": { "Report": "report/index.html" }
  },
  "returning": ["viewerEntries"]
}
```

Here the report can fetch `report/scores.json` and link supporting logs or configs under that mount without giving those files their own entries. Updating the report or adding supporting files does not require another entry. A diagnostic check with only raw outputs can instead record its outcome and paths in Result/Config, with no Viewers configuration.

When consolidating an existing direct configuration, remove obsolete entry keys with null, e.g. `{"viewers":{"entries":{"Old check":null}}}`. Omitted keys and `entries:{}` leave existing entries unchanged. Keep mounts/sources still used by pages or metrics; removing an entry does not delete its files.

No own Viewers means inherit: Item from Card; Card from viewerSource, otherwise basedOn, recursively. An own empty object disables inheritance; viewers:null restores inheritance. Inherited variables resolve in the target object's context. SourceRef always resolves in its named object's context.

A W&B source belongs to Viewers, independently of its consumers. This example needs neither an HTML page nor a Viewer entry:

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
        "title": "Training loss",
        "source": { "objectId": "self", "source": "training" },
        "display": "line",
        "series": [{ "key": ["train/loss"] }]
      }
    ]
  },
  "returning": ["viewerEntries"]
}
```

Mount the actual local run files/directories and any content/cache needed by artifacts. No Python or W&B sync service is needed. Multiple different runs in a mount require runId, chosen from the source's meta endpoint. Attempts for a run and its resume reference the same source, e.g. `{"objectId":"card_1234abcd","source":"training"}`. Creation also accepts self and parent placeholders, resolved to real IDs in the receipt. Removing Metrics does not remove the source.

Metrics panels select line/value, series (key path arrays and optional labels), x (step, time, or metric plus key), range `{from,to}` (exclusive to), scale linear/log, and statistic last/min/max/mean. `['train/loss']` differs from `['train','loss']`. Metrics can be attached directly to a Card for Canvas viewing; Progress is optional. Cloud W&B access is not implemented.

viewerEntries supplies the source apiPath. On the viewer host origin, use GET `apiPath/meta`, `apiPath/query?q=<URL-encoded JSON>`, and `apiPath/artifacts`. Example query: `{"series":[["train/loss"]],"mode":"series"}`. Modes summary/latest avoid returning a curve. Artifact responses provide local content hrefs and unavailable reasons. A static HTML frontend mounted beside the source can use these APIs without the Paseo client. Use returned paths with the host's accessible origin or client forwarding; do not invent a public URL.

## Progress and CLI

A Progress component needs a plan, source, or both. Sources:

- Log: `{"type":"log","path":"${storage.path}/train.log","progressRegex":"step=(?<current>\\d+)/(?<total>\\d+)","endRegex":"Training finished"}`. End evidence is separate from reaching total.
- Command: `{"type":"command","argv":["node","scripts/progress.mjs"],"parse":{"type":"json"}}`. Default cwd is project root; optional cwd and timeoutMs. Stdout is `{current,total?,ended,phase?,message?}`. Regex parsing is also available and must capture ended.
- Viewer source: `{"type":"viewer-source","source":{"objectId":"card_1234abcd","source":"training"},"current":{"kind":"step"},"total":10000}`. Current can instead be `{kind:"metric",key:["epoch"]}`, total can reference `{key:["total_steps"]}`. Shared run completion does not complete every consumer or fill each Attempt's execution times.

Plan uses `{sourceUnit,units:[{unit,total,...}]}` with v1 schedule/curriculum units and tracks. Read the tool schema for unit transforms and segments before configuring a plan. Visible clients refresh configured sources; they stop when hidden or disconnected. This is not background job supervision.

CLI uses the same service: `paseo work card ls/show/create/update`, `item ls/show/create/update`, `storage <id>` (or --shared), `progress <id>`, `viewer ls <id>`, `viewer configure <id> --file <json>`. Supply --project and the normal --host if needed. Mutations accept --input @file, --title and --body-file. Use --json for complete structured results. CLI list defaults to all filtered Cards or one Card's Items; --limit/--cursor request a single page. It reads PASEO_AGENT_ID for automatic participation. Ordinary Git manages worktrees under returned storage; there are no worktree allocation or cleanup APIs.
