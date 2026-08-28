# Fork release

This repository publishes the `HamiltonHuaji/paseo` overlay. It does not publish the upstream
`@getpaseo/*` npm packages, official mobile apps, website, relay, or Docker image.

Read [fork-overlay.md](fork-overlay.md) before changing the upstream base. Desktop packaging is
documented in [fork-desktop-distribution.md](fork-desktop-distribution.md); daemon packaging is
documented in [fork-daemon-distribution.md](fork-daemon-distribution.md).

## Release identity

A fork release has two identities:

- `origin/overlay` is the product branch.
- `packages/desktop/src/features/fork-build-info.json` records one fork version, the incorporated
  official version, and the fork revision.

For official `A.B.C` and revision `R` from 1 through 999, the fork version is
`A.B.(C * 1000 + R)`. Official `0.6.1` revision `9` is fork `0.6.1009`. Use that exact version for
the Git tag, desktop packages, app, daemon distribution, and optional Android or VSIX artifact.
The release scripts reject metadata or a tag that does not match the formula. Reset the revision
to `1` when the official base advances; otherwise increment it for every functional release.

The desktop workflow creates the release tag with the exact overlay release commit as its target.
Workflow dispatch uses `--ref overlay` so GitHub loads the fork workflow definition, while
`checkout_ref=<commit SHA>` pins every build job to the same source. Do not push a release tag:
external GitHub Apps can react to tag events even when the overlay removes upstream workflows.

## Artifact set

Every fork release builds:

- Windows x64 NSIS installer;
- Linux x64 Debian package;
- `paseo-fork.tgz`, the fork CLI and daemon distribution.

The VS Code extension is unfinished and its VSIX is opt-in. Android is opt-in because EAS signing
and native compilation are slow. Build either only when the user explicitly requests it. The fork
does not have an npm beta channel. Use `publish=false` on an individual workflow when you need an
unpublished artifact for testing.

## Preparation

1. Fetch `origin`. Prepare only from a clean local `overlay` whose HEAD equals `origin/overlay`.
2. Increment `forkRevision` in `fork-build-info.json` and update `version` from the formula. Reset
   the revision to `1` only when `upstreamBaseVersion` advances.
3. Run `npm run release:fork:check`. This runs formatting checks, lint, and typecheck only.
4. Show the release commit, fork version, official base, revision, and artifact set to the user.
5. Wait for explicit publish authorization. Keep all preparation local until then.

Do not add or run Playwright, browser, E2E, integration, packaged smoke, or other test suites while
preparing or publishing a release. Quick Checks may run existing Node unit tests independently,
but their status never gates a fork release. Run broader tests only after a separate explicit user
request.

Do not run `npm run release:patch`, `release:minor`, `release:promote`, or any npm publish command.
Those commands belong to upstream Paseo and are intentionally absent from the overlay root
package.

## Publish

After authorization, commit the release metadata, push `overlay`, and record its exact SHA:

```bash
git add packages/desktop/src/features/fork-build-info.json
git commit -m "chore(release): bump fork revision"
git push origin overlay
RELEASE_COMMIT=$(git rev-parse origin/overlay)
```

Dispatch the fork workflows explicitly. The desktop workflow creates the release and its tag; the
other workflows tolerate racing with that creation and attach their assets to the same release.
Dispatch immediately after pushing the release commit. Quick Checks and release workflows are
independent, so a pending or failed Quick Checks run does not delay publication.

```bash
gh workflow run fork-desktop-release.yml \
  --repo HamiltonHuaji/paseo \
  --ref overlay \
  -f tag="v$FORK_VERSION" \
  -f checkout_ref="$RELEASE_COMMIT" \
  -f platform=windows-linux \
  -f publish=true \
  -f rollout_hours=0

gh workflow run fork-daemon-release.yml \
  --repo HamiltonHuaji/paseo \
  --ref overlay \
  -f tag="v$FORK_VERSION" \
  -f checkout_ref="$RELEASE_COMMIT" \
  -f publish=true

```

When the user explicitly requests the unfinished VSIX, dispatch `fork-vscode-release.yml` with the
same tag, ref, commit, and publish inputs.

When Android was explicitly requested:

```bash
gh workflow run fork-android-release.yml \
  --repo HamiltonHuaji/paseo \
  --ref overlay \
  -f tag="v$FORK_VERSION" \
  -f checkout_ref="$RELEASE_COMMIT" \
  -f publish=true
```

Each selected workflow publishes the release after uploading its artifact. Do not wait for a
slower platform before exposing artifacts that have already finished.

## Completion

Watch every dispatched workflow to completion. A release is complete only after the GitHub release
is public and contains:

- the Windows x64 installer and `latest.yml`;
- the Linux amd64 `.deb` and `latest-linux.yml`;
- `paseo-fork.tgz`;
- `paseo-fork.vsix`, only when explicitly requested;
- the APK, only when requested.

Confirm the release title shows the expected fork version and official base. Report every
workflow URL and asset URL to the user. Confirm the release tag resolves to `RELEASE_COMMIT`. Do
not restart a running daemon while publishing.
