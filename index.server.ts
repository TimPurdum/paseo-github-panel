import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  loadImageRpc,
  loadCommentsRpc,
  loadPanelRpc,
  mergePullRequestRpc,
  openInVSCodeRpc,
} from "./shared/contract";
import { loadComments, loadPanel, mergePullRequest, openInVSCode } from "./server/github";
import { loadImage } from "./server/image-proxy";

export default function contribute(server: PluginServerContext) {
  server.handle(loadPanelRpc, (input) => loadPanel(input));
  server.handle(loadImageRpc, (input) => loadImage(input));
  server.handle(mergePullRequestRpc, (input) => mergePullRequest(input));
  server.handle(openInVSCodeRpc, (input) => openInVSCode(input));
  server.handle(loadCommentsRpc, (input) => loadComments(input));
  return () => undefined;
}
