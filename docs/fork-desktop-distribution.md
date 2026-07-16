# Fork desktop distribution

This checkout keeps the desktop identity (`sh.paseo.desktop`, product name `Paseo`) used by
upstream, but publishes desktop updates from `HamiltonHuaji/paseo`. Installing a fork build over
an official build, or an official build over a fork build, therefore keeps the existing Electron
user-data directory and daemon home.

The fork produces only these desktop installers:

- Windows x64 and arm64 NSIS installers (`Paseo-Setup-<version>-<arch>.exe`)
- Linux x64 Debian package (`Paseo-<version>-amd64.deb`)

Windows fork updates use `electron-updater` and the manifests in the fork's GitHub release. A
Debian installation cannot use Electron's AppImage updater, so Linux checks the fork's GitHub
release directly, requires GitHub's SHA-256 asset digest, and installs the verified `.deb` through
`pkexec` and `dpkg`.

## Version ownership

The package version is the installed-build version and must increase for every fork release. It is
separate from `FORK_UPSTREAM_BASE_VERSION` in
`packages/desktop/src/features/fork-build-info.ts`, which records the latest official version whose
changes have been incorporated into the fork.

For example, a fork build may be `0.1.110` while its upstream base is `0.1.109`. When official
`0.1.110` appears, the app reports it as a newer upstream release even though the two installed
builds have the same package version. Update the base constant only after incorporating that
official release.

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
`v<version>` release contains the two Windows installers, their updater metadata, and the Linux
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
