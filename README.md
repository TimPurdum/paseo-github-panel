# Paseo GitHub Panel

A read-only-except-merge Paseo workspace panel for the GitHub repository and branch checked out in the current workspace. It shows the branch pull request, checks, review state, linked issue, comment conversations, and the repository's open issues and pull requests without sending credentials to the client.

## Requirements

- Paseo 0.8.0-beta.1 or later
- `git` on the Paseo daemon host
- GitHub CLI (`gh`) installed and authenticated on the Paseo daemon host
- The VS Code CLI (`code`) on the Paseo daemon host, for the **VS Code** button
- The [`paseo-github-focus`](vscode/README.md) VS Code helper extension on that host, to focus the GitHub Pull Requests view

Run `gh auth login` on the daemon machine if the panel reports an authentication error. In VS Code, run **Shell Command: Install 'code' command in PATH** on that machine if the button reports a missing executable.

## Development

```sh
npm install
npm test
npm run typecheck
paseo plugin install .
paseo plugin reload paseo-github-panel
```

The panel is read-only except for two host actions. Merging a pull request runs `gh pr merge --merge` behind a two-tap confirmation. The **VS Code** button runs `code --reuse-window <workspace>` on the daemon host to open the workspace, then `code --open-url vscode://dymaptic.paseo-github-focus/focus` to focus the GitHub Pull Requests sidebar through the helper extension. VS Code has no command-line switch for a contributed view, so without the helper the button still opens the workspace but cannot focus the sidebar; VS Code asks once to allow the helper to open that URI. Opening an issue or pull request delegates to github.com. The daemon only proxies body images from `github.com` and subdomains of `githubusercontent.com`.

## License

MIT. Portions are adapted from Gustavo Ambrozio's `github-board` plugin; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
