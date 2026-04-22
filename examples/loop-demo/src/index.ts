import { Annotation, StateGraph, START } from "@langchain/langgraph";
import {
  GraphOS,
  LoopGuard,
  PolicyViolationError,
  createWebSocketTransport,
} from "@graphos/sdk";

const State = Annotation.Root({
  ticks: Annotation<number>({
    reducer: (_, x) => x,
    default: () => 0,
  }),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stuckGraph = new StateGraph(State)
  .addNode("think", async (s) => {
    await sleep(400);
    return { ticks: s.ticks };
  })
  .addNode("act", async (s) => {
    await sleep(400);
    return { ticks: s.ticks };
  })
  .addEdge(START, "think")
  .addEdge("think", "act")
  .addEdge("act", "think")
  .compile();

const managed = GraphOS.wrap(stuckGraph, {
  projectId: "loop-demo",
  policies: [new LoopGuard({ maxRepeats: 3 })],
  onTrace: createWebSocketTransport(),
});

console.log("▶︎  running stuck graph with GraphOS LoopGuard...");
console.log("   (dashboard: http://localhost:4000 — start with `pnpm --filter @graphos/dashboard dev`)");

try {
  await managed.invoke({ ticks: 0 });
  console.error("✗  expected LoopGuard to halt the run — got a clean return");
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
