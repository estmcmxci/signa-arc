/// <reference types="vite/client" />
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  formatUnits,
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

// The three outcomes a write can settle into (research §5.1). Only the last one is an
// error — a refusal is the coverage gate working, not the software breaking.
type WriteOutcome =
  | { kind: "permitted"; request: unknown }
  | { kind: "refused"; code: string; args: readonly unknown[] }
  | { kind: "reverted"; reason: string }
  | { kind: "abi-drift"; signature: Hex }
  | { kind: "errored"; message: string };

type GateState =
  | { status: "idle" }
  | { status: "pending"; amount: bigint }
  | { status: "permitted"; amount: bigint; request: unknown }
  | { status: "refused"; amount: bigint; code: string; args: readonly unknown[] }
  | { status: "errored"; amount: bigint; message: string };

type ActionOutcome = { action: string; outcome: WriteOutcome };

const facilityRegistryAbi = (facilityRegistryJson as ArtifactJson).abi;
const credentialRegistryAbi = (credentialRegistryJson as ArtifactJson).abi;
const coverageEngineAbi = (coverageEngineJson as ArtifactJson).abi;
const covenantVaultAbi = (covenantVaultJson as ArtifactJson).abi;
const mockTokenAbi = (mockTokenJson as ArtifactJson).abi;

// Fallback only — the real manifest carries this at `exposureDenomination` (E-EUR-1).
const FALLBACK_EURC_ADDRESS: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

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
const exposureAsset = manifest?.exposureDenomination?.referenceAsset ?? {
  address: FALLBACK_EURC_ADDRESS,
  decimals: 6,
  symbol: "EURC",
};

// Text label + shape, never colour alone (WCAG 1.4.1). BREACH is magenta, not red, so
// red stays free to mean the software failed (research §4.3, gitlab.com/design green+magenta).
// Declared before `render()` is first invoked below — it is called unconditionally on
// the initial synchronous render, so it must not sit in a later const's temporal dead zone.
const STATE_GLYPH: Record<string, string> = {
  UNASSESSED: "○",
  COMPLIANT: "●",
  CURE: "▲",
  BREACH: "⬣",
  WAIVED: "⊘",
  "READ FAILED": "■",
};
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
// only assess() does (and, transitively, a simulated draw()), when the draw would
// breach reserveAmount.
const resultReasons = [
  "NONE",
  "MISSING_EXPOSURE",
  "INVALID_EXPOSURE",
  "BELOW_THRESHOLD",
  "RESERVE_VIOLATION",
];

// Also declared ahead of `render()`/`refreshGate()`: calling an async function runs its
// body synchronously up to the first `await`, so the initial `void refreshGate()` below
// reaches `formatUsd` (via the "pending" gate copy) before the module finishes evaluating
// — anything that path touches has to be initialized above this line, not just above the
// bottom-of-file convention the rest of the formatting helpers otherwise follow.
const usdFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

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
let amountValue = "100000";
let gate: GateState = { status: "idle" };
let gateRequestId = 0;
let gateDebounce: ReturnType<typeof setTimeout> | undefined;
let lastActionOutcome: ActionOutcome | undefined;
let historyError = "";
const arcEvidence = loadArcEvidence();

render();
if (configured) {
  void refreshLive();
  void refreshGate();
}

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

// --- The coverage gate: simulate before every write (research §5.4, §6.4) ---------

async function simulateWrite(
  functionName: string,
  args: readonly unknown[],
  account: Address,
): Promise<WriteOutcome> {
  if (!addresses) return { kind: "errored", message: "No deployment configured." };
  try {
    const { request } = await publicClient.simulateContract({
      address: addresses.covenantVault,
      abi: covenantVaultAbi,
      functionName,
      args,
      account,
      chain: arcTestnet,
    } as never);
    return { kind: "permitted", request };
  } catch (error) {
    if (error instanceof BaseError) {
      const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        if (revert.data?.errorName) {
          return { kind: "refused", code: revert.data.errorName, args: revert.data.args ?? [] };
        }
        if (revert.signature) return { kind: "abi-drift", signature: revert.signature };
        if (revert.reason) return { kind: "reverted", reason: revert.reason };
      }
    }
    return { kind: "errored", message: errorText(error) };
  }
}

