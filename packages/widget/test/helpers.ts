export function post(
  iframe: HTMLIFrameElement,
  data: unknown,
  opts: { origin?: string; source?: Window | null } = {},
): void {
  const source = opts.source === undefined ? iframe.contentWindow : opts.source;
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: opts.origin ?? "https://layerhop.com",
      source: source as MessageEventSource | null,
    }),
  );
}
