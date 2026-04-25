import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import {
  GraphOS,
  BudgetGuard,
  PolicyViolationError,
  createWebSocketTransport,
} from "@graphos-io/sdk";

const State = Annotation.Root({
  turn: Annotation<number>({
    reducer: (_, x) => x,
    default: () => 0,
  }),
  done: Annotation<boolean>({
    reducer: (_, x) => x,
    default: () => false,
  }),
});

type S = typeof State.State;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COST_PER_NODE: Record<string, number> = {
  plan: 0.04,
  research: 0.18,
  draft: 0.22,
  critique: 0.12,
};

const pricyGraph = new StateGraph(State)
  .addNode("plan", async (s: S) => {
    await sleep(400);
    return { turn: s.turn + 1 };
  })
  .addNode("research", async (s: S) => {
    await sleep(500);
    return { turn: s.turn + 1 };
  })
  .addNode("draft", async (s: S) => {
    await sleep(500);
    return { turn: s.turn + 1 };
  })
  .addNode("critique", async (s: S) => {
    await sleep(400);
    return { turn: s.turn + 1, done: s.turn >= 6 };
  })
  .addEdge(START, "plan")
  .addEdge("plan", "research")
  .addEdge("research", "draft")
  .addEdge("draft", "critique")
  .addConditionalEdges("critique", (s: S) => (s.done ? END : "research"))
  .compile();

const managed = GraphOS.wrap(pricyGraph, {
  projectId: "budget-demo",
  policies: [
    new BudgetGuard<S>({
      usdLimit: 0.5,
      cost: (exec) => COST_PER_NODE[exec.node] ?? 0,
    }),
  ],
  onTrace: createWebSocketTransport(),
});

console.log("▶︎  running pricey graph with GraphOS BudgetGuard (limit $0.50)...");
console.log(
  "   (dashboard: http://localhost:4000 — start with `pnpm --filter @graphos-io/dashboard dev`)"
);

try {
  await managed.invoke({ turn: 0, done: false });
  console.error("✗  expected BudgetGuard to halt the run — got a clean return");
  process.exit(1);
} catch (err) {
  if (err instanceof PolicyViolationError) {
    console.log(`✓  halted by ${err.policy}: ${err.reason}`);
    console.log("   details:", err.details);
    await sleep(500);
    process.exit(0);
  }
  console.error("✗  unexpected error:", err);
  process.exit(1);
}
