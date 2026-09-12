/** Browser recordings are kept as Blobs, never base64 in the project document. */
const DATABASE = "mimi-studio-recordings";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("recordings", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法保存本地录制，请先下载原始录制"));
  });
}
export async function cacheRecording(id: string, file: File): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("recordings", "readwrite");
      transaction
        .objectStore("recordings")
        .put({ id, blob: file, name: file.name, lastModified: file.lastModified });
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(new Error("录制存储空间不足，请先下载原始录制"));
    });
  } finally {
    db.close();
  }
}
export async function cachedRecording(id: string): Promise<File | null> {
  const db = await database();
  try {
    return await new Promise<File | null>((resolve, reject) => {
      const transaction = db.transaction("recordings", "readonly");
      const request = transaction.objectStore("recordings").get(id);
      request.onsuccess = () => {
        const result = request.result;
        resolve(
          result?.blob instanceof Blob
            ? new File([result.blob], result.name, {
                type: result.blob.type,
                lastModified: result.lastModified,
              })
            : null,
        );
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
