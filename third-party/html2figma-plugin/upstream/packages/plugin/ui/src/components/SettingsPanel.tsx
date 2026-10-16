import { useEffect, useState } from 'react';
import { Settings, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AVAILABLE_SERVER_URLS, DEFAULT_SERVER_URL } from '@/lib/server-config';

interface Props {
  serverUrl: string;
  onSave: (serverUrl: string) => void;
  open: boolean;
  onToggle: () => void;
}

export function SettingsPanel({ serverUrl, onSave, open, onToggle }: Props) {
  const [url, setUrl] = useState(serverUrl);

  useEffect(() => {
    if (open) setUrl(serverUrl);
  }, [open, serverUrl]);

  if (!open) return null;

  return (
    <div className="border-t border-border bg-muted/50">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5" />
            Settings
          </span>
          <button
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={onToggle}
          >
            Close
          </button>
        </div>
        <div className="space-y-1.5">
          <Label>Server URL</Label>
          <div className="space-y-1.5">
            <select
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-[11px]"
            >
              {AVAILABLE_SERVER_URLS.map((server) => (
                <option key={server} value={server}>
                  {server === DEFAULT_SERVER_URL ? `${server} (default)` : server}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground">
              Network origins are restricted by the plugin manifest.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          className="w-full"
          onClick={() => onSave(url)}
        >
          <Save className="w-3 h-3 mr-1.5" />
          Save Settings
        </Button>
      </div>
    </div>
  );
}
