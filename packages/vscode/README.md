# Paseo Fork for VS Code

This is a VS Code client for a running Paseo daemon. Workspace integration is native; conversation
editors embed a focused build of Paseo's existing app panel so they retain the same behavior and
style without nesting Paseo's tab list or workspace shell inside VS Code.

The current milestone includes:

- a native Sessions tree in a dedicated **Paseo** Activity Bar container;
- agent and provider-subagent conversation editors backed by Paseo's real panel registry, including
  its timeline, Markdown/formula rendering, retry, resume, permissions, send/steer, and stop UI;
- a read-only `paseo-fs://` virtual workspace backed by the daemon;
- Paseo terminal sessions opened as native VS Code terminals.

For remote hosts, run **Paseo: Add Relay Host from Pairing Link** and paste the link shown by the
Paseo host settings. The extension stores the relay endpoint, host id, and daemon public key by
host id, then uses Paseo's end-to-end encrypted relay transport. Multiple hosts may be saved.

For direct connections, the extension discovers the daemon from `paseo.endpoint`,
`PASEO_VSCODE_ENDPOINT`, `~/.paseo/config.json`, or `127.0.0.1:6767`, in that order. Direct daemon
passwords are stored in VS Code SecretStorage.

Run **Paseo: Open Workspace** to choose a saved relay host or the direct/local connection.
The extension opens the virtual folder directly as a single-folder workspace, so Explorer displays
the remote directory's contents without an extra project root node. Its URI uses the daemon's
actual absolute workspace path, and the remote-style status item identifies the connected host.

`paseo-fs` is a virtual workspace, so a normal local terminal cannot use its URI path as a local
working directory. Use **Paseo: New Terminal**, the add button in **Paseo Sessions**, or select the
**Paseo Daemon** terminal profile. These create a daemon-backed pseudoterminal in the real remote
workspace directory.

An agent marked `closed` has no live provider runtime, but it is not deleted: open it to read its
saved history, choose **Resume Agent Session**, or send the next message to resume it automatically.
Archived agents remain outside the active Sessions tree. File writes are still deferred to a later
milestone.

Build a locally installable package from the repository root:

```sh
npm run package:vscode
```

The result is `artifacts/vscode/paseo-fork.vsix`.
