---
name: release-fork
description: Publish or rebuild the HamiltonHuaji/paseo overlay fork. Use when the user asks to release, publish, rebuild, or ship the fork, its desktop installers, daemon package, VSIX, or optional Android APK.
user-invocable: true
---

# Release the overlay fork

Read `docs/release.md` completely and follow it end-to-end.

Never run the upstream npm release scripts, publish `@getpaseo/*`, release from `main`, or invoke
the official Android/EAS workflow. The release source is `origin/overlay`; the GitHub release tag
provides the monotonically increasing installer version.

Desktop, daemon, and VSIX are the default artifact set. Build the fork Android APK only when the
user explicitly requests Android.

Release preparation runs formatting, lint, and typecheck only. Do not add or run tests, browser
downloads, Playwright, E2E, or smoke checks as part of a release. Existing fast Node unit tests
belong to ordinary Quick Checks and never gate publication. Do not wait for Quick Checks before
dispatching an authorized release.

Preparation is reversible. Show the proposed installer version, fork display version, artifact
set, and release commit before publishing. Publishing requires explicit user authorization. Once
authorized, watch every dispatched workflow to completion and verify the release assets.
