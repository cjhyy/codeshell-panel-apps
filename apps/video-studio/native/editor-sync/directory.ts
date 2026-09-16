import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { SnapshotSyncError } from "../../src/editor/snapshot-sync";

const changed = (): never => {
  throw new SnapshotSyncError("DIRECTORY_CHANGED", "同步目录已被替换或包含符号链接，请重新连接");
};
export const sameIdentity = (a: Pick<Stats, "dev" | "ino">, b: Pick<Stats, "dev" | "ino">) =>
  a.dev === b.dev && a.ino === b.ino;
/** Only fixed components and validated digest/token names reach this guard. No JSON pathname authority. */
export async function openSyncDirectory(
  root: string,
  components: string[],
  create: boolean,
  signal: AbortSignal,
) {
  const held: Array<{ path: string; handle: FileHandle; identity: Stats }> = [];
  const close = async () => {
    await Promise.all(held.map((item) => item.handle.close().catch(() => {})));
  };
  const verify = async (cleaning = false) => {
    if (!cleaning) signal.throwIfAborted();
    for (const item of held) {
      const current = await lstat(item.path);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        !sameIdentity(current, item.identity)
      )
        changed();
    }
  };
  try {
    const original = await lstat(root);
    if (!original.isDirectory() || original.isSymbolicLink()) changed();
    let current = await realpath(root);
    for (let index = -1; index < components.length; index++) {
      if (index >= 0 && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(components[index]!)) changed();
      await verify();
      if (index >= 0) current = join(current, components[index]!);
      const parent = held.at(-1),
        path =
          parent && process.platform === "linux"
            ? `/proc/self/fd/${parent.handle.fd}/${components[index]}`
            : current;
      if (index >= 0 && create)
        await mkdir(path, { mode: 0o700 }).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
      const handle = await open(
        path,
        constants.O_RDONLY |
          (constants.O_NOFOLLOW ?? 0) |
          (constants.O_DIRECTORY ?? 0) |
          (constants.O_NONBLOCK ?? 0),
      );
      const identity = await handle.stat().catch(async (error) => {
        await handle.close();
        throw error;
      });
      held.push({ path: current, handle, identity });
      if (!identity.isDirectory() || (index === -1 && !sameIdentity(identity, original))) changed();
    }
    await verify();
    const leaf = held.at(-1)!;
    return {
      path: leaf.path,
      location: (name: string) => {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) changed();
        return process.platform === "linux"
          ? `/proc/self/fd/${leaf.handle.fd}/${name}`
          : join(leaf.path, name);
      },
      verify,
      sync: async () => {
        await verify(true);
        await leaf.handle.sync();
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
export type SyncDirectory = Awaited<ReturnType<typeof openSyncDirectory>>;
export async function openSyncFile(directory: SyncDirectory, name: string) {
  await directory.verify();
  const path = directory.location(name),
    info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new SnapshotSyncError("UNSAFE_FILE", "同步对象不是普通文件");
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = await file.stat();
    if (!opened.isFile() || !sameIdentity(opened, info)) changed();
    await directory.verify();
    return { file, info: opened, path };
  } catch (error) {
    await file.close();
    throw error;
  }
}
