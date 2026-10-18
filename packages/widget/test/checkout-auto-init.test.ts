import { afterEach, describe, expect, it, vi } from "vitest";
import { closeCheckout } from "../src/checkout";
import { autoInitCheckout, checkoutOptionsFromElement, resetCheckoutAutoInit } from "../src/checkout-auto-init";
import { post } from "./helpers";

const SID = "cs_test_01jabc123";
const flush = () => new Promise((r) => setTimeout(r, 0));
const html = (s: string) => {
  document.body.innerHTML = s;
};

afterEach(() => {
  closeCheckout();
  resetCheckoutAutoInit();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("checkoutOptionsFromElement", () => {
  it("reads product, reference, metadata, urls and mode", () => {
    html(`<button data-layerhop-product="prod_test_abc1" data-layerhop-reference="order_9" data-layerhop-metadata='{"plan":"pro","seats":3}'
      data-layerhop-metadata-Region="eu" data-layerhop-base-url="http://localhost:3110" data-layerhop-mode="INLINE"></button>`);
    expect(checkoutOptionsFromElement(document.querySelector("button")!, { apiUrl: "https://api.example.com" })).toEqual({
      mode: "inline",
      options: {
        productId: "prod_test_abc1",
        reference: "order_9",
        metadata: { plan: "pro", seats: "3", region: "eu" },
        baseUrl: "http://localhost:3110",
        apiUrl: "https://api.example.com",
      },
    });
  });

  it("defaults to the modal, reads sessions, rejects bad metadata JSON", () => {
    html(`<a data-layerhop-session="${SID}"></a><a data-layerhop-product="prod_test_abc1" data-layerhop-metadata="[1]"></a>`);
    const [a, b] = Array.from(document.querySelectorAll("a"));
    expect(checkoutOptionsFromElement(a!)).toEqual({ mode: "modal", options: { sessionId: SID } });
    expect(() => checkoutOptionsFromElement(b!)).toThrow(/JSON object/);
  });
});

describe("autoInitCheckout", () => {
  it("labels empty buttons and leaves custom content alone", () => {
    html(`<button id="a" data-layerhop-product="prod_test_abc1"></button><button id="b" data-layerhop-product="prod_test_abc1"><img alt="Buy"></button>
      <button id="c" data-layerhop-session="${SID}">Buy now</button>`);
    autoInitCheckout();
    expect(document.getElementById("a")!.textContent).toBe("Pay with crypto");
    expect(document.getElementById("b")!.textContent).toBe("");
    expect(document.getElementById("c")!.textContent).toBe("Buy now");
  });

  it("opens the modal on click (also for buttons added later) and dispatches DOM events", async () => {
    autoInitCheckout(document, { baseUrl: "http://localhost:3110" });
    html(`<form><a href="https://layerhop.com/buy/x" data-layerhop-session="${SID}"><span id="inner">Pay</span></a></form>`);
    const link = document.querySelector("a")!;
    const events: [string, unknown][] = [];
    for (const t of ["ready", "paid", "close", "cancel"]) document.addEventListener(`layerhop:${t}`, (e) => events.push([t, (e as CustomEvent).detail]));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    document.getElementById("inner")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await flush();
    const iframe = document.querySelector<HTMLIFrameElement>("[data-layerhop-checkout] iframe")!;
    expect(iframe.src).toContain(`http://localhost:3110/pay/${SID}?embed=modal`);
    const origin = "http://localhost:3110";
    post(iframe, { source: "layerhop-checkout", version: 1, type: "ready", sessionId: SID }, { origin });
    post(iframe, { source: "layerhop-checkout", version: 1, type: "paid", sessionId: SID, session: { id: SID, status: "paid" } }, { origin });
    post(iframe, { source: "layerhop-checkout", version: 1, type: "cancel", sessionId: SID }, { origin });
    expect(events).toEqual([
      ["ready", { sessionId: SID }],
      ["paid", { sessionId: SID, session: { id: SID, status: "paid" } }],
      ["cancel", { sessionId: SID }],
      ["close", { sessionId: SID }],
    ]);
    expect(link.isConnected).toBe(true);
  });

  it("ignores modified clicks and disabled buttons", () => {
    autoInitCheckout();
    html(`<button disabled data-layerhop-session="${SID}">Pay</button><button id="ok" data-layerhop-session="${SID}">Pay</button>`);
    document.querySelector<HTMLButtonElement>("button[disabled]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("ok")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    expect(document.querySelector("[data-layerhop-checkout]")).toBeNull();
  });

  it("mounts inline checkouts once, starting product sessions", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: SID }), { status: 201 }));
    vi.stubGlobal("fetch", fetchFn);
    html(`<div id="pay" data-layerhop-product="prod_test_abc1" data-layerhop-mode="inline" data-layerhop-reference="r1"></div>`);
    const handles = autoInitCheckout();
    expect(autoInitCheckout()).toHaveLength(0);
    expect(handles).toHaveLength(1);
    await handles[0]!.sessionId;
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#pay iframe")?.getAttribute("src")).toContain(`/pay/${SID}?embed=1`);
    // A click inside an inline checkout never opens a modal.
    document.getElementById("pay")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector("[data-layerhop-checkout]")).toBeNull();
  });

  it("reports invalid elements as layerhop:error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    html(`<div data-layerhop-product="prod_test_abc1" data-layerhop-mode="inline" data-layerhop-metadata="{nope"></div>`);
    const onError = vi.fn();
    document.addEventListener("layerhop:error", onError, { once: true });
    autoInitCheckout();
    expect(onError).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
