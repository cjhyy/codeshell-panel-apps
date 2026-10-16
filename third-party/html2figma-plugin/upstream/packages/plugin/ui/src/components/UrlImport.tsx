import { useState, useCallback } from 'react';
import { Globe, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { convertUrl } from '@/lib/api';
import { preProcessImages } from '@/lib/image-processor';
import { sendToPlugin } from '@/lib/message';

interface Props {
  serverUrl: string;
}

export function UrlImport({ serverUrl }: Props) {
  const [url, setUrl] = useState('');
  const [selector, setSelector] = useState('');
  const [width, setWidth] = useState(1440);
  const [height, setHeight] = useState(900);
  const [showOptions, setShowOptions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const handleConvert = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setStatus({ type: 'info', text: 'Converting URL...' });

    try {
      const figmaJSON = await convertUrl(serverUrl, {
        url: url.trim(),
        selector: selector.trim() || undefined,
        width,
        height,
      });

      setStatus({ type: 'info', text: 'Processing images...' });
      await preProcessImages(figmaJSON, serverUrl);

      sendToPlugin('import-design', { designData: figmaJSON, name: new URL(url.trim()).hostname });
      setStatus({ type: 'success', text: 'Sent to Figma!' });
      setUrl('');
    } catch (err: any) {
      setStatus({ type: 'error', text: err.message || 'Conversion failed' });
    } finally {
      setLoading(false);
    }
  }, [url, selector, width, height, serverUrl]);

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5" />
          Website URL
        </Label>
        <Input
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConvert()}
          disabled={loading}
        />
      </div>

      <button
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setShowOptions(!showOptions)}
      >
        {showOptions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Advanced Options
      </button>

      {showOptions && (
        <div className="space-y-3 p-3 bg-muted rounded-md">
          <div className="space-y-1.5">
            <Label>CSS Selector (optional)</Label>
            <Input
              placeholder="body, .container, #main"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Width</Label>
              <Input
                type="number"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Height</Label>
              <Input
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                disabled={loading}
              />
            </div>
          </div>
        </div>
      )}

      <Button className="w-full" onClick={handleConvert} disabled={loading || !url.trim()}>
        {loading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            Converting...
          </>
        ) : (
          'Convert to Figma'
        )}
      </Button>

      {status && (
        <div
          className={`text-[11px] px-3 py-2 rounded-md ${
            status.type === 'success'
              ? 'bg-success/10 text-success'
              : status.type === 'error'
                ? 'bg-destructive/10 text-destructive'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}
