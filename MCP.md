# RAVN over MCP

RAVN runs a hosted MCP server. Point any MCP client at it and `ravn_quote`, `ravn_execute`,
`ravn_status`, `ravn_health` and `ravn_btc_prepare_send` show up as native tools.

**No signup. No API key. No payment.** It is the same routing engine, the same 0 bps, and the
same quote a person gets in the app.

```
https://app.ravn.exchange/api/mcp
```

## Claude Code

```bash
claude mcp add --transport http ravn https://app.ravn.exchange/api/mcp
```

## Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ravn": {
      "type": "streamable-http",
      "url": "https://app.ravn.exchange/api/mcp"
    }
  }
}
```

## Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ravn": {
      "url": "https://app.ravn.exchange/api/mcp"
    }
  }
}
```

## Then just ask

> what would 25 USDC on Base get me in native bitcoin right now?

> which RAVN venues are up?

## Custody

RAVN never holds funds and the MCP server never asks for a private key. `ravn_execute` returns a
payload for **you** to sign — a transaction to broadcast, typed data to sign, or a deposit address
to send to. Wiring that to a wallet is a decision you make once, deliberately; see
[`src/btc-out.ts`](src/btc-out.ts) for the signing side done explicitly.

Full docs: <https://docs.ravn.exchange/ai-agents/mcp-server>
