# RAVN examples

[![smithery badge](https://smithery.ai/badge/team-dgp6/ravn)](https://smithery.ai/servers/team-dgp6/ravn)

Working code for the [RAVN](https://ravn.exchange) cross-chain swap API — including **native
Bitcoin**, not wrapped BTC.

One integration covers EVM chains, native Bitcoin and Solana. Every quote races every live
execution venue in parallel and the best net output wins. **RAVN takes 0 bps on every route.** Non-custodial:
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
| [`src/btc-out.ts`](src/btc-out.ts) | **USDC on Base → native BTC**, end to end on the SDK's `executeAndTrack`, fee and status reporting included. The one most swap APIs can't do. Dry-runs without a wallet. |
| [`src/agent-swap.ts`](src/agent-swap.ts) | Claude tool-calling loop: the model picks the swap, your code keeps the keys. |
| [`src/x402-client.ts`](src/x402-client.ts) | Pay-per-call over [x402](https://x402.org) — no key, no account. |
| [`src/ravn.ts`](src/ravn.ts) | The shared client: the official [`@ravnexchange/sdk`](https://docs.ravn.exchange/sdks/core) (zero dependencies, typed) plus amount helpers. |
| [`MCP.md`](MCP.md) | Point Claude or Cursor at the hosted MCP server. Three lines of config. |

## The contract

Four calls, always the same order.

```
POST /quote   → best route + an opaque quoteToken
POST /execute → an execution payload tagged by executionType, with its own quoteToken
                (+ submit-signature, when the type is SIGNATURE)
POST /status  → pending → processing → success (or refunded / failed)
```

Poll `/status` with the `quoteToken` **execute** returned, its `statusRef` (else your swap's tx hash),
and as `txHash` the hash of the fee payment you sent beside the swap, or on a two-step route (a
`statusRef` came with a `TRANSACTION`) your swap's own tx hash, until the status is final.
Use `POST`: a `quoteToken` can run to tens of kilobytes, and a large one in a `GET` query string fails.

Everything branches on **one field**:

```ts
switch (execution.executionType) {
  case "TRANSACTION": // sign and broadcast it yourself
  case "SIGNATURE":   // sign typed data; RAVN submits it, no gas
  case "DEPOSIT":     // send the input asset to an address
}
```

### The one thing that trips people up

An ERC-20 swap is really **two** transactions. Before any contract can move your tokens you must
sign a separate on-chain permission — an `approve()`. `TRANSACTION` and `SIGNATURE` payloads carry
that ready to send, as **`approval`**, whenever it's needed.

```ts
if (execution.approval) {
  const { to, data, value } = execution.approval;            // value is a decimal string
  const hash = await wallet.sendTransaction({ to, data, value: BigInt(value) });
  await client.waitForTransactionReceipt({ hash });   // MINED, not just broadcast
}
// …now send the swap
```

Broadcasting the swap before the allowance is **mined** reverts on `transferFrom` and the user eats
the gas. On gasless venues (CoW, Bebop) it's quieter and worse: the order is accepted and simply
**never fills**, with no error. Native-coin sells and `DEPOSIT` routes never carry `approval`.

RAVN reads your user's allowance on-chain at `/execute` and leaves `approval` out when it already
covers the amount. When that read fails, `approval` is included anyway, so check the allowance for
`approval.spender` yourself and skip it when it covers `approval.amount` (`btc-out.ts` does, through
`executeAndTrack`'s `hasAllowance`). An `approval.reset` (Ethereum USDT holding a partial allowance)
is an `approve(spender, 0)` to send and mine first; `executeAndTrack` does.

0x Gasless can also return `approvalData`: a second typed-data signature that approves the token
gaslessly, sent to `/submit-signature` as `approvalSignature`. `executeAndTrack` signs it for you.

## Collecting your fee

If your key sets a fee, a swap only pays you when you do two things:

1. **Pay `execution.fee` exactly as returned**, when there is one (Rift, private swaps, Eco Routes,
   Layerswap, Mayan routes paying no referrer). EVM: send `fee.transaction` once the swap has
   succeeded, or batch an ERC-20 fee with it. Bitcoin: the fee is a second output of the deposit's
   own transaction. Solana: the transfer goes inside the deposit's own transaction.
2. **Report the swap to `/status` until it's final**, with that fee payment's hash (on a two-step
   route, your swap's own hash) as `txHash` on every poll. On same-chain venues RAVN only learns a swap
   happened from your poll: never reported, never paid.

On a `TRANSACTION`, `executeAndTrack` pays the fee and hands you the hash to poll with
(`statusTxHash`); from SDK 0.2.0 its own polling also runs through `expired` and `not_found` and
retries a failed status call. A `DEPOSIT` it leaves to you: `btc-out.ts` sends the deposit and the
fee, then polls them all through one loop. The full checklist: <https://docs.ravn.exchange/collecting-your-fee>

`unlimitedRecommended: true` (CoW) means the venue would rather you approve once for a large amount
than pay approval gas on every swap. `data` still encodes the exact amount; raising it is your call.

## Amounts

Always strings, always the token's smallest unit — wei, lamports, satoshis. Never floats.
`toBaseUnits()` / `fromBaseUnits()` in [`src/ravn.ts`](src/ravn.ts) convert safely.

## Cross-ecosystem swaps

Selling on EVM and receiving BTC or SOL needs a `destinationAddress` — the payout chain has no
idea what your EVM address is.

## Rate limits

| | |
| --- | --- |
| No key | 30 req/min per IP, plus 120 `/status` polls/min |
| [Free key](https://docs.ravn.exchange/tools/get-api-key), instant, no review | 120 req/min, plus 480 `/status` polls/min |

Status polls have a budget of their own (4× your limit). Every response carries `X-RateLimit-Limit`,
`X-RateLimit-Remaining` and `X-RateLimit-Reset` (epoch seconds), and a `429` adds `Retry-After`.
Pass your key as `x-api-key`. **CORS is enabled on every endpoint**, so browser-side dapps and wallet
widgets can call the API directly with no server-side proxy.

## Errors

Branch on the stable `code`, never the message.

`INVALID_REQUEST` (an unsupported chain is one of these) · `UNSUPPORTED_TOKEN` · `NO_LIQUIDITY` ·
`QUOTE_EXPIRED` · `QUOTE_INVALID` · `QUOTE_NOT_EXECUTABLE` · `BUILD_FAILED` · `ORDER_REJECTED` ·
`VENUE_RATE_LIMITED` · `RATE_LIMITED` · `UNAUTHORIZED` · `UNAVAILABLE` · `NOT_FOUND` · `NOT_CONFIGURED` ·
`INTERNAL`. The SDK adds `NETWORK_ERROR` when no response came back at all. Full table: <https://docs.ravn.exchange/errors>

Every response carries `x-request-id`. Quote it if you report a bad quote — it's how we find it.

## Links

- Docs — <https://docs.ravn.exchange>
- App — <https://app.ravn.exchange>
- MCP server — `https://app.ravn.exchange/api/mcp`
- OpenAPI spec (Postman / Insomnia import) — `https://app.ravn.exchange/openapi.json`
- Partnerships — team@ravn.exchange · [@ravnexchange](https://x.com/ravnexchange)

MIT licensed. Issues and PRs welcome.
