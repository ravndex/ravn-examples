# RAVN examples

Working code for the [RAVN](https://ravn.exchange) cross-chain swap API — including **native
Bitcoin**, not wrapped BTC.

One integration covers 16 chains (14 EVM + Bitcoin + Solana). Every quote races 12 execution
venues in parallel and the best net output wins. **RAVN takes 0 bps on every route.** Non-custodial:
RAVN never holds your funds and writes no smart contracts of its own.

No signup required to start. Every example below runs anonymously.

```bash
git clone https://github.com/ravndex/ravn-examples
cd ravn-examples && npm install
npm run health
```

## The examples

| | What it shows |
| --- | --- |
| [`src/health.ts`](src/health.ts) | 10-second smoke test — which venues are racing right now. Start here. |
| [`src/btc-out.ts`](src/btc-out.ts) | **USDC on Base → native BTC**, end to end. The one most swap APIs can't do. Dry-runs without a wallet. |
| [`src/agent-swap.ts`](src/agent-swap.ts) | Claude tool-calling loop: the model picks the swap, your code keeps the keys. |
| [`src/x402-client.ts`](src/x402-client.ts) | Pay-per-call over [x402](https://x402.org) — no key, no account. |
| [`src/ravn.ts`](src/ravn.ts) | The whole client, ~150 lines. There is no SDK because you don't need one — copy this file. |
| [`MCP.md`](MCP.md) | Point Claude or Cursor at the hosted MCP server. Three lines of config. |

## The contract

Four calls, always the same order.

```
POST /quote   → best route + an opaque quoteToken
POST /execute → an execution payload tagged by executionType
                (+ submit-signature, when the type is SIGNATURE)
GET  /status  → pending → processing → success (or refunded / failed)
```

Everything branches on **one field**:

```ts
switch (execution.executionType) {
  case "TRANSACTION": // sign and broadcast it yourself
  case "SIGNATURE":   // sign typed data; RAVN submits it, no gas
  case "DEPOSIT":     // send the input asset to an address
}
```

### The one thing that trips people up

`TRANSACTION` and `SIGNATURE` payloads may carry an **`approval`** — an ERC-20 `approve()` that
must be **mined** before the swap.

```ts
if (execution.approval) {
  const hash = await wallet.sendTransaction(execution.approval);
  await client.waitForTransactionReceipt({ hash });   // MINED, not just broadcast
}
```

Broadcasting the swap before the allowance lands reverts on `transferFrom` and the user eats the
gas. On gasless venues (CoW, Bebop) it is quieter and worse: the order is accepted and simply
never fills. Native-coin sells and already-approved tokens omit `approval` entirely.

Read the on-chain allowance for `approval.spender` first and skip it when it already covers
`approval.amount`.

## Amounts

Always strings, always the token's smallest unit — wei, lamports, satoshis. Never floats.
`toBaseUnits()` / `fromBaseUnits()` in [`src/ravn.ts`](src/ravn.ts) convert safely.

## Cross-ecosystem swaps

Selling on EVM and receiving BTC or SOL needs a `destinationAddress` — the payout chain has no
idea what your EVM address is.

## Rate limits

| | |
| --- | --- |
| No key | 30 req/min per IP |
| [Free key](https://docs.ravn.exchange/tools/get-api-key), instant, no review | 120 req/min |

Pass it as `x-api-key`. **CORS is enabled on every endpoint**, so browser-side dapps and wallet
widgets can call the API directly with no server-side proxy.

## Errors

Branch on the stable `code`, never the message.

`INVALID_REQUEST` · `UNSUPPORTED_TOKEN` · `UNSUPPORTED_CHAIN` · `NO_LIQUIDITY` · `QUOTE_EXPIRED` ·
`QUOTE_INVALID` · `RATE_LIMITED` · `UNAUTHORIZED` · `INTERNAL`

Every response carries `x-request-id`. Quote it if you report a bad quote — it's how we find it.

## Links

- Docs — <https://docs.ravn.exchange>
- App — <https://app.ravn.exchange>
- MCP server — `https://app.ravn.exchange/api/mcp`
- Partnerships — team@ravn.exchange · [@ravnexchange](https://x.com/ravnexchange)

MIT licensed. Issues and PRs welcome.
