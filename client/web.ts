import { Linking, Platform } from "react-native";

interface BrowserWindow {
  open(url: string, target: string, features: string): unknown;
}

declare const window: BrowserWindow;

/** Opens a GitHub URL outside the panel without requiring DOM types in the bundle. */
export async function openExternal(url: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    await Linking.openURL(url);
  } catch (error: unknown) {
    console.warn("[paseo-github-panel] could not open external URL", error);
  }
}
