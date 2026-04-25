# @graphos-io/core

Shared types for [`@graphos-io/sdk`](https://www.npmjs.com/package/@graphos-io/sdk) and [`@graphos-io/dashboard`](https://www.npmjs.com/package/@graphos-io/dashboard).

```bash
npm install @graphos-io/core
```

You usually don't depend on this directly — it's pulled in by the SDK. Install it explicitly only if you're writing your own policy or transport.

## Exports

- `Policy<TState>` — interface for halting/continuing a run
- `PolicyDecision`, `PolicyContext`
- `NodeExecution<TState>` — what your policy sees per step
- `TraceEvent<TState>` — discriminated union: `session.start | step | policy.halt | session.end`
- `TraceListener<TState>` — `(event) => void | Promise<void>`
- `SessionId`, `NodeId` — branded string types
- Helpers: `cont()`, `halt(policy, reason, details?)`

## Writing a custom policy

```typescript
import { type Policy, cont, halt } from "@graphos-io/core";

class FirstStepGate implements Policy {
  readonly name = "FirstStepGate";
  observe(exec) {
    if (exec.step === 0 && exec.node !== "validator") {
      return halt(this.name, `expected to start at validator, got "${exec.node}"`);
    }
    return cont();
  }
}
```

Pass it to `GraphOS.wrap({ policies: [new FirstStepGate()] })`.

## License

MIT
