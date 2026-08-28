---
name: track-experiments
description: Record and coordinate project work as experiments and attempts using Paseo's experiment tools. Use when an agent develops, debugs, launches, monitors, compares, resumes, or concludes long-running work; when work has lineage from an earlier experiment; or when results, jobs, W&B runs, output directories, progress sources, and static viewers should remain visible to users and other agents.
---

# Track experiments

Use an experiment for an intent or hypothesis. Use attempts for concrete actions taken toward it: a probe, debug reproduction, training run, evaluation, resumed run, or visualization pass.

## Start or resume work

1. Call `list_experiments` before creating anything. Reuse an existing experiment when its intent matches the work.
2. Call `get_experiment` to inspect its attempts before acting.
3. Call `list_agents` and inspect `experimentTouches` when another agent may already own or have context for the work.
4. Call `create_experiment` only for a new intent. Pass `basedOn` when the intent branches from an existing experiment. Pass the human goal name when the work belongs to a longer-running goal; omit it when ungrouped.
5. Call `create_attempt` when beginning a concrete action. Do not create attempts for every conversational turn or short code-edit step.

Create a new attempt for every retry, resumed run, or materially different probe. Do not replace the identifiers or progress configuration of an earlier run. Clients present attempts as a time-ordered record and initially expand the newest one.

Do not synthesize IDs or storage paths. Use handles and paths returned by the tools.

## Keep records useful

- Put the short label in `shortDescription` and the motivation or question in `description`/`purpose`.
- Set `wandbId`, `jobId`, and `outputDir` directly when they exist.
- Attach `progressPlans` and `progressSource` to a long-running attempt as soon as its job and output locations are known so clients can refresh it without another agent turn. Set `progressPlans.sourceUnit` to the coordinate reported by the source; it may be any project-defined unit such as a step, sample, frame, or token. Add one entry to `progressPlans.units` for every axis users should be able to select for that attempt. Each entry owns its total and tracks. Put schedule dimensions that vary in parallel into separate `tracks`; segments may overlap across tracks but not within one track. For a non-source unit, add piecewise-linear `projection` ranges from `sourceUnit` only where the conversion is known; leave unknown ranges uncovered instead of guessing or scaling by the ratio between totals. Prefer a log source when the job already writes `sourceUnit`. Use a command source when progress requires a query. Paseo runs the command without a shell.
- Configure viewers with `configure_experiment_viewers`. Mount the narrow directories the viewer needs; one viewer may have several mounts. Use variables returned by the storage and attempt context rather than hard-coded generated paths.
- Call `get_experiment_storage` before writing coordination artifacts or generated visualizations under `.paseo/v1/blobs`.

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
