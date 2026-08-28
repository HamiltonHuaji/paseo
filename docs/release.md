# Fork release

This repository publishes the `HamiltonHuaji/paseo` overlay. It does not publish the upstream
`@getpaseo/*` npm packages, official mobile apps, website, relay, or Docker image.

Read [fork-overlay.md](fork-overlay.md) before changing the upstream base. Desktop packaging is
documented in [fork-desktop-distribution.md](fork-desktop-distribution.md); daemon packaging is
documented in [fork-daemon-distribution.md](fork-daemon-distribution.md).

## Release identity

A fork release has three identities:

- `origin/overlay` is the product branch.
- `packages/desktop/src/features/fork-build-info.json` records the incorporated official version
  and fork revision, such as `0.6.1-fork.4`.
- The GitHub release tag is the monotonically increasing installer version, such as `v0.6.4`.
  Electron, Debian, Android, and VS Code use it for upgrade ordering.

The installer version can advance while the official base stays unchanged. Never reuse a
published installer version for a functional update: clients cannot discover a different build
with the same version. Re-run an existing tag only to retry a failed build whose assets were not
published.

The desktop workflow creates the release tag with the exact overlay release commit as its target.
Workflow dispatch uses `--ref overlay` so GitHub loads the fork workflow definition, while
`checkout_ref=<commit SHA>` pins every build job to the same source. Do not push a release tag:
external GitHub Apps can react to tag events even when the overlay removes upstream workflows.

## Artifact set

Every fork release builds:

- Windows x64 NSIS installer;
- Linux x64 Debian package;
- `paseo-fork.tgz`, the fork CLI and daemon distribution;
- `paseo-fork.vsix`, the VS Code extension.

Android is opt-in because EAS signing and native compilation are slow. Build it only when the user
explicitly requests Android. The fork does not have an npm beta channel. Use `publish=false` on an
individual workflow when you need an unpublished artifact for testing.

## Preparation

1. Fetch `origin`. Prepare only from a clean local `overlay` whose HEAD equals `origin/overlay`.
2. Increment `revision` in `fork-build-info.json`. Reset it to `1` only when
   `upstreamBaseVersion` advances.
3. Choose an installer patch version greater than every published fork installer version.
4. Run `npm run release:fork:check`. This runs formatting checks, lint, and typecheck only.
5. Show the
   release commit, installer version, fork display version, and artifact set to the user.
6. Wait for explicit publish authorization. Keep all preparation local until then.

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
  -f tag="v$INSTALLER_VERSION" \
  -f checkout_ref="$RELEASE_COMMIT" \
  -f platform=windows-linux \
  -f publish=true \
  -f rollout_hours=0

gh workflow run fork-daemon-release.yml \
  --repo HamiltonHuaji/paseo \
  --ref overlay \
  -f tag="v$INSTALLER_VERSION" \
  -f checkout_ref="$RELEASE_COMMIT" \
  -f publish=true

gh workflow run fork-vscode-release.yml \
  --repo HamiltonHuaji/paseo \
  --ref overlay \
  -f tag="v$INSTALLER_VERSION" \
  -f checkout_ref="$RELEASE_COMMIT" \
  -f publish=true
```

When Android was explicitly requested:

```bash
gh workflow run fork-android-release.yml \
  --repo HamiltonHuaji/paseo \
  --ref overlay \
  -f tag="v$INSTALLER_VERSION" \
  -f checkout_ref="$RELEASE_COMMIT" \
  -f publish=true
```

The desktop workflow creates a draft release and publishes it only after the final updater
manifests are uploaded. Other fork workflows may attach assets while that release is still a
draft.

## Completion

Watch every dispatched workflow to completion. A release is complete only after the GitHub release
is public and contains:

- the Windows x64 installer and `latest.yml`;
- the Linux amd64 `.deb` and `latest-linux.yml`;
- `paseo-fork.tgz`;
- `paseo-fork.vsix`;
- the APK, only when requested.

Confirm the release title shows the expected fork display version and official base. Report every
workflow URL and asset URL to the user. Confirm the release tag resolves to `RELEASE_COMMIT`. Do
not restart a running daemon while publishing.
