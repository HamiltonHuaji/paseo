# Experiments

Status: initial v1 implementation. Goal catalog management, doctor/repair, and post-turn reporting
forks remain follow-up work.

Experiments give a project durable coordination state for work that spans agent sessions, attempts,
and long-running external processes. The model is domain-neutral. The first stored fields support
machine-learning experiments directly because that is the first target workflow.

## Product boundary

Use three concepts:

- **Goal** groups experiments in the client. It is an Experiment property, not a parent work item.
- **Experiment** records an intent: what to change, why, and what was learned.
- **Attempt** records an action taken for an Experiment: a probe, implementation, launch,
  evaluation, deployment, or other concrete execution.

Containment and lineage stay separate:

```text
Goal <- Experiment -> Attempt
          |
          +-- based on --> Experiment
```

An Experiment may have several Attempts at once. An agent may be changing evaluation code while a
probe waits for a cluster and a formal run continues. Do not represent development, debugging,
running, and evaluation as one Experiment status enum.

Codex plans remain inside their agent sessions. Project state keeps only information that remains
useful across sessions and days.

## Project-local storage

Store all durable feature state under the canonical Project root:

```text
<project-root>/.paseo/v1/
├── state.db
└── blobs/
    ├── shared/
    └── experiments/
        └── <experiment-directory>/
            └── attempts/
                └── <attempt-directory>/
```

`v1` identifies this storage design. It is not a payload or database schema version. A future
incompatible design uses `.paseo/v2/`; records do not carry `schemaVersion` fields for this purpose.

Resolve the path from `Project.root`, never from an agent's current `cwd`. Every Workspace attached
to a Project reads the same store even when the Workspace is a different worktree.

`state.db` is the authoritative metadata store. `blobs/` is ordinary project-owned file space for
scripts, reports, generated visualizations, viewer assets, and any other files an Experiment or
Attempt needs. The layout assigns no special directory to viewer files.

The supported CLI, RPC, and agent tools do not describe the SQLite tables. The skill does not tell
agents to open `state.db` and adds no rule forbidding inspection.

## Database records

Enable SQLite foreign keys. The database belongs to one Project, so rows do not repeat `projectId`.

### Goals

```text
goals
  id                 UUID, internal only
  name               text, unique among active Goals
  description        nullable text
  archived_at        nullable timestamp
  created_at         timestamp
  updated_at         timestamp
```

Goal UUIDs never appear in UI copy, CLI arguments, agent tool inputs, agent tool results, or client
routes. Interfaces address Goals by name. The daemon resolves the name to the internal UUID.

Renaming a Goal updates one row. Experiments keep their stable foreign keys while the client groups
them under the new name.

### Experiments

```text
experiments
  id                           short stable handle, `exp_<suffix>`
  goal_id                      nullable foreign key to goals
  short_description            text
  description                  text; motivation, intended change, and purpose
  based_on_experiment_id       nullable foreign key to experiments
  viewer_source_experiment_id  nullable foreign key to experiments
  viewer_config_json           nullable ViewerConfig
  conclusion                   nullable text
  blob_relpath                 text relative to `.paseo/v1/`
  closed_at                    nullable timestamp
  archived_at                  nullable timestamp
  created_at                   timestamp
  updated_at                   timestamp
```

`based_on_experiment_id` forms the experiment lineage. It does not determine Goal grouping and may
cross Goals.

`closed_at` means the Experiment no longer needs work. A negative or inconclusive result can still
close an Experiment. `archived_at` only removes it from normal views.

### Attempts

```text
attempts
  id                    short stable handle, `att_<suffix>`
  experiment_id         foreign key to experiments
  short_description     text
  purpose               text
  result_summary        nullable text
  wandb_id              nullable text
  job_id                nullable text
  output_dir            nullable text
  progress_plan_json    nullable ProgressPlan
  progress_source_json  nullable ProgressSource
  viewer_config_json    nullable ViewerConfig
  blob_relpath          text relative to `.paseo/v1/`
  started_at            nullable timestamp
  ended_at              nullable timestamp
  created_at            timestamp
  updated_at            timestamp
```

The first design stores `wandb_id`, `job_id`, and `output_dir` directly. Do not wrap them in a
generic Resource, Reference, Artifact, or adapter layer. Non-ML work leaves them null.

