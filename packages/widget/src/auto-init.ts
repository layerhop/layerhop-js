import {
  COLOR_OPTIONS,
  mount,
  type MountOptions,
  type WidgetDensity,
  type WidgetFont,
  type WidgetHandle,
  type WidgetMessage,
  type WidgetPreset,
  type WidgetShadow,
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

function list(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Boolean options, read as flags (`data-lock-amount`, `data-show-usd="0"`, …). */
const FLAG_OPTIONS = [
  "lockSrc", "lockDst", "lockAmount", "lockRecipient", "hideHistory", "hideHeader", "hideRoutes", "hideSettings", "hidePoweredBy",
  "gasOnArrival", "showUsd", "border", "autoResize", "liveUpdates",
] as const;

/** Plain string options. */
const STRING_OPTIONS = [
  "srcChain", "srcToken", "dstChain", "dstToken", "amount", "recipient", "accent", "integrator", "baseUrl",
  "headerTitle", "logo", "buttonLabel", "allowParentOrigin", ...(Object.keys(COLOR_OPTIONS) as (keyof typeof COLOR_OPTIONS)[]),
] as const;

/**
 * Read mount options from `data-*` attributes:
 * every option as its kebab-case name (`srcChain` → `data-src-chain`, `borderColor` →
 * `data-border-color`). Lists (`data-from-chains`, `data-to-tokens`, …) are comma-separated.
 * Flags are on when the attribute is empty, `1`, `true` or `yes`; `"0"` turns them off.
 */
export function optionsFromDataset(el: HTMLElement): MountOptions {
  const d = el.dataset;
  const o: MountOptions = {};
  const out = o as Record<string, unknown>;
  for (const k of STRING_OPTIONS) if (d[k]) out[k] = d[k];
  for (const k of FLAG_OPTIONS) {
    const v = flag(d[k]);
    if (v !== undefined) out[k] = v;
  }
  for (const k of ["slippageBps", "radius", "radiusInner", "width", "height"] as const) {
    const v = int(d[k]);
    if (v !== undefined) out[k] = v;
  }
  for (const k of ["fromChains", "toChains", "excludeChains", "fromTokens", "toTokens"] as const) {
    const v = list(d[k]);
    if (v) out[k] = v;
  }
  if (d.theme) o.theme = d.theme as WidgetTheme;
  if (d.preset) o.preset = d.preset as WidgetPreset;
  if (d.font) o.font = d.font as WidgetFont;
  if (d.density) o.density = d.density as WidgetDensity;
  if (d.shadow) o.shadow = d.shadow as WidgetShadow;
  if (d.locale) o.locale = d.locale as "en";
  if (d.fontScale) o.fontScale = Number(d.fontScale);
  if (d.maxWidth) o.maxWidth = /^\d+$/.test(d.maxWidth) ? Number(d.maxWidth) : d.maxWidth;
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
