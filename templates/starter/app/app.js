const workspace = document.querySelector("#workspace");
const status = document.querySelector("#status");
const count = document.querySelector("#count");
const increment = document.querySelector("#increment");

let clicks = 0;

function renderContext(context) {
  workspace.textContent = context?.cwd || "未绑定项目";
  workspace.title = context?.cwd || "未绑定项目";
  status.textContent = context?.trusted ? "可信工作区" : "只读上下文";
  status.dataset.ready = context?.trusted ? "true" : "false";
}

increment.addEventListener("click", () => {
  clicks += 1;
  count.textContent = `${clicks} 次点击`;
});

const bridge = window.codeshellPanel;
if (!bridge) {
  renderContext({ cwd: "浏览器预览", trusted: false });
} else {
  let contextChanged = false;
  const unsubscribe = bridge.on("context.changed", (context) => {
    contextChanged = true;
    renderContext(context);
  });
  window.addEventListener("pagehide", () => unsubscribe(), { once: true });
  try {
    const context = await bridge.getContext();
    // A project selected while discovery was pending owns the current view.
    if (!contextChanged) renderContext(context);
  } catch {
    if (!contextChanged) {
      workspace.textContent = "无法读取项目，请重新打开面板";
      status.textContent = "连接失败";
      status.dataset.ready = "false";
    }
  }
}
