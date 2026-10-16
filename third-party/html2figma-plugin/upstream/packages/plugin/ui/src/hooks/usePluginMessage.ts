import { useEffect } from 'react';
import { onPluginMessage } from '@/lib/message';

/**
 * Listen for specific message types from the plugin code.
 * @param handlers  Map of type → callback
 */
export function usePluginMessage(handlers: Record<string, (data: any) => void>) {
  useEffect(() => {
    return onPluginMessage((type, data) => {
      handlers[type]?.(data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
