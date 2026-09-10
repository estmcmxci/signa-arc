/// <reference types="vite/client" />
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";

import covenantVaultJson from "../../../contracts/out/CovenantVault.sol/CovenantVault.json";
import coverageEngineJson from "../../../contracts/out/CoverageEngine.sol/CoverageEngine.json";
import credentialRegistryJson from "../../../contracts/out/CredentialRegistry.sol/CredentialRegistry.json";
import facilityRegistryJson from "../../../contracts/out/FacilityRegistry.sol/FacilityRegistry.json";
import mockTokenJson from "../../../contracts/out/MockUSDC.sol/MockUSDC.json";

import { loadManifest, type ArcTestnetManifest, type ManifestState } from "./manifest";
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
type DrawPreview =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ready"; allowed: boolean; reason: number; amount: bigint }
  | { status: "error"; message: string };
type ArcEvidenceStep = {
  action?: unknown;
  transactionHash?: unknown;
  expectedStatus?: unknown;
  actualStatus?: unknown;
  coverageBps?: unknown;
  resultReason?: unknown;
  explorerLink?: unknown;
};
type ArcEvidence = { network?: { name?: unknown; chainId?: unknown }; steps: ArcEvidenceStep[] };
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

const facilityRegistryAbi = (facilityRegistryJson as ArtifactJson).abi;
const credentialRegistryAbi = (credentialRegistryJson as ArtifactJson).abi;
const coverageEngineAbi = (coverageEngineJson as ArtifactJson).abi;
const covenantVaultAbi = (covenantVaultJson as ArtifactJson).abi;
const mockTokenAbi = (mockTokenJson as ArtifactJson).abi;

// Referenced, never moved (E-DEC-2, E-EUR-1 … E-EUR-5). The loan book this facility
// covers is EURC-denominated; this vault never holds, transfers, or approves EURC.
const EURC_ADDRESS: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

const manifestState: ManifestState = loadManifest();
const manifest: ArcTestnetManifest | undefined =
  manifestState.status === "ready" ? manifestState.manifest : undefined;
const configured = manifest !== undefined && manifest.chainId === arcTestnet.id;

const explorerUrl = manifest?.explorer ?? "";
const rpcUrl = manifest?.rpcUrl ?? arcTestnet.rpcUrls.default.http[0];
const facilityId = manifest?.facility.id;
const addresses = manifest
  ? {
      token: manifest.settlementAsset.address,
      facilityRegistry: manifest.contracts.facilityRegistry.address,
      credentialRegistry: manifest.contracts.credentialRegistry.address,
      coverageEngine: manifest.contracts.coverageEngine.address,
      covenantVault: manifest.contracts.covenantVault.address,
    }
  : undefined;

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) throw new Error("Missing #app root");
const root: HTMLDivElement = rootElement;

let live: LiveState | undefined;
let walletAddress: Address | undefined;
let busy = false;
let message = configured ? "Reading current onchain state…" : "Arc deployment not configured.";
let errorMessage = "";
let lastRefreshedAt: number | undefined;
let stale = false;
let drawPreview: DrawPreview = { status: "idle" };
const arcEvidence = loadArcEvidence();

render();
if (configured) void refreshLive();