One Attempt represents one concrete submission or execution. A retry creates another Attempt rather
than replacing the previous `job_id`.

Do not ask agents to maintain `pending`, `active`, or `finished` state. Short Attempts are useful as
an ordered record even when they have no result summary. Setting `result_summary` records a result
and causes the daemon to set `ended_at` when it is still null. Creating a later Attempt does not end
an earlier one because Attempts may run concurrently.

The daemon owns `id`, `blob_relpath`, and every timestamp. Agent, CLI, and client inputs never set
them. The daemon sets `started_at` after the first successful progress observation and `ended_at`
after an observation reports completion or a result summary is recorded.

### Create and update semantics

Treat create as an update applied to a daemon-defined initial record. Nullable mutable fields start
as null. Omitted create fields retain that initial value; `goal: null` has no special behavior and
need not be sent when an Experiment starts ungrouped.

For every update input:

- an omitted field is unchanged;
- a field set to null is cleared;
- required text fields such as `shortDescription`, `description`, and `purpose` cannot be null;
- daemon-owned fields cannot appear.

Experiment nullable initial fields are `goal`, `basedOn`, `viewerSource`, and `conclusion`. Attempt
nullable initial fields are `resultSummary`, `wandbId`, `jobId`, `outputDir`, `progressPlan`, and
`progressSource`. Viewer configuration is changed through its focused tool.

Setting a non-null Experiment conclusion causes the daemon to set `closed_at`. Clearing the
conclusion reopens it and clears `closed_at`. Agent inputs never set `closedAt` directly.

## Long-run progress

Only long-running Attempts need near-real-time progress. An agent configures the progress plan and
source once; it does not poll logs, W&B, a scheduler, or another service on the client's behalf.
The daemon understands a small progress observation contract and no vendor API.

```ts
interface ProgressPlan {
  unit: string;
  total: number;
  segments?: Array<{
    label: string;
    start: number;
    end: number;
  }>;
}
```

Segments use the same unit as the plan, may not overlap, and stay within `0..total`. They describe a
training schedule such as changes in data source or sequence length. The client derives the current
segment from the observed position.

Progress comes from either a log or a command:

```ts
type ProgressSource =
  | {
      type: "log";
      path: string;
      progressRegex: string;
      endRegex?: string;
    }
  | {
      type: "command";
      command: string[];
      cwd?: string;
      timeoutMs?: number;
      parse: { type: "json" } | { type: "regex"; regex: string };
    };
```

Use an argv array for commands. Shell behavior is explicit, for example
`["bash", "-lc", "..."]`. Configured commands are trusted project automation. The daemon executes
one only for an explicit progress-refresh RPC, never while discovering a Project, listing records,
or resolving a viewer.

Progress sources support these variables:

```text
${project.root}
${project.blobDir}
${experiment.id}
${experiment.blobDir}
${attempt.id}
${attempt.blobDir}
${attempt.outputDir}
${attempt.wandbId}
${attempt.jobId}
```

Missing variable values make the refresh unavailable with a clear reason. Do not replace them with
empty strings.

### Log parsing

The daemon tracks a byte cursor and an incomplete-line buffer for each configured log source. Apply
the regexes only to newly completed lines. The last progress match wins. Detect truncation or
rotation and reset the cursor. On the first refresh after daemon startup, read a bounded tail instead
of scanning an unbounded historical log.

`progressRegex` uses these optional named capture groups:

```text
current   numeric position
total     numeric total that overrides ProgressPlan.total for this observation
phase     short current-phase label
message   short detail
```

At least `current` must be captured. Matching `endRegex` sets `ended` to true. V1 does not infer
success versus failure from arbitrary logs; record that distinction in `resultSummary` when useful.

### Command parsing

A JSON command prints one object to stdout:

```json
{
  "current": 184200,
  "total": 500000,
  "ended": false,
  "phase": "Mixed-context data",
  "message": "Training normally"
}
```

`current` and `ended` are required. `total`, `phase`, and `message` are optional. A regex command
parser applies its regex to stdout and recognizes named groups `current`, `total`, `ended`, `phase`,
and `message`. It must capture `current` and `ended`; the other groups are optional. `ended` accepts
`true`, `false`, `1`, or `0`. Bound command duration and captured stdout and stderr.

