/**
 * One-time bootstrap (TESTNET). Requires OWNER_SUI_KEY (bech32 suiprivkey1...)
 * funded with testnet SUI. Run: pnpm seed:account  (loads apps/web/.env)
 */

const PKG = process.env.MEMWAL_PACKAGE_ID ?? "0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6";
const REG = process.env.MEMWAL_REGISTRY_ID ?? "0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437";

async function main() {
  const ownerKey = process.env.OWNER_SUI_KEY;
  if (!ownerKey) throw new Error("Set OWNER_SUI_KEY (bech32 suiprivkey1...) funded with testnet SUI.");

  const { generateDelegateKey, createAccount, addDelegateKey } = await import("@mysten-incubation/memwal/account");
  // @mysten/sui 2.x renamed the old `SuiClient` (now SuiJsonRpcClient), so memwal's
  // account utils can't build one internally — construct it here and pass it in.
  const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } = await import("@mysten/sui/jsonRpc");
  const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });

  const delegate = await generateDelegateKey();
  const account = await createAccount({ packageId: PKG, registryId: REG, suiPrivateKey: ownerKey, suiNetwork: "testnet", suiClient });
  await addDelegateKey({ packageId: PKG, accountId: account.accountId, publicKey: delegate.publicKey, label: "waldocs-backend", suiPrivateKey: ownerKey, suiNetwork: "testnet", suiClient });

  console.log("\n# Paste into apps/web/.env :");
  console.log(`MEMWAL_PRIVATE_KEY=${delegate.privateKey}`);
  console.log(`MEMWAL_ACCOUNT_ID=${account.accountId}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
