/** Send a typed message to the plugin code (sandbox) */
export function sendToPlugin(type: string, data?: any) {
  parent.postMessage({ pluginMessage: { type, data } }, '*');
}

export type PluginMessageHandler = (type: string, data: any) => void;

/** Listen for messages from plugin code */
export function onPluginMessage(handler: PluginMessageHandler) {
  const listener = (event: MessageEvent) => {
    const msg = event.data?.pluginMessage;
    if (msg?.type) handler(msg.type, msg.data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
