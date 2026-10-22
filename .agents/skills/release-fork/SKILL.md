---
name: release-fork
description: Prepare and publish authorized HamiltonHuaji/paseo fork releases for desktop, daemon, and optional Android APK. Local builds and previews stay local.
user-invocable: true
---

# Release the overlay fork

Read [the fork release workflow](../../../docs/release.md) before preparation.
For baseline changes, verify [the behavior contracts](../../../docs/contracts/README.md).

Use the canonical fork version and exact upstream baseline from
`packages/desktop/src/features/fork-build-info.json`. Reset the revision to 1
when the baseline advances; otherwise increment it for a new published build.
Published tags and assets are immutable. Never move a published tag or overwrite
an existing asset. The VS Code extension is retired.

Desktop and daemon form the default release; Android is included for a full
release or when explicitly requested. Use only fork workflows, pinned to one full
commit SHA. Never publish `@getpaseo/*` npm packages or invoke official store,
website, relay, or cloud release channels.

A local build or hosted preview does not authorize publishing, tagging, or global
installation. For a release, show the version, baseline, revision, artifact set,
and commit before publishing. Explicit publishing authorization persists for its
stated scope. After authorization, expose the Release immediately and attach
completed artifacts independently; watch each dispatched workflow to completion.
