# Fork daemon distribution

The fork ships its CLI and daemon as one npm-compatible tarball attached to GitHub Releases. It is
not published to the npm registry. npm remains the installer because it can select and install
third-party native dependencies for the target operating system.

## Artifact

Build the complete package, including the daemon-hosted Web UI:

```bash
npm run build:fork-daemon-package
```

The result is `artifacts/fork-daemon/paseo-fork.tgz`. Its package identity is
`@hamiltonhuaji/paseo-fork`, while its global executable remains `paseo`.

The distribution package contains the CLI payload at its root and real, fork-built copies of these
internal workspaces under its own `node_modules/@getpaseo/`:

- `client`
- `highlight`
- `protocol`
- `relay`
- `server`

Do not replace these copies with workspace symlinks. `npm pack` follows bundled workspace symlinks
and can capture hoisted dependencies through paths outside the package root. The packaging script
instead asks npm for each workspace's publish file list and copies those files into a staging tree.

Third-party dependencies are the merged dependency set of the CLI and bundled workspaces. They are
ordinary dependencies of the outer package, so npm installs platform-specific packages such as
`node-pty` on the target machine. Conflicting ranges fail the build instead of silently selecting
one. The staged internal package manifests omit their original `dependencies` fields because the
outer package owns that complete dependency set. Without that rewrite, npm treats missing
transitive files below a manually bundled package as already bundled and can leave empty dependency
directories instead of fetching them.

## Isolation from official Paseo

Every bundled internal package carries a generated `paseoDistribution` marker. The generated
`paseo-distribution.json` records the fork version, upstream daemon baseline, install URL, and exact
internal package versions. The `paseo` bootstrap verifies before loading the CLI that every internal
package:

1. exists below the fork package root;
2. resolves to a real path below that root rather than an external symlink;
3. carries the matching fork distribution marker and expected version.

Failure is fatal. The bootstrap must never fall through to an official package installed elsewhere
in the same global npm prefix.

The source workspaces keep their `@getpaseo/*` names. Only the staged copies are marked, so this
packaging strategy does not create import-renaming conflicts during an upstream rebase.

## Installation and switching

Install the latest published GitHub Release asset:

```bash
npm install -g https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz
```

npm refuses a normal install with `EEXIST` when an existing global package already owns the `paseo`
bin. The clean switch is:

```bash
paseo daemon stop
npm uninstall -g @getpaseo/cli
npm install -g https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz
paseo daemon start
```

Using `--force` lets both packages remain installed and gives the fork the shared bin, but later
updates or uninstalls can disturb that bin. It is supported by the isolation guard for testing, not
recommended as the normal switch procedure.

Both distributions use `~/.paseo`; switching packages does not delete daemon identity, settings, or
stored sessions. Installing a new CLI does not replace an already-running daemon process, so the
daemon must be restarted to run the newly installed code.

## Self-update

Official installs continue to inspect and install `@getpaseo/cli@latest`. A bundled fork discovers
`paseo-distribution.json`, inspects `@hamiltonhuaji/paseo-fork`, validates that the running server is
inside that exact global package, and installs:

```text
https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz
```

The outer distribution version is `<upstream>-fork.<revision>`, while the daemon continues to report
the upstream baseline for client compatibility comparisons.

## GitHub Actions

Run the `Fork Daemon Release` workflow with an existing release tag and `checkout_ref=overlay`. It:

1. installs repository dependencies with Node 22;
2. builds the server, CLI, and daemon Web UI;
3. packs the single tarball;
4. installs it into a temporary global npm prefix containing deliberately conflicting official
   package fixtures and runs `paseo --version`;
5. uploads the stable asset name `paseo-fork.tgz` to the selected GitHub Release.

Use `publish=false` to keep the result as a short-lived workflow artifact without changing a
release.
