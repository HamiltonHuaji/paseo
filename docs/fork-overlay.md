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

When a release must absorb fixes newer than the selected tag, place reviewed upstream commits in a
separate layer immediately above the tag and below every fork product commit. Record the exact
commits in the [baseline review](contracts/baseline-review.md). Do not mix pending upstream fixes
into product commits; remove or align the patch layer after upstream merges them.

A separate branch containing generated patch files is intentionally not maintained. Git commits
already preserve the overlay's reviewable units, tests, authorship, and conflict context; a patch
snapshot would duplicate that state while making conflicts harder to resolve.

## Following a new upstream stable release

Start from the [behavior contracts](contracts/README.md). Preserve the old product ref and any
uncommitted work, then create an isolated Git checkout for the candidate. Record the exact old and
target bases; a later upstream main commit is not evidence that the selected release includes a fix.
The same contract review applies to an explicitly selected prerelease.

Fetch upstream and inspect the release. For a small upstream jump, rebase the candidate so fork
commits appear after all upstream commits:

```bash
git fetch upstream --tags
# In the isolated candidate checkout, based on the saved product ref:
git rebase v<official-version>
```

For a large upstream jump, create the replacement overlay from the official tag and replay only
the fork behavior that upstream has not implemented. Reimplement retained behavior on the current
upstream APIs instead of preserving obsolete conflict resolutions. Keep a backup ref until the
replacement overlay passes verification.

Use the contracts as the loss-prevention checklist and create a repository-tracked
[baseline review](contracts/baseline-review.md). Check every ID, including features outside conflict
files. Classify implementation ownership separately from verification: an upstream equivalent may
replace fork code only when it satisfies the required behavior. Port the missing behavior using
current upstream APIs.

Preserve attribution for old commits and final changed paths, including temporary upstream patches,
tests, dependencies and release metadata. [The old overlay inventory](fork-overlay-inventory.md)
is historical evidence for its stated revisions, not the current requirements registry. Do not
reintroduce discarded session/state designs from that or other old material.

Keep existing gaps, new regressions, unverified scenarios and future targets distinct in the review.
Do not silently retire or weaken a contract to make the candidate pass. Follow the review's
completion criteria before replacing the product branch.

Do not merge the release tag into `overlay`. Merge commits make the overlay boundary harder to
review and retain historical conflict resolutions in the wrong order.

After the rebase:

1. Update `packages/desktop/src/features/fork-build-info.json` to the new official base and reset
   its fork revision to `1`.
2. Verify every contract's applicable scenarios; reuse upstream evidence only for the exact
   candidate behavior. Run affected test files and required platform checks without running the
   full suite locally.
3. Run formatting, lint, and typecheck; record failures and environment limitations.
4. Compare `v<official-version>..<candidate>` to review the remaining fork overlay. Complete the
   per-ID review and retain the documentation alongside the migrated code.
5. Integrate the verified candidate into the product branch. When publication is authorized,
   push the rewritten overlay with `git push --force-with-lease origin overlay`.

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