### Cached observation and refresh

Persist the latest valid observation and log cursor as daemon-owned state in `state.db`. A refresh
failure preserves the last valid observation and records the error separately. Every observation
has a daemon-generated `refreshedAt` so the client can show staleness.

The client explicitly calls:

```json
{
  "attempt": "att_ab12cd"
}
```

through `experiment.attempt.progress.refresh.request`. While an Attempt is visible, the client uses
the returned `nextRefreshAfterMs` to schedule another request. The daemon coalesces concurrent
refreshes, but every new request after the current refresh completes reads the log or runs the
command again.

When an observation has `ended: true`, return `nextRefreshAfterMs: null`; the client stops automatic
requests. The manual refresh action sends the same request even after completion. If the new
observation is not ended, automatic refresh may resume. The daemon does not persist a separate
auto-refresh or terminal latch; the client decides from the latest observation.

`get_experiment` returns cached progress observations with its Attempts but never executes a source.
No client means no progress polling.

## Blob directory allocation

Use readable, time-sortable directory names with the stable short handle as a suffix.

Experiment directory:

```text
YYYYMMDD-HHmmssZ-<slug>-<experiment-id>
```

Attempt directory, nested under its Experiment:

```text
DDDDd-HHhMMmSSs-<slug>-<attempt-id>
```

The Attempt timestamp is elapsed time since the Experiment was created. Fixed-width fields preserve
lexicographic order.

Example:

```text
.paseo/v1/blobs/experiments/
└── 20260827-143205Z-test-lr-1e-3-with-sparse-router-exp_ab12cd/
    ├── compare.py
    ├── report.html
    └── attempts/
        ├── 0000d-00h07m31s-probe-eval-pipeline-att_91ef20/
        ├── 0000d-02h16m08s-find-maximum-batch-size-att_20dc41/
        └── 0002d-11h03m52s-formal-training-att_7a31bb/
```

`blobs/shared/` holds temporary scripts or materials reused by unrelated Experiments. Files intended
for source control remain in the Project tree and may be referenced from there.

Persist `blob_relpath` when the record is created. Editing `short_description` never renames an
existing directory. Stable paths keep scripts, external links, and viewer mounts valid.

### Slug generation

The daemon generates slugs. Clients and agents provide only `short_description`.

1. Normalize with Unicode NFKC.
2. Lowercase.
3. Keep Unicode letters and numbers, including CJK characters.
4. Keep an ASCII hyphen between letters or numbers.
5. Replace every other run of whitespace, punctuation, separators, and symbols with one hyphen.
6. Collapse repeated hyphens and trim them from both ends.
7. Truncate at a Unicode character boundary to at most 96 UTF-8 bytes.
8. Use `experiment` or `attempt` when the result is empty.

Examples:

```text
Try LR=1e-3 with Sparse Router!
-> try-lr-1e-3-with-sparse-router

测试：lr=1e-3 是否稳定？
-> 测试-lr-1e-3-是否稳定

Probe eval/code path — batch size 32
-> probe-eval-code-path-batch-size-32
```

Generate the short handle at creation and check it for uniqueness. Store it as the record ID; do not
derive it later by truncating a UUID.

### Filesystem consistency

V1 does not define an atomic transaction spanning SQLite and directory creation. If a database row
exists without its directory, create the directory when a storage path is next requested.

Provide `paseo experiment doctor` to report:

- missing Experiment or Attempt blob directories;
- Attempt directories outside their recorded Experiment directory;
- orphan directories whose short handles have no database record;
- configured viewer mounts or entries whose source files are unavailable;
- unavailable external `output_dir` paths.

`doctor --repair` may create missing directories. It does not delete orphan directories.

## Static viewers

A viewer is a named entry in an Experiment or Attempt static-file namespace. Viewer files remain
ordinary files. The daemon serves them directly and starts no helper process.

```ts
interface ViewerConfig {
  mounts: Record<string, string>;
  entries: Record<string, string>;
}
```

`mounts` maps a relative URL path to a filesystem directory. `entries` maps a display name to a path
inside the same namespace.

Example:

```json
{
  "mounts": {
    "report": "${attempt.outputDir}/viewer",
    "assets": "${project.root}/scripts/viewer-assets",
    "data": "${attempt.outputDir}/eval",
    "shared": "${project.blobDir}/shared"
  },
  "entries": {
    "results": "report/index.html",
    "metrics": "report/metrics.html"
  }
}
```

