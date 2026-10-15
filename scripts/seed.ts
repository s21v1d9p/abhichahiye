// Seeds the synthetic Assam flood scenario on Tiramisu and checks what the chain now shows.
//   npm run seed                      fund the demo wallets from FUNDER_PK if low, run the scenario, assert
//   npm run seed -- --demo-expiry     also post a need that lapses by itself after three minutes
//   npm run seed -- --mem             dry run on an in-memory chain (no funds, no network)
// Re-running is safe: every step first checks what already exists, and re-confirms needs that are ageing. That makes
// this script the demo's keepalive too: .github/workflows/keepalive.yml runs it every hour with SEED_WALLETS_JSON.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { formatEther, type Hex, parseEther } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { explorerAddress, fallbackFromKey, makePublicClient, makeWalletClient, type PublicClient, type WalletClient } from "../src/core/arkiv"
import { createMemChain } from "../src/core/memchain"
import { assertScenario, ROLES, type Role, runScenario, type Wallets } from "../src/core/scenario"

const FILE = ".seed-wallets.json"
const FUND_EACH = parseEther("0.05")
const MIN_BALANCE = parseEther("0.02")
const args = new Set(process.argv.slice(2))

function loadKeys(): Record<Role, Hex> {
  const fromEnv = process.env.SEED_WALLETS_JSON
  if (fromEnv) return JSON.parse(fromEnv) as Record<Role, Hex>
  if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")) as Record<Role, Hex>
  // A scheduled run must keep the existing demo wallets alive, never quietly start a second set.
  if (process.env.CI) throw new Error("SEED_WALLETS_JSON is not set: refusing to create new demo wallets in CI")
  const keys = Object.fromEntries(ROLES.map((role) => [role, generatePrivateKey()])) as Record<Role, Hex>
  writeFileSync(FILE, JSON.stringify(keys, null, 2), { mode: 0o600 })
  console.log(`created ${FILE} (git-ignored, testnet keys only)`)
  return keys
}

// Each write costs about 0.0001 GLM, so 0.05 GLM keeps a demo wallet going for months; FUNDER_PK is only needed then.
async function fundWallets(pub: PublicClient, keys: Record<Role, Hex>) {
  const balances = await Promise.all(ROLES.map(async (role) => [role, await pub.getBalance({ address: privateKeyToAccount(keys[role]).address })] as const))
  const needy = balances.filter(([, balance]) => balance < MIN_BALANCE).map(([role]) => role)
  if (needy.length === 0) return console.log("all demo wallets are funded")
  const funderKey = process.env.FUNDER_PK as Hex | undefined
  if (!funderKey) throw new Error(`${needy.join(", ")} need test GLM: set FUNDER_PK`)
  const funder = makeWalletClient(funderKey)
  const have = await pub.getBalance({ address: funder.account.address })
  const need = FUND_EACH * BigInt(needy.length)
  if (have < need + parseEther("0.01")) {
    throw new Error(`funder ${funder.account.address} has ${formatEther(have)} GLM, needs about ${formatEther(need)}: claim from https://hub.arkiv.network/faucet`)
  }
  for (const role of needy) {
    const hash = await funder.sendTransaction({ to: privateKeyToAccount(keys[role]).address, value: FUND_EACH })
    await pub.waitForTransactionReceipt({ hash })
    console.log(`funded ${role} with ${formatEther(FUND_EACH)} GLM`)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  let pub: PublicClient
  let wallets: Wallets
  if (args.has("--mem")) {
    const chain = createMemChain()
    pub = chain.pub
    wallets = Object.fromEntries(ROLES.map((role) => [role, chain.wallet()])) as Wallets
    console.log("dry run on an in-memory chain")
  } else {
    pub = makePublicClient(fallbackFromKey(process.env.ARKIV_KEY))
    const keys = loadKeys()
    await fundWallets(pub, keys)
    wallets = Object.fromEntries(ROLES.map((role) => [role, makeWalletClient(keys[role])])) as Wallets
  }

  const started = Date.now()
  await runScenario(pub, wallets, { log: (message) => console.log(`  ${message}`), demoExpiry: args.has("--demo-expiry") })
  console.log(`scenario done in ${Math.round((Date.now() - started) / 1000)}s`)

  // A write can land one block after the head the next query reads, so give the chain a moment before judging it.
  let checks = await assertScenario(pub, wallets)
  for (let attempt = 1; attempt < 5 && checks.some((c) => !c.ok); attempt++) {
    await sleep(4000)
    checks = await assertScenario(pub, wallets)
  }
  console.log()
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}  (${check.detail})`)

  console.log("\n| Role | Wallet |\n|---|---|")
  for (const role of ROLES) console.log(`| ${role} | ${(wallets[role] as WalletClient).account.address} |`)
  if (!args.has("--mem")) {
    console.log("\nExplorer:")
    for (const role of ROLES) console.log(`  ${role.padEnd(16)} ${explorerAddress((wallets[role] as WalletClient).account.address)}`)
  }

  if (checks.some((c) => !c.ok)) {
    console.log("\nSOME ASSERTIONS FAILED")
    process.exit(1)
  }
  console.log("\nALL ASSERTIONS PASSED")
}

await main()
