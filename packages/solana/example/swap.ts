// Example: quote SOL -> USDC on Base and execute it with a Solana wallet.
// `wallet` is `useWallet()` from @solana/wallet-adapter-react (or any adapter instance).
import { Connection } from "@solana/web3.js";
import { executeSolanaQuote, fromWalletAdapter, LayerHop, type WalletAdapterLike } from "@layerhop/solana";

const lh = new LayerHop({ integrator: "myapp" });
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

export async function swapSolToBase(wallet: WalletAdapterLike & { publicKey: { toBase58(): string } | null }, evmRecipient: string) {
  if (!wallet.publicKey) throw new Error("Connect a Solana wallet");
  const { best } = await lh.quote({
    srcChain: "solana", srcToken: "SOL", amount: "100000000", // 0.1 SOL in lamports
    dstChain: "base", dstToken: "USDC",
    sender: wallet.publicKey.toBase58(), recipient: evmRecipient,
  });
  // Builds the tx, has the wallet sign it (then POST /v1/orders/submit when the route needs it,
  // otherwise our RPC broadcasts it and re-sends it until it lands), then reports the signature.
  const sent = await executeSolanaQuote(fromWalletAdapter(wallet), { quote: best, client: lh, connection });
  const confirmed = await sent.wait();
  return { signature: sent.signature, confirmed, provider: best.provider };
}
