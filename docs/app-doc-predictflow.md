# PredictFlow — App Doc

> App-doc source for `llPorZall/sui-deepbook-predict-example` (PredictFlow). This is the
> step-by-step guide that the `waldocs-publish` skill would send to the backend
> (kept here as a file, unpublished).

## Environment

- sui: `@mysten/sui@2.17.0` (Node / TypeScript)
- dapp-kit: `@mysten/dapp-kit@1.0.6`
- payment-kit: `@mysten/payment-kit@0.1.11`
- slush-wallet: `@mysten/slush-wallet@1.0.5`

> Next.js 16 / React 19 dApp on **Sui testnet**. Exact SDK packages/versions this guide was written and verified against.

## Step 1: Install the Sui dApp SDKs

PredictFlow composes four Sui primitives in the browser: the core SDK, dApp Kit (React hooks + wallet provider), Payment Kit (on-chain payments), and the Slush wallet connector. `@tanstack/react-query` is a peer dependency of dApp Kit.

```bash
pnpm add @mysten/sui@2.17.0 @mysten/dapp-kit@1.0.6 @mysten/payment-kit@0.1.11 @mysten/slush-wallet@1.0.5 @tanstack/react-query@5.100.14
```

## Step 2: Wrap the app with the Sui client + Slush wallet providers

All on-chain reads/signing flow through dApp Kit's `SuiClientProvider` + `WalletProvider`. `@mysten/sui` 2.x exposes fullnode URLs via `getJsonRpcFullnodeUrl`; register Slush by passing `slushWallet` to `WalletProvider` (with `autoConnect`).

```tsx
"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import "@mysten/dapp-kit/dist/index.css";

const NETWORKS = {
  testnet: { url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" as const },
  mainnet: { url: getJsonRpcFullnodeUrl("mainnet"), network: "mainnet" as const },
};

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={NETWORKS} defaultNetwork="testnet">
        <WalletProvider autoConnect slushWallet={{ name: "PredictFlow Demo" }}>
          {children}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
```

## Step 3: Connect the Slush wallet and read the active account

Slush is registered through `WalletProvider`; use dApp Kit's `ConnectButton` to trigger connection and `useCurrentAccount` to read the connected address (null until the user connects). Handle the wallet-standard states (not installed / rejected / wrong network) explicitly.

```tsx
import { ConnectButton, useCurrentAccount, useSuiClientContext } from "@mysten/dapp-kit";

export function WalletBar() {
  const account = useCurrentAccount();
  const { network } = useSuiClientContext();
  return (
    <div className="wallet-bar">
      <ConnectButton connectText="Connect Slush" />
      {account
        ? <span>Connected {account.address.slice(0, 6)}…{account.address.slice(-4)} on {network}</span>
        : <span>Connect a Slush wallet on testnet to continue</span>}
    </div>
  );
}
```

## Step 4: Build a Sui Payment Kit research payment with on-chain duplicate prevention

`PaymentKitClient` builds the payment `Transaction`. With a registry id you get `processRegistryPayment` (on-chain `EDuplicatePayment` guard); without one, `processEphemeralPayment` still produces a real `PaymentReceipt` + digest. The nonce is deterministic (wallet+purpose+UTC-day) so re-submitting the same day reproduces the PaymentKey and triggers the duplicate guard.

```ts
import { PaymentKitClient, type PaymentKitCompatibleClient } from "@mysten/payment-kit";

const DUSDC_UNIT = BigInt(10) ** BigInt(6); // DUSDC has 6 decimals

export function buildResearchPayment(client: PaymentKitCompatibleClient, opts: {
  walletAddress: string; amountDusdc: string; merchant: string; dusdcType: string; registryId?: string;
}) {
  const amount = BigInt(opts.amountDusdc) * DUSDC_UNIT;
  const nonce = `pf-${opts.walletAddress.replace(/^0x/, "").slice(0, 12)}-research-20260620`; // <= 36 chars
  const payKit = new PaymentKitClient({ client });
  const common = { sender: opts.walletAddress, receiver: opts.merchant, amount, coinType: opts.dusdcType, nonce };

  return opts.registryId
    ? payKit.tx.processRegistryPayment({ ...common, registryId: opts.registryId })
    : payKit.tx.processEphemeralPayment(common);
}
```

