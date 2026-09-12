// Which steps a run of scenarios/arc-waiver-run.ts must send, and which are already on chain.
//
// A resumed run adopts transactions an interrupted attempt sent. The first version decided that
// per mode — "resuming" skipped the steps before the waiver — and so it adopted W-5 and then sent
// it again. The draw reverted during gas estimation and nothing reached the chain, but on a
// facility with drawable liquidity it would have drawn twice. The decision is per step here, and
// the one rule that matters is exhaustively tested: a step this run adopted is never sent.

export const PHASES = ["W-1", "W-2", "W-3", "W-4", "W-5", "W-6", "W-7"] as const;
export type Phase = (typeof PHASES)[number];

export type PlanInput = {
  /** Steps already on chain, named by --adopt. */
  adopted: readonly Phase[];
  /** A waiver already broadcast, named by --adopt-waiver. W-4 is then adopted rather than sent. */
  adoptedWaiver: boolean;
  /** W-7 re-observes the exposure. It runs only when asked for. */
  refreshExposure: boolean;
};

export type RunPlan = {
  /** In sequence order, the steps this run broadcasts. */
  send: readonly Phase[];
  /** Adopted: re-read from the chain and re-asserted, never re-sent. */
  skip: readonly Phase[];
  /** Whether the waiver is proposed and approved here, or adopted from an earlier attempt. */
  sendWaiver: boolean;
};

export function planRun(input: PlanInput): RunPlan {
  const adopted = new Set<Phase>(input.adopted);
  if (input.adoptedWaiver) adopted.add("W-4");
  const wanted = PHASES.filter((phase) => phase !== "W-7" || input.refreshExposure);
  return {
    send: wanted.filter((phase) => !adopted.has(phase)),
    skip: PHASES.filter((phase) => adopted.has(phase)),
    sendWaiver: !adopted.has("W-4"),
  };
}