function scheduleGateRefresh() {
  if (gateDebounce) clearTimeout(gateDebounce);
  gateDebounce = setTimeout(() => void refreshGate(), 250);
}

// Always-on preflight for `draw`. Re-run on amount change and after every state
// refresh, so the gate strip is never news by the time the operator clicks Draw.
async function refreshGate() {
  if (!configured || !facilityId || !addresses || !manifest) {
    gate = { status: "idle" };
    renderGate();
    return;
  }
  const requestId = ++gateRequestId;
  let amount: bigint;
  try {
    amount = parseSixDecimals(amountValue);
  } catch {
    gate = { status: "idle" };
    renderGate();
    return;
  }
  gate = { status: "pending", amount };
  renderGate();
  const account = walletAddress ?? manifest.roles.operator;
  const outcome = await simulateWrite("draw", [amount], account);
  if (requestId !== gateRequestId) return; // a newer simulate superseded this one
  gate =
    outcome.kind === "permitted"
      ? { status: "permitted", amount, request: outcome.request }
      : outcome.kind === "refused"
        ? { status: "refused", amount, code: outcome.code, args: outcome.args }
        : {
            status: "errored",
            amount,
            message:
              outcome.kind === "reverted"
                ? outcome.reason
                : outcome.kind === "abi-drift"
                  ? `ABI drift — unknown selector ${outcome.signature}`
                  : outcome.message,
          };
  renderGate();
}

