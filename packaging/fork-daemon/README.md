# Paseo fork daemon

This package bundles the HamiltonHuaji Paseo fork CLI and daemon into one globally installable npm
package. The executable remains `paseo` and uses the normal Paseo data directory.

Install the GitHub Release asset with:

```bash
npm install -g --force https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz
```

The package verifies its bundled `@getpaseo/*` workspaces before starting. It does not load an
official package from elsewhere in the global npm prefix.
