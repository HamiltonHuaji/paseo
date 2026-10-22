---
name: paseo-works
description: Record progress, link related sessions, and organize outputs in Paseo when developing or maintaining software, running training or evaluations, processing data, or producing reports, charts, pages, or creative assets. Also apply this skill when asked to organize collected, analyzed, or accumulated materials and results for the user to consult and use. Give outputs a clear home and make them findable from the work record, even for one-off delivery or a specified output path. Research or analysis solely to answer questions or offer advice does not trigger use; organizing the materials or results for the user does. Chat-based creation and routine file operations do not trigger use merely because they produce files. Apply it to find or continue earlier work; keep follow-up work under the same topic or experiment. Do not wait for the user to request tracking. Long runs and multiple sessions are not required.
---

# Paseo works

Keep work and its results accessible from Paseo. Record what you are doing, associate
useful sessions, save outputs with the work, and make results findable from its
record. Handle this as part of the requested work without making the user
maintain tickets or remember where you put files.

Use the Works MCP tools and [tool reference](references/tools.md). If this host
does not expose them, continue the requested work with available tools and report
the missing registration. Do not invent calls or saved records, edit the database,
or repurpose v1 fields. V1 and Works have separate records and entry points.

## Find the work before starting

Look up related records and results using the project and conversation context.
Read the relevant record before changing it. When asked to find an earlier result,
return its existing entry point and status rather than generating it again.

Keep follow-up work under the existing topic or experiment. An attempt records
one experimental execution: create a new attempt for a new run, retry, or resume,
even when it continues the same W&B run. Preserve the earlier execution's inputs,
code, timing, and results so it can be understood and compared independently.

An issue records the problem or change being delivered. Continue diagnosis,
implementation, and validation in that issue while its intended outcome remains
the same; a failed build or another edit does not require a new issue. Create a
separate item when a development variant or execution needs its own retained
result or comparison. Update the current request when the user refines it.

Choose the area or outcome the user will recognize in Canvas. Put a software fix
under its module or feature and a run under its experiment. Keep a library or
report and its updates together. In development, use an issue for the concrete
work, as you use an attempt for an experimental operation; do not add an extra
attempt layer beneath each issue. One development issue can include diagnosis,
implementation, tests, and integration.

Use Sessions to link conversations worth returning to for this work. Automatic
touches separately record which agents performed operations; they do not make
every participant a standing session link. Reuse a familiar session when
appropriate and authorized, but do not require a dedicated owner. Work can have
no linked session, one, or several. Session links do not authorize creating
agents, delegating, or interrupting another session.

## Choose storage and isolate code

Before generating materials, obtain the work's storage location. Respect existing
or user-specified destinations and register those locations with the work. Do not
scatter outputs into arbitrary directories or put one-off scripts and configs in
reusable source directories. Keep retained logs, reports, checkpoints, and pages
outside disposable code checkouts.

Use separate Git worktrees and branches for concurrent code changes. Sequential
edits and validation for the same execution can share a worktree. Reuse the current
execution's checkout or create one from a known base when execution starts; queued
work and read-only questions do not need one. Record the base and intended
integration target. Obtain the object's storage path from Paseo and use Git to
create worktrees beneath it. Paseo does not allocate or manage these worktrees.
Keep retained outputs outside the worktree subdirectories; do not guess storage
paths from the v1 layout.

Keep running training and validation on code that other work will not change. A
recorded commit does not protect a mutable directory. When trying alternatives,
isolate their changes and retain enough information to compare their results.

## Record execution and progress

Record the purpose, relevant inputs and configuration, code version, execution
identifier, and output locations. Link results to the code actually used. Update
progress and meaningful outcomes as work proceeds, including failures and abandoned
alternatives. Keep earlier executions distinguishable from retries and resumes.

Record enough to resume or understand the result, without copying the entire chat
or your detailed plan. Do not add probes, runs, or checks merely to populate records.

