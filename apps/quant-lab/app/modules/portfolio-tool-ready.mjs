// Resolve only Host identity and this identity's base ledger. Research, history
// metadata, FX and other modules are deliberately outside the readiness chain.
export function createPortfolioBaseReady({ identityReady, getIdentity, loadBase }) {
  return async () => {
    await identityReady;
    const expected = getIdentity();
    await loadBase(expected.epoch);
    const current = getIdentity();
    if (expected.epoch !== current.epoch || expected.executionId !== current.executionId)
      throw new Error("持仓工具执行身份已切换，请重新发起");
    return expected;
  };
}
