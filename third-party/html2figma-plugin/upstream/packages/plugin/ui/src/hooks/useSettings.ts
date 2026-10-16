import { useState, useEffect, useCallback } from 'react';
import { sendToPlugin, onPluginMessage } from '@/lib/message';
import { clearKeyCache } from '@/lib/dsl-codec';
import { DEFAULT_SERVER_URL, normalizeServerUrl } from '@/lib/server-config';

export interface Settings {
  serverUrl: string;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({ serverUrl: DEFAULT_SERVER_URL });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Request settings on mount
    sendToPlugin('load-settings');

    return onPluginMessage((type, data) => {
      if (type === 'settings-loaded') {
        setSettings({ serverUrl: normalizeServerUrl(data?.serverUrl) });
        setLoaded(true);
      } else if (type === 'settings-saved') {
        // noop, already updated locally
      }
    });
  }, []);

  const updateSettings = useCallback((next: Partial<Settings>) => {
    const nextServerUrl = next.serverUrl
      ? normalizeServerUrl(next.serverUrl)
      : settings.serverUrl;
    const merged = { ...settings, ...next, serverUrl: nextServerUrl };
    if (nextServerUrl !== settings.serverUrl) {
      clearKeyCache();
    }
    setSettings(merged);
    sendToPlugin('save-settings', merged);
  }, [settings]);

  return { settings, loaded, updateSettings };
}
