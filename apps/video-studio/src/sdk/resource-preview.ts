import type { RuntimeBridge } from "./panel-runtime";

/** Resolve an authorized inline media address without copying an entire source into memory. */
export async function resourcePreviewUrl(
  bridge: RuntimeBridge | undefined,
  id: string,
  signal?: AbortSignal,
  baseUrl = location.href,
): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(id)) throw new Error("素材资源编号无效");
  const aborted = () => {
    if (signal?.aborted) throw new DOMException("取消素材预览", "AbortError");
  };
  aborted();
  const context = await bridge?.getContext();
  aborted();
  if (!context?.availableMethods?.includes("resources.preview")) {
    if (context?.availableMethods?.includes("resources.open") || context?.host === "hub")
      throw new Error("当前云端或远程 Host 尚不支持面板内素材播放，请更新服务后重新打开面板");
    return new URL(`/media/${encodeURIComponent(id)}`, baseUrl).href;
  }
  if (!/^(?:asset|external)-[a-f0-9]{64}$/.test(id)) throw new Error("素材资源编号无效");
  const appId = context.appId, cwd = context.cwd;
  let value: any;
  if (bridge!.callResult) {
    const result = await bridge!.callResult("resources.preview", { assetId: id });
    if (!result.ok) throw new Error(result.error.message);
    value = result.value;
  } else value = await bridge!.call("resources.preview", { assetId: id });
  aborted();
  const current = await bridge!.getContext();
  aborted();
  if (current?.cwd !== cwd || current?.appId !== appId)
    throw new DOMException("项目已切换，取消旧素材预览", "AbortError");
  if (value?.asset?.id !== id || typeof value?.url !== "string")
    throw new Error("素材播放授权返回无效数据");
  const url = new URL(value.url, baseUrl);
  if (!/^https?:$/.test(url.protocol) || url.origin !== new URL(baseUrl).origin || url.username || url.password)
    throw new Error("素材播放地址不属于当前 Host");
  return url.href;
}
