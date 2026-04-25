import type { PolicyDecision } from "@graphos-io/core";

type HaltDecision = Extract<PolicyDecision, { kind: "halt" }>;

export class PolicyViolationError extends Error {
  readonly policy: string;
  readonly reason: string;
  readonly details: unknown;

  constructor(decision: HaltDecision) {
    super(`[${decision.policy}] ${decision.reason}`);
    this.name = "PolicyViolationError";
    this.policy = decision.policy;
    this.reason = decision.reason;
    this.details = decision.details;
  }
}