function render() {
  const stateName = live
    ? covenantStates[live.state] ?? "UNKNOWN"
    : configured
      ? "READ FAILED"
      : "UNCONFIGURED";
  const coverage = live?.coverage;
  root.innerHTML = `
    <main class="shell">
      <div class="truth-banner">Arc Testnet 5042002 · fictional facility · mock provider data — ${manifestBadge()}</div>
      <header class="masthead">
        <div>
          <div class="eyebrow">{ FX coverage control desk }</div>
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
      ${errorMessage ? `<div class="notice notice-error">${escapeHtml(errorMessage)}</div>` : ""}

      <section class="metrics" aria-label="Current coverage metrics">
        ${metric("Covenant state", stateGlyph(stateName) + " " + stateName, `status-${stateName.toLowerCase().replace(/\s+/g, "-")}`, stale, false)}
        ${metric("Counted coverage", coverage ? formatBps(coverage.coverageBps) : "—", "hero-figure", stale)}
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
          <div class="panel-head"><div><div class="section-kicker">Actions</div><h2>Coverage gate</h2></div><button id="connect" class="action">${walletAddress ? short(walletAddress) : "Connect wallet"}</button></div>
          <div id="draw-gate" class="gate gate-${gate.status}">${gateMarkup()}</div>
          <div class="controls">
            <input id="amount" inputmode="decimal" value="${escapeHtml(amountValue)}" aria-label="Amount in mock USD" class="num" />
            <button id="sync" class="action-primary" ${disabled()}>Sync covenant</button>
            <button id="restore" ${disabled()}>Restore</button>
            <button id="draw" ${disabled()}>Draw mUSD</button>
            <button id="repay" ${disabled()}>Repay mUSD</button>
          </div>
          ${actionOutcomeMarkup()}
          <p class="footer-note">Every write is simulated first via <span class="mono">simulateContract</span>; a refusal is decoded from the vault's own custom error and shown before anything is signed. The Draw button stays enabled when held — a refusal is the gate working, not a reason to hide the control.</p>
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
            ${datum(`Denominating asset (${exposureAsset.symbol}, referenced only)`, eurcLink())}
          </div>
          <p class="footer-note">${escapeHtml(manifest?.exposureDenomination?.note ?? "The exposure is a loan book in a servicing system, asserted under a signed ExposureCredential — never an onchain balance. The reference asset above is linked for context only: this vault never transfers, holds, or approves it. The portfolio is denominated in EUR; the facility is funded, drawn and repaid in USDC.")}</p>
        </article>

        <article class="panel">
          <div class="panel-head"><div><div class="section-kicker">Computed onchain</div><h2>Coverage result</h2></div><span class="mono">${coverage ? (resultReasons[coverage.resultReason] ?? "UNKNOWN") : "—"}</span></div>
          ${coverageBar()}
          <div class="policy-grid">
            ${datum("Gross eligible", coverage ? formatUsd(coverage.grossEligible) : "—")}
            ${datum("Gross coverage (uncapped)", coverage ? formatGrossBps(coverage) : "—")}
            ${datum("Counted eligible", coverage ? formatUsd(coverage.countedEligible) : "—")}
            ${datum("Counted coverage", coverage ? formatBps(coverage.coverageBps) : "—")}
            ${datum("Required", coverage ? formatBps(coverage.requiredCoverageBps) : "—")}
            ${datum("Delta to threshold", coverage ? formatBpsDelta(coverage.coverageBps, coverage.requiredCoverageBps) : "—")}
            ${datum("Eligible hedges", coverage ? `${coverage.eligibleHedgeCount} / ${coverage.totalHedgeCount}` : "—")}
            ${datum("Assessed", coverage ? String(coverage.assessed) : "—")}
          </div>
          <p class="footer-note">Gross and counted coverage are shown separately by design: over-hedging is visible in the gross figure (hatched above the cap), but only the counted figure — capped at 100% of the exposure — ever governs a draw (EED §6, R-F2-3).</p>
        </article>
      </section>

      <section class="panel">
        <div class="panel-head"><div><div class="section-kicker">Independent source B</div><h2>Active hedge credentials</h2></div><span class="mono">${live?.hedges.length ?? 0} active IDs</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Committed trade ID</th><th>Issuer</th><th class="num">Remaining</th><th>Status</th><th>Maturity</th><th>Expires</th><th>Eligibility</th></tr></thead>
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
  document.querySelector("#sync")?.addEventListener("click", () => void execute("sync"));
  document.querySelector("#restore")?.addEventListener("click", () => void execute("restore"));
  document.querySelector("#draw")?.addEventListener("click", () => void execute("draw"));
  document.querySelector("#repay")?.addEventListener("click", () => void execute("repay"));
  document.querySelector<HTMLInputElement>("#amount")?.addEventListener("input", (event) => {
    amountValue = (event.target as HTMLInputElement).value;
    scheduleGateRefresh();
  });
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
  void refreshGate();
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
      amount = parseSixDecimals(amountValue);
    }
  } catch (error) {
    errorMessage = errorText(error);
    render();
    return;
  }
  busy = true;
  errorMessage = "";
  lastActionOutcome = undefined;
  message = `Preparing ${action}…`;
  render();
  try {
    const wallet = createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum as never) });
    const [account] = await wallet.requestAddresses();
    if (!account) throw new Error("The wallet returned no account.");
    walletAddress = account;
    await wallet.switchChain({ id: arcTestnet.id });

    if (action === "repay") {
      // repay()'s only real refusal (InvalidAmount) is checked before transferFrom, so
      // it simulates correctly even with no allowance yet. A transferFrom-shaped revert
      // here is a missing-approval precondition, not a covenant decision — fall through.
      const preflight = await simulateWrite("repay", [amount], account);
      if (preflight.kind === "refused" || preflight.kind === "abi-drift") {
        lastActionOutcome = { action, outcome: preflight };
        message = "Repay held before signing — see below.";
        return;
      }
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
      const outcome = await simulateWrite(functionName, args, account);
      if (outcome.kind !== "permitted") {
        lastActionOutcome = { action, outcome };
        message = `${capitalize(action)} held before signing — see below.`;
        return;
      }
      await writeSimulatedRequest(wallet, outcome.request);
    }
    lastActionOutcome = { action, outcome: { kind: "permitted", request: undefined } };
    message = `${action} confirmed. Refreshing contract state…`;
    await refreshLive();
  } catch (error) {
    errorMessage = errorText(error);
    message = `${action} did not complete.`;
  } finally {
    busy = false;
    render();
    void refreshGate();
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

// Reuses the exact request simulateContract returned — the canonical viem pairing,
// so what was simulated is what gets sent (research §5.4/§6.4).
async function writeSimulatedRequest(wallet: ReturnType<typeof createWalletClient>, request: unknown) {
  const hash = await wallet.writeContract(request as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("Transaction reverted on-chain after simulation passed — state changed between simulate and send.");
  }
}

// Arc's public RPC rejects eth_getLogs over a wide range with -32012 "requested range
// too large" (confirmed against rpc.testnet.arc.network directly — the exact cap isn't
// documented and the RPC also rate-limits under repeated calls, -32005). 2,000 blocks
// stays comfortably under both observed thresholds.
const HISTORY_BLOCK_WINDOW = 2_000n;

async function loadHistory(): Promise<HistoryItem[]> {
  if (!addresses) return [];
  let logs;
  try {
    const currentBlock = await publicClient.getBlockNumber();
    const fromBlock =
      currentBlock > HISTORY_BLOCK_WINDOW ? currentBlock - HISTORY_BLOCK_WINDOW : 0n;
    logs = await publicClient.getLogs({
      address: [
        addresses.facilityRegistry,
        addresses.credentialRegistry,
        addresses.covenantVault,
      ],
      fromBlock,
      toBlock: "latest",
    } as never);
    historyError = "";
  } catch (error) {
    // A degraded history read must never take the whole live read down with it — the
    // facility policy, coverage, and state are already known-good by the time this
    // runs, and history is the least essential thing on the page (E-UI-5: the failure
    // state should be as narrow as what actually failed, not the whole dashboard).
    historyError = errorText(error);
    return [];
  }
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

// --- Refusal copy: control as the actor, plain sentence before the code (§5.7) ----

function decodeCustomError(
  code: string,
  args: readonly unknown[],
): { headline: string; body: string; remedy: string } {
  if (code === "DrawNotAllowed") {
    const state = typeof args[0] === "number" ? covenantStates[args[0]] ?? "UNKNOWN" : "UNKNOWN";
    const coverageLine = live?.coverage
      ? `Coverage is ${formatBps(live.coverage.coverageBps)}. Facility requires ${formatBps(live.coverage.requiredCoverageBps)}.`
      : "";
    return {
      headline: "The coverage covenant holds this draw.",
      body: `${coverageLine} Covenant state is ${state}.`.trim(),
      remedy:
        "To release this draw, add eligible cover or repay to reduce exposure — repayment is available in every state. Often the cause is a stale credential: sync after a fresh attestation.",
    };
  }
  if (code === "ReserveViolation") {
    const [balance, requested, reserve] = args as [bigint, bigint, bigint];
    return {
      headline: "The retained reserve holds this draw.",
      body: `Drawing ${formatUsd(requested)} would leave ${formatUsd(balance - requested)} in the vault, below the ${formatUsd(reserve)} reserve floor.`,
      remedy: "Reduce the amount, or deposit additional funds first.",
    };
  }
  if (code === "NotOperator" || code === "NotAdmin") {
    return {
      headline: "This account does not hold the required role.",
      body: `${code} — the connected wallet is not the facility's authorised signer for this action.`,
      remedy: "Connect the operator or admin wallet for this facility.",
    };
  }
  if (code === "InvalidAmount") {
    return {
      headline: "The vault holds this call.",
      body: "The amount is zero, or exceeds outstanding principal for a repayment.",
      remedy: "Enter a positive amount within the applicable limit.",
    };
  }
  return {
    headline: "The vault declined this call.",
    body: `${code}${args.length ? `(${args.map(formatUnknown).join(", ")})` : ""}`,
    remedy: "",
  };
}

