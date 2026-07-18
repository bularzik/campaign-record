/**
 * Serialize async tasks so no two ever overlap, letting newer submissions
 * supersede queued ones: run(task) chains task behind all prior tasks; by
 * default a task that is no longer the most recent submission when its turn
 * arrives is skipped (resolves undefined). supersede:false tasks always run
 * (used for close, which must never be skipped). Errors reach run()'s caller
 * but never wedge the chain. No Foundry globals — unit-tested with vitest.
 */
export function createSerialQueue() {
  let chain = Promise.resolve();
  let latest = 0;
  return {
    run(task, { supersede = true } = {}) {
      const token = ++latest;
      const result = chain.then(() => {
        if (supersede && token !== latest) return undefined;
        return task();
      });
      chain = result.catch(() => {});
      return result;
    }
  };
}
