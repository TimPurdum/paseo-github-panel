# Paseo GitHub Panel

A read-only Paseo workspace panel for the GitHub repository and branch checked out in the current workspace. It shows the branch pull request, checks, review state, linked issue, and the repository's open issues and pull requests without sending credentials to the client.

## Requirements

- Paseo 0.8.0-beta.1 or later
- `git` on the Paseo daemon host
- GitHub CLI (`gh`) installed and authenticated on the Paseo daemon host

Run `gh auth login` on the daemon machine if the panel reports an authentication error.

## Development

```sh
npm install
npm test
npm run typecheck
paseo plugin install .
paseo plugin reload paseo-github-panel
```

The panel is read-only. Opening an issue or pull request delegates to github.com. The daemon only proxies body images from `github.com` and subdomains of `githubusercontent.com`.

## License

MIT. Portions are adapted from Gustavo Ambrozio's `github-board` plugin; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
