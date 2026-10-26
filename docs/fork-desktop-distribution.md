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
same file owns the single derived fork version. For official `A.B.C` or `A.B.C-prerelease` and
revision `R`, preserve the exact official string in metadata, strip the suffix for derivation, and
use `A.B.(C * 1000 + R)`. The tag, Electron package, renderer, installer, update manifest, and daemon
distribution all use that version. Reset the revision to `1` after advancing the official base;
otherwise increment it for each published fork revision.

## Publication barrier

The desktop workflow creates a public release before platform jobs upload packages. Each platform
publishes its completed artifact immediately. Release withdrawal and its cache limits follow
[the release workflow](release.md#withdraw-a-release).

Use `fork-desktop-release.yml` with the exact overlay release commit as `checkout_ref`; the workflow
creates the requested installer tag with that commit as its target. Keep `rollout_hours=0` for
personal fork releases unless a staged rollout was explicitly requested. See
[release.md](release.md) for the complete command sequence and artifact checklist.

## Daemon lifecycle

Starting Desktop attaches to an already-running daemon without restarting it because its version
differs from the app. Clients and daemons update independently; feature capabilities decide what
you can use. Restart or update the daemon through an explicit lifecycle action.

Client-assisted daemon downloads and their compatibility boundary belong to
[daemon distribution](fork-daemon-distribution.md#explicit-self-update-contract).

## Desktop payload

Keep Electron for this fork. Reduce duplicate application payload without changing the rendering
engine or removing desktop capabilities; see [DIST-06](contracts/distribution.md#dist-06--桌面瘦身保持功能与运行环境).
The local daemon and plugin compiler are runtime consumers of packaged dependencies. A dependency
that looks like a build tool can still be required after installation. Check package exports and
the packaged compiler before excluding files, and compare compressed installer size separately
from installed bytes.

## Official release visibility

Fork builds check `getpaseo/paseo` as read-only release metadata. Settings can download and verify
an official NSIS or `.deb`, including an equal or lower version, then hand it to the platform
installer.

After installing the official binary, returning to the fork requires manually running a fork
installer. Both distributions use the same Electron data directory and `~/.paseo` daemon state.
