# Native VS Code client

`packages/vscode` is an additional Paseo client surface. It uses VS Code's native extension APIs
for workspace files, terminals, and the Sessions tree. A focused build of `packages/app` renders
the contents of each conversation editor in a Webview. This is not a code-server wrapper and does
not put Paseo's workspace shell or tab list inside VS Code.

## First milestone

The first installable VSIX deliberately implements only three independent slices:

1. **Sessions Tree and chat** — a `TreeDataProvider` contributes **Sessions** to a dedicated
   **Paseo** Activity Bar container, separate from the file Explorer. Active agent and terminal
   names with common slash-separated prefixes form a real multi-level tree. Agent leaves open a
   VS Code editor containing Paseo's real registered agent or provider-subagent panel. The focused
   route deliberately omits Paseo's workspace chrome and tab list, while retaining the same
   timeline, Markdown/KaTeX, composer, steer, permission, retry, and lifecycle behavior as the main
   client.
2. **Read-only workspace** — a `FileSystemProvider` exposes a daemon workspace as
   `paseo-fs://host/<remote-absolute-path>?serverId=<server-id>&workspaceId=<id>`. VS Code's built-in
   Explorer and text editors consume `listDirectory` and `readFile`; every mutating filesystem
   operation returns `NoPermissions`.
3. **Native terminal** — terminal leaves open as `Pseudoterminal`s. The extension asks the daemon
   for a visible snapshot plus scrollback, renders legacy snapshots to ANSI when necessary, and
   forwards input and resize events. Closing the VS Code terminal only unsubscribes; **Kill
   Terminal** explicitly kills the daemon terminal. The extension also contributes a **Paseo
   Daemon** terminal profile. In a `paseo-fs` workspace, VS Code's plain **New Terminal** action is
   redirected to that daemon-backed terminal because a local shell cannot use a remote path such as
   `/data/project` as its cwd. Terminals explicitly configured with a different local cwd remain
   local.

There is no daemon/protocol change in this milestone. On the wire the extension identifies as
`clientType: "cli"`, because released official daemons reject client-type enum values they do not
know. The VS Code extension remains a distinct client package and UI surface.

## Window and connection model

One VS Code window maps to one Paseo workspace/worktree. Run **Paseo: Open Workspace** to pick from
the daemon. The extension opens its virtual URI directly as a single-folder workspace, so Explorer
starts at the remote directory's contents instead of showing an extra root folder as `.code-workspace`
multi-root mode does. The URI uses the daemon's actual absolute workspace directory. If the current
window already has a folder, VS Code opens a new window; this avoids replacing a user's ordinary
local workspace. Prototype entries whose URI root was a synthetic workspace name are not mounted.
The extension stays active only long enough to show an explicit reopen action that creates the
current workspace form.

The `paseo-fs` authority is the fixed literal `host`. The daemon `serverId` lives in the query and
is compared exactly: URI authorities follow hostname rules and may be lowercased, while Paseo's
`srv_...` identifiers are case-sensitive. Do not move host identity back into the authority.

Relay is the normal remote-access path. Run **Paseo: Add Relay Host from Pairing Link** and paste
the URL exposed by the host settings page. The extension parses the canonical connection offer,
stores its relay endpoint, `serverId`, TLS choice, and daemon public key in extension global state,
and uses the same E2E-encrypted relay transport as the Paseo app. These fields are connection
capability data and should be handled like the original pairing link; the daemon private key never
leaves the host. Saved relay connections are keyed by `serverId`, so multiple hosts can coexist.
Reopening a `paseo-fs` workspace automatically selects the saved connection matching the
`serverId` in its URI.

An open Paseo workspace window is pinned to that URI's `serverId` for its lifetime. Choosing a
different host from **Paseo: Open Workspace** never retargets the window's Sessions tree, native
filesystem, terminals, or open conversation editors. The host/workspace picker uses a separate
short-lived daemon connection with its own client id, opens the chosen workspace in a new window,
and then disposes only that picker connection. Adding another relay pairing link likewise only
saves the host; it does not mutate the current window's connection. Primary client ids are unique
per extension/window connection instance and remain stable for reconnects within that instance, so
two VS Code windows on the same daemon do not accidentally share one logical client session.

Direct daemon discovery remains available in this order:

