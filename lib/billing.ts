/** SaaS billing defaults for new Clerk users. */
export const DEFAULT_FREE_CREDITS = 50;
export const DEFAULT_USER_PLAN = "FREE";

/** 1 virtual human = 1 credit. */
export function computeSwarmCreditCost(agentCount: number): number {
  return Math.max(1, Math.floor(agentCount));
}
