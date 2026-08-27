# Changelog

## 0.3.1

- Add the native sessions tree, read-only virtual workspace, and native terminal bridge.
- Add multi-host, end-to-end encrypted relay connections from Paseo pairing links.
- Keep `paseo-fs` resource labels URI-style on Windows instead of rendering them with backslashes.
- Register **Paseo Daemon** as a VS Code terminal profile for virtual workspaces.
- Use the daemon workspace's actual absolute path as the `paseo-fs` URI root; obsolete synthetic
  workspace-name URIs must be reopened.
- Open virtual folders as single-folder workspaces so Explorer starts directly at their contents,
  and show the connected host in the remote-style status item.
- Keep the extension active on obsolete prototype URIs so it can offer an explicit reopen action
  instead of failing during activation.
- Preserve case-sensitive daemon IDs in the URI query instead of the hostname-normalized authority.
- Move Sessions out of the file Explorer into a dedicated Paseo Activity Bar container.
- Add focused conversation Webviews that reuse Paseo's registered agent and provider-subagent
  panels without embedding the app's workspace chrome or tab list.
- Bridge embedded file links to native `paseo-fs` editors and agent/subagent navigation to separate
  VS Code editor tabs.
