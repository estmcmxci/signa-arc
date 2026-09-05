import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  defineChain,
  http,
  isAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import localEvidenceJson from "../../../scenarios/output/local-coffee-evidence.json";
import covenantVaultJson from "../../../contracts/out/CovenantVault.sol/CovenantVault.json";
import coverageEngineJson from "../../../contracts/out/CoverageEngine.sol/CoverageEngine.json";
import credentialRegistryJson from "../../../contracts/out/CredentialRegistry.sol/CredentialRegistry.json";
import facilityRegistryJson from "../../../contracts/out/FacilityRegistry.sol/FacilityRegistry.json";
import mockTokenJson from "../../../contracts/out/MockUSDC.sol/MockUSDC.json";

import "./styles.css";

type ArtifactJson = { abi: Abi };
type FacilityPolicy = {
  facilityId: Hex;
  settlementCurrency: Hex;
  exposureCurrency: Hex;
  minCoverageBps: number;
  credentialMaxAge: number;
  maturityTolerance: number;
  defaultHaircutBps: number;
  reserveAmount: bigint;
  curePeriod: number;
  maxWaiverDuration: number;
  maxActiveHedges: number;
  settlementAsset: Address;
  admin: Address;
  operator: Address;
  frozen: boolean;
};
type StoredExposure = {
  credential: {
    facilityId: Hex;
    exposureCurrency: Hex;
    settlementCurrency: Hex;
    outstandingValue: bigint;
    exposureMaturity: bigint;
    observedAt: bigint;
    validUntil: bigint;
    sequence: bigint;
    sourceCommitment: Hex;
  };
  issuer: Address;
  digest: Hex;
  acceptedAt: bigint;
  issuerEpoch: bigint;
};
type StoredHedge = {
  credential: {
    facilityId: Hex;
    tradeIdCommitment: Hex;
    baseCurrency: Hex;
    quoteCurrency: Hex;
    remainingNotional: bigint;
    maturity: bigint;
    status: number;
    observedAt: bigint;
    validUntil: bigint;
    sequence: bigint;
    sourceCommitment: Hex;
  };
  issuer: Address;
  digest: Hex;
  acceptedAt: bigint;
  issuerEpoch: bigint;
};
type CoverageResult = {
  assessed: boolean;
  compliant: boolean;
  outstandingValue: bigint;
  grossEligible: bigint;
  countedEligible: bigint;
  coverageBps: number;
  requiredCoverageBps: number;
  eligibleHedgeCount: number;
  totalHedgeCount: number;
  exposureReason: number;
  resultReason: number;
};
type HedgeView = StoredHedge & { eligibilityReason: number; adjustedNotional: bigint };
type HistoryItem = {
  eventName: string;
  transactionHash: Hex;
  blockNumber: bigint;
  summary: string;
};
type LiveState = {
  policy: FacilityPolicy;
  exposure: StoredExposure;
  coverage: CoverageResult;
  state: number;
  principal: bigint;
  cureDeadline: bigint;
  availableToDraw: bigint;
  hedges: HedgeView[];
  history: HistoryItem[];
};
type LocalEvidence = {
  network: { name: string; chainId: number };
  steps: Array<{
    action: string;
    transactionHash?: Hex;
    blockNumber?: string;
    transactionStatus?: string;
    covenant?: { state: string; coverageBps: number; principal: string };
  }>;
};

const facilityRegistryAbi = (facilityRegistryJson as ArtifactJson).abi;
const credentialRegistryAbi = (credentialRegistryJson as ArtifactJson).abi;
const coverageEngineAbi = (coverageEngineJson as ArtifactJson).abi;
const covenantVaultAbi = (covenantVaultJson as ArtifactJson).abi;
const mockTokenAbi = (mockTokenJson as ArtifactJson).abi;
const localEvidence = localEvidenceJson as LocalEvidence;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? "84532");
const rpcUrl = import.meta.env.VITE_RPC_URL ?? "https://sepolia.base.org";
const explorerUrl =
  import.meta.env.VITE_EXPLORER_URL ??
  (chainId === 84_532 ? "https://sepolia.basescan.org" : "");
