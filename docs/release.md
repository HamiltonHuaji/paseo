# Fork release

This repository publishes the `HamiltonHuaji/paseo` overlay. It does not publish the upstream
`@getpaseo/*` npm packages, official mobile apps, website, relay, or Docker image.

Read [fork-overlay.md](fork-overlay.md) and verify every [behavior contract](contracts/README.md) before changing the upstream base. Desktop packaging is
documented in [fork-desktop-distribution.md](fork-desktop-distribution.md); daemon packaging is
documented in [fork-daemon-distribution.md](fork-daemon-distribution.md).

## Release identity

A fork release has two identities:

- `origin/overlay` is the product branch.
- `packages/desktop/src/features/fork-build-info.json` records one fork version, the incorporated
  official version, and the fork revision.

For official `A.B.C` or `A.B.C-prerelease` and revision `R` from 1 through 999, strip the
prerelease suffix for the installable version and derive `A.B.(C * 1000 + R)`. The metadata keeps
the full official version, including a suffix such as `-beta.2`, so the incorporated source remains
unambiguous. Official `0.9.0-beta.2` revision `1` is fork `0.9.1`. Use that exact version for
the Git tag, desktop packages, app, daemon distribution, and optional Android artifact.
The release scripts reject metadata or a tag that does not match the formula. Reset the revision
to `1` when the official base advances; otherwise increment it for every functional release.

The desktop workflow creates the release tag with the exact overlay release commit as its target.
Workflow dispatch uses `--ref overlay` so GitHub loads the fork workflow definition, while
`checkout_ref=<commit SHA>` pins every build job to the same source. Do not push a release tag:
external GitHub Apps can react to tag events even when the overlay removes upstream workflows.

Published tags and assets are immutable. Never rebuild or overwrite an installer under an existing
tag: update manifests and installer downloads can be cached independently, producing a checksum
mismatch. Increment the fork revision and publish a new version even when the only change is to the
release pipeline.

## Artifact set

Every fork release builds:

- Windows x64 NSIS installer;
- Linux x64 Debian package;
- `paseo-fork.tgz`, the fork CLI and daemon distribution.

Android is opt-in because EAS signing and native compilation are slow. A full release includes Android. The VS Code extension is retired and has no build or release path. The fork does not have an npm beta channel. Use `publish=false` on an individual workflow when you need an unpublished
artifact for testing.

## Preparation

1. Fetch `origin`. Prepare only from a clean local `overlay` whose HEAD equals `origin/overlay`.
2. Increment `forkRevision` in `fork-build-info.json` and update `version` from the formula. Reset
   the revision to `1` only when `upstreamBaseVersion` advances.
3. Run `npm run release:fork:check`. This runs formatting checks, lint, and typecheck only.
4. Show the release commit, fork version, exact official base, revision, and artifact set to the user.
5. Wait for explicit publish authorization. Keep all preparation local until then.

Keep automatic verification within [RELEASE-02](contracts/distribution.md#release-02--验证范围与发行解耦).
Quick Checks runs formatting, lint, and typecheck after building workspace declarations. It does
not install browsers or run test suites. Existing fast Node unit tests may be retained only within
the agreed scope; do not restore upstream test matrices during a baseline bump. Broader validation
requires a separate explicit user request, and a one-time request does not authorize a recurring job.

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

Dispatch the fork workflows explicitly. The desktop workflow creates a public release and its tag
before builds finish; the other workflows tolerate racing with that creation and attach their
assets to the same release. Dispatch immediately after pushing the release commit. Quick Checks
and release workflows are independent, so a pending or failed Quick Checks run does not delay
publication.

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

When Android was explicitly requested:

```bash
gh workflow run fork-android-release.yml \
  --repo HamiltonHuaji/paseo \
  --ref overlay \
  -f tag="v$FORK_VERSION" \
  -f checkout_ref="$RELEASE_COMMIT" \
  -f publish=true
```

Each selected workflow uploads its artifact directly to the already-public release. Do not wait
for a slower platform before exposing artifacts that have already finished.

## Completion

Watch every dispatched workflow to completion. A release is complete only after the GitHub release
is public and contains:

- the Windows x64 installer and `latest.yml`;
- the Linux amd64 `.deb` and `latest-linux.yml`;
- `paseo-fork.tgz`;
- the APK, only when requested.

Confirm the release title shows the expected fork version and official base. Report every
workflow URL and asset URL to the user. Confirm the release tag resolves to `RELEASE_COMMIT`. Do
not restart a running daemon while publishing.

## Withdraw a release

Fork distribution uses GitHub Release assets only. Keep the preceding release and its assets.
Before publishing, record its tag and the old overlay commit alongside the candidate SHA.
Withdrawing a release removes it from future update discovery once GitHub and client caches refresh;
it does not undo installed software or reclaim downloaded installers. The source branch, Actions
records and notifications remain. Restoring the source branch is a separate operation.

1. Cancel every running release workflow for the withdrawn tag and wait for those runs to finish.
   The workflows can create a missing Release; deletion while they run can be undone by a late job.
2. Delete the Release and, if you also want to remove the source download tag, delete that tag.
   GitHub's web Release deletion alone leaves the tag. The CLI can remove both:

   ```bash
   gh release delete v0.13.1 --repo HamiltonHuaji/paseo --cleanup-tag --yes
   ```

3. Check `gh api repos/HamiltonHuaji/paseo/releases/latest --jq .tag_name`. If the intended previous
   release is not latest, restore that selection with
   `gh release edit v0.9.20 --repo HamiltonHuaji/paseo --latest`. These tags are examples for the
   0.13 baseline transition; use the recorded pair for later releases.
4. Confirm that the selected release still has both desktop manifests/installers and
   `paseo-fork.tgz`, and that fresh update checks/download redirects no longer select the withdrawn tag.

Keep the withdrawn version reserved. A corrected publication gets a new fork revision even after
its Release and tag have been deleted. Do not republish different bytes under a withdrawn URL.
No npm unpublish, store rollback or Docker tag change belongs to this workflow.
