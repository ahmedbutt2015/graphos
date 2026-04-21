import { Annotation, StateGraph, START } from "@langchain/langgraph";
import { GraphOS, LoopGuard, PolicyViolationError } from "@graphos/sdk";

const State = Annotation.Root({
  ticks: Annotation<number>({
    reducer: (_, x) => x,
    default: () => 0,
  }),
});

const stuckGraph = new StateGraph(State)
  .addNode("think", (s) => ({ ticks: s.ticks }))
  .addNode("act", (s) => ({ ticks: s.ticks }))
  .addEdge(START, "think")
  .addEdge("think", "act")
  .addEdge("act", "think")
  .compile();

const managed = GraphOS.wrap(stuckGraph, {
  policies: [new LoopGuard({ maxRepeats: 3 })],
});

console.log("▶︎  running stuck graph with GraphOS LoopGuard...");

try {
  await managed.invoke({ ticks: 0 });
  console.error("✗  expected LoopGuard to halt the run — got a clean return");
  process.exit(1);
} catch (err) {
  if (err instanceof PolicyViolationError) {
    console.log(`✓  halted by ${err.policy}: ${err.reason}`);
    console.log("   details:", err.details);
    process.exit(0);
  }
  console.error("✗  unexpected error:", err);
  process.exit(1);
}
