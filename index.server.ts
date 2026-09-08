import type { PluginServerContext } from "@getpaseo/plugin/server";

import { loadImageRpc, loadPanelRpc } from "./shared/contract";
import { loadPanel } from "./server/github";
import { loadImage } from "./server/image-proxy";

export default function contribute(server: PluginServerContext) {
  server.handle(loadPanelRpc, (input) => loadPanel(input));
  server.handle(loadImageRpc, (input) => loadImage(input));
  return () => undefined;
}
