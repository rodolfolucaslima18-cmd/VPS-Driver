import { useState } from "react";
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, X, UploadCloud, RefreshCw } from "lucide-react";
import type { UploadItem } from "@/hooks/useUploadQueue";

interface Props {
  items: UploadItem[];
  onRetry: (id: string) => void;
  onClearDone: () => void;
  onDismiss: () => void;
}

export function UploadQueuePanel({ items, onRetry, onClearDone, onDismiss }: Props) {
  const [minimized, setMinimized] = useState(false);

  if (items.length === 0) return null;

  const uploading = items.filter((i) => i.status === "uploading").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const done = items.filter((i) => i.status === "done").length;
  const errors = items.filter((i) => i.status === "error").length;
  const active = uploading + pending;

  const headerLabel =
    active > 0
      ? `Enviando ${active} arquivo${active !== 1 ? "s" : ""}…`
      : errors > 0
      ? `${done} concluído${done !== 1 ? "s" : ""}, ${errors} com erro`
      : `${done} arquivo${done !== 1 ? "s" : ""} enviado${done !== 1 ? "s" : ""}`;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg shadow-2xl border border-border bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/60 border-b border-border select-none">
        <UploadCloud className="w-4 h-4 shrink-0 text-primary" />
        <span className="text-sm font-medium flex-1 truncate">{headerLabel}</span>
        <button
          className="p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground"
          title={minimized ? "Expandir" : "Minimizar"}
          onClick={() => setMinimized((m) => !m)}
        >
          {minimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {/* Always show dismiss when not active — clears done + errors */}
        {active === 0 && (
          <button
            className="p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground"
            title="Fechar"
            onClick={onDismiss}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* File list */}
      {!minimized && (
        <div className="max-h-64 overflow-y-auto divide-y divide-border">
          {items.map((item) => (
            <div key={item.id} className="px-3 py-2 flex items-center gap-2">
              {/* Status icon */}
              <div className="shrink-0">
                {item.status === "done" && (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                )}
                {item.status === "error" && (
                  <XCircle className="w-4 h-4 text-destructive" />
                )}
                {(item.status === "uploading" || item.status === "pending") && (
                  <Loader2
                    className={`w-4 h-4 ${item.status === "uploading" ? "animate-spin text-primary" : "text-muted-foreground"}`}
                  />
                )}
              </div>

              {/* Name + progress */}
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate leading-none mb-1" title={item.file.name}>
                  {item.file.name}
                </p>
                {item.status === "error" ? (
                  <p className="text-xs text-destructive truncate">{item.error}</p>
                ) : (
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-200 ${
                        item.status === "done" ? "bg-green-500" : "bg-primary"
                      }`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Progress % or retry */}
              {item.status === "uploading" && (
                <span className="text-xs text-muted-foreground shrink-0 w-8 text-right">
                  {item.progress}%
                </span>
              )}
              {item.status === "error" && (
                <button
                  className="shrink-0 p-1 rounded hover:bg-accent transition-colors text-muted-foreground"
                  title="Tentar novamente"
                  onClick={() => onRetry(item.id)}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer: show "Limpar concluídos" when there are mixed done+error items and no active */}
      {!minimized && active === 0 && done > 0 && errors > 0 && (
        <div className="px-3 py-2 border-t border-border bg-muted/40 flex justify-between items-center">
          <button className="text-xs text-primary hover:underline" onClick={onClearDone}>
            Limpar concluídos
          </button>
        </div>
      )}
    </div>
  );
}
