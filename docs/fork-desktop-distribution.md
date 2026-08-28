# Fork desktop distribution

The fork keeps the upstream desktop identity (`sh.paseo.desktop`, product name `Paseo`) while its
updater reads releases from `HamiltonHuaji/paseo`. Installing the fork over an official build, or
the official build over the fork, preserves the Electron user-data directory and daemon home.

The fork produces only:

- Windows x64 NSIS installer (`Paseo-Setup-<version>-x64.exe`);
- Linux x64 Debian package (`Paseo-<version>-amd64.deb`).

Windows updates use `electron-updater` and the fork release manifest. Electron cannot update a
Debian installation, so Linux downloads the fork `.deb`, verifies GitHub's SHA-256 asset digest,
and installs it through `pkexec` and `dpkg`.

## Versions

`packages/desktop/src/features/fork-build-info.json` owns the official base and fork revision. The
same file owns the single derived fork version. For official `A.B.C` and revision `R`, use
`A.B.(C * 1000 + R)`. The tag, Electron package, renderer, installer, update manifest, and daemon
distribution all use that version. Reset the revision to `1` after advancing the official base;
otherwise increment it for each published fork revision.

## Publication barrier

The desktop workflow creates a draft release before platform jobs upload packages. Each platform
publishes its completed artifact immediately.

Use `fork-desktop-release.yml` with the exact overlay release commit as `checkout_ref`; the workflow
creates the requested installer tag with that commit as its target. Keep `rollout_hours=0` for
personal fork releases unless a staged rollout was explicitly requested. See
[release.md](release.md) for the complete command sequence and artifact checklist.

## Official release visibility

Fork builds check `getpaseo/paseo` as read-only release metadata. Settings can download and verify
an official NSIS or `.deb`, including an equal or lower version, then hand it to the platform
installer.

After installing the official binary, returning to the fork requires manually running a fork
installer. Both distributions use the same Electron data directory and `~/.paseo` daemon state.
