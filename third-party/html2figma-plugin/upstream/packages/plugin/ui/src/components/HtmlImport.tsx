import { useState, useCallback } from 'react';
import { Code, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { convertHtml } from '@/lib/api';
import { preProcessImages } from '@/lib/image-processor';
import { sendToPlugin } from '@/lib/message';

interface Props {
  serverUrl: string;
}

export function HtmlImport({ serverUrl }: Props) {
  const [html, setHtml] = useState('');
  const [width, setWidth] = useState(1440);
  const [height, setHeight] = useState(900);
  const [showOptions, setShowOptions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const handleConvert = useCallback(async () => {
    if (!html.trim()) return;
    setLoading(true);
    setStatus({ type: 'info', text: 'Converting HTML...' });

    try {
      const figmaJSON = await convertHtml(serverUrl, {
        html: html.trim(),
        width,
        height,
      });

      setStatus({ type: 'info', text: 'Processing images...' });
      await preProcessImages(figmaJSON, serverUrl);

      sendToPlugin('import-design', { designData: figmaJSON, name: 'HTML Import' });
      setStatus({ type: 'success', text: 'Sent to Figma!' });
    } catch (err: any) {
      setStatus({ type: 'error', text: err.message || 'Conversion failed' });
    } finally {
      setLoading(false);
    }
  }, [html, width, height, serverUrl]);

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          <Code className="w-3.5 h-3.5" />
          HTML Content
        </Label>
        <Textarea
          placeholder='<div style="padding: 24px;">&#10;  <h1>Hello World</h1>&#10;</div>'
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          className="min-h-[200px] font-mono text-[11px]"
          disabled={loading}
        />
      </div>

      <button
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setShowOptions(!showOptions)}
      >
        {showOptions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Viewport Options
      </button>

      {showOptions && (
        <div className="grid grid-cols-2 gap-3 p-3 bg-muted rounded-md">
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
      )}

      <Button className="w-full" onClick={handleConvert} disabled={loading || !html.trim()}>
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
