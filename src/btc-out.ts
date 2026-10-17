/**
 * USDC on Base → NATIVE Bitcoin, end to end, on @ravnexchange/sdk's executeAndTrack.
 *
 * This is the example most swap APIs cannot run at all. The BTC that lands is real Bitcoin on
 * the Bitcoin network — not wBTC, not cbBTC, not a bridge receipt. RAVN races every venue that
 * can deliver it and takes the best net output.
 *
 *   DRY RUN (no wallet, no funds):  npm run btc-out
 *   REAL SWAP:                      set PRIVATE_KEY and EXECUTE=1
 *
 * Cross-ecosystem swaps need `destinationAddress` — your Bitcoin address — because the payout
 * chain has no concept of your EVM address.
 *
 * What it gets right, because these are where integrations lose swaps and fees:
 *   - the approval is mined before the swap, and skipped when the allowance already covers it;
 *   - RAVN's fee, when the execution carries one, is paid exactly as returned, after the swap;
 *   - every status poll sends execute's quoteToken and statusRef, plus the fee payment's hash;
 *   - polling runs to a final status (`expired` means a refund is still coming).
 * See https://docs.ravn.exchange/collecting-your-fee
 */
import { createWalletClient, encodeFunctionData, erc20Abi, http, publicActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { executeAndTrack, type SettlementStatus } from "@ravnexchange/sdk";
import { ravn, CHAIN, fromBaseUnits, toBaseUnits } from "./ravn.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Where the real BTC should land. Replace with your own before running for real.
const BTC_DESTINATION = process.env.BTC_DESTINATION ?? "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const AMOUNT_USDC = process.env.AMOUNT_USDC ?? "25";

// Final: nothing more will change. `expired` and `not_found` are not: keep polling them.
const FINAL: SettlementStatus[] = ["success", "refunded", "failed", "unknown"];

async function main() {
  const account = process.env.PRIVATE_KEY
    ? privateKeyToAccount(process.env.PRIVATE_KEY as Hex)
    : undefined;
  // A quote needs *an* address to price against; a real swap needs your actual one.
  const userAddress = account?.address ?? "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

  console.log(`\nQuoting ${AMOUNT_USDC} USDC (Base) → native BTC…`);

  const quote = await ravn.getQuote({
    inputChainId: CHAIN.base,
    inputToken: USDC_BASE,
    outputChainId: CHAIN.bitcoin,
    outputToken: "BTC",
    inputAmount: toBaseUnits(AMOUNT_USDC, 6),
    userAddress,
    destinationAddress: BTC_DESTINATION,
  });

  console.log(`  venue      ${quote.venue.name}`);
  console.log(`  you get    ${fromBaseUnits(quote.output.amount, quote.output.token.decimals)} BTC`);
  console.log(`  fee        ${quote.fee.bps} bps${quote.fee.supported ? "" : " (this route can't carry one)"}`);
  console.log(`  eta        ~${Math.round(quote.estimatedTimeSeconds)}s`);

  if (!account || process.env.EXECUTE !== "1") {
    console.log("\nDry run only. Set PRIVATE_KEY and EXECUTE=1 to actually swap.\n");
    return;
  }

  const wallet = createWalletClient({ account, chain: base, transport: http() }).extend(publicActions);
  // RAVN sends `value` as a decimal string; viem wants a bigint.
  const asTx = (tx: { to?: string; data?: string; value?: string }) => ({
    to: tx.to as Hex,
    data: tx.data as Hex | undefined,
    value: BigInt(tx.value ?? "0"),
  });
  // Send and wait until mined; the hash only if this very transaction succeeded.
  const sendAndConfirm = async (tx: { to?: string; data?: string; value?: string }) => {
    const hash = await wallet.sendTransaction(asTx(tx));
    const receipt = await wallet.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || receipt.transactionHash !== hash) throw new Error(`${hash} didn't succeed`);
    return hash;
  };

  const result = await executeAndTrack(
    ravn,
    { quoteToken: quote.quoteToken, destinationAddress: BTC_DESTINATION },
    {
      sendTransaction: (tx) => wallet.sendTransaction(asTx(tx)),
      // Must resolve to the receipt itself: RAVN's fee is only sent on a swap whose own receipt
      // says success. One that resolves to nothing sends no fee.
      waitForReceipt: (hash) => wallet.waitForTransactionReceipt({ hash: hash as Hex }),
      signTypedData: (typedData) => wallet.signTypedData(typedData as Parameters<typeof wallet.signTypedData>[0]),
      // Most venues send `approval` even when the allowance is already in place: skip it then.
      hasAllowance: async (approval) =>
        !!approval.spender &&
        (await wallet.readContract({
          address: approval.to as Hex,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account.address, approval.spender as Hex],
        })) >= BigInt(approval.amount),
    },
    // We poll ourselves (track below): it survives a failed status call and doesn't stop at
    // `expired` or `not_found`, which executeAndTrack 0.1.15's own polling does.
    { pollUntilTerminal: false }
  );

  const { execution } = result;
  console.log(`  execution  ${execution.executionType}`);
  if (result.txHash) console.log(`  → swap tx  ${result.txHash}`);
  let txHash = result.statusTxHash;

  if (execution.executionType === "DEPOSIT") {
    // executeAndTrack sends nothing for a DEPOSIT. The deposit names no token: send the quote's
    // input token (USDC here), exactly deposit.amount, then RAVN's fee once it has confirmed.
    const { address, amount } = execution.deposit;
    const depositHash = await sendAndConfirm({
      to: USDC_BASE,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [address as Hex, BigInt(amount)] }),
    });
    console.log(`  → deposit  ${depositHash}`);
    // From Base it's always a transaction; Bitcoin and Solana fees go inside the deposit itself.
    if (result.feePayment?.kind === "transaction") {
      try {
        txHash = await sendAndConfirm(result.feePayment.transaction);
        console.log(`  → fee tx   ${txHash}`);
      } catch (e) {
        // The deposit is already sent: never stop here, or the swap goes untracked.
        console.log(`  fee not paid, nothing is owed on this swap: ${(e as Error).message}`);
      }
    }
  }
  if (result.feeTxHash) console.log(`  → fee tx   ${result.feeTxHash}`);
  if (result.feeError) console.log(`  fee not paid, nothing is owed on this swap: ${String(result.feeError)}`);

  await track(result.quoteToken, result.statusRef ?? "", txHash);
}

/** Poll with execute's quoteToken, its ref and the fee payment's hash until the status is final. */
async function track(quoteToken: string, ref: string, txHash?: string) {
  console.log("\nTracking…");
  let last = "";
  // ponytail: 90 minutes covers a Bitcoin payout; past it, resume polling with the same three values.
  for (let i = 0; i < 540; i++) {
    try {
      const { status } = await ravn.getStatus(quoteToken, ref, txHash);
      if (status !== last) console.log(`  ${(last = status)}`);
      if (FINAL.includes(status)) return;
    } catch (e) {
      // A rate limit or a network blip: the swap is out, so keep going.
      console.log(`  status call failed, retrying: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  console.log(`  not final yet: keep polling with quoteToken, ref ${ref}${txHash ? ` and txHash ${txHash}` : ""}`);
}

main().catch((e) => {
  console.error(`\n${e.name ?? "Error"}: ${e.message}${e.meta?.requestId ? ` (request ${e.meta.requestId})` : ""}`);
  process.exit(1);
});
