# Fork daemon distribution

The fork ships its CLI and daemon as one npm-compatible GitHub Release asset. npm installs the
third-party native dependencies for the target host; the tarball carries fork-built copies of the
internal `highlight`, `protocol`, `client`, `relay`, `plugin`, and `server` workspaces.

Build and verify it with:

```bash
npm run build:fork-daemon-package
npm run verify:fork-daemon-package
```

The output is `artifacts/fork-daemon/paseo-fork.tgz`. Install it with:

```bash
npm install -g --force https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz
```

The outer package is `@hamiltonhuaji/paseo-fork`; its executable stays `paseo`. It verifies every
bundled internal workspace before loading the CLI, so an official package elsewhere in the global
npm prefix cannot satisfy a missing fork dependency.

The bundled daemon also injects that outer `paseo` executable into agent terminals and hooks. It
must not resolve a separately installed `@getpaseo/cli`; otherwise a restart from an agent can
replace the running fork daemon with the official daemon.

The generated distribution manifest records the fork version, official daemon baseline, and
install URL. Daemon self-update reads that manifest, runs npm directly with `--force`, and updates
the same distribution. It never resolves `paseo` from `PATH`. `server_info.version` remains the
internal server compatibility version; `server_info.distribution.version` is the exact fork release
and is the value clients use for display and self-update confirmation. An official installation
without a manifest keeps using `@getpaseo/cli@latest`.

Self-update restarts the worker through its existing supervisor. The replacement worker inherits
the supervisor's startup environment and loads code from the updated package path. The supervisor
process itself remains in memory; a release that changes supervisor behavior still requires one
full external daemon restart or a host reboot after the package update.

Network filesystems can make npm's directory replacement much slower than local disk. Self-update
does not impose a wall-clock timeout on npm and disables audit and funding metadata requests. npm
already retires the old package to a hidden `.paseo-fork-*` directory before replacing it. A
`cleanup` warning about that directory is non-fatal when npm finishes successfully; it means npm
could not remove the retired tree, not that the active distribution is invalid.

The update request streams bounded npm output to its requesting client and emits an installing
heartbeat while npm is silent. The client keeps only a bounded tail for display; update output is not
persisted or broadcast to other clients.

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