async function refreshLive() {
  if (!configured || !facilityId || !addresses) return;
  busy = true;
  message = "Reading current onchain state…";
  errorMessage = "";
  render();
  try {
    const [policy, exposure, coverage, state, principal, cureDeadline, available, tradeIds] =
      await Promise.all([
        read(addresses.facilityRegistry, facilityRegistryAbi, "getFacility", [facilityId]),
        read(addresses.credentialRegistry, credentialRegistryAbi, "currentExposure", [
          facilityId,
        ]),
        read(addresses.coverageEngine, coverageEngineAbi, "evaluate", [facilityId]),
        read(addresses.covenantVault, covenantVaultAbi, "covenantState"),
        read(addresses.covenantVault, covenantVaultAbi, "principal"),
        read(addresses.covenantVault, covenantVaultAbi, "cureDeadline"),
        read(addresses.covenantVault, covenantVaultAbi, "availableToDraw"),
        read(addresses.credentialRegistry, credentialRegistryAbi, "hedgeTradeIds", [
          facilityId,
        ]),
      ]);
    const hedges = await Promise.all(
      (tradeIds as Hex[]).map(async (tradeId) => {
        const [stored, eligibility] = await Promise.all([
          read(addresses.credentialRegistry, credentialRegistryAbi, "currentHedge", [
            facilityId,
            tradeId,
          ]),
          read(addresses.coverageEngine, coverageEngineAbi, "hedgeEligibility", [
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
    lastRefreshedAt = Date.now();
    stale = false;
    message = `Onchain state read at ${new Date().toLocaleTimeString()}.`;
  } catch (error) {
    errorMessage = errorText(error);
    stale = live !== undefined;
    message = stale
      ? "Live read failed. The panels below show the last successful read, marked stale."
      : "Live read failed and no prior successful read exists.";
  } finally {
    busy = false;
    render();
  }
}

async function previewDraw() {
  if (!configured || !facilityId || !addresses) return;
  let amount: bigint;
  try {
    amount = parseSixDecimals(document.querySelector<HTMLInputElement>("#amount")?.value ?? "0");
  } catch (error) {
    drawPreview = { status: "error", message: errorText(error) };
    render();
    return;
  }
  drawPreview = { status: "pending" };
  render();
  try {
    // assess() measures the reserve against msg.sender's balance of the settlement
    // asset. Read-only, that is whoever the RPC call is sent "from" — nonsense unless
    // pinned to the vault, which is who calls it for real inside draw(). See EED §1.
    const [allowed, reason] = (await publicClient.readContract({
      address: addresses.coverageEngine,
      abi: coverageEngineAbi,
      functionName: "assess",
      args: [facilityId, amount],
      account: addresses.covenantVault,
    } as never)) as [boolean, number];
    drawPreview = { status: "ready", allowed, reason, amount };
  } catch (error) {
    drawPreview = { status: "error", message: errorText(error) };
  }
  render();
}

function render() {
  const stateName = live ? covenantStates[live.state] ?? "UNKNOWN" : "UNCONFIGURED";
  const coverage = live?.coverage;
  root.innerHTML = `
    <main class="shell">
      <div class="truth-banner">Arc Testnet 5042002 / fictional facility / mock provider data — ${manifestBadge()}</div>
      <header class="masthead">
        <div>
          <div class="eyebrow">FX coverage control desk</div>
          <h1>Capital moves only when coverage holds.</h1>
          <p class="lede">A fictional EURC-denominated loan book demonstrates how independently signed exposure and hedge state can govern a USDC credit vault on Arc. The exposure feed is shaped like a servicer/bank confirmation and the hedge feed is shaped like a StableFX RFQ receipt — both are labelled mocks; no bank or venue is integrated. This interface reads the contracts; it does not price, recommend, or execute a derivative.</p>
        </div>
        <div class="network-box">
          <strong>${escapeHtml(arcTestnet.name)}</strong>
          <span>chain ${arcTestnet.id}</span>
          <span>${configured ? "deployment configured" : "deployment pending"}</span>
          <span>${walletAddress ? short(walletAddress) : "wallet not connected"}</span>
        </div>
      </header>

      ${manifestNotice()}
      ${staleNotice()}
      ${errorMessage ? `<div class="notice">${escapeHtml(errorMessage)}</div>` : ""}

      <section class="metrics" aria-label="Current coverage metrics">
        ${metric("Covenant state", stateName, `status-${stateName.toLowerCase()}`, stale)}
        ${metric("Counted coverage", coverage ? formatBps(coverage.coverageBps) : "—", "", stale)}
        ${metric("Authenticated exposure", coverage ? formatUsd(coverage.outstandingValue) : "—", "", stale)}
        ${metric("Available to draw", live ? formatUsd(live.availableToDraw) : "—", "", stale)}
      </section>

      <section class="two-column">
        <article class="panel">
          <div class="panel-head"><div><div class="section-kicker">Facility policy</div><h2>USD / EUR control</h2></div><span class="mono">${live?.policy.frozen ? "FROZEN" : "—"}</span></div>
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
            <button id="preview" ${disabledRead()}>Preview draw</button>
            <button id="sync" class="action-primary" ${disabled()}>Sync covenant</button>
            <button id="restore" ${disabled()}>Restore</button>
            <button id="draw" ${disabled()}>Draw mUSD</button>
            <button id="repay" ${disabled()}>Repay mUSD</button>
          </div>
          ${previewLine()}
          <p class="footer-note">Every draw evaluates current credentials in the same transaction via <span class="mono">ICoverageGate.assess</span>; the gate rules, it never authorises from a cached verdict. Reverted draws cannot persist a state transition; any account can then call sync to record cure or breach. Repayment remains available in every state.</p>
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
            ${datum("Denominating asset (referenced only)", eurcLink())}
          </div>
          <p class="footer-note">The exposure is a loan book in a servicing system, asserted under a signed <span class="mono">ExposureCredential</span> — never an onchain balance. EURC above is linked for context only: this vault never transfers, holds, or approves it. The portfolio is denominated in EUR; the facility is funded, drawn and repaid in USDC.</p>
        </article>

        <article class="panel">
          <div class="panel-head"><div><div class="section-kicker">Computed onchain</div><h2>Coverage result</h2></div><span class="mono">${coverage ? (resultReasons[coverage.resultReason] ?? "UNKNOWN") : "—"}</span></div>
          <div class="policy-grid">
            ${datum("Gross eligible", coverage ? formatUsd(coverage.grossEligible) : "—")}
            ${datum("Gross coverage (uncapped)", coverage ? formatGrossBps(coverage) : "—")}
            ${datum("Counted eligible", coverage ? formatUsd(coverage.countedEligible) : "—")}
            ${datum("Counted coverage", coverage ? formatBps(coverage.coverageBps) : "—")}
            ${datum("Required", coverage ? formatBps(coverage.requiredCoverageBps) : "—")}
            ${datum("Eligible hedges", coverage ? `${coverage.eligibleHedgeCount} / ${coverage.totalHedgeCount}` : "—")}
            ${datum("Assessed", coverage ? String(coverage.assessed) : "—")}
          </div>
          <p class="footer-note">Gross and counted coverage are shown separately by design: over-hedging is visible in the gross figure, but only the counted figure — capped at 100% of the exposure — ever governs a draw (EED §6, R-F2-3).</p>
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
        <div class="panel-head"><div><div class="section-kicker">Arc receipts</div><h2>Current deployment event history</h2></div>${configured && explorerUrl && addresses ? `<a href="${explorerUrl}/address/${addresses.covenantVault}" target="_blank" rel="noreferrer">Open vault ↗</a>` : ""}</div>
        <div class="timeline">${liveHistoryRows()}</div>
      </section>

      <section class="panel">
        <div class="panel-head"><div><div class="section-kicker">Scenario evidence</div><h2>Arc EURC facility arc (A-1 → A-4)</h2></div><span class="mono">${arcEvidence ? `${arcEvidence.steps.length} steps` : "not yet recorded"}</span></div>
        ${arcEvidenceRows()}
      </section>

      <p class="footer-note">Trust boundary: the contracts prove which authorized party asserted which fields, when, and which deterministic capital rule followed. They do not independently prove legal existence, enforceability, completeness, valuation, or counterparty solvency of an offchain derivative.</p>
    </main>
  `;
  bindActions();
}

function bindActions() {
  document.querySelector("#connect")?.addEventListener("click", () => void connectWallet());
  document.querySelector("#preview")?.addEventListener("click", () => void previewDraw());
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
    const wallet = createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum as never) });
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
  if (!configured || !facilityId || !addresses || !window.ethereum) {
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
    const wallet = createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum as never) });
    const [account] = await wallet.requestAddresses();
    if (!account) throw new Error("The wallet returned no account.");
    walletAddress = account;
    await wallet.switchChain({ id: arcTestnet.id });

    if (action === "repay") {
      await writeAndWait(wallet, account, addresses.token, mockTokenAbi, "approve", [
        addresses.covenantVault,
        amount,
      ]);
      await writeAndWait(wallet, account, addresses.covenantVault, covenantVaultAbi, "repay", [
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
        addresses.covenantVault,
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
    chain: arcTestnet,
    address,
    abi,
    functionName,
    args,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
}

async function loadHistory(): Promise<HistoryItem[]> {
  if (!addresses) return [];
  const currentBlock = await publicClient.getBlockNumber();
  const fromBlock = currentBlock > 50_000n ? currentBlock - 50_000n : 0n;
  const logs = await publicClient.getLogs({
    address: [
      addresses.facilityRegistry,
      addresses.credentialRegistry,
      addresses.covenantVault,
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

function loadArcEvidence(): ArcEvidence | undefined {
  const modules = import.meta.glob<{ default: unknown }>(
    "../../../scenarios/output/arc-facility-evidence.json",
    { eager: true },
  );
  const raw = Object.values(modules)[0]?.default;
  if (typeof raw !== "object" || raw === null) return undefined;
  const steps = (raw as Record<string, unknown>)["steps"];
  if (!Array.isArray(steps)) return undefined;
  return raw as ArcEvidence;
}

async function read(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<unknown> {
  return publicClient.readContract({ address, abi, functionName, args } as never);
}

function manifestBadge() {
  if (manifestState.status !== "ready") return "manifest unavailable";
  return manifestState.source === "deployed" ? "deployed manifest" : "fixture manifest";
}

function manifestNotice() {
  if (manifestState.status === "ready" && manifestState.source === "deployed") return "";
  if (manifestState.status === "ready" && manifestState.source === "fixture") {
    return `<div class="notice"><strong>Fixture manifest:</strong> <span class="mono">deployments/arc-testnet.json</span> does not exist yet, so this dashboard is reading a bundled fixture at <span class="mono">apps/dashboard/fixtures/arc-testnet.fixture.json</span> — schema-valid, addresses fake. Live contract reads below will fail against Arc until the real manifest lands; drop it in place and reload. Nothing here is deployed until it is.</div>`;
  }
  const error = manifestState.status !== "ready" ? manifestState.error : "";
  return `<div class="notice"><strong>No usable manifest:</strong> ${escapeHtml(error)}</div>`;
}

function staleNotice() {
  if (!stale) return "";
  const since = lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleTimeString() : "an unknown time";
  return `<div class="notice"><strong>STALE:</strong> the last live read failed. The state shown below is the last successful read, from ${since} — it is not confirmed current compliance.</div>`;
}

function previewLine() {
  if (drawPreview.status === "idle") return "";
  if (drawPreview.status === "pending") {
    return `<p class="footer-note mono">Previewing assess()…</p>`;
  }
  if (drawPreview.status === "error") {
    return `<p class="footer-note mono">Preview failed: ${escapeHtml(drawPreview.message)}</p>`;
  }
  const label = drawPreview.allowed ? "ALLOWED" : "REFUSED";
  const cls = drawPreview.allowed ? "status-compliant" : "status-breach";
  return `<p class="footer-note mono"><span class="${cls}">${label}</span> — ${resultReasons[drawPreview.reason] ?? "UNKNOWN"} — drawing ${formatUsd(drawPreview.amount)} would be assessed this way right now, per <span class="mono">ICoverageGate.assess</span> called from the vault's own address.</p>`;
}

function eurcLink() {
  const href = explorerUrl ? `${explorerUrl}/address/${EURC_ADDRESS}` : undefined;
  const inner = hashSpan(EURC_ADDRESS);
  return href ? `<a href="${href}" target="_blank" rel="noreferrer">${inner} ↗</a>` : inner;
}

function metric(label: string, value: string, className = "", isStale = false) {
  const staleTag = isStale ? ` <span class="stale-flag">STALE</span>` : "";
  return `<article class="metric"><span class="label">${label}</span><span class="value ${className}">${escapeHtml(value)}${staleTag}</span></article>`;
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
    return `<div class="empty">${configured ? "No recent protocol events found." : "Configure a deployment to read Arc events."}</div>`;
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

function arcEvidenceRows() {
  if (!arcEvidence?.steps.length) {
    return `<div class="empty">Awaiting <span class="mono">scenarios/arc-facility.ts</span> (Lane B). This panel reads <span class="mono">scenarios/output/arc-facility-evidence.json</span> automatically once that file exists — nothing fabricated shown in its place.</div>`;
  }
  return `<div class="timeline">${arcEvidence.steps
    .map((step) => {
      const action = typeof step.action === "string" ? step.action : "step";
      const hash = typeof step.transactionHash === "string" ? step.transactionHash : undefined;
      const expected = typeof step.expectedStatus === "string" ? step.expectedStatus : "—";
      const actual = typeof step.actualStatus === "string" ? step.actualStatus : "—";
      const reason =
        typeof step.resultReason === "number" ? resultReasons[step.resultReason] ?? "UNKNOWN" : "—";
      return `<div class="event">
        <div class="event-state">${escapeHtml(actual.toUpperCase())}</div>
        <div class="event-copy">${escapeHtml(action)} · expected ${escapeHtml(expected)} · reason ${escapeHtml(reason)}</div>
        <div class="event-meta">${hash ? transactionLink(hash as Hex) : "—"}</div>
      </div>`;
    })
    .join("")}</div>`;
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

function formatGrossBps(coverage: CoverageResult) {
  if (coverage.outstandingValue === 0n) return "—";
  const bps = Number((coverage.grossEligible * 10_000n) / coverage.outstandingValue);
  return formatBps(bps);
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

function disabledRead() {
  return busy || !configured ? "disabled" : "";
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
// CoverageEngine.ResultReason (contracts/src/CoverageEngine.sol). RESERVE_VIOLATION is
// the fifth member, added alongside ICoverageGate.assess — evaluate() never returns it,
// only assess() does, when the draw would breach reserveAmount.
const resultReasons = [
  "NONE",
  "MISSING_EXPOSURE",
  "INVALID_EXPOSURE",
  "BELOW_THRESHOLD",
  "RESERVE_VIOLATION",
];
