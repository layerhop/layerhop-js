import {
  mount,
  type MountOptions,
  type WidgetHandle,
  type WidgetMessage,
  type WidgetTheme,
} from "./core";

/** Attribute that marks an element for auto-init: `<div data-layerhop-widget ...></div>`. */
export const AUTO_INIT_ATTRIBUTE = "data-layerhop-widget";
const MOUNTED_ATTRIBUTE = "data-layerhop-mounted";

const handles = new WeakMap<Element, WidgetHandle>();

function flag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  return v === "" || v === "1" || v === "true" || v === "yes";
}

function int(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return Number(value.trim());
}

/**
 * Read mount options from `data-*` attributes:
 * data-src-chain, data-src-token, data-dst-chain, data-dst-token, data-amount, data-recipient,
 * data-slippage-bps, data-theme, data-accent, data-radius, data-lock-src, data-lock-dst,
 * data-hide-history, data-integrator, data-base-url, data-height, data-max-width, data-auto-resize.
 */
export function optionsFromDataset(el: HTMLElement): MountOptions {
  const d = el.dataset;
  const o: MountOptions = {};
  if (d.srcChain) o.srcChain = d.srcChain;
  if (d.srcToken) o.srcToken = d.srcToken;
  if (d.dstChain) o.dstChain = d.dstChain;
  if (d.dstToken) o.dstToken = d.dstToken;
  if (d.amount) o.amount = d.amount;
  if (d.recipient) o.recipient = d.recipient;
  const slippage = int(d.slippageBps);
  if (slippage !== undefined) o.slippageBps = slippage;
  if (d.theme) o.theme = d.theme as WidgetTheme;
  if (d.accent) o.accent = d.accent;
  const radius = int(d.radius);
  if (radius !== undefined) o.radius = radius;
  const lockSrc = flag(d.lockSrc);
  if (lockSrc !== undefined) o.lockSrc = lockSrc;
  const lockDst = flag(d.lockDst);
  if (lockDst !== undefined) o.lockDst = lockDst;
  const hideHistory = flag(d.hideHistory);
  if (hideHistory !== undefined) o.hideHistory = hideHistory;
  if (d.integrator) o.integrator = d.integrator;
  if (d.baseUrl) o.baseUrl = d.baseUrl;
  const height = int(d.height);
  if (height !== undefined) o.height = height;
  if (d.maxWidth) o.maxWidth = /^\d+$/.test(d.maxWidth) ? Number(d.maxWidth) : d.maxWidth;
  const autoResize = flag(d.autoResize);
  if (autoResize !== undefined) o.autoResize = autoResize;
  return o;
}

/**
 * Mount a widget into every `[data-layerhop-widget]` element under `root` that is not mounted yet.
 * Each widget re-dispatches its events on the host element as DOM CustomEvents named
 * `layerhop:<type>` (e.g. `layerhop:quote`) with the payload in `event.detail`.
 * Invalid attributes are reported via console.error and that element is skipped.
 */
export function autoInit(root: ParentNode = document): WidgetHandle[] {
  const mounted: WidgetHandle[] = [];
  root.querySelectorAll<HTMLElement>(`[${AUTO_INIT_ATTRIBUTE}]`).forEach((el) => {
    if (el.hasAttribute(MOUNTED_ATTRIBUTE)) return;
    try {
      const handle = mount(el, {
        ...optionsFromDataset(el),
        onEvent: (message: WidgetMessage) => {
          el.dispatchEvent(
            new CustomEvent(`layerhop:${message.type}`, { detail: message.payload, bubbles: true }),
          );
        },
      });
      el.setAttribute(MOUNTED_ATTRIBUTE, "");
      handles.set(el, handle);
      mounted.push(handle);
    } catch (err) {
      console.error("[LayerHop] widget auto-init failed:", err);
    }
  });
  return mounted;
}

/** The handle of a widget created by `autoInit`, if any. */
export function getWidget(el: Element): WidgetHandle | undefined {
  return handles.get(el);
}
