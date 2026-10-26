# Fork daemon distribution

The fork ships its CLI and daemon as one npm-compatible GitHub Release asset. npm installs the
third-party native dependencies for the target host; the tarball carries fork-built copies of the
internal `highlight`, `protocol`, `client`, `relay`, `plugin`, and `server` workspaces.

Build and verify it with:

```bash
npm run build:fork-daemon-package
npm run check:fork-daemon-dependencies
```

The output is `artifacts/fork-daemon/paseo-fork.tgz`. Install it with:

```bash
npm install -g --force https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz
```

The outer package is `@hamiltonhuaji/paseo-fork`; its executable stays `paseo`. It verifies every
bundled internal workspace before loading the CLI, so an official package elsewhere in the global
npm prefix cannot satisfy a missing fork dependency.

The outer package owns required peer dependencies, including peers of bundled third-party
packages. Leaving those peer declarations in a nested bundled manifest can make npm finish
successfully with an empty dependency directory. The fixed release check validates the final
tarball's bundled dependencies and runtime module references; the packer checks peer version
coverage before removing nested declarations. External module exports resolve against the build's
installed dependencies only after checking the tarball explicitly declares them.

This check uses static module tracing and does not launch the CLI, daemon, providers, or browsers.
It reports dependency failures only, without package-style or unused-code suggestions. The existing
`verify:fork-daemon-package` installation probe remains available for explicitly requested diagnosis;
it is not part of the fixed release checks. Automatic scope belongs to
[RELEASE-02](contracts/distribution.md#release-02--验证范围与发行解耦).

Agent terminals and managed Codex tools use the CLI from the running distribution. Build the CLI
before starting Codex from a source checkout; a missing source or bundled CLI must not resolve to an
outer checkout or separately installed package. A restart through the wrong CLI can replace the
running fork daemon.

Bash login profiles can replace the inherited `PATH`. Managed Codex tools retain the distribution's
CLI after those profiles run, using a private hook under `PASEO_HOME/agent-shell`. Your existing
`BASH_ENV` file still runs first; user shell profiles and global installations are unchanged. The
login-shell guarantee is currently verified on Linux/Bash. Other shell startup files require their
own verification.

The generated distribution manifest records the fork version, official daemon baseline, and
install URL. Daemon self-update reads that manifest, runs npm directly with `--force`, and updates
the same distribution. It never resolves `paseo` from `PATH`. `server_info.version` remains the
internal server compatibility version; `server_info.distribution.version` is the exact fork release
and is the value clients use for display and post-update reporting. An official installation
without a manifest keeps using `@getpaseo/cli@latest`. A fork source checkout reports its
canonical fork identity and refuses npm self-update; rebuild and restart that checkout explicitly.

Self-update restarts the worker through its existing supervisor. The replacement worker inherits
the supervisor's startup environment and loads code from the updated package path. The supervisor
process itself remains in memory; a release that changes supervisor behavior still requires one
full external daemon restart or a host reboot after the package update.

## Explicit self-update contract

After the user confirms **Update daemon** for a standalone fork daemon, install that distribution
from its release URL or a complete client-supplied release archive. Do not gate the request or installation on the app version, the running
worker version, the global npm package version, whether any two of those versions match, whether
the target version is newer, or whether the worker still resides under the current npm package
directory. npm may replace that directory while the old worker remains alive; same-version
reinstallation must also work. Version checks may drive notices and report the replacement worker's
actual version, but must not decide whether an explicit update runs or is considered installed.

Keep checks that protect the operation itself: the client must be authorized and connected to the
selected host, Desktop-managed daemons use Desktop's update path, and concurrent installs are
rejected. A nonzero npm exit code is an installation failure. After installation, confirm the
selected host has a replacement worker; do not require a particular version string to call the
replacement successful. Do not add a new pre-install gate without a concrete safety invariant
that cannot be checked during or after installation.

Network filesystems can make npm's directory replacement much slower than local disk. Self-update
does not impose a wall-clock timeout on npm and disables audit and funding metadata requests. npm
already retires the old package to a hidden `.paseo-fork-*` directory before replacing it. A
`cleanup` warning about that directory is non-fatal when npm finishes successfully; it means npm
could not remove the retired tree, not that the active distribution is invalid.

The daemon owns the update task. A client with update-control capability can read its current phase,
bounded output tail, and terminal result after reconnecting, and can cancel it from another connection.
Cancellation stops npm and its child processes before releasing the installation slot; it does not
roll back files npm already replaced. Network fetches have bounded attempts, while installation keeps
the slow-filesystem rule above. Legacy requests still receive their progress stream.

Desktop clients can download the release asset on demand and transfer it over their existing direct
or encrypted relay connection. The daemon verifies the completed archive against its advertised
size, checksum, package identity, and selected version before invoking npm. Host-specific native
dependencies may still need npm downloads on the daemon. An interrupted transfer can resume from the
acknowledged offset; abandoned transfers expire and release temporary storage. This path adds no
pre-downloaded daemon archive to the desktop installer.

Older hosts need one installation containing update-control support before clients can manage their
updater. An upgraded client cannot retroactively cancel an old host's untracked npm process.

After the one-time manual installation of a release containing this behavior, replace the old
supervisor as well:

```bash
paseo daemon restart
```

Run the command from the same shell and `PASEO_HOME` used by the daemon. This loads the new updater
into the worker. A release that changes the supervisor itself still requires a full stop and start as
described above.

Run the `Fork Daemon Release` workflow to build and attach the stable `paseo-fork.tgz` asset to a
fork release.
