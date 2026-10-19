// Example: quote USDC on Base -> SOL and execute it with the connected wagmi wallet.
// With an EIP-5792 wallet (Coinbase Smart Wallet, MetaMask with smart accounts, ...) the approval and
// the swap take ONE confirmation; other wallets get approve, then swap.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http, useAccount, WagmiProvider } from "wagmi";
import { base } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { LayerHopProvider, useExecuteQuote, useLayerHopQuote, useOrderStatus } from "@layerhop/wagmi";

const config = createConfig({ chains: [base], connectors: [injected()], transports: { [base.id]: http() } });
const queryClient = new QueryClient();

export function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <LayerHopProvider options={{ integrator: "myapp" }}>
          <Swap />
        </LayerHopProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function Swap() {
  const { address } = useAccount();
  const quote = useLayerHopQuote(
    address && {
      srcChain: "base", srcToken: "USDC", amount: "25000000", // 25 USDC in base units
      dstChain: "solana", dstToken: "SOL",
      sender: address, recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    },
  );
  const exec = useExecuteQuote();
  const best = quote.data?.best;
  const status = useOrderStatus(best?.provider, exec.hash);

  return (
    <div>
      <button disabled={!best || exec.isPending} onClick={() => best && exec.execute({ quote: best })}>
        {exec.isPending ? exec.status : "Swap"}
      </button>
      {exec.mode === "batch" && <p>Sent in one confirmation.</p>}
      {exec.error && <p>{exec.error.message}</p>}
      {status.data && <p>Order: {status.data.state}</p>}
    </div>
  );
}