Support these path variables:

```text
${project.root}
${project.blobDir}
${experiment.blobDir}
${attempt.blobDir}
${attempt.outputDir}
```

Resolving a variable that has no value fails with a clear unavailable reason. Do not silently choose
another directory.

### URL namespace

Use the Project ID followed by Experiment and Attempt short handles as collision-free URL prefixes
on the daemon listener:

```text
/view/<project-id>/exp_ab12cd/
/view/<project-id>/exp_ab12cd/att_91ef20/
```

Every mount is relative to its scope prefix:

```text
/view/<project-id>/exp_ab12cd/att_91ef20/report/
/view/<project-id>/exp_ab12cd/att_91ef20/assets/
/view/<project-id>/exp_ab12cd/att_91ef20/data/
```

This lets one daemon serve many Experiments and Attempts on one port. It requires no per-viewer port
forwarding.

Multiple explicit mounts avoid exposing the filesystem paths between sibling directories. Given an
entry at `report/pages/index.html`, this reference:

```html
<script src="../../assets/viewer.js"></script>
```

resolves to:

```text
/view/<project-id>/exp_ab12cd/att_91ef20/assets/viewer.js
```

Match nested mounts by longest URL prefix. Reject mount names and entry paths that are absolute or
escape their scope through `..`. Requests that do not match a configured mount return 404.

Treat symlinks as ordinary filesystem paths. There is no `followSymlinks` option, symlink manifest,
or separate allowlist. Viewer configuration is trusted project configuration.

The static handler supports `GET`, `HEAD`, MIME types, directory `index.html`, byte ranges,
`ETag`, and `Last-Modified`. The daemon hosts one loopback-only viewer HTTP service and registers it
as the internal `viewers` service. All viewers share that internal port and keep their Experiment and
Attempt path prefixes. Do not start a process or allocate a port per viewer.

A direct client opens the path on the daemon HTTP origin. A relay-connected desktop client opens a
loopback listener on an operating-system-assigned port and forwards its TCP traffic through the
existing encrypted relay connection to the internal viewer service. The system browser uses an
ordinary `http://127.0.0.1:<port>/view/...` URL. One listener is reused for the Host and viewer
target; each browser connection gets its own tunnel stream.

### Viewer inheritance

Resolve Experiment viewer configuration in this order:

1. Use `viewer_config_json` when it is non-null. An empty config disables inheritance.
2. Otherwise, follow `viewer_source_experiment_id` when set.
3. Otherwise, follow `based_on_experiment_id` when set.
4. Otherwise, return no entries.

Resolve Attempt viewer configuration in this order:

1. Use the Attempt's `viewer_config_json` when it is non-null.
2. Otherwise, use the resolved Experiment configuration in the Attempt's path context.

Inheritance is a live reference. Do not copy the JSON into the derived Experiment. Expand path
variables against the target Experiment and Attempt so similar output layouts work without edits.
Absolute source paths continue to reference the original path and can deliberately share files.

Detect cycles across `viewer_source_experiment_id` and `based_on_experiment_id` and report the chain.

## Agent association

Do not persist agent engagement in `state.db`. An agent declares involvement by mutating an
Experiment or Attempt through its agent-scoped tools.

After `create_experiment`, `update_experiment`, `create_attempt`, or `update_attempt`, update the
calling Agent's state:

```ts
interface AgentExperimentTouch {
  experiment: string;
  attempt: string | null;
  lastTouchedAt: string;
}
```

Keep one latest touch per Experiment on each Agent. Touches remain after the turn, Attempt, or
Experiment finishes. They let the user find the last Agent session that worked on an old Experiment
and resume it.

The client derives:

- **current work** from each live Agent's most recent touch and current Agent status;
- **previously involved agents** from all touches for the Experiment, sorted by `lastTouchedAt`.

Read-only tools, CLI mutations, client mutations, scheduler polling, and external status observation
do not create an Agent touch.

A post-turn reporting fork carries an internal `reportsForAgentId`. Its mutations touch the source
Agent rather than the short-lived reporting Agent. Ordinary agent tools cannot set this value.

## Client