## Step 5: Mint a DeepBook Predict position

A prediction is a `predict::mint_range<Quote>` (or `mint_binary`) Move call: deposit DUSDC into the wallet's `PredictManager`, construct the on-chain key, then mint. Payoff per unit is capped at $1, so `quantity * 10^6` always covers the mint cost.

```ts
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";

export const SUI_CLOCK_OBJECT_ID = "0x6";
const DUSDC_UNIT = BigInt(10) ** BigInt(6);

export function mintRangeTx(cfg: { packageId: string; predictObjectId: string; dusdcType: string }, p: {
  managerId: string; oracleId: string; expiry: bigint; lowerStrike: bigint; higherStrike: bigint; quantity: bigint;
}): Transaction {
  const tx = new Transaction();

  // 1) deposit the max-payout cost into the PredictManager
  const coin = coinWithBalance({ balance: p.quantity * DUSDC_UNIT, type: cfg.dusdcType });
  tx.moveCall({ target: `${cfg.packageId}::predict_manager::deposit`, typeArguments: [cfg.dusdcType], arguments: [tx.object(p.managerId), coin] });

  // 2) build the range key, then mint the position
  const rangeKey = tx.moveCall({
    target: `${cfg.packageId}::range_key::new`,
    arguments: [tx.pure.id(p.oracleId), tx.pure.u64(p.expiry), tx.pure.u64(p.lowerStrike), tx.pure.u64(p.higherStrike)],
  });
  tx.moveCall({
    target: `${cfg.packageId}::predict::mint_range`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(cfg.predictObjectId), tx.object(p.managerId), tx.object(p.oracleId), rangeKey, tx.pure.u64(p.quantity), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  return tx;
}
```

## Step 6: Place the prediction in one signed PTB (fee + mint, atomically)

The research-fee payment and the position mint are appended to a single `Transaction`, then signed once via dApp Kit's `useSignAndExecuteTransaction` (Slush). One signature, one digest — payment and mint succeed or fail together.

```tsx
import { useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";

function usePlacePrediction() {
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  return async (walletAddress: string) => {
    // build ONE transaction carrying both the Payment Kit fee and the Predict mint
    const tx = mintRangeTx(getPredictConfig(), {
      managerId: "0x7c6d…e93f", oracleId: "0x3a2b…1c0d",
      expiry: 1_760_000_000_000n, lowerStrike: 60_000_000_000_000n, higherStrike: 70_000_000_000_000n, quantity: 5n,
    });
    // (the same `tx` also receives the buildResearchPayment moveCalls before signing)

    const { digest } = await signAndExecute({ transaction: tx });
    console.log("placed:", `https://suiscan.xyz/testnet/tx/${digest}`);
    return digest;
  };
}
```

## Step 7: Redeem a settled position and withdraw DUSDC

Redeeming credits the payout to the `PredictManager`; a follow-up withdraw pulls DUSDC to the wallet. Settled binary positions can use `redeem_permissionless` so the owner key isn't required.

```ts
import { Transaction } from "@mysten/sui/transactions";

export function redeemBinaryTx(cfg: { packageId: string; predictObjectId: string; dusdcType: string }, p: {
  managerId: string; oracleId: string; expiry: bigint; strike: bigint; direction: "up" | "down"; quantity: bigint; permissionless?: boolean;
}): Transaction {
  const tx = new Transaction();
  const marketKey = tx.moveCall({
    target: `${cfg.packageId}::market_key::new`,
    arguments: [tx.pure.id(p.oracleId), tx.pure.u64(p.expiry), tx.pure.u64(p.strike), tx.pure.bool(p.direction === "up")],
  });
  tx.moveCall({
    target: `${cfg.packageId}::predict::${p.permissionless ? "redeem_permissionless" : "redeem"}`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(cfg.predictObjectId), tx.object(p.managerId), tx.object(p.oracleId), marketKey, tx.pure.u64(p.quantity), tx.object("0x6")],
  });
  return tx;
}
```
