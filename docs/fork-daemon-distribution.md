# Fork daemon distribution

The fork ships its CLI and daemon as one npm-compatible GitHub Release asset. npm installs the
third-party native dependencies for the target host; the tarball carries fork-built copies of the
internal `highlight`, `protocol`, `client`, `relay`, `plugin`, and `server` workspaces.

Build it with:

```bash
npm run build:fork-daemon-package
```

Package verification is a separate, explicit operation. It is not part of a release.

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
the same distribution. It never resolves `paseo` from `PATH`. The daemon advertises the exact
distribution version so fork clients can distinguish revisions built on the same official base. An
official installation without a manifest keeps using `@getpaseo/cli@latest`.

Self-update restarts the worker through its existing supervisor. The replacement worker inherits
the supervisor's startup environment and loads code from the updated package path. The supervisor
process itself remains in memory; a release that changes supervisor behavior still requires one
full external daemon restart or a host reboot after the package update.

Run the `Fork Daemon Release` workflow to build and attach the stable `paseo-fork.tgz` asset to a
fork release.
