import { LayerHop, type LayerHopOptions } from "@layerhop/sdk";
import { QueryClient, QueryClientContext, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { LayerHopClient } from "./client.js";

const LayerHopContext = createContext<LayerHopClient | null>(null);

export interface LayerHopProviderProps {
  /** A ready client (`new LayerHop({...})` or anything implementing `LayerHopClient`). Wins over `options`. */
  client?: LayerHopClient;
  /** Options for a client the provider creates for you. Ignored when `client` is set. */
  options?: LayerHopOptions;
  /**
   * React Query client. When omitted, an existing `<QueryClientProvider>` above is reused, or the
   * provider creates its own.
   */
  queryClient?: QueryClient;
  children?: ReactNode;
}

/** Makes a LayerHop client available to every `use*` hook below it. */
export function LayerHopProvider({ client, options, queryClient, children }: LayerHopProviderProps) {
  const optionsKey = JSON.stringify(options ?? {}, (_k, v: unknown) => (typeof v === "function" ? "[fn]" : v));
  const value = useMemo<LayerHopClient>(() => client ?? new LayerHop(options), [client, optionsKey]);
  const outer = useContext(QueryClientContext);
  const [own] = useState(() => (queryClient || outer ? null : new QueryClient()));
  const inner = <LayerHopContext.Provider value={value}>{children}</LayerHopContext.Provider>;
  const qc = queryClient ?? (outer ? null : own);
  return qc ? <QueryClientProvider client={qc}>{inner}</QueryClientProvider> : inner;
}

/** The client from the nearest `<LayerHopProvider>`. */
export function useLayerHop(): LayerHopClient {
  const c = useContext(LayerHopContext);
  if (!c) throw new Error("useLayerHop: wrap your component tree in <LayerHopProvider>");
  return c;
}
