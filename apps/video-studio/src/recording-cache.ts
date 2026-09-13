/** Keep original media bytes outside the project JSON. Retain the recording database for upgrades. */
const DATABASE = "mimi-studio-recordings";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let settled = false;
    request.onupgradeneeded = () =>
      request.result.createObjectStore("recordings", { keyPath: "id" });
    request.onsuccess = () => {
      if (settled) request.result.close();
      else {
        settled = true;
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
    request.onerror = () => {
      settled = true;
      reject(request.error);
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("本地素材缓存被其他窗口占用，请关闭其他视频工作台后重试"));
    };
  });
}

function cacheError(action: "save" | "read", cause: unknown): Error {
  if (action === "read")
    return new Error("无法读取本地素材缓存。原有工程已保留，请检查存储权限或重新选择原文件。", {
      cause,
    });
  const quota = cause instanceof DOMException && cause.name === "QuotaExceededError";
  return new Error(
    quota
      ? "本地存储空间不足，素材尚未保存。请释放空间后重新导入，并保留原文件。"
      : "本地素材缓存写入失败，素材尚未保存。请检查存储权限和可用空间后重新导入，并保留原文件。",
    { cause },
  );
}

export async function cacheMediaFile(id: string, file: File): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    const connection = db;
    await new Promise<void>((resolve, reject) => {
      const transaction = connection.transaction("recordings", "readwrite");
      // A successful put can still be rolled back. Publish project metadata only after commit.
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
      const request = transaction
        .objectStore("recordings")
        .put({ id, blob: file, name: file.name, lastModified: file.lastModified });
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    throw cacheError("save", error);
  } finally {
    db?.close();
  }
}

export async function cachedMediaFile(id: string): Promise<File | null> {
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    const connection = db;
    return await new Promise<File | null>((resolve, reject) => {
      const transaction = connection.transaction("recordings", "readonly");
      const request = transaction.objectStore("recordings").get(id);
      transaction.oncomplete = () => {
        const result = request.result;
        if (result === undefined) return resolve(null);
        if (
          !result ||
          !(result.blob instanceof Blob) ||
          typeof result.name !== "string" ||
          !Number.isSafeInteger(result.lastModified)
        ) {
          reject(new Error("本地素材缓存不完整"));
          return;
        }
        resolve(
          new File([result.blob], result.name, {
            type: result.blob.type,
            lastModified: result.lastModified,
          }),
        );
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    throw cacheError("read", error);
  } finally {
    db?.close();
  }
}

/** Compatibility exports for recordings saved by earlier Panel versions. */
export const cacheRecording = cacheMediaFile;
export const cachedRecording = cachedMediaFile;