The default view groups Experiments by Goal name and includes an Ungrouped section. Goal grouping,
lineage, and Attempt containment are separate projections.

An Experiment row shows:

- short description and Goal;
- latest meaningful update time;
- live Agents whose latest touch points to the Experiment;
- previously involved Agents, with the most recent first;
- Attempt count and cached progress for visible long-running Attempts;
- available viewer entries;
- whether a conclusion exists.

The Experiment detail shows its description, lineage, conclusion, Attempts, Agent sessions, and
resolved viewer entries. Attempt detail shows direct W&B, job, output directory, result, blob
directory, viewer entries, progress plan, latest observation, refresh error, and staleness.

The client requests progress only for visible Attempts that have a source. It stops automatic
requests after an ended observation and keeps a manual refresh action that sends the same request.

Do not build a board whose columns are development, debugging, running, and finished. Those facts may
coexist and come from Agent state, Attempts, and external observations.

## CLI

Use one top-level command group:

```text
paseo experiment
```

Goal is an Experiment property, so Goal catalog commands remain below it:

```bash
paseo experiment init
paseo experiment status
paseo experiment doctor [--repair]

paseo experiment goal ls
paseo experiment goal add <name>
paseo experiment goal rename <old-name> <new-name>
paseo experiment goal archive <name>

paseo experiment ls [--goal <name>]
paseo experiment show <experiment>
paseo experiment create [--goal <name>] [--based-on <experiment>] --summary <text> --description <text>
paseo experiment update <experiment> ...
paseo experiment close <experiment> --conclusion <text>
paseo experiment archive <experiment>

paseo experiment attempt ls <experiment>
paseo experiment attempt add <experiment> --summary <text> --purpose <text>
paseo experiment attempt update <attempt> ...
paseo experiment attempt finish <attempt> --result <text>
paseo experiment attempt progress <attempt>

paseo experiment storage shared
paseo experiment storage <experiment>
paseo experiment storage <experiment> --attempt <attempt>

paseo experiment viewer configure <experiment> [--attempt <attempt>] --file <json>
paseo experiment viewer inherit <experiment> --from <source-experiment>
paseo experiment viewer ls <experiment> [--attempt <attempt>]
paseo experiment viewer open <experiment> <entry> [--attempt <attempt>]
```

Support the normal Paseo `--json`, `--yaml`, and Host selection options. CLI and app operations call
the daemon API so local and remote behavior share one implementation.

Creation responses include the assigned short handle and blob path. Agents and clients never
construct blob directory names themselves.

`--based-on` writes `based_on_experiment_id` through the normal create operation. Do not add a
separate derive operation to the CLI, daemon API, or agent tool catalog.

## Daemon API

Put storage and policy behind one Experiment domain service. The app, CLI, and agent tool catalog
call the same operations.

New WebSocket RPCs use dotted request/response pairs:

```text
experiment.list.request                     / experiment.list.response
experiment.get.request                      / experiment.get.response
experiment.create.request                   / experiment.create.response
experiment.update.request                   / experiment.update.response
experiment.goal.list.request                / experiment.goal.list.response
experiment.goal.update.request              / experiment.goal.update.response
experiment.attempt.create.request           / experiment.attempt.create.response
experiment.attempt.update.request           / experiment.attempt.update.response
experiment.attempt.progress.refresh.request / experiment.attempt.progress.refresh.response
experiment.storage.resolve.request          / experiment.storage.resolve.response
experiment.viewer.configure.request         / experiment.viewer.configure.response
experiment.viewer.resolve.request           / experiment.viewer.resolve.response
```

Gate the feature once on `server_info.features.experiments`. Do not simulate it through older RPCs.
New wire fields remain optional so older apps continue to parse new daemon messages.

## Agent tools and skill

Add focused operations to Paseo's transport-neutral agent tool catalog:

```text
list_experiments
get_experiment
create_experiment
update_experiment
create_attempt
update_attempt
get_experiment_storage
configure_experiment_viewers
resolve_experiment_viewers
```

The agent-scoped catalog resolves `callerAgentId -> Workspace -> Project` and therefore needs no
Project ID or Project root input. Goal inputs and outputs use names. Mutation tools apply Agent
touches after successful updates.

Tool inputs use record handles under the concise names `experiment`, `attempt`, `basedOn`, and
`viewerSource`. They do not expose database column names or append `Id` to these fields.