function gateMarkup(): string {
  if (!configured) {
    return `<span class="gate-word">—</span> No manifest to simulate against.`;
  }
  switch (gate.status) {
    case "idle":
      return `<span class="gate-word">—</span> Enter an amount to preview the coverage gate.`;
    case "pending":
      return `<span class="gate-glyph">○</span><span class="gate-word gate-pending">EVALUATING</span> Simulating draw of ${formatUsd(gate.amount)}…`;
    case "permitted": {
      const deltaLine = live?.coverage
        ? formatBpsDelta(live.coverage.coverageBps, live.coverage.requiredCoverageBps)
        : "";
      return `<span class="gate-glyph">●</span><span class="gate-word gate-open">OPEN</span> The coverage covenant permits drawing ${formatUsd(gate.amount)}.${deltaLine ? ` ${deltaLine}.` : ""}`;
    }
    case "refused": {
      const { headline, body, remedy } = decodeCustomError(gate.code, gate.args);
      return `
        <div class="gate-line"><span class="gate-glyph">▲</span><span class="gate-word gate-hold">HOLD</span> ${escapeHtml(headline)}</div>
        <p class="gate-body">${escapeHtml(body)}</p>
        ${remedy ? `<p class="gate-remedy">${escapeHtml(remedy)}</p>` : ""}
        <p class="gate-code mono">${escapeHtml(gate.code)}</p>
      `;
    }
    case "errored":
      return `<span class="gate-glyph">■</span><span class="gate-word gate-error">READ FAILED</span> Could not evaluate this draw: ${escapeHtml(gate.message)}`;
  }
}

