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
install URL. Daemon self-update reads that manifest and updates the same distribution. An official
installation without a manifest keeps using `@getpaseo/cli@latest`.

Run the `Fork Daemon Release` workflow to build and attach the stable `paseo-fork.tgz` asset to a
fork release.
