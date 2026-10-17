/** `layerhop init` templates, embedded so the CLI works from a single file. `{{name}}` is replaced. */

export type TemplateName = "node" | "next";
export const TEMPLATE_NAMES: readonly TemplateName[] = ["node", "next"];

const SDK_VERSION = "^0.1.0";

const ENV_EXAMPLE = `# Optional. Defaults to https://api.layerhop.com
LAYERHOP_API_URL=
# Optional partner / project key
LAYERHOP_API_KEY=
`;

const GITIGNORE = `node_modules/
.next/
.env
.env.local
`;

const SAFETY = `LayerHop is non-custodial: the SDK returns transactions for *your* wallet to sign. It never
holds keys, and nothing in this project sends a transaction on its own. Amounts are integer
strings in base units (100 USDC = "100000000").`;

const node: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "{{name}}",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: { start: "node --env-file-if-exists=.env index.mjs" },
      dependencies: { "@layerhop/sdk": SDK_VERSION },
      engines: { node: ">=20" },
    },
    null,
    2,
  ) + "\n",
  "index.mjs": `import { LayerHop } from "@layerhop/sdk";

const lh = new LayerHop({
  baseUrl: process.env.LAYERHOP_API_URL || undefined, // e.g. http://localhost:8787 with \`layerhop devnet\`
  apiKey: process.env.LAYERHOP_API_KEY || undefined,
});

// 100 USDC on Base -> SOL on Solana. Amounts are integer strings in base units.
const sender = process.env.SENDER ?? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const recipient = process.env.RECIPIENT ?? "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const { best, quotes, errors } = await lh.quote({
  srcChain: "base",
  srcToken: "USDC",
  amount: "100000000",
  dstChain: "solana",
  dstToken: "SOL",
  sender,
  recipient,
});

console.log(\`\${quotes.length} quote(s); best: \${best.provider} -> \${best.dstAmount} lamports in ~\${best.estimatedSeconds}s\`);
for (const e of errors) console.log(\`  \${e.provider} failed: \${e.code}\`);

// The transaction for the user's wallet. Sign + send it with your wallet library (viem, ethers,
// @solana/web3.js ...), send tx.approval first when present, then track the order:
//
//   const hash = await walletClient.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) });
//   await lh.reportSubmitted?.(best.quoteId, hash);
//   for await (const s of lh.watch(best.provider, hash)) console.log(s.state);
const tx = await lh.buildTx(best.quoteId);
console.log("Transaction to sign:", tx);
`,
  ".env.example": ENV_EXAMPLE,
  ".gitignore": GITIGNORE,
  "README.md": `# {{name}}

A minimal Node script using [\`@layerhop/sdk\`](https://docs.layerhop.com/sdk): quote a cross-chain swap
and build the transaction.

\`\`\`bash
npm install
cp .env.example .env   # optional
npm start
\`\`\`

${SAFETY}
`,
};

const next: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "{{name}}",
      version: "0.1.0",
      private: true,
      scripts: { dev: "next dev", build: "next build", start: "next start" },
      dependencies: { "@layerhop/sdk": SDK_VERSION, next: "^15.1.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      devDependencies: { "@types/node": "^22.10.2", "@types/react": "^19.0.7", typescript: "^5.7.2" },
    },
    null,
    2,
  ) + "\n",
  "next.config.mjs": `/** @type {import('next').NextConfig} */
export default {};
`,
  "tsconfig.json": JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["dom", "dom.iterable", "esnext"],
        strict: true,
        noEmit: true,
        module: "esnext",
        moduleResolution: "bundler",
        jsx: "preserve",
        isolatedModules: true,
        esModuleInterop: true,
        skipLibCheck: true,
        incremental: true,
        plugins: [{ name: "next" }],
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    },
    null,
    2,
  ) + "\n",
  "app/layout.tsx": `export const metadata = { title: "{{name}}" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", maxWidth: 640, margin: "40px auto", padding: "0 16px" }}>{children}</body>
    </html>
  );
}
`,
  "app/api/quote/route.ts": `import { LayerHop, LayerHopApiError } from "@layerhop/sdk";

// Server-side, so LAYERHOP_API_KEY never reaches the browser.
const lh = new LayerHop({
  baseUrl: process.env.LAYERHOP_API_URL || undefined,
  apiKey: process.env.LAYERHOP_API_KEY || undefined,
});

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const r = await lh.quote({
      srcChain: q.get("srcChain") ?? "base",
      srcToken: q.get("srcToken") ?? "USDC",
      amount: q.get("amount") ?? "100000000", // base units
      dstChain: q.get("dstChain") ?? "solana",
      dstToken: q.get("dstToken") ?? "SOL",
      sender: q.get("sender") ?? "",
      recipient: q.get("recipient") ?? "",
    });
    return Response.json(r);
  } catch (e) {
    if (e instanceof LayerHopApiError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    throw e;
  }
}
`,
  "app/page.tsx": `"use client";

import { useState } from "react";

type Quote = { provider: string; dstAmount: string; estimatedSeconds: number; quoteId: string };

export default function Page() {
  const [sender, setSender] = useState("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  const [recipient, setRecipient] = useState("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState("");

  async function getQuote() {
    setError("");
    const qs = new URLSearchParams({ amount: "100000000", sender, recipient });
    const r = await fetch(\`/api/quote?\${qs}\`).then((res) => res.json());
    if (r.error) setError(\`\${r.error.code}: \${r.error.message}\`);
    else setQuotes(r.quotes);
  }

  return (
    <main>
      <h1>100 USDC on Base → SOL</h1>
      <p><label>Sender <input value={sender} onChange={(e) => setSender(e.target.value)} size={46} /></label></p>
      <p><label>Recipient <input value={recipient} onChange={(e) => setRecipient(e.target.value)} size={46} /></label></p>
      <button onClick={getQuote}>Get quotes</button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <ul>
        {quotes.map((q) => (
          <li key={q.quoteId}>{q.provider}: {q.dstAmount} lamports, ~{q.estimatedSeconds}s</li>
        ))}
      </ul>
      <p>
        Next: call <code>buildTx(quoteId)</code> and sign the result with your wallet library (wagmi/viem,
        Solana wallet adapter), or use <code>@layerhop/react</code>&apos;s <code>useSwap</code>.
      </p>
    </main>
  );
}
`,
  ".env.example": ENV_EXAMPLE,
  ".gitignore": GITIGNORE + "next-env.d.ts\n",
  "README.md": `# {{name}}

A minimal Next.js (App Router) app using [\`@layerhop/sdk\`](https://docs.layerhop.com/sdk). Quotes are
fetched server-side in \`app/api/quote/route.ts\`, so your API key stays on the server.

\`\`\`bash
npm install
cp .env.example .env.local   # optional
npm run dev
\`\`\`

${SAFETY}
`,
};

export const TEMPLATES: Record<TemplateName, Record<string, string>> = { node, next };

/** Files for a template with `{{name}}` filled in. Paths use `/`. */
export function renderTemplate(name: TemplateName, projectName: string): Record<string, string> {
  const files = TEMPLATES[name];
  return Object.fromEntries(Object.entries(files).map(([p, c]) => [p, c.replaceAll("{{name}}", projectName)]));
}

/** npm-safe package name from a directory name. */
export function packageNameFrom(dir: string): string {
  const base = dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "layerhop-app";
  const n = base.toLowerCase().replace(/[^a-z0-9-._~]/g, "-").replace(/^[-._]+/, "");
  return n || "layerhop-app";
}
