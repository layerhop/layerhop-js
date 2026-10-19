# @layerhop/mcp

[![npm](https://img.shields.io/npm/v/@layerhop/mcp?color=c3f06b&labelColor=090d15&cacheSeconds=3600)](https://www.npmjs.com/package/@layerhop/mcp) [![license](https://img.shields.io/npm/l/@layerhop/mcp?color=7ddec8&labelColor=090d15)](https://opensource.org/license/mit) [![docs](https://img.shields.io/badge/docs-docs.layerhop.com-7ddec8?labelColor=090d15)](https://docs.layerhop.com/guides/ai-agents)

[Model Context Protocol](https://modelcontextprotocol.io) server for [LayerHop](https://layerhop.com): AI agents (Claude, ChatGPT, Cursor, …) can list chains and tokens, get best-price cross-chain / same-chain swap quotes with every fee spelled out, and hand the user a prefilled swap link.

**The server holds no private keys and never signs or broadcasts.** The user's own wallet signs.

Listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=com.layerhop) as `com.layerhop/mcp`.

```bash
# stdio (Claude Desktop, Claude Code, Cursor, …)
npx -y @layerhop/mcp
claude mcp add layerhop -- npx -y @layerhop/mcp

# hosted, Streamable HTTP
claude mcp add --transport http layerhop https://mcp.layerhop.com/mcp

# self-host over HTTP: POST /mcp, GET /healthz
npx -y @layerhop/mcp --http --port 8090 --host 0.0.0.0
```

Env: `LAYERHOP_API_URL` (default `https://api.layerhop.com`), `LAYERHOP_API_KEY` (optional; required for deposit addresses), `LAYERHOP_INTEGRATOR` (optional partner id), `LAYERHOP_APP_URL` (default `https://layerhop.com`).

Tools: `list_chains`, `list_tokens`, `get_quote`, `get_swap_link`, `build_transaction`, `simulate_transaction`, `report_submitted`, `get_order_status`, `list_orders`, plus deposit addresses (API key required): `create_deposit_address`, `list_deposit_addresses`, `get_deposit_address`, `refresh_deposit_address`, `disable_deposit_address`, `simulate_deposit` (test keys only). Amounts in tool inputs are human decimals (`"100"` = 100 USDC).

Full guide: https://docs.layerhop.com/guides/ai-agents

MIT licensed.
