# @hamiltonhuaji/paseo-fork

This is the single-package daemon and CLI distribution for HamiltonHuaji's Paseo fork.

Install the latest GitHub Release asset with npm:

```bash
npm install -g https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz
```

The installed command remains `paseo`. The package includes fork-built copies of Paseo's internal
server, client, protocol, relay, and highlighting packages. Third-party dependencies are installed
normally by npm for the target operating system.

The daemon continues to use `~/.paseo`, so switching from the official CLI does not create a
separate data directory.