function renderGate() {
  const node = document.querySelector<HTMLDivElement>("#draw-gate");
  if (!node) return;
  node.className = `gate gate-${gate.status}`;
  node.innerHTML = gateMarkup();
}

function actionOutcomeMarkup() {
  if (!lastActionOutcome) return "";
  const { action, outcome } = lastActionOutcome;
  if (outcome.kind === "permitted") {
    return `<p class="footer-note outcome outcome-permitted">${capitalize(action)} permitted and sent.</p>`;
  }
  if (outcome.kind === "refused") {
    const { headline, body, remedy } = decodeCustomError(outcome.code, outcome.args);
    return `<div class="outcome outcome-refused">
      <p><span class="gate-glyph">▲</span><strong>${escapeHtml(headline)}</strong></p>
      <p class="footer-note">${escapeHtml(body)}</p>
      ${remedy ? `<p class="footer-note">${escapeHtml(remedy)}</p>` : ""}
      <p class="footer-note mono">${escapeHtml(outcome.code)}</p>
    </div>`;
  }
  if (outcome.kind === "abi-drift") {
    return `<div class="outcome outcome-errored"><p><span class="gate-glyph">■</span><strong>ABI drift.</strong></p><p class="footer-note">Unknown selector ${escapeHtml(outcome.signature)} — the dashboard's ABI does not match the deployed contract. This is a build problem, not a covenant decision.</p></div>`;
  }
  if (outcome.kind === "reverted") {
    return `<div class="outcome outcome-refused"><p><span class="gate-glyph">▲</span><strong>The vault declined this call.</strong></p><p class="footer-note">${escapeHtml(outcome.reason)}</p></div>`;
  }
  return `<div class="outcome outcome-errored"><p><span class="gate-glyph">■</span><strong>Could not evaluate this ${escapeHtml(action)}.</strong></p><p class="footer-note">${escapeHtml(outcome.message)}</p></div>`;
}

