# Paseo GitHub Focus

A tiny VS Code helper extension for the Paseo GitHub panel. It registers one URI
handler that focuses the GitHub Pull Requests activity bar view:

```
vscode://dymaptic.paseo-github-focus/focus
```

VS Code has no command-line switch for focusing a contributed view, so the panel
opens this URI after it opens the workspace. Without the helper, the panel still
opens the workspace; it just cannot switch the activity bar to GitHub.

Requires the [GitHub Pull Requests and Issues](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github)
extension, which contributes the view.

## Build and install

```sh
cd vscode
npx @vscode/vsce package --no-dependencies
code --install-extension paseo-github-focus-0.1.0.vsix
```

Reload VS Code after installing. The first time the panel opens the URI, VS Code
asks once to allow the extension to open it; approve it and the focus works from
then on.

To remove it:

```sh
code --uninstall-extension dymaptic.paseo-github-focus
```
