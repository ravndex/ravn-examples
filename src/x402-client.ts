/**
 * Pay-per-call with x402 — no API key, no signup, no account.
 *
 *   npm run x402
 *
 * The endpoint answers HTTP 402 with its price; an x402-aware fetch pays it in USDC (Base or
 * Solana) and retries automatically. $0.001 a quote, $0.01 an execute.
 *
 * Use this only when your agent cannot hold a long-lived credential. The free REST API and the
 * MCP server run the same routing at no cost — x402 buys you the absence of a key, not a better
 * quote. The trade-off it wins on: nothing to rotate or leak, spend capped per call, and every
 * call settles on-chain as its own audit trail.
 */
import { CHAIN, fromBaseUnits, toBaseUnits } from "./ravn.js";

const X402_QUOTE = "https://app.ravn.exchange/api/v1/x402/quote";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const body = {
  inputChainId: CHAIN.base,
  inputToken: USDC_BASE,
  outputChainId: CHAIN.bitcoin,
  outputToken: "BTC",
  inputAmount: toBaseUnits("25", 6),
  userAddress: process.env.USER_ADDRESS ?? "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  destinationAddress: process.env.BTC_DESTINATION ?? "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
};

/** Show the payment terms without paying — this is what an agent discovers on its own. */
async function inspect402() {
  const res = await fetch(X402_QUOTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status !== 402) {
    console.log(`Expected 402, got ${res.status}.`);
    return;
  }

  const header = res.headers.get("payment-required");
  const terms = header ? JSON.parse(Buffer.from(header, "base64").toString()) : await res.json();

  console.log(`\nHTTP 402 — ${terms.resource?.serviceName ?? "RAVN"}`);
  console.log(`  ${terms.resource?.description ?? ""}`);
  for (const a of terms.accepts ?? []) {
    // amount is in the asset's smallest unit; USDC is 6 decimals.
    console.log(`  accepts  ${fromBaseUnits(a.amount, 6)} USDC on ${a.network} → ${a.payTo}`);
  }
  console.log("\nTo actually pay, wrap fetch with an x402 client:\n");
  console.log(`  import { wrapFetchWithPayment } from "x402-fetch";`);
  console.log(`  import { privateKeyToAccount } from "viem/accounts";`);
  console.log(`  const account = privateKeyToAccount(process.env.PRIVATE_KEY);`);
  console.log(`  const pay = wrapFetchWithPayment(fetch, account);`);
  console.log(`  const res = await pay("${X402_QUOTE}", { method: "POST", … });\n`);
  console.log("The 402 is retried automatically once payment settles. Same quote, same 0 bps.\n");
}

inspect402().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
