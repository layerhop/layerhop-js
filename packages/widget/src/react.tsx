import { useEffect, useRef, type CSSProperties } from "react";
import { buildEmbedUrl, mount, type MountOptions, type WidgetHandle, type WidgetOptions } from "./core";

export type * from "./core";

export interface LayerHopWidgetProps extends MountOptions {
  /** Class name for the wrapping <div>. */
  className?: string;
  /** Inline style for the wrapping <div>. */
  style?: CSSProperties;
}

/**
 * React wrapper around `mount()`. URL options trigger an iframe reload only when the resulting
 * URL changes; callbacks can change freely without reloading. Changing `baseUrl`, `autoResize`,
 * `height`, `maxWidth` or `title` remounts the iframe.
 */
export function LayerHopWidget(props: LayerHopWidgetProps) {
  const {
    className,
    style,
    baseUrl,
    autoResize,
    height,
    maxWidth,
    title,
    onReady: _onReady,
    onQuote: _onQuote,
    onSubmitted: _onSubmitted,
    onStatus: _onStatus,
    onError: _onError,
    onResize: _onResize,
    onEvent: _onEvent,
    ...urlOptions
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<WidgetHandle | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const urlOptionsRef = useRef<WidgetOptions>(urlOptions);
  urlOptionsRef.current = urlOptions;

  // Stable key for URL options; also validates them during render (throws on invalid props).
  const src = buildEmbedUrl(urlOptions, baseUrl);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handle = mount(el, {
      ...urlOptionsRef.current,
      baseUrl,
      autoResize,
      height,
      maxWidth,
      title,
      onReady: (p) => propsRef.current.onReady?.(p),
      onQuote: (p) => propsRef.current.onQuote?.(p),
      onSubmitted: (p) => propsRef.current.onSubmitted?.(p),
      onStatus: (p) => propsRef.current.onStatus?.(p),
      onError: (p) => propsRef.current.onError?.(p),
      onResize: (p) => propsRef.current.onResize?.(p),
      onEvent: (m) => propsRef.current.onEvent?.(m),
    });
    handleRef.current = handle;
    return () => {
      handle.destroy();
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [baseUrl, autoResize, height, maxWidth, title]);

  useEffect(() => {
    // Replace (not merge) URL options so removed props are cleared too.
    const cleared: WidgetOptions = {
      srcChain: undefined, srcToken: undefined, dstChain: undefined, dstToken: undefined,
      amount: undefined, recipient: undefined, slippageBps: undefined, theme: undefined,
      accent: undefined, radius: undefined, lockSrc: undefined, lockDst: undefined,
      hideHistory: undefined, integrator: undefined,
    };
    handleRef.current?.update({ ...cleared, ...urlOptionsRef.current });
  }, [src]);

  return <div ref={containerRef} className={className} style={style} data-layerhop-widget-root="" />;
}