function eurcLink() {
  const href = explorerUrl ? `${explorerUrl}/address/${exposureAsset.address}` : undefined;
  const inner = hashSpan(exposureAsset.address);
  return href ? `<a href="${href}" target="_blank" rel="noreferrer">${inner} ↗</a>` : inner;
}

function coverageBar() {
  const coverage = live?.coverage;
  if (!coverage || coverage.outstandingValue === 0n) return "";
  const countedPct = Math.min(100, Number((coverage.countedEligible * 10_000n) / coverage.outstandingValue) / 100);
  const grossPct = Math.min(150, Number((coverage.grossEligible * 10_000n) / coverage.outstandingValue) / 100);
  const thresholdPct = Math.min(100, coverage.requiredCoverageBps / 100);
  const overCap = Math.max(0, grossPct - 100);
  return `
    <div class="coverage-bar" role="img" aria-label="Counted coverage ${formatBps(coverage.coverageBps)} of a ${formatBps(coverage.requiredCoverageBps)} minimum; gross coverage ${formatGrossBps(coverage)}">
      <div class="coverage-bar-track">
        <div class="coverage-bar-counted" style="width:${countedPct}%"></div>
        ${overCap > 0 ? `<div class="coverage-bar-uncounted" style="left:100%;width:${overCap}%"></div>` : ""}
        <div class="coverage-bar-threshold" style="left:${thresholdPct}%" title="Minimum coverage ${formatBps(coverage.requiredCoverageBps)}"></div>
      </div>
      <div class="coverage-bar-caption">
        <span>0%</span>
        <span>${formatBps(coverage.requiredCoverageBps)} min</span>
        <span>100% cap</span>
      </div>
    </div>
  `;
}

function metric(label: string, value: string, className = "", isStale = false, numeric = true) {
  const staleTag = isStale ? ` <span class="stale-flag">STALE</span>` : "";
  const numCls = numeric ? "num" : "";
  return `<article class="metric"><span class="label">${label}</span><span class="value ${numCls} ${className}">${escapeHtml(value)}${staleTag}</span></article>`;
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
        <td class="num">${formatUsd(hedge.credential.remainingNotional)}</td>
        <td>${hedgeStatuses[hedge.credential.status] ?? "UNKNOWN"}</td>
        <td>${formatTimestamp(hedge.credential.maturity)}</td>
        <td>${formatTimestamp(hedge.credential.validUntil)}</td>
        <td>${hedgeReasons[hedge.eligibilityReason] ?? "UNKNOWN"}</td>
      </tr>`,
    )
    .join("");
}

function liveHistoryRows() {
  if (historyError) {
    return `<div class="empty">Could not read recent events: ${escapeHtml(historyError)}. The panels above are unaffected — this read is independent.</div>`;
  }
  if (!live?.history.length) {
    return `<div class="empty">${configured ? "No recent protocol events found in the last ~2,000 blocks." : "Configure a deployment to read Arc events."}</div>`;
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
  const sign = value < 0n ? "−" : "";
  const abs = value < 0n ? -value : value;
  // formatUnits gives an exact decimal string; Intl.NumberFormat accepts strings and
  // BigInts as exact decimals at runtime (no float round-trip) per ECMA-402 — see
  // research §6.8. TS's lib for this project's target predates that overload, hence
  // the cast; the behaviour is verified, not a type-safety hole in real precision.
  return `${sign}$${usdFormatter.format(formatUnits(abs, 6) as unknown as number)}`;
}

// bps is already an on-chain integer (Solidity/BigInt division both truncate toward
// zero), so dividing by 100 here never rounds up past the true value — this is the
// "floor, don't round" requirement satisfied by construction, not by an extra Math.floor.
function formatBps(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function formatBpsDelta(observedBps: number, requiredBps: number) {
  const delta = observedBps - requiredBps;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${Math.abs(delta)} bp ${delta >= 0 ? "above" : "below"} the ${formatBps(requiredBps)} minimum`;
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

function stateGlyph(stateName: string) {
  return STATE_GLYPH[stateName] ?? "○";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