const chain = defineChain({
  id: chainId,
  name: chainId === 84_532 ? "Base Sepolia" : `Configured chain ${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: explorerUrl
    ? { default: { name: "Explorer", url: explorerUrl } }
    : undefined,
});

const addresses = {
  token: configuredAddress(import.meta.env.VITE_TOKEN_ADDRESS),
  facilityRegistry: configuredAddress(import.meta.env.VITE_FACILITY_REGISTRY_ADDRESS),
  credentialRegistry: configuredAddress(import.meta.env.VITE_CREDENTIAL_REGISTRY_ADDRESS),
  coverageEngine: configuredAddress(import.meta.env.VITE_COVERAGE_ENGINE_ADDRESS),
  covenantVault: configuredAddress(import.meta.env.VITE_COVENANT_VAULT_ADDRESS),
} as const;
const facilityId = import.meta.env.VITE_FACILITY_ID as Hex | undefined;
const configured =
  facilityId?.length === 66 &&
  facilityId !== ZERO_BYTES32 &&
  Object.values(addresses).every(
    (address) => address && isAddress(address) && address !== ZERO_ADDRESS,
  );

const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) throw new Error("Missing #app root");
const root: HTMLDivElement = rootElement;

let live: LiveState | undefined;
let walletAddress: Address | undefined;
let busy = false;
let message = configured ? "Reading current onchain state…" : "Sepolia addresses not configured.";
let errorMessage = "";

render();
if (configured) void refreshLive();

async function refreshLive() {
  if (!configured || !facilityId) return;
  busy = true;
  message = "Reading current onchain state…";
  errorMessage = "";
  render();
  try {
    const [policy, exposure, coverage, state, principal, cureDeadline, available, tradeIds] =
      await Promise.all([
        read(addresses.facilityRegistry!, facilityRegistryAbi, "getFacility", [facilityId]),
        read(addresses.credentialRegistry!, credentialRegistryAbi, "currentExposure", [
          facilityId,
        ]),
        read(addresses.coverageEngine!, coverageEngineAbi, "evaluate", [facilityId]),
        read(addresses.covenantVault!, covenantVaultAbi, "covenantState"),
        read(addresses.covenantVault!, covenantVaultAbi, "principal"),
        read(addresses.covenantVault!, covenantVaultAbi, "cureDeadline"),
        read(addresses.covenantVault!, covenantVaultAbi, "availableToDraw"),
        read(addresses.credentialRegistry!, credentialRegistryAbi, "hedgeTradeIds", [
          facilityId,
        ]),
      ]);
    const hedges = await Promise.all(
      (tradeIds as Hex[]).map(async (tradeId) => {
        const [stored, eligibility] = await Promise.all([
          read(addresses.credentialRegistry!, credentialRegistryAbi, "currentHedge", [
            facilityId,
            tradeId,
          ]),
          read(addresses.coverageEngine!, coverageEngineAbi, "hedgeEligibility", [
            facilityId,
            tradeId,
          ]),
        ]);
        const [eligibilityReason, adjustedNotional] = eligibility as [number, bigint];
        return {
          ...(stored as StoredHedge),
          eligibilityReason,
          adjustedNotional,
        };
      }),
    );
    live = {
      policy: policy as FacilityPolicy,
      exposure: exposure as StoredExposure,
      coverage: coverage as CoverageResult,
      state: Number(state),
      principal: principal as bigint,
      cureDeadline: cureDeadline as bigint,
      availableToDraw: available as bigint,
      hedges,
      history: await loadHistory(),
    };
    message = `Onchain state read at ${new Date().toLocaleTimeString()}.`;
  } catch (error) {
    errorMessage = errorText(error);
    message = "Live read failed; recorded local evidence remains separately labeled below.";
  } finally {
    busy = false;
    render();
  }
}

function render() {
  const stateName = live ? covenantStates[live.state] ?? "UNKNOWN" : "UNCONFIGURED";
  const coverage = live?.coverage;
  root.innerHTML = `
    <main class="shell">
      <div class="truth-banner">Base Sepolia / fictional facility / mock provider data</div>
      <header class="masthead">
        <div>
          <div class="eyebrow">FX coverage control desk</div>
          <h1>Capital moves only when coverage holds.</h1>
          <p class="lede">A fictional COP-repayable Colombian coffee portfolio demonstrates how independently signed exposure and hedge state can govern a Base credit vault. This interface reads the contracts; it does not price, recommend, or execute a derivative.</p>
        </div>
        <div class="network-box">
          <strong>${escapeHtml(chain.name)}</strong>
          <span>chain ${chainId}</span>
          <span>${configured ? "deployment configured" : "deployment pending"}</span>
          <span>${walletAddress ? short(walletAddress) : "wallet not connected"}</span>
        </div>
      </header>

      ${
        !configured
          ? `<div class="notice"><strong>Truthful prototype state:</strong> Base Sepolia addresses have not been configured, so no live product claim is made here. The timeline below is a recorded local Anvil run with fictional inputs. Configure the five <span class="mono">VITE_*_ADDRESS</span> values after deployment to enable contract reads and controls.</div>`
          : ""
      }
      ${errorMessage ? `<div class="notice">${escapeHtml(errorMessage)}</div>` : ""}

      <section class="metrics" aria-label="Current coverage metrics">
        ${metric("Covenant state", stateName, `status-${stateName.toLowerCase()}`)}
        ${metric("Eligible coverage", coverage ? formatBps(coverage.coverageBps) : "—")}
        ${metric("Authenticated exposure", coverage ? formatUsd(coverage.outstandingValue) : "—")}
        ${metric("Available to draw", live ? formatUsd(live.availableToDraw) : "—")}
      </section>

      <section class="two-column">
        <article class="panel">
          <div class="panel-head"><div><div class="section-kicker">Facility policy</div><h2>USD / COP control</h2></div><span class="mono">${live?.policy.frozen ? "FROZEN" : "—"}</span></div>
          <div class="policy-grid">
            ${datum("Threshold", live ? formatBps(live.policy.minCoverageBps) : "—")}
            ${datum("Freshness", live ? formatDuration(live.policy.credentialMaxAge) : "—")}
            ${datum("Maturity tolerance", live ? formatDuration(live.policy.maturityTolerance) : "—")}
            ${datum("Default haircut", live ? formatBps(live.policy.defaultHaircutBps) : "—")}
            ${datum("Retained reserve", live ? formatUsd(live.policy.reserveAmount) : "—")}
            ${datum("Cure period", live ? formatDuration(live.policy.curePeriod) : "—")}
            ${datum("Principal drawn", live ? formatUsd(live.principal) : "—")}
            ${datum("Cure deadline", live ? formatTimestamp(live.cureDeadline) : "—")}
            ${datum("Maximum active hedges", live ? String(live.policy.maxActiveHedges) : "—")}
          </div>
        </article>

        <article class="panel">
          <div class="panel-head"><div><div class="section-kicker">Actions</div><h2>Fresh onchain evaluation</h2></div><button id="connect" class="action">${walletAddress ? short(walletAddress) : "Connect wallet"}</button></div>
          <div class="controls">
            <input id="amount" inputmode="decimal" value="100000" aria-label="Amount in mock USD" />
            <button id="sync" class="action-primary" ${disabled()}>Sync covenant</button>
            <button id="restore" ${disabled()}>Restore</button>
            <button id="draw" ${disabled()}>Draw mUSD</button>
            <button id="repay" ${disabled()}>Repay mUSD</button>
          </div>
          <p class="footer-note">Every draw evaluates current credentials in the same transaction. Reverted draws cannot persist a state transition; any account can then call sync to record cure or breach. Repayment remains available in every state.</p>
          <p class="footer-note mono">${escapeHtml(message)}</p>
        </article>
      </section>

      <section class="two-column">
        <article class="panel">
          <div class="panel-head"><div><div class="section-kicker">Independent source A</div><h2>Exposure assertion</h2></div><span class="mono">${live ? exposureReasons[live.coverage.exposureReason] : "—"}</span></div>
          <div class="policy-grid">
            ${datum("Issuer", live ? short(live.exposure.issuer) : "—")}
            ${datum("Outstanding", live ? formatUsd(live.exposure.credential.outstandingValue) : "—")}
            ${datum("Sequence", live ? live.exposure.credential.sequence.toString() : "—")}
            ${datum("Observed", live ? formatTimestamp(live.exposure.credential.observedAt) : "—")}
            ${datum("Expires", live ? formatTimestamp(live.exposure.credential.validUntil) : "—")}
            ${datum("Source commitment", live ? hashSpan(live.exposure.credential.sourceCommitment) : "—")}
          </div>
        </article>

        <article class="panel">
          <div class="panel-head"><div><div class="section-kicker">Computed onchain</div><h2>Coverage result</h2></div><span class="mono">${coverage ? resultReasons[coverage.resultReason] : "—"}</span></div>
          <div class="policy-grid">
            ${datum("Gross eligible", coverage ? formatUsd(coverage.grossEligible) : "—")}
            ${datum("Counted eligible", coverage ? formatUsd(coverage.countedEligible) : "—")}
            ${datum("Coverage", coverage ? formatBps(coverage.coverageBps) : "—")}
            ${datum("Required", coverage ? formatBps(coverage.requiredCoverageBps) : "—")}
            ${datum("Eligible hedges", coverage ? `${coverage.eligibleHedgeCount} / ${coverage.totalHedgeCount}` : "—")}
            ${datum("Assessed", coverage ? String(coverage.assessed) : "—")}
          </div>
        </article>
      </section>

      <section class="panel">
        <div class="panel-head"><div><div class="section-kicker">Independent source B</div><h2>Active hedge credentials</h2></div><span class="mono">${live?.hedges.length ?? 0} active IDs</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Committed trade ID</th><th>Issuer</th><th>Remaining</th><th>Status</th><th>Maturity</th><th>Expires</th><th>Eligibility</th></tr></thead>
            <tbody>${hedgeRows()}</tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><div><div class="section-kicker">Base receipts</div><h2>Current deployment event history</h2></div>${configured && explorerUrl ? `<a href="${explorerUrl}/address/${addresses.covenantVault}" target="_blank" rel="noreferrer">Open vault ↗</a>` : ""}</div>
        <div class="timeline">${liveHistoryRows()}</div>
      </section>

      <section class="panel">
        <div class="panel-head"><div><div class="section-kicker">Recorded local evidence</div><h2>Deterministic coffee-facility arc</h2></div><span class="mono">Anvil ${localEvidence.network.chainId}</span></div>
        <div class="timeline">${localEvidenceRows()}</div>
        <p class="footer-note">These hashes belong only to the recorded local chain and are not Base Sepolia evidence. Reproduce them with <span class="mono">anvil --chain-id 31337 --timestamp 1800000000</span> and <span class="mono">pnpm scenario:coffee</span>.</p>
      </section>

      <p class="footer-note">Trust boundary: the contracts prove which authorized party asserted which fields, when, and which deterministic capital rule followed. They do not independently prove legal existence, enforceability, completeness, valuation, or counterparty solvency of an offchain derivative.</p>
    </main>
  `;
  bindActions();
}

function bindActions() {
  document.querySelector("#connect")?.addEventListener("click", () => void connectWallet());
  document.querySelector("#sync")?.addEventListener("click", () => void execute("sync"));
  document.querySelector("#restore")?.addEventListener("click", () => void execute("restore"));
  document.querySelector("#draw")?.addEventListener("click", () => void execute("draw"));
  document.querySelector("#repay")?.addEventListener("click", () => void execute("repay"));
}

async function connectWallet() {
  if (!window.ethereum) {
    errorMessage = "No injected wallet was found.";
    render();
    return;
  }
  try {
    const wallet = createWalletClient({ chain, transport: custom(window.ethereum as never) });
    const [address] = await wallet.requestAddresses();
    if (!address) throw new Error("The wallet returned no account.");
    walletAddress = address;
    message = "Wallet connected. Writes still require the contract-authorized role.";
    errorMessage = "";
  } catch (error) {
    errorMessage = errorText(error);
  }
  render();
}

async function execute(action: "sync" | "restore" | "draw" | "repay") {
  if (!configured || !facilityId || !window.ethereum) {
    errorMessage = "Configure the deployment and connect an injected wallet first.";
    render();
    return;
  }
  let amount = 0n;
  try {
    if (action === "draw" || action === "repay") {
      amount = parseSixDecimals(
        document.querySelector<HTMLInputElement>("#amount")?.value ?? "0",
      );
    }
  } catch (error) {
    errorMessage = errorText(error);
    render();
    return;
  }
  busy = true;
  errorMessage = "";
  message = `Waiting for ${action} transaction…`;
  render();
  try {
    const wallet = createWalletClient({ chain, transport: custom(window.ethereum as never) });
    const [account] = await wallet.requestAddresses();
    if (!account) throw new Error("The wallet returned no account.");
    walletAddress = account;
    await wallet.switchChain({ id: chain.id });

    if (action === "repay") {
      await writeAndWait(wallet, account, addresses.token!, mockTokenAbi, "approve", [
        addresses.covenantVault!,
        amount,
      ]);
      await writeAndWait(wallet, account, addresses.covenantVault!, covenantVaultAbi, "repay", [
        amount,
      ]);
    } else {
      const functionName =
        action === "sync"
          ? "syncCovenant"
          : action === "restore"
            ? "restoreCompliance"
            : "draw";
      const args = action === "draw" ? [amount] : [];
      await writeAndWait(
        wallet,
        account,
        addresses.covenantVault!,
        covenantVaultAbi,
        functionName,
        args,
      );
    }
    message = `${action} confirmed. Refreshing contract state…`;
    await refreshLive();
  } catch (error) {
    errorMessage = errorText(error);
    message = `${action} did not confirm.`;
  } finally {
    busy = false;
    render();
  }
}

async function writeAndWait(
  wallet: ReturnType<typeof createWalletClient>,
  account: Address,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
) {
  const hash = await wallet.writeContract({
    account,
    chain,
    address,
    abi,
    functionName,
    args,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
}

async function loadHistory(): Promise<HistoryItem[]> {
  const currentBlock = await publicClient.getBlockNumber();
  const fromBlock = currentBlock > 50_000n ? currentBlock - 50_000n : 0n;
  const logs = await publicClient.getLogs({
    address: [
      addresses.facilityRegistry!,
      addresses.credentialRegistry!,
      addresses.covenantVault!,
    ],
    fromBlock,
    toBlock: "latest",
  } as never);
  const combinedAbi = [
    ...facilityRegistryAbi,
    ...credentialRegistryAbi,
    ...covenantVaultAbi,
  ] as Abi;
  return logs
    .flatMap((log) => {
      try {
        const decoded = decodeEventLog({
          abi: combinedAbi,
          data: log.data,
          topics: log.topics,
          strict: false,
        } as never) as { eventName: string; args: Record<string, unknown> };
        return [
          {
            eventName: decoded.eventName,
            transactionHash: log.transactionHash!,
            blockNumber: log.blockNumber!,
            summary: summarizeArgs(decoded.args),
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
    .slice(0, 24);
}

async function read(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<unknown> {
  return publicClient.readContract({ address, abi, functionName, args } as never);
}

function metric(label: string, value: string, className = "") {
  return `<article class="metric"><span class="label">${label}</span><span class="value ${className}">${escapeHtml(value)}</span></article>`;
}

function datum(label: string, content: string) {
  return `<div class="datum"><span class="label">${label}</span><span class="content">${content}</span></div>`;
}

function hedgeRows() {
  if (!live?.hedges.length) {
    return `<tr><td colspan="7" class="empty">No active onchain hedge IDs to display.</td></tr>`;
  }
  return live.hedges
    .map(
      (hedge) => `<tr>
        <td class="mono">${hashSpan(hedge.credential.tradeIdCommitment)}</td>
        <td class="mono">${short(hedge.issuer)}</td>
        <td>${formatUsd(hedge.credential.remainingNotional)}</td>
        <td>${hedgeStatuses[hedge.credential.status] ?? "UNKNOWN"}</td>
        <td>${formatTimestamp(hedge.credential.maturity)}</td>
        <td>${formatTimestamp(hedge.credential.validUntil)}</td>
        <td>${hedgeReasons[hedge.eligibilityReason] ?? "UNKNOWN"}</td>
      </tr>`,
    )
    .join("");
}

function liveHistoryRows() {
  if (!live?.history.length) {
    return `<div class="empty">${configured ? "No recent protocol events found." : "Configure a deployment to read Base events."}</div>`;
  }
  return live.history
    .map(
      (item) => `<div class="event">
        <div class="event-state">${escapeHtml(item.eventName)}</div>
        <div class="event-copy">${escapeHtml(item.summary)}</div>
        <div class="event-meta">block ${item.blockNumber}<br/>${transactionLink(item.transactionHash)}</div>
      </div>`,
    )
    .join("");
}

function localEvidenceRows() {
  return localEvidence.steps
    .filter((step) => step.covenant)
    .map(
      (step) => `<div class="event">
        <div class="event-state status-${step.covenant!.state.toLowerCase()}">${escapeHtml(step.covenant!.state)}</div>
        <div class="event-copy">${escapeHtml(step.action)} · ${formatBps(step.covenant!.coverageBps)} coverage · ${step.transactionStatus}</div>
        <div class="event-meta">local block ${step.blockNumber}<br/><span title="${step.transactionHash}">${short(step.transactionHash ?? "")}</span></div>
      </div>`,
    )
    .join("");
}

function transactionLink(hash: Hex) {
  return explorerUrl
    ? `<a href="${explorerUrl}/tx/${hash}" target="_blank" rel="noreferrer">${short(hash)} ↗</a>`
    : short(hash);
}

function summarizeArgs(args: Record<string, unknown>) {
  const values = Object.entries(args)
    .filter(([key]) => !/^\d+$/.test(key))
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${formatUnknown(value)}`);
  return values.length ? values.join(" · ") : "Protocol state transition";
}

