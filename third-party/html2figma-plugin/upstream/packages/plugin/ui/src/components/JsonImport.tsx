import { useState, useCallback, useRef } from 'react';
import { FileKey, Upload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { sendToPlugin } from '@/lib/message';
import { decodeDSL } from '@/lib/dsl-codec';
import { preProcessImages } from '@/lib/image-processor';

interface Props {
  serverUrl: string;
}

export function JsonImport({ serverUrl }: Props) {
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importDSL = useCallback(async (fileText: string, name: string) => {
    setLoading(true);
    setStatus({ type: 'info', text: 'Decrypting via server...' });

    try {
      const parsed = await decodeDSL(serverUrl, fileText) as any;

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid design data in DSL file');
      }

      setStatus({ type: 'info', text: 'Processing images...' });
      await preProcessImages(parsed, serverUrl);

      if (Array.isArray(parsed)) {
        if (parsed.length === 0) throw new Error('Empty design array');
        sendToPlugin('batch-import', {
          designs: parsed.map((d: any, i: number) => ({
            designData: d,
            name: d.name || `Design ${i + 1}`,
          })),
        });
        setStatus({ type: 'success', text: `Sent ${parsed.length} design(s) to Figma!` });
      } else {
        sendToPlugin('import-design', {
          designData: parsed,
          name: parsed.name || name.replace(/\.dsl$/, ''),
        });
        setStatus({ type: 'success', text: 'Sent to Figma!' });
      }
    } catch (err: any) {
      setStatus({ type: 'error', text: err.message || 'Failed to decode DSL file' });
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setStatus({ type: 'info', text: `Reading: ${file.name} (${(file.size / 1024).toFixed(1)}KB)` });

    const reader = new FileReader();
    reader.onload = () => importDSL(reader.result as string, file.name);
    reader.onerror = () => {
      setStatus({ type: 'error', text: 'Failed to read file' });
      setLoading(false);
    };
    reader.readAsText(file);
  }, [importDSL]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }, [handleFile]);

  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.dsl')) {
      setStatus({ type: 'error', text: 'Please drop a .dsl file' });
      return;
    }
    handleFile(file);
  }, [handleFile]);

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          <FileKey className="w-3.5 h-3.5" />
          Import DSL File
        </Label>
        <p className="text-[11px] text-muted-foreground">
          Import an encrypted <code className="px-1 py-0.5 bg-muted rounded text-[10px]">.dsl</code> file exported from the browser extension.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-8 transition-colors cursor-pointer ${
          dragOver
            ? 'border-foreground bg-muted'
            : 'border-border hover:border-muted-foreground'
        } ${loading ? 'pointer-events-none opacity-50' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {loading ? (
          <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
        ) : (
          <Upload className="w-8 h-8 text-muted-foreground" />
        )}
        <div className="text-center">
          <p className="text-xs font-medium">
            {fileName || 'Drop .dsl file here'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            or click to browse
          </p>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".dsl"
        className="hidden"
        onChange={handleFileUpload}
      />

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
