/**
 * Image pre-processing pipeline.
 * Walks the FigmaJSON tree, fetches remote images via proxy,
 * and converts unsupported formats (WebP/AVIF/BMP/TIFF) to PNG.
 */

const UNSUPPORTED_MIMES = ['image/webp', 'image/avif', 'image/bmp', 'image/tiff'];

/** Fetch a remote image as base64 through the server proxy */
async function fetchImageBase64(url: string, serverUrl: string): Promise<string | undefined> {
  if (!url || url.startsWith('data:')) return url;
  try {
    const proxyUrl = `${serverUrl}/api/image-proxy?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/** Convert an unsupported image format to PNG via canvas */
function convertToPng(dataUri: string): Promise<string> {
  return new Promise((resolve) => {
    const raw = atob(dataUri.split(',')[1]);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    const mime = dataUri.substring(5, dataUri.indexOf(';'));
    const blob = new Blob([arr], { type: mime });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(dataUri);
    };
    img.src = url;
  });
}

/** Collect all image fetch tasks from the FigmaJSON tree */
function collectImageTasks(
  node: any,
  tasks: Array<() => Promise<void>>,
  serverUrl: string
) {
  if (!node || typeof node !== 'object') return;

  // node.imageMetadata
  if (node.imageMetadata?.originalUrl && !node.imageMetadata.base64) {
    const meta = node.imageMetadata;
    tasks.push(async () => {
      const b64 = await fetchImageBase64(meta.originalUrl, serverUrl);
      if (b64) meta.base64 = b64;
    });
  }

  // fills[]._imageMetadata
  if (Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.type === 'IMAGE' && fill._imageMetadata?.originalUrl && !fill._imageMetadata.base64) {
        const meta = fill._imageMetadata;
        tasks.push(async () => {
          const b64 = await fetchImageBase64(meta.originalUrl, serverUrl);
          if (b64) meta.base64 = b64;
        });
      }
    }
  }

  // Recurse
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectImageTasks(child, tasks, serverUrl);
  }
}

/** Ensure all images are in Figma-compatible formats (PNG/JPEG/GIF) */
async function ensureCompatible(node: any): Promise<void> {
  if (!node || typeof node !== 'object') return;
  const tasks: Promise<void>[] = [];

  if (node.imageMetadata?.base64) {
    const b64 = node.imageMetadata.base64 as string;
    if (b64.startsWith('data:')) {
      const mime = b64.substring(5, b64.indexOf(';'));
      if (UNSUPPORTED_MIMES.includes(mime)) {
        tasks.push(convertToPng(b64).then((png) => { node.imageMetadata.base64 = png; }));
      }
    }
  }

  if (Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.type === 'IMAGE' && fill._imageMetadata?.base64) {
        const b64 = fill._imageMetadata.base64 as string;
        if (b64.startsWith('data:')) {
          const mime = b64.substring(5, b64.indexOf(';'));
          if (UNSUPPORTED_MIMES.includes(mime)) {
            tasks.push(convertToPng(b64).then((png) => { fill._imageMetadata.base64 = png; }));
          }
        }
      }
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) tasks.push(ensureCompatible(child));
  }

  await Promise.all(tasks);
}

export interface ProcessProgress {
  phase: 'fetching' | 'converting' | 'done';
  current: number;
  total: number;
}

/**
 * Full image pre-processing pipeline:
 * 1. Fetch remote images via server proxy → base64
 * 2. Convert unsupported formats → PNG
 */
export async function preProcessImages(
  data: any,
  serverUrl: string,
  onProgress?: (p: ProcessProgress) => void
): Promise<any> {
  if (!data) return data;

  // Phase 1: Fetch remote images
  const tasks: Array<() => Promise<void>> = [];
  collectImageTasks(data, tasks, serverUrl);

  if (tasks.length > 0) {
    let done = 0;
    onProgress?.({ phase: 'fetching', current: 0, total: tasks.length });
    await Promise.all(
      tasks.map((task) =>
        task().finally(() => {
          done++;
          onProgress?.({ phase: 'fetching', current: done, total: tasks.length });
        })
      )
    );
  }

  // Phase 2: Convert unsupported formats
  onProgress?.({ phase: 'converting', current: 0, total: 1 });
  await ensureCompatible(data);
  onProgress?.({ phase: 'done', current: 1, total: 1 });

  return data;
}
