# Fork desktop distribution

This checkout keeps the desktop identity (`sh.paseo.desktop`, product name `Paseo`) used by
upstream, but publishes desktop updates from `HamiltonHuaji/paseo`. Installing a fork build over
an official build, or an official build over a fork build, therefore keeps the existing Electron
user-data directory and daemon home.

The fork produces only these desktop installers:

- Windows x64 NSIS installer (`Paseo-Setup-<version>-x64.exe`)
- Linux x64 Debian package (`Paseo-<version>-amd64.deb`)

Windows fork updates use `electron-updater` and the manifests in the fork's GitHub release. A
Debian installation cannot use Electron's AppImage updater, so Linux checks the fork's GitHub
release directly, requires GitHub's SHA-256 asset digest, and installs the verified `.deb` through
`pkexec` and `dpkg`.

## Version ownership

Fork releases expose two deliberately separate versions:

- The **fork version**, such as `0.1.109-fork.2`, identifies the incorporated official base and the
  fork revision on that base. This is the user-facing version in Settings and GitHub Releases.
- The **installer version**, such as `0.1.111`, is the monotonically increasing package version used
  by Electron, Debian, and Android update ordering.

`packages/desktop/src/features/fork-build-info.json` is the source of truth for the upstream base
and fork revision. Reset `revision` to `1` when `upstreamBaseVersion` advances; otherwise increment
it for each fork release. Do not put the fork version into package `version` fields: semver tools
would treat it as a prerelease, and Android would derive colliding `versionCode` values.

The retained fork release line starts at installer `0.1.0`, displayed as
`0.1.109-fork.1`. Experimental installers through `0.1.112` were removed. A desktop installation
of the experimental line must be replaced manually once because Electron correctly refuses to
auto-downgrade from `0.1.112` to `0.1.0`; subsequent fork releases resume normal automatic updates
at `0.1.1`, `0.1.2`, and so on. Keep the technical installer version monotonic from this new
baseline and do not reset it again.

For example, installer `0.1.1` may be displayed as fork `0.1.109-fork.2`. After incorporating
official `0.1.110`, the next fork becomes `0.1.110-fork.1`, while its installer version continues
upward. The release workflow writes both identities into the GitHub Release title and body.

New releases remain GitHub drafts while the platform jobs upload installers. The desktop workflow
publishes the release only after it has assembled and uploaded the final updater manifests. This
prevents an installed client from discovering a release before `latest.yml` or
`latest-linux.yml` exists. The Android workflow may attach an APK to an existing release, or create
a draft when it runs first, but it never publishes that draft; desktop manifest finalization owns
the publication barrier.

## Build and publish Windows + Linux

Run the `Desktop Release` workflow manually. Its default `windows-linux` platform selection skips
macOS and produces only NSIS and `.deb` targets. The source tag supplies version metadata; the
checkout ref selects the fork commit to build.

```bash
gh workflow run desktop-release.yml \
  --ref main \
  -f tag=desktop-v0.1.110 \
  -f checkout_ref=main \
  -f platform=windows-linux \
  -f publish=true \
  -f rollout_hours=0
```

Use a version greater than every previously published fork build. Confirm that the resulting
`v<version>` release contains the Windows x64 installer, its updater metadata, and the Linux
`.deb` before distributing it.

## Official release visibility and one-way switch

Fork builds continue to check `getpaseo/paseo` as read-only release metadata. A newer official
release appears as a low-priority sidebar notice and in Settings. Settings can also download the
official NSIS or `.deb` asset, verify its GitHub SHA-256 digest, stop the built-in daemon, and run
the installer. This action deliberately works for an equal or lower installed version.

Once the official binary is installed, its code no longer knows about the fork update source.
Returning to the fork requires manually installing a release from `HamiltonHuaji/paseo`.

The shared identity is intentional: Electron settings remain in `%APPDATA%\Paseo` on Windows or
`~/.config/Paseo` on Linux, while production daemon state remains in `~/.paseo`.
