/**
 * Test doubles for the native modules. The real `react-native` and `react-native-webview` entry
 * points need the native runtime; these render plain DOM nodes and record WebView props.
 */
import type { ReactNode } from "react";
import { afterEach, vi } from "vitest";

export interface NativeMock {
  webViews: { props: Record<string, any> }[];
  urlListeners: Set<(e: { url: string }) => void>;
  appStateListeners: Set<(s: string) => void>;
  openURL: { fn: null | ((url: string) => Promise<void>) };
}

/** The shared mock state (also reachable from tests through `native()`). */
export const native = (): NativeMock => (globalThis as { __layerhopNativeMock?: NativeMock }).__layerhopNativeMock!;

const state = vi.hoisted(() => {
  const g = globalThis as { __layerhopNativeMock?: NativeMock };
  g.__layerhopNativeMock ??= {
    webViews: [],
    urlListeners: new Set(),
    appStateListeners: new Set(),
    openURL: { fn: null },
  };
  return g.__layerhopNativeMock;
});

vi.mock("react-native", () => {
  const View = ({ children, testID, accessibilityLabel }: { children?: ReactNode; testID?: string; accessibilityLabel?: string }) => (
    <div data-testid={testID} aria-label={accessibilityLabel}>
      {children}
    </div>
  );
  return {
    View,
    ActivityIndicator: () => <span data-testid="activity" />,
    Linking: {
      openURL: vi.fn((url: string) => (state.openURL.fn ? state.openURL.fn(url) : Promise.resolve())),
      addEventListener: (_: "url", cb: (e: { url: string }) => void) => {
        state.urlListeners.add(cb);
        return { remove: () => state.urlListeners.delete(cb) };
      },
    },
    AppState: {
      addEventListener: (_: "change", cb: (s: string) => void) => {
        state.appStateListeners.add(cb);
        return { remove: () => state.appStateListeners.delete(cb) };
      },
    },
  };
});

vi.mock("react-native-webview", () => {
  const WebView = (props: Record<string, any>) => {
    state.webViews.push({ props });
    return <div data-testid={props.testID} data-uri={props.source?.uri} />;
  };
  return { WebView, default: WebView };
});

afterEach(() => {
  state.webViews.length = 0;
  state.openURL.fn = null;
});
