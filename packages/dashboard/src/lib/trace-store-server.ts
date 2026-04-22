import { createTraceStore } from "../../lib/trace-store.mjs";

type TraceStore = ReturnType<typeof createTraceStore>;

const globalStore = globalThis as unknown as {
  __graphosTraceStore?: TraceStore;
};

export const getTraceStore = (): TraceStore => {
  if (!globalStore.__graphosTraceStore) {
    globalStore.__graphosTraceStore = createTraceStore();
  }
  return globalStore.__graphosTraceStore;
};
