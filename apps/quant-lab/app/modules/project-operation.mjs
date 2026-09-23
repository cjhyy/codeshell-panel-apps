// A controller reset invalidates work even when the Host has not changed its
// epoch yet. This stops subsequent calls, not effects already accepted by Host.
export function createProjectOperations(hostCall, currentEpoch = () => 0) {
  let generation = 0;
  return {
    reset() {
      generation++;
    },
    capture(epoch = currentEpoch()) {
      const capturedGeneration = generation;
      const isCurrent = () => epoch === currentEpoch() && capturedGeneration === generation;
      const check = () => {
        if (!isCurrent()) throw new Error("项目已切换；旧操作不再继续");
      };
      return {
        isCurrent,
        check,
        async call(method, params) {
          check();
          const result = await hostCall(method, params);
          check();
          return result;
        },
      };
    },
  };
}
