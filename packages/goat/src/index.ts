import { createTool, PluginBase, type Chain, type ToolBase, type WalletClientBase } from "@goat-sdk/core";
import {
  createLayerHopTools,
  executeEvmSwap,
  errorMessage,
  ERC20_ABI,
  zodV3Schemas,
  type EvmSigner,
  type LayerHopToolsOptions,
  type LayerHopToolset,
  type ToolName,
} from "@layerhop/ai";
import { z } from "zod/v3";

export const VERSION = "0.7.0";

export interface LayerHopGoatOptions extends Omit<LayerHopToolsOptions, "toolName" | "client"> {
  /**
   * Add `layerhop_execute_swap`, which sends a confirmed quote's transactions with the GOAT EVM wallet
   * client you configured (your own signer). Default true. Set false for quote/prepare-only agents.
   */
  enableSwapExecution?: boolean;
}

/** The part of GOAT's EVMWalletClient the executor uses (duck-typed so any EVM wallet client works). */
interface GoatEvmWallet {
  getAddress(): string;
  getChain(): Chain;
  sendTransaction(tx: { to: string; data?: `0x${string}`; value?: bigint }): Promise<{ hash: string }>;
  read?(req: { address: string; abi: unknown; functionName: string; args?: unknown[] }): Promise<{ value: unknown }>;
}

const prefixed = (n: string) => `layerhop_${n}`;

function isEvmWallet(w: WalletClientBase): w is WalletClientBase & GoatEvmWallet {
  return w.getChain().type === "evm" && typeof (w as Partial<GoatEvmWallet>).sendTransaction === "function";
}

/**
 * GOAT plugin: LayerHop's quote, unsigned-transaction, tracking, token, price, deposit-address and
 * checkout tools, plus `layerhop_execute_swap` for EVM wallets. LayerHop never sees keys: swaps are
 * signed by the GOAT wallet client the developer configured.
 */
export class LayerHopGoatPlugin extends PluginBase<WalletClientBase> {
  readonly toolset: LayerHopToolset;
  private readonly enableSwapExecution: boolean;

  constructor(opts: LayerHopGoatOptions = {}) {
    super("layerhop", []);
    const { enableSwapExecution = true, ...rest } = opts;
    this.enableSwapExecution = enableSwapExecution;
    this.toolset = createLayerHopTools({ ...rest, toolName: prefixed });
  }

  supportsChain(chain: Chain): boolean {
    return chain.type === "evm" || chain.type === "solana";
  }

  getTools(walletClient: WalletClientBase): ToolBase[] {
    const v3 = zodV3Schemas(prefixed);
    const tools: ToolBase[] = this.toolset.tools.map((t) =>
      createTool(
        { name: t.name, description: t.description, parameters: v3[t.baseName as ToolName] as never },
        async (params: unknown) => {
          const r = await t.run(params);
          return r.ok ? r.data : { error: r.error };
        },
      ),
    );
    if (this.enableSwapExecution && isEvmWallet(walletClient)) tools.push(this.executeTool(walletClient));
    return tools;
  }

  private executeTool(wallet: WalletClientBase & GoatEvmWallet): ToolBase {
    const params = z.object({
      quoteId: z.string().regex(/^q_/, "quoteId starts with q_").describe('quoteId from layerhop_get_quote (starts with "q_"), made with sender = this wallet address.'),
      userConfirmed: z
        .literal(true)
        .describe("Set to true ONLY after you showed the user this exact quote (amount, minimum received, every fee, recipient) and the user explicitly confirmed it."),
    });
    const chain = wallet.getChain();
    const signer: EvmSigner = {
      address: wallet.getAddress(),
      chainId: chain.type === "evm" ? chain.id : undefined,
      getAllowance: wallet.read
        ? async (token, owner, spender) => {
            const r = await wallet.read!({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [owner, spender] });
            return BigInt(String(r.value));
          }
        : undefined,
      sendTransaction: async (req) => (await wallet.sendTransaction({ to: req.to, data: req.data, value: BigInt(req.value) })).hash,
    };
    return createTool(
      {
        name: "layerhop_execute_swap",
        description:
          "Execute a LayerHop quote the user explicitly confirmed: builds the transaction and sends it with this agent's EVM wallet (ERC-20 approval first when needed, then the swap), then reports it for tracking. The wallet signs with the developer's own key; LayerHop never sees keys. Only for quotes made with sender = this wallet. Never call it without the user's explicit confirmation of the exact quote.",
        parameters: params as never,
      },
      async (p: unknown) => {
        const parsed = params.safeParse(p);
        if (!parsed.success) return { error: `Invalid input for layerhop_execute_swap: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}` };
        try {
          return await executeEvmSwap(this.toolset, parsed.data.quoteId, signer);
        } catch (e) {
          return { error: errorMessage(e) };
        }
      },
    );
  }
}

/** GOAT plugin factory: `getOnChainTools({ wallet, plugins: [layerhop({ integrator: "myapp" })] })`. */
export function layerhop(opts: LayerHopGoatOptions = {}): LayerHopGoatPlugin {
  return new LayerHopGoatPlugin(opts);
}
