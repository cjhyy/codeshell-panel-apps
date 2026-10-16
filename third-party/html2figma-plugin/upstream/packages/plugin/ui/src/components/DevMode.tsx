import { useState, useCallback, useRef, useEffect } from 'react';
import { Radio, Square, Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { pollResult, getQueueStatus } from '@/lib/api';
import { preProcessImages } from '@/lib/image-processor';
import { sendToPlugin } from '@/lib/message';
import { usePluginMessage } from '@/hooks/usePluginMessage';

interface Props {
  serverUrl: string;
}

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warn';
}

export function DevMode({ serverUrl }: Props) {
  const [polling, setPolling] = useState(false);
  const [queueLength, setQueueLength] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [importInProgress, setImportInProgress] = useState(false);
  const lastResultId = useRef<string | null>(null);
  const skipFirst = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('en', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLogs((prev) => [...prev.slice(-199), { time, message, type }]);
  }, []);

  // Listen for plugin code messages
  usePluginMessage({
    'import-success': (data) => {
      addLog(`Imported: ${data?.name || 'design'}`, 'success');
      setImportInProgress(false);
    },
    'import-error': (data) => {
      addLog(`Import error: ${data?.message || 'unknown'}`, 'error');
      setImportInProgress(false);
    },
    'export-result': (data) => {
      if (data?.error) {
        addLog(`Export failed: ${data.error}`, 'error');
      } else {
        addLog(`Exported ${data?.count || 0} node(s)`, 'success');
        // Download JSON
        const json = JSON.stringify(data.nodes, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `figma-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    },
  });

  const doPoll = useCallback(async () => {
    if (importInProgress) return;
    let nextInterval = 2000;

    try {
      // Try queue first
      const queueData = await pollResult(serverUrl, 'queue');
      const qs = await getQueueStatus(serverUrl);
      setQueueLength(qs.length || 0);

      if (queueData?.id) {
        addLog(`Queue: ${queueData.name || 'design'}`, 'info');
        setImportInProgress(true);

        const processed = await preProcessImages(queueData.figmaJSON, serverUrl);
        sendToPlugin('import-design', { designData: processed, name: queueData.name });
        nextInterval = 500;
      } else {
        // Fall back to single-result
        const data = await pollResult(serverUrl);
        if (data?.id && data.id !== lastResultId.current) {
          if (skipFirst.current) {
            lastResultId.current = data.id;
            skipFirst.current = false;
            addLog('Connected, waiting for new data...', 'info');
          } else {
            lastResultId.current = data.id;
            addLog(`Received: ${data.name || 'design'}`, 'info');
            setImportInProgress(true);

            const processed = await preProcessImages(data.figmaJSON, serverUrl);
            sendToPlugin('import-design', { designData: processed, name: data.name });
          }
        }
      }
    } catch {
      // silently continue polling
    }

    return nextInterval;
  }, [serverUrl, importInProgress, addLog]);

  // Polling loop
  useEffect(() => {
    if (!polling) return;

    let active = true;
    const loop = async () => {
      if (!active) return;
      const interval = (await doPoll()) || 2000;
      if (active) {
        pollTimerRef.current = setTimeout(loop, interval);
      }
    };
    loop();

    return () => {
      active = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [polling, doPoll]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const togglePolling = () => {
    if (polling) {
      setPolling(false);
      addLog('Stopped polling', 'info');
    } else {
      setPolling(true);
      skipFirst.current = true;
      lastResultId.current = null;
      addLog('Started polling...', 'info');
    }
  };

  const statusColor = polling
    ? importInProgress
      ? 'bg-warning'
      : 'bg-success'
    : 'bg-muted-foreground';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColor} ${polling && !importInProgress ? 'animate-pulse' : ''}`} />
          <span className="text-[11px] font-medium">
            {polling ? (importInProgress ? 'Importing...' : 'Polling') : 'Disconnected'}
          </span>
          {queueLength > 0 && <Badge variant="secondary">{queueLength}</Badge>}
        </div>
        <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">
          {serverUrl}
        </div>
      </div>

      {/* Logs */}
      <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">
            Click Start to begin polling...
          </div>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className="py-0.5">
              <span className="text-muted-foreground mr-1.5">{entry.time}</span>
              <span
                className={
                  entry.type === 'success'
                    ? 'text-success'
                    : entry.type === 'error'
                      ? 'text-destructive'
                      : entry.type === 'warn'
                        ? 'text-warning'
                        : 'text-foreground'
                }
              >
                {entry.message}
              </span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-3 py-2 border-t border-border">
        <Button
          variant={polling ? 'destructive' : 'default'}
          size="sm"
          className="flex-1"
          onClick={togglePolling}
        >
          {polling ? (
            <>
              <Square className="w-3 h-3 mr-1" />
              Stop
            </>
          ) : (
            <>
              <Radio className="w-3 h-3 mr-1" />
              Start
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => sendToPlugin('export-selection')}
          disabled={polling && importInProgress}
        >
          <Download className="w-3 h-3 mr-1" />
          Export
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLogs([])}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
