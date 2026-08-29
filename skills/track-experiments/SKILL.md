---
name: track-experiments
description: Track durable project work and its concrete operations with Paseo experiments and attempts.
---

# Track experiments

## Find the Paseo tools

This workflow uses the Paseo MCP server. Codex may defer MCP tools instead of listing every tool
in the initial context. When an expected tool is not visible, search the available tools for
`paseo` or `experiment` before concluding that it is unavailable. In Codex, the resolved names are
usually prefixed with `mcp__paseo__`, such as `mcp__paseo__list_experiments`.

If tool search cannot find the Paseo experiment tools, ask the user to enable **Paseo tools** on
the host and reload the agent. Do not replace missing Experiment tools by editing `.paseo/v1/state.db`
directly.

The latest copy of this skill is
[`skills/track-experiments`](https://github.com/HamiltonHuaji/paseo/tree/overlay/skills/track-experiments)
in the Paseo fork. To try it before the next daemon release, copy that directory to
`~/.agents/skills/track-experiments`, `~/.codex/skills/track-experiments`, or
`~/.claude/skills/track-experiments`, according to the current agent's skill root.

## Choose an experiment or attempt

An experiment is a durable, user-visible unit of work with a stable subject, intended outcome, and completion criterion. It may be a model setting, software build, benchmark configuration, data-processing job, artifact, or any other independently meaningful work. A broader goal may group several experiments; each experiment must be able to reach its own conclusion or produce its own result.

An attempt is an append-only record of one concrete operation toward an experiment. It need not execute the whole experiment or be a formal run. Attempts include short probes, capacity checks, debug reproductions, builds, training runs, evaluations, retries, resumes, visualizations, and artifact-generation steps.

Create a new experiment when the identity of the intended result changes: its target configuration, artifact, implementation variant, input protocol, or completion criterion is independently meaningful. Create another attempt when performing another operation toward the same intended result, including a temporary diagnostic operation that answers a small operational question. Make a diagnostic action a separate experiment only when its result should stand on its own.

## Start or resume work

1. Call `list_experiments` before creating anything and read candidates from its `experiments` array. Reuse an existing experiment when its subject, intended result, and completion criterion match the work.
2. Call `get_experiment` to inspect its attempts before acting.
3. Call `list_agents` and inspect `experimentTouches` when another agent may already own or have context for the work.
4. Call `create_experiment` only for a new independently meaningful result. Pass `basedOn` when it branches from an existing experiment. Pass the human goal name when the work belongs to a longer-running goal; omit it when ungrouped.
5. Call `create_attempt` when beginning a concrete action. Do not create attempts for every conversational turn or short code-edit step.

Create a new attempt for every retry, resumed run, or materially different probe. Do not replace the identifiers or progress configuration of an earlier run. Clients present attempts as a time-ordered record and initially expand the newest one.

Do not synthesize IDs or storage paths. Use handles and paths returned by the tools.

## Keep records useful

- Put the short label in `shortDescription` and the motivation or question in `description`/`purpose`.
- Set `wandbId`, `jobId`, and `outputDir` directly when they exist.
- Attach `progressPlans` and `progressSource` to a long-running attempt as soon as its job and output locations are known so clients can refresh it without another agent turn. Set `progressPlans.sourceUnit` to the coordinate reported by the source; it may be any project-defined unit such as a step, sample, frame, or token. Add one entry to `progressPlans.units` for every axis users should be able to select for that attempt. Each entry owns its total and tracks. Put schedule dimensions that vary in parallel into separate `tracks`; segments may overlap across tracks but not within one track. For a non-source unit, add piecewise-linear `projection` ranges from `sourceUnit` only where the conversion is known; leave unknown ranges uncovered instead of guessing or scaling by the ratio between totals. Prefer a log source when the job already writes `sourceUnit`. Use a command source when progress requires a query. Paseo runs the command without a shell.
- Configure viewers with `configure_experiment_viewers`. Mount the narrow directories the viewer needs; one viewer may have several mounts. Use variables returned by the storage and attempt context rather than hard-coded generated paths.
- Call `get_experiment_storage` before writing coordination artifacts or generated visualizations under `.paseo/v1/blobs`.
- For machine-learning work, also use Experiment or Attempt storage for one-off configs and scripts. Use Attempt storage for one operation and Experiment storage for files shared by its attempts. Copy reusable templates into storage before editing them. Reserve project `configs/` and `scripts/` for reusable baseline configs and templates, per-module or per-dataset configs, common scripts, and files intended to ship with the project.

Omit fields that should remain unchanged. Pass `null` on update only to clear a nullable field. The daemon owns IDs and timestamps.

## Model debugging and continuation

Keep a failed or interrupted long run as its own attempt. For example, when a run develops NaNs:

1. Update the run attempt with a concise `resultSummary` if the failure is understood well enough to summarize.
2. Create a new attempt for the diagnostic reproduction, such as monitoring per-operator outputs around the failure.
3. Record the probe job, W&B run, output directory, progress source, and viewer if they exist.
4. After finding and fixing the cause, create another attempt for the resumed run and state in `purpose` that it loads the prior checkpoint.

The presence and sequence of attempts convey workflow state. Do not maintain `pending`, `running`, or `finished` status fields.

## Finish work

- Update an attempt with `resultSummary` when its action has a durable result.
- Update the experiment with `conclusion` when the intent has been answered.
- Keep failed probes and superseded attempts; they explain lineage and prevent repeated work.
- Before handing back to the user, ensure the latest meaningful action is represented by an attempt and the durable identifiers are recorded.
