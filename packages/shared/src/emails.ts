/**
 * Transactional email bodies (invoices, receipts, monitoring alerts). Pure functions returning
 * subject + HTML + text, shared by the API and the worker; sending is done by each service.
 * HTML uses inline styles and tables only, so it renders in every mail client.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface MoneyLine {
  description: string;
  quantity: number;
  /** Formatted amount for the line, e.g. "49.00 USDC". */
  total: string;
}

/**
 * Subjects carry merchant-chosen text (merchant name, invoice total): collapse CR/LF and other
 * control characters so a value can never start a new header line, whatever the mail library does.
 */
export const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Base units → "49.00" (at least 2 decimals, trailing zeros trimmed beyond that). */
export function formatTokenAmount(amount: string, decimals: number): string {
  const v = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  const whole = (v / base).toString();
  let frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

function shell(title: string, body: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f6f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0e141c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d0d8e2;border-radius:14px">
<tr><td style="padding:28px 32px 8px;font-size:15px;font-weight:700;letter-spacing:-0.01em">LayerHop</td></tr>
<tr><td style="padding:8px 32px 4px;font-size:22px;font-weight:700;letter-spacing:-0.02em">${esc(title)}</td></tr>
<tr><td style="padding:8px 32px 28px;font-size:15px;line-height:1.55">${body}</td></tr>
</table>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#546070">${footer}</p>
</td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#0e141c;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${esc(label)}</a>`;

function linesTable(lines: MoneyLine[], total: string): string {
  const rows = lines
    .map((l) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e6ebf0">${esc(l.description)}${l.quantity !== 1 ? ` <span style="color:#546070">× ${l.quantity}</span>` : ""}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #e6ebf0;white-space:nowrap">${esc(l.total)}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;font-size:14px">${rows}<tr><td style="padding:10px 0;font-weight:700">Total</td><td align="right" style="padding:10px 0;font-weight:700;white-space:nowrap">${esc(total)}</td></tr></table>`;
}

const NONCUSTODIAL = "LayerHop is non-custodial: payments go straight from your wallet to the merchant. LayerHop never holds funds.";

export interface InvoiceEmailInput {
  merchant: string;
  number: string;
  customerName?: string | null;
  lines: MoneyLine[];
  total: string;
  /** e.g. "USDC on Base" */
  settlement: string;
  dueDate?: string | null;
  memo?: string | null;
  url: string;
  test?: boolean;
}

export function invoiceEmail(i: InvoiceEmailInput): EmailContent {
  const subject = oneLine(`${i.test ? "[TEST] " : ""}Invoice ${i.number} from ${i.merchant}: ${i.total}`);
  const due = i.dueDate ? `, due ${i.dueDate}` : "";
  const body = `<p style="margin:0">${i.customerName ? `Hi ${esc(i.customerName)},<br><br>` : ""}${esc(i.merchant)} sent you invoice <b>${esc(i.number)}</b> for <b>${esc(i.total)}</b>${esc(due)}.</p>
${linesTable(i.lines, i.total)}
${i.memo ? `<p style="margin:0 0 18px;color:#546070">${esc(i.memo)}</p>` : ""}
<p style="margin:0 0 22px">Pay with any token on any chain from your own wallet. ${esc(i.merchant)} receives ${esc(i.settlement)}.</p>
<p style="margin:0">${button(i.url, `Pay ${i.total}`)}</p>
${i.test ? `<p style="margin:18px 0 0;color:#a16207">Test invoice: paying it is simulated and moves no real funds.</p>` : ""}`;
  const text = [
    i.customerName ? `Hi ${i.customerName},` : "",
    `${i.merchant} sent you invoice ${i.number} for ${i.total}${due}.`,
    "",
    ...i.lines.map((l) => `- ${l.description}${l.quantity !== 1 ? ` x ${l.quantity}` : ""}: ${l.total}`),
    `Total: ${i.total}`,
    i.memo ? `\n${i.memo}` : "",
    "",
    `Pay with any token on any chain: ${i.url}`,
    i.test ? "\nTest invoice: paying it is simulated and moves no real funds." : "",
    "",
    NONCUSTODIAL,
  ].filter((l) => l !== "").join("\n");
  return { subject, html: shell(`Invoice ${i.number}`, body, `${NONCUSTODIAL} Questions about this invoice? Reply to ${esc(i.merchant)} directly.`), text };
}

export interface ReceiptEmailInput {
  merchant: string;
  number?: string | null;
  description?: string | null;
  total: string;
  settlement: string;
  paidAt: string;
  paidWith?: string | null;
  txHash?: string | null;
  receiptUrl?: string | null;
  test?: boolean;
}

export function receiptEmail(r: ReceiptEmailInput): EmailContent {
  const what = r.number ? `invoice ${r.number}` : r.description ?? "your payment";
  const subject = oneLine(`${r.test ? "[TEST] " : ""}Receipt from ${r.merchant}: ${r.total}`);
  const rows: [string, string][] = [
    ["Paid", r.total],
    ["Received as", r.settlement],
    ["Date", r.paidAt],
    ...(r.paidWith ? ([["Paid with", r.paidWith]] as [string, string][]) : []),
    ...(r.txHash ? ([["Transaction", r.txHash]] as [string, string][]) : []),
  ];
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;font-size:14px">${rows
    .map(([k, v]) => `<tr><td style="padding:7px 0;color:#546070;border-bottom:1px solid #e6ebf0">${esc(k)}</td><td align="right" style="padding:7px 0;border-bottom:1px solid #e6ebf0;word-break:break-all">${esc(v)}</td></tr>`)
    .join("")}</table>`;
  const body = `<p style="margin:0">Thanks! ${esc(r.merchant)} received your payment for ${esc(what)}.</p>${table}${r.receiptUrl ? `<p style="margin:0">${button(r.receiptUrl, "Download receipt (PDF)")}</p>` : ""}`;
  const text = [
    `Thanks! ${r.merchant} received your payment for ${what}.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    r.receiptUrl ? `\nReceipt (PDF): ${r.receiptUrl}` : "",
    "",
    NONCUSTODIAL,
  ].filter((l) => l !== "").join("\n");
  return { subject, html: shell("Payment received", body, NONCUSTODIAL), text };
}

export interface AlertEmailInput {
  component: string;
  state: "down" | "recovered";
  detail?: string | null;
  startedAt: string;
  resolvedAt?: string | null;
  statusUrl: string;
}

export function alertEmail(a: AlertEmailInput): EmailContent {
  const down = a.state === "down";
  const subject = oneLine(down ? `DOWN: ${a.component}` : `Recovered: ${a.component}`);
  const lines = [
    down ? `${a.component} is failing its health checks.` : `${a.component} is healthy again.`,
    `Started: ${a.startedAt}`,
    ...(a.resolvedAt ? [`Resolved: ${a.resolvedAt}`] : []),
    ...(a.detail ? [`Detail: ${a.detail}`] : []),
    `Status page: ${a.statusUrl}`,
  ];
  return {
    subject,
    text: lines.join("\n"),
    html: shell(subject, lines.map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`).join(""), "LayerHop monitoring"),
  };
}
