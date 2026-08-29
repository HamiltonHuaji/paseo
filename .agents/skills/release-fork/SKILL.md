---
name: release-fork
description: Publish or rebuild the HamiltonHuaji/paseo overlay fork. Use when the user asks to release, publish, rebuild, or ship the fork, its desktop installers, daemon package, VSIX, or optional Android APK.
user-invocable: true
---

# Release the overlay fork

Read `docs/release.md` completely and follow it end-to-end.

Never run the upstream npm release scripts, publish `@getpaseo/*`, release from `main`, or invoke
the official Android/EAS workflow. The release source is `origin/overlay`; the GitHub release tag
must equal the canonical version in `fork-build-info.json`.

The fork uses one version everywhere. For upstream `A.B.C` and fork revision `R` from 1 through
999, derive `A.B.(C * 1000 + R)`. For example, upstream `0.6.1` revision `9` is `0.6.1009`.
`fork-build-info.json` stores the derived version, upstream baseline, and revision; reject a
release when they disagree. Use this version for the Git tag, Release, desktop installer, app,
daemon distribution, and any explicitly requested Android or VSIX artifact.

Desktop and daemon are the default artifact set. A full release adds the Android APK. The VS Code
extension is unfinished; build its VSIX only when the user explicitly names VSIX, including when
the user asks for a full release. An ordinary release includes Android only when the user requests
it.

Release preparation runs formatting, lint, and typecheck only. Do not add or run tests, browser
downloads, Playwright, E2E, or smoke checks as part of a release. Existing fast Node unit tests
belong to ordinary Quick Checks and never gate publication. Do not wait for Quick Checks before
dispatching an authorized release.

Preparation is reversible. Show the proposed fork version, upstream baseline, fork revision,
artifact set, and release commit before publishing. Publishing requires explicit user authorization. Once
authorized, watch every dispatched workflow to completion and verify the release assets.
Make the GitHub Release public before its artifacts finish. Publish each artifact as soon as its
workflow uploads it. Do not keep the Release or completed artifacts hidden while another platform
is still building.
