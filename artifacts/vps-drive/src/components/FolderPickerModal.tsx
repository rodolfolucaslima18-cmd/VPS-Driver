import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Folder, ChevronRight, Loader2, Home } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type FolderItem = { name: string; path: string; type: string };

interface Props {
  open: boolean;
  onClose: () => void;
  mode: "move" | "copy";
  sourcePath: string;
  itemName: string;
  onConfirm: (destDirPath: string) => void;
  titleOverride?: string;
}

export function FolderPickerModal({ open, onClose, mode, sourcePath, itemName, onConfirm, titleOverride }: Props) {
  const [browsePath, setBrowsePath] = useState("");
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setBrowsePath("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: "500" });
    if (browsePath) params.append("path", browsePath);
    fetch(`${BASE_URL}/api/files?${params}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const items = (data.items ?? []) as FolderItem[];
        setFolders(
          items.filter(
            (i) =>
              i.type === "directory" &&
              i.path !== sourcePath &&
              !i.path.startsWith(sourcePath + "/")
          )
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, browsePath, sourcePath]);

  const breadcrumbs = browsePath.split("/").filter(Boolean);
  const label = mode === "move" ? "Mover" : "Copiar";
  const title = titleOverride ?? `${label} "${itemName}"`;

  const destPath = browsePath ? `${browsePath}/${itemName}` : itemName;
  const isSameDest = destPath === sourcePath;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap min-h-[20px]">
          <button
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() => setBrowsePath("")}
          >
            <Home className="w-3.5 h-3.5" />
            Início
          </button>
          {breadcrumbs.map((part, i) => (
            <div key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5" />
              <button
                className="hover:text-foreground transition-colors truncate max-w-[120px]"
                onClick={() => setBrowsePath(breadcrumbs.slice(0, i + 1).join("/"))}
              >
                {part}
              </button>
            </div>
          ))}
        </div>

        <div className="min-h-[200px] max-h-[300px] overflow-y-auto border border-border rounded-lg">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : folders.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
              Nenhuma subpasta aqui
            </div>
          ) : (
            folders.map((folder) => (
              <button
                key={folder.path}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent/50 transition-colors text-left border-b border-border/50 last:border-b-0"
                onClick={() => setBrowsePath(folder.path)}
              >
                <Folder className="w-4 h-4 text-primary shrink-0" strokeWidth={1.5} />
                <span className="truncate">{folder.name}</span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0" />
              </button>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Destino: <strong>{browsePath || "Início (raiz)"}</strong>
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(browsePath)} disabled={isSameDest}>
            {label} aqui
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
