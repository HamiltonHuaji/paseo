# Fork overlay workflow

This fork keeps product customizations as a rebaseable overlay on official Paseo releases.

## Branch roles

- `upstream/main` is the authoritative upstream development branch.
- `main` is reserved as a mirror of `upstream/main`; it must not contain fork-only commits.
- `overlay` is the fork's product branch. It contains the latest selected official stable tag plus
  the fork-only commits, replayed after that tag.

Releases and fork build tags are cut from `overlay`, not `main`. The overlay follows official
stable tags rather than `upstream/main`, so a fork release never accidentally includes unreleased
upstream work.

A separate branch containing generated patch files is intentionally not maintained. Git commits
already preserve the overlay's reviewable units, tests, authorship, and conflict context; a patch
snapshot would duplicate that state while making conflicts harder to resolve.

## Following a new upstream stable release

Fetch upstream, inspect the release, and rebase the overlay so fork commits appear after all
upstream commits:

```bash
git fetch upstream --tags
git switch overlay
git rebase v<official-version>
```

Resolve conflicts in favor of the current upstream structure, then reapply the overlay behavior.
Do not merge the release tag into `overlay`: merge commits make the overlay boundary harder to
review and cause later updates to retain historical conflict resolutions in the wrong order.

After the rebase:

1. Update `packages/desktop/src/features/fork-build-info.json` to the new official base and reset
   its fork revision to `1`.
2. Run targeted tests for every conflict and fork feature touching the same files.
3. Run formatting, lint, and typecheck.
4. Compare `v<official-version>..overlay` to review only the remaining fork overlay.
5. Push the rewritten overlay with `git push --force-with-lease origin overlay` only after the
   rebased branch has been verified.

`--force-with-lease` is required because rebase intentionally rewrites overlay commit IDs while
protecting against overwriting remote work that was not fetched locally.

## Mirroring upstream main

Update the mirror independently from the release overlay:

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
```

If the fork's historical `main` still contains overlay commits, migrate and publish `overlay`
first, make `overlay` the GitHub default branch, and only then replace remote `main`. Replacing
that remote `main` requires an explicit one-time `--force-with-lease`; routine updates after the
migration must be fast-forward only. Keeping `overlay` as the default also makes manual GitHub
Actions runs and pull requests target the fork product rather than the upstream mirror.
