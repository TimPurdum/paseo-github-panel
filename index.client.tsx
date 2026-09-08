import type { PluginClientContext } from "@getpaseo/plugin/client";

import { GitHubPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  return client.addWorkspacePanel({
    id: "github",
    title: "GitHub",
    icon: "Github",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: GitHubPanel,
  });
}
