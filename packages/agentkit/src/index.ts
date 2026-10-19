import { ActionProvider, type Action, type Network, type WalletProvider } from "@coinbase/agentkit";
import {
  createLayerHopTools,
  errorMessage,
  ERC20_ABI,
  executeEvmSwap,
  executeSvmSwap,
  zodV3Schemas,
  type EvmSigner,
  type ExecuteSwapResult,
  type LayerHopToolsOptions,
  type LayerHopToolset,
  type SvmSigner,
  type ToolName,
} from "@layerhop/ai";
import { z } from "zod/v3";

export const VERSION = "0.7.0";

export interface LayerHopActionProviderOptions extends Omit<LayerHopToolsOptions, "toolName" | "client"> {
  /**
   * Add `layerhop_execute_swap`, which signs and sends a confirmed quote with the AgentKit wallet
   * provider (your own key, per AgentKit's design). Default true. Set false for quote/prepare-only agents.
   */
  enableSwapExecution?: boolean;
}

const prefixed = (n: string) => `layerhop_${n}`;

/** The EvmWalletProvider methods the executor uses (duck-typed: works with every AgentKit EVM wallet provider). */
interface EvmWalletLike {
  getAddress(): string;
  getNetwork(): Network;
  sendTransaction(tx: { to: `0x${string}`; data: `0x${string}`; value: bigint }): Promise<`0x${string}`>;
  waitForTransactionReceipt(hash: `0x${string}`): Promise<unknown>;
  readContract?(p: { address: `0x${string}`; abi: typeof ERC20_ABI; functionName: "allowance"; args: readonly [`0x${string}`, `0x${string}`] }): Promise<unknown>;
}

/** The SvmWalletProvider methods the executor uses. Transactions are (de)serialized with @solana/web3.js. */
interface SvmWalletLike {
  getAddress(): string;
  getNetwork(): Network;
  signAndSendTransaction(tx: unknown): Promise<string>;
  signTransaction?(tx: unknown): Promise<{ serialize(): Uint8Array }>;
}

const isEvm = (w: WalletProvider): w is WalletProvider & EvmWalletLike =>
  w.getNetwork().protocolFamily === "evm" && typeof (w as Partial<EvmWalletLike>).sendTransaction === "function";
const isSvm = (w: WalletProvider): w is WalletProvider & SvmWalletLike =>
  w.getNetwork().protocolFamily === "svm" && typeof (w as Partial<SvmWalletLike>).signAndSendTransaction === "function";

function evmSigner(w: EvmWalletLike): EvmSigner {
  const chainId = Number(w.getNetwork().chainId);
  return {
    address: w.getAddress(),
    chainId: Number.isFinite(chainId) && chainId > 0 ? chainId : undefined,
    getAllowance: w.readContract
      ? async (token, owner, spender) => BigInt(String(await w.readContract!({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [owner, spender] })))
      : undefined,
    sendTransaction: (req) => w.sendTransaction({ to: req.to, data: req.data, value: BigInt(req.value) }),
    waitForReceipt: (hash) => w.waitForTransactionReceipt(hash as `0x${string}`),
  };
}

async function svmSigner(w: SvmWalletLike): Promise<SvmSigner> {
  let web3: typeof import("@solana/web3.js");
  try {
    web3 = await import("@solana/web3.js");
  } catch {
    throw new Error("Solana swaps need @solana/web3.js (a dependency of @coinbase/agentkit); install it next to @layerhop/agentkit.");
  }
  const decode = (b64: string) => web3.VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(b64, "base64")));
  return {
    address: w.getAddress(),
    signAndSendTransaction: (b64) => w.signAndSendTransaction(decode(b64)),
    signTransaction: w.signTransaction ? async (b64) => Buffer.from((await w.signTransaction!(decode(b64))).serialize()).toString("base64") : undefined,
  };
}

/**
 * Coinbase AgentKit action provider for LayerHop: best-price cross-chain / same-chain swap quotes,
 * unsigned transactions, simulation, tracking, tokens, prices, deposit addresses and checkout, plus
 * `layerhop_execute_swap`, which sends a user-confirmed quote with the AgentKit wallet provider.
 * The wallet provider signs with the developer's own key (AgentKit's model); LayerHop never sees keys.
 */
export class LayerHopActionProvider extends ActionProvider<WalletProvider> {
  readonly toolset: LayerHopToolset;
  private readonly enableSwapExecution: boolean;

  constructor(opts: LayerHopActionProviderOptions = {}) {
    super("layerhop", []);
    const { enableSwapExecution = true, ...rest } = opts;
    this.enableSwapExecution = enableSwapExecution;
    this.toolset = createLayerHopTools({ ...rest, toolName: prefixed });
  }

  supportsNetwork(network: Network): boolean {
    return network.protocolFamily === "evm" || network.protocolFamily === "svm";
  }

  getActions(walletProvider: WalletProvider): Action[] {
    const v3 = zodV3Schemas(prefixed);
    const actions: Action[] = this.toolset.tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: v3[t.baseName as ToolName] as unknown as Action["schema"],
      invoke: async (args: unknown) => {
        const r = await t.run(args);
        return r.ok ? JSON.stringify(r.data) : `Error: ${r.error}`;
      },
    }));
    if (this.enableSwapExecution && (isEvm(walletProvider) || isSvm(walletProvider))) actions.push(this.executeAction(walletProvider));
    return actions;
  }

  private executeAction(wallet: WalletProvider): Action {
    const schema = z.object({
      quoteId: z
        .string()
        .regex(/^q_/, "quoteId starts with q_")
        .describe(`quoteId from layerhop_get_quote (starts with "q_"), made with sender = this wallet's address (${wallet.getAddress()}).`),
      userConfirmed: z
        .literal(true)
        .describe("Set to true ONLY after you showed the user this exact quote (amount, minimum received, every fee, recipient) and the user explicitly confirmed it."),
    });
    return {
      name: "layerhop_execute_swap",
      description:
        "Execute a LayerHop quote the user explicitly confirmed: builds the transaction and sends it with this agent's wallet provider (EVM: ERC-20 approval first when needed, then the swap; Solana: signs the serialized transaction), then reports it for tracking. The wallet provider signs with the developer's own key; LayerHop never sees keys. Only for quotes made with sender = this wallet. Never call it without the user's explicit confirmation of the exact quote.",
      schema: schema as unknown as Action["schema"],
      invoke: async (args: unknown) => {
        const parsed = schema.safeParse(args);
        if (!parsed.success) {
          return `Error: Invalid input for layerhop_execute_swap: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`;
        }
        try {
          let r: ExecuteSwapResult;
          if (isEvm(wallet)) r = await executeEvmSwap(this.toolset, parsed.data.quoteId, evmSigner(wallet));
          else if (isSvm(wallet)) r = await executeSvmSwap(this.toolset, parsed.data.quoteId, await svmSigner(wallet));
          else return "Error: this wallet provider cannot send EVM or Solana transactions.";
          return JSON.stringify(r);
        } catch (e) {
          return `Error: ${errorMessage(e)}`;
        }
      },
    };
  }
}

/** Factory in AgentKit style: `AgentKit.from({ walletProvider, actionProviders: [layerhopActionProvider()] })`. */
export const layerhopActionProvider = (opts: LayerHopActionProviderOptions = {}) => new LayerHopActionProvider(opts);
