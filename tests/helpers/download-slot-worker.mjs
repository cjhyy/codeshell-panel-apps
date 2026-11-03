// Owned IPC fixture for the production filesystem queue admission boundary.
import { createCliStore } from "../../apps/video-download/app/tools/cli-store.mjs";
const [project, id, attemptText, token, bootId] = process.argv.slice(2);
const attempt = Number(attemptText), store = await createCliStore(project);
await store.admitWorker(id, attempt, token, { bootId });
const release = await store.claimWorker(id, attempt, token);
await store.update(id, (record) => ({ ...record, status: "running", startedAt: Date.now() }));
process.on("message", async (message) => {
  if (message !== "finish") return;
  await store.update(id, ({ workerToken, ...record }) => ({ ...record, status: "completed" }));
  await store.releaseSlot(id, attempt, token);
  await release();
  process.send({ type: "finished" }, () => process.disconnect());
});
process.send({ type: "claimed", pid: process.pid });
