# @layerhop/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for [LayerHop](https://layerhop.com): AI agents (Claude, ChatGPT, Cursor, …) can list chains and tokens, get best-price cross-chain / same-chain swap quotes with every fee spelled out, and hand the user a prefilled swap link.

**The server holds no private keys and never signs or broadcasts.** The user's own wallet signs.

```bash
# stdio (Claude Desktop, Claude Code, Cursor, …)
npx -y @layerhop/mcp
claude mcp add layerhop -- npx -y @layerhop/mcp

# hosted, Streamable HTTP
claude mcp add --transport http layerhop https://mcp.layerhop.com/mcp

# self-host over HTTP: POST /mcp, GET /healthz
npx -y @layerhop/mcp --http --port 8090 --host 0.0.0.0
```

Env: `LAYERHOP_API_URL` (default `https://api.layerhop.com`), `LAYERHOP_API_KEY` (optional), `LAYERHOP_INTEGRATOR` (optional partner id), `LAYERHOP_APP_URL` (default `https://layerhop.com`).

Tools: `list_chains`, `list_tokens`, `get_quote`, `get_swap_link`, `build_transaction`, `simulate_transaction`, `report_submitted`, `get_order_status`, `list_orders`. Amounts in tool inputs are human decimals (`"100"` = 100 USDC).

Full guide: https://docs.layerhop.com/guides/ai-agents

MIT licensed.