Use Config for extra JSON settings such as job IDs, output locations, W&B IDs,
and hyperparameters. Record known execution start and end times. Automatic
updatedAt tracks observed activity; repeatedly reading an unchanged source is
not evidence that the underlying job is still making progress.

For long-running work, configure supported progress observation so the user can
check it without asking another agent to investigate. Identify the running process
or job and record how its completion will be observed. Do not claim ongoing
monitoring unless it is configured.

## Deliver an accessible result

Keep retained materials and their locations findable from the owning work record,
including one-off deliveries and user-specified paths. A code fix or diagnostic
check can be delivered through its Result and recorded code/output locations.
Using this skill does not require a Viewer entry or a new HTML page.

Separate resources from viewing destinations: `Viewers.mounts` serves directories;
`sources` publishes data for Metrics, Progress, or a frontend; `entries` puts named
links in the user's Viewer list. Mount a directory tree once when needed. Its
files and subdirectories do not each need an entry. A Metrics or Progress source
can have no entries at all.

Choose entries by what the user will deliberately open to understand or use the
result. A report, comparison dashboard, library index, or image/PDF deliverable can
be such a destination. Retain raw JSON, configs, logs, and intermediate check
outputs in storage; put relevant settings/paths in Config and summarize outcomes
in Result. Publishing a file does not make it a useful Viewer entry. A raw file can be an entry when the user specifically
wants to open it. Do not generate HTML wrappers solely to justify more entries.

For related materials, prefer one useful report or index that organizes the result
and links supporting files. A report should present conclusions, comparisons, or
visualizations directly. Update that entry as the same work progresses instead
of appending one for every check. Add multiple entries only for distinct viewing
destinations the user needs. Put execution-specific entries on their Item; use Card
entries for shared overviews or reusable viewer templates, not a copy of every
Item's links. Reuse configuration through inheritance when output layouts match.
For local W&B viewing, mount the records and content needed for metrics and
artifacts; do not assume one .wandb file contains everything.

Report what was completed, the outcome, where to find it, and any remaining
work. When Result is attached, keep its text and completed state accurate; an
ended attempt can have a negative or failed result. Completion does not archive
the record or complete its parent module, feature, or other continuing work.
Do not attach Result merely to give every item a completion checkbox.

Use the [returned Viewer URI](references/tools.md) when linking a Viewer in chat.

## Release worktrees when execution ends

On completion, integrate selected changes into the intended target within the
user's authorization and verify the integration. Preserve useful evidence and
recoverable code for abandoned alternatives before releasing their worktrees.
Tracking alone does not authorize a push, merge, or deployment.

On pause, preserve needed code, including uncommitted and untracked files, under a
retained Git ref or supported snapshot. Record the resume context, then release the
worktree. Recreate it from the saved state when work resumes. Preserve full commit
identities and reachable refs for code needed after cleanup. If integration awaits
approval, preserve the candidate independently of its checkout.

Before removing a worktree, check that no process still uses it and retained outputs
are secure. Never discard unsaved work or stop a running job just to clean up.
Arrange cleanup after background jobs finish; do not leave it for the user to
remember. Report a concrete blocker if cleanup cannot complete.

Do not retain a worktree solely because its session is idle or the work might be
revisited. A session can span several checkouts; provide the current path and base
when work resumes.

## Tool workflow

1. Find a relevant Card with list_cards; read it and search only that Card's Items.
2. Create or update the appropriate record; request storage or selected components
   in the same receipt. See [tool reference](references/tools.md) for patch rules.
3. Save outputs in returned storage or record their established location. Configure
   Viewers resources and user-facing entries only as needed under the delivery
   guidance above; attach Metrics directly to the Card for Canvas curves.
4. Keep Result current. Its timestamps fill automatically; supply explicit known
   times for earlier executions. Preserve useful results before releasing worktrees.
5. Verify any Viewer entry you publish opens the intended result. Point the user to
   the work record and relevant results; do not create an entry just to finish this step.