1. `paseo.endpoint`;
2. `PASEO_VSCODE_ENDPOINT`;
3. `daemon.listen` in `~/.paseo/config.json`;
4. `127.0.0.1:6767`.

Direct connections support TCP endpoints. A direct daemon password is validated over `/api/status`
and stored per endpoint in VS Code `SecretStorage`. Relay connections authenticate the daemon
cryptographically with the public key from the pairing offer and therefore do not use that
password. A virtual URI includes the daemon's `serverId` so the extension can resolve the matching
saved host connection.

The provider is intentionally read-only and has a no-op file watcher. Consequently an already-open
file is not automatically refreshed after another process changes it. Write RPCs, a daemon-backed
watch stream, and virtual-workspace language-tooling limitations belong to the later editing
milestone.

## Conversation editor boundary

The Expo route `/embedded-agent` mounts `WorkspacePaneContent`, which resolves the requested target
through the same panel registry used by the web, desktop, and mobile clients. The VS Code host does
not interpret or duplicate timeline entries. This keeps streaming, virtualization, Markdown,
formula rendering, permissions, steering, retries, and provider-subagent behavior on the existing
implementation path.

The host bridge has a deliberately small boundary:

- an initial host/workspace/target descriptor and relay or direct connection data;
- `openTarget` and `retargetEditor` for agent and provider-subagent navigation;
- `openFile`, which maps a workspace path to the native `paseo-fs` editor;
- `closeEditor` and an informational fallback for imports that require the full client.

Each workspace window owns exactly one physical daemon connection in the extension host. Its
conversation Webviews still instantiate normal `DaemonClient`s, but their transports are local
virtual ports multiplexed through that workspace connection. The extension host terminates relay
E2EE or direct-password authentication, handles each virtual hello and heartbeat locally, and
forwards application frames over the shared connection. Connection capabilities and passwords are
therefore not injected into Webviews. Native terminal binary output stays on the extension-host
path instead of being copied into every chat editor.

The Output panel reports this boundary as
`[vscode-transport] physicalConnections=N virtualPorts=M`. In a connected workspace, `N` should
remain `1` while opening additional conversation editors only increments `M`. The cross-host
workspace picker is the sole intentional temporary connection; it is closed immediately after the
workspace snapshot and daemon identity are fetched, before the user spends time in the picker.

`closed` is a runtime state, not deletion: there is no live provider process attached, but the
agent record, timeline, and provider persistence handle remain. **Resume Agent Session** calls
`refresh_agent_request`; sending from the editor uses the normal prompt RPC, whose daemon path
loads the agent before dispatch. `archivedAt`, rather than `status: closed`, is what removes an
agent from this active Sessions tree.

## Build and distribution

Build a local VSIX without starting or restarting a daemon:

```bash
npm run package:vscode
```

The stable output path is `artifacts/vscode/paseo-fork.vsix`. Install it with VS Code's **Extensions:
Install from VSIX...** command, or:

```bash
code --install-extension artifacts/vscode/paseo-fork.vsix
```

Packaging exports `packages/app` with `PASEO_WEB_PLATFORM=vscode`, copies the static output into
the VSIX, then bundles the native extension host. The generated `packages/vscode/webview-app`
directory is not committed. The host rewrites exported root-relative assets to VS Code Webview
resource URIs and injects a restrictive Content Security Policy plus the per-editor bootstrap.
The VS Code platform attachment store is a static IndexedDB import so Metro does not leave dynamic
chunks whose root-relative URLs cannot be served by a Webview. The packaging step rewrites Expo
asset registry entries to use the explicit Webview resource root injected by the host and fails if
a new root-relative JavaScript split point or unscoped asset URI appears.

Do not install the cross-origin Webview resource root as an HTML `<base>`. Expo Router uses the
History API after mount; a cross-origin base makes those relative navigation URLs resolve against
the resource origin and throws a `SecurityError`. HTML assets use explicit `asWebviewUri` values,
and bundled React Native assets read `window.__PASEO_VSCODE_RESOURCE_ROOT__` instead.

The `Fork VS Code Release` workflow builds the same stable asset. With `publish=true`, it attaches
the VSIX to the canonical fork release tag; with `publish=false`, it keeps a seven-day workflow
artifact. The packaged extension uses the same fork version as the release.