### Agent tool inputs

`list_experiments` accepts:

```ts
{
  goal?: string;
  includeClosed?: boolean;   // default false
  includeArchived?: boolean; // default false
}
```

`get_experiment` accepts `{ experiment: string }` and returns the Experiment together with all of
its Attempts. It does not return involved Agents; the client derives those from Agent touches.

`create_experiment` accepts:

```ts
{
  shortDescription: string;
  description: string;
  goal?: string | null;
  basedOn?: string | null;
  viewerSource?: string | null;
  conclusion?: string | null;
}
```

`update_experiment` accepts the same mutable fields plus required `experiment: string`. Every
mutable field is optional. It does not accept `closedAt`, `archivedAt`, or timestamps.

`create_attempt` accepts:

```ts
{
  experiment: string;
  shortDescription: string;
  purpose: string;
  resultSummary?: string | null;
  wandbId?: string | null;
  jobId?: string | null;
  outputDir?: string | null;
  progressPlan?: ProgressPlan | null;
  progressSource?: ProgressSource | null;
}
```

`update_attempt` accepts the same mutable fields except `experiment`, plus required
`attempt: string`. Every mutable field is optional. It does not accept state or timestamps.

`get_experiment_storage` uses an explicit scope and accepts exactly one of:

```json
{ "scope": "shared" }
{ "scope": "experiment", "experiment": "exp_ab12cd" }
{ "scope": "attempt", "attempt": "att_91ef20" }
```

`configure_experiment_viewers` accepts exactly one target:

```ts
{
  experiment: string;
  viewer: ViewerConfig | null;
}
{
  attempt: string;
  viewer: ViewerConfig | null;
}
```

`viewer: null` removes the local configuration and restores inheritance. A non-null ViewerConfig
with empty `mounts` and `entries` explicitly disables viewers at that target.

`resolve_experiment_viewers` also accepts exactly one target:

```json
{ "experiment": "exp_ab12cd" }
{ "attempt": "att_91ef20" }
```

The progress-refresh RPC is deliberately absent from the agent tool catalog. Agents configure
`progressPlan` and `progressSource`; clients request observations from the daemon.

Ship a `track-experiments` orchestration skill. It teaches agents to:

- find or create an Experiment before sustained experimental work;
- create an Attempt for each concrete probe, run, retry, evaluation, or deployment;
- fill W&B, job, and output directory fields as they become known;
- configure a plan and log or command source once for long-running work;
- never poll progress merely to keep the project record current;
- request blob paths instead of constructing them;
- configure static viewer mounts and entries after generating results;
- close an Experiment only after recording its conclusion;
- keep detailed coding progress in the agent's own plan.

The skill describes tools and workflow. It does not describe SQLite or the `.paseo/v1/state.db`
tables.

Post-turn reporting may fork the completed Agent context, invoke the skill with a fixed update form,
submit the mutations on behalf of the source Agent, and archive the reporting fork. A fork used for
actual work records its own Agent touches.

## Non-goals

V1 does not include:

- file locks or edit reservations;
- a dynamic schema registry or per-record schema migrations;
- generic Resource, Reference, Artifact, Evidence, or Execution entities;
- process-backed viewers or viewer process lifecycle management;
- special viewer file directories;
- persistent project-owned Agent engagement records;
- detailed copies of provider plans;
- an exhaustive Experiment phase enum;
- agent-maintained Attempt lifecycle state;
- W&B, scheduler, or training-framework logic in the core daemon;
- daemon progress polling when no client requests it;
- atomic publication of multi-file output bundles;
- automatic deletion of output directories, blob directories, or failed-run evidence;
- direct synchronization of `.paseo/v1/` between daemon hosts.

## Implementation order

1. Add the Project-root locator, SQLite store, blob allocation, and CLI CRUD.
2. Add protocol capability gating, daemon RPCs, and app/client SDK methods.
3. Add agent tools, Agent touches, and the orchestration skill.
4. Add Goal-grouped Experiment and Attempt client views.
5. Add on-demand log and command progress refresh with cached observations.
6. Add static mount resolution, viewer inheritance, and embedded viewer navigation.
7. Add post-turn reporting forks after manual updates prove the form and tool boundaries.
