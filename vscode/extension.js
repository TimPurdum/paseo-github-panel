const vscode = require("vscode");

const GITHUB_PULL_REQUESTS_VIEW = "workbench.view.extension.github-pull-requests";
const FOCUS_PATH = "/focus";

/**
 * VS Code has no command-line switch that focuses a contributed view, so the
 * Paseo GitHub panel opens this extension's URI instead. The URI arrives after
 * the workspace window exists, which is what lets the view command run.
 */
function activate(context) {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path !== FOCUS_PATH) return;
        return vscode.commands.executeCommand(GITHUB_PULL_REQUESTS_VIEW);
      },
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
