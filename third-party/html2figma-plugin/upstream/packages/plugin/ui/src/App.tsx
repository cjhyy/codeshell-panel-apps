import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { UrlImport } from '@/components/UrlImport';
import { HtmlImport } from '@/components/HtmlImport';
import { JsonImport } from '@/components/JsonImport';
import { DevMode } from '@/components/DevMode';
import { SettingsPanel } from '@/components/SettingsPanel';
import { useSettings } from '@/hooks/useSettings';
import { usePluginMessage } from '@/hooks/usePluginMessage';
import { IS_DEVELOPMENT } from '@/lib/server-config';

export function App() {
  const { settings, updateSettings } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  usePluginMessage({
    'import-success': (data) => {
      setImportStatus(`Imported: ${data?.name || 'design'}`);
      setTimeout(() => setImportStatus(null), 3000);
    },
    'import-error': (data) => {
      setImportStatus(null);
    },
    'batch-complete': (data) => {
      setImportStatus(`Batch: ${data?.successful}/${data?.total} imported`);
      setTimeout(() => setImportStatus(null), 4000);
    },
  });

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold tracking-tight">Html2Figma</span>
        {IS_DEVELOPMENT && (
          <button
            className="p-1 rounded hover:bg-muted transition-colors"
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Development server settings"
          >
            <Settings className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Import status toast */}
      {importStatus && (
        <div className="mx-3 mt-2 px-3 py-1.5 rounded-md bg-success/10 text-success text-[11px] shrink-0">
          {importStatus}
        </div>
      )}

      {/* Main tabs */}
      <Tabs defaultValue="url" className="flex flex-col flex-1 min-h-0">
        <TabsList>
          <TabsTrigger value="url">URL</TabsTrigger>
          <TabsTrigger value="html">HTML</TabsTrigger>
          <TabsTrigger value="dsl">DSL</TabsTrigger>
          {IS_DEVELOPMENT && <TabsTrigger value="dev">Dev</TabsTrigger>}
        </TabsList>

        <TabsContent value="url">
          <UrlImport serverUrl={settings.serverUrl} />
        </TabsContent>

        <TabsContent value="html">
          <HtmlImport serverUrl={settings.serverUrl} />
        </TabsContent>

        <TabsContent value="dsl">
          <JsonImport serverUrl={settings.serverUrl} />
        </TabsContent>

        {IS_DEVELOPMENT && (
          <TabsContent value="dev" className="flex flex-col">
            <DevMode serverUrl={settings.serverUrl} />
          </TabsContent>
        )}
      </Tabs>

      {/* Settings panel */}
      {IS_DEVELOPMENT && (
        <SettingsPanel
          serverUrl={settings.serverUrl}
          onSave={(url) => {
            updateSettings({ serverUrl: url });
            setSettingsOpen(false);
          }}
          open={settingsOpen}
          onToggle={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