function formatUnknown(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && value.startsWith("0x")) return short(value);
  return String(value);
}

function formatUsd(value: bigint) {
  const whole = Number(value / 1_000_000n);
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(whole)}`;
}

function formatBps(value: number) {
  return `${(Number(value) / 100).toFixed(Number(value) % 100 === 0 ? 0 : 2)}%`;
}

function formatDuration(seconds: number) {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return `${seconds}s`;
}

function formatTimestamp(value: bigint) {
  if (value === 0n) return "—";
  return new Date(Number(value) * 1_000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseSixDecimals(value: string) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) {
    throw new Error("Enter a positive amount with at most six decimals.");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (result <= 0n) throw new Error("Amount must be greater than zero.");
  return result;
}

function configuredAddress(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? value : undefined;
}

function short(value: string) {
  if (!value || value.length <= 14) return value || "—";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function hashSpan(value: string) {
  return `<span class="hash mono" title="${value}">${short(value)}</span>`;
}

function disabled() {
  return busy || !configured || !walletAddress ? "disabled" : "";
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.message;
  return String(error);
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ]!,
  );
}

const covenantStates = ["UNASSESSED", "COMPLIANT", "CURE", "BREACH", "WAIVED"];
const hedgeStatuses = ["ACTIVE", "CANCELLED", "SETTLED", "DISPUTED"];
const exposureReasons = [
  "ELIGIBLE",
  "MISSING",
  "ZERO_VALUE",
  "ISSUER_NOT_APPROVED",
  "PAIR_MISMATCH",
  "NOT_YET_OBSERVED",
  "EXPIRED",
  "STALE",
  "REVOKED",
  "ISSUER_AUTHORIZATION_STALE",
];
const hedgeReasons = [
  "ELIGIBLE",
  "MISSING",
  "ISSUER_NOT_APPROVED",
  "SAME_AS_EXPOSURE_ISSUER",
  "PAIR_MISMATCH",
  "NOT_ACTIVE",
  "NOT_YET_OBSERVED",
  "EXPIRED",
  "STALE",
  "MATURITY_MISMATCH",
  "REVOKED",
  "ISSUER_AUTHORIZATION_STALE",
];
const resultReasons = ["NONE", "MISSING_EXPOSURE", "INVALID_EXPOSURE", "BELOW_THRESHOLD"];
