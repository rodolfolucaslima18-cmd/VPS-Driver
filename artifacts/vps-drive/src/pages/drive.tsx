import { useState, useRef, useCallback, useEffect } from "react";
import {
  HardDrive, Folder, File, Upload, LogOut, ChevronRight,
  Pencil, Trash2, MoreVertical, FolderPlus, X, Check, Users, Share2, FolderUp,
  LayoutGrid, List, Lock, KeyRound, ShieldOff, Loader2
} from "lucide-react";
import { ShareModal } from "@/components/ShareModal";
import { useAuth, logout } from "@/lib/auth";
import { useLocation } from "wouter";
import {
  useGetStorageStats,
  getGetStorageStatsQueryKey,
  useUploadFiles, useCreateDirectory, useDeleteItem, useRenameItem
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { FilePreviewSheet } from "@/components/FilePreviewSheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type FileItem = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
  mimeType: string | null;
  hasPassword?: boolean;
};

const IMAGE_TYPES = ["image/jpeg","image/png","image/gif","image/webp","image/svg+xml","image/bmp"];
const VIDEO_TYPES = ["video/mp4","video/webm","video/quicktime"];
const TEXT_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = ["application/json","application/javascript","application/xml"];
const OFFICE_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);
const OFFICE_EXTS = new Set([".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"]);

function isOfficeFile(file: FileItem): boolean {
  if (file.mimeType && OFFICE_MIMES.has(file.mimeType)) return true;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return OFFICE_EXTS.has(ext);
}

function isPreviewable(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return (
    IMAGE_TYPES.includes(mimeType) ||
    VIDEO_TYPES.includes(mimeType) ||
    mimeType === "application/pdf" ||
    TEXT_PREFIXES.some((p) => mimeType.startsWith(p)) ||
    TEXT_MIME_TYPES.includes(mimeType)
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" });
  return d.toLocaleDateString("pt-BR", { month: "short", day: "numeric" });
}

function formatTotalSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function DrivePage() {
  const [currentPath, setCurrentPath] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [pendingDeleteItem, setPendingDeleteItem] = useState<{ path: string; name: string } | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try { return (localStorage.getItem("vps-drive-view") as "grid" | "list") ?? "grid"; } catch { return "grid"; }
  });
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<FileItem | null>(null);
  const [shareItem, setShareItem] = useState<FileItem | null>(null);
  const [folderToUnlock, setFolderToUnlock] = useState<FileItem | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [folderToSetPwd, setFolderToSetPwd] = useState<FileItem | null>(null);
  const [setPwdValue, setSetPwdValue] = useState("");
  const [setPwdLoading, setSetPwdLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const isMaster = user?.role === "master";
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  async function handleLogout() {
    try {
      await logout();
    } finally {
      setLocation("/");
      window.location.href = "/";
    }
  }

  const { data: stats } = useGetStorageStats();

  const uploadMutation = useUploadFiles();
  const mkdirMutation = useCreateDirectory();
  const deleteMutation = useDeleteItem();
  const renameMutation = useRenameItem();

  // ── Pagination state ──────────────────────────────────────────────────────
  const PAGE_LIMIT = 200;
  const [displayedItems, setDisplayedItems] = useState<FileItem[]>([]);
  const [totalItems,     setTotalItems]     = useState(0);
  const [currentPage,   setCurrentPage]    = useState(1);
  const [isLoadingPage1, setIsLoadingPage1] = useState(false);
  const [isLoadingMore,  setIsLoadingMore]  = useState(false);
  const [hasMore,        setHasMore]        = useState(false);

  const fetchFilesPage = useCallback(async (path: string, page: number) => {
    const isFirst = page === 1;
    if (isFirst) setIsLoadingPage1(true);
    else         setIsLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT), page: String(page) });
      if (path) params.append("path", path);
      const resp = await fetch(`${BASE_URL}/api/files?${params}`, { credentials: "include" });
      if (!resp.ok) return;
      const data = (await resp.json()) as {
        items: FileItem[];
        total: number;
        page: number;
        totalPages: number;
      };
      setDisplayedItems(prev => isFirst ? data.items : [...prev, ...data.items]);
      setTotalItems(data.total);
      setCurrentPage(data.page);
      setHasMore(data.page < data.totalPages);
    } finally {
      if (isFirst) setIsLoadingPage1(false);
      else         setIsLoadingMore(false);
    }
  }, []);

  // Fetch page 1 whenever the current folder changes
  useEffect(() => {
    setDisplayedItems([]);
    setCurrentPage(1);
    setHasMore(false);
    setTotalItems(0);
    fetchFilesPage(currentPath, 1);
  }, [currentPath, fetchFilesPage]);

  const invalidate = useCallback(() => {
    // Reset pagination and reload page 1 for current folder
    setDisplayedItems([]);
    setCurrentPage(1);
    setHasMore(false);
    setTotalItems(0);
    fetchFilesPage(currentPath, 1);
    queryClient.invalidateQueries({ queryKey: getGetStorageStatsQueryKey() });
  }, [queryClient, currentPath, fetchFilesPage]);

  // Focus rename input when rename mode activates
  useEffect(() => {
    if (renamingPath !== null) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingPath]);

  // Focus new folder input when in new folder mode
  useEffect(() => {
    if (newFolderMode) {
      setTimeout(() => newFolderInputRef.current?.focus(), 50);
    }
  }, [newFolderMode]);

  // Batch upload — used for folders, drag-and-drop with subfolders, and large file selections.
  // Defined first so doUpload can reference it.
  const doUploadWithPaths = useCallback(async (
    entries: Array<{file: File; relativePath: string}>,
    onDone?: () => void,
  ) => {
    if (entries.length === 0) return;
    const total = entries.length;
    const BATCH = 50;

    if (total > 1000) {
      toast({
        title: "Upload grande detectado",
        description: `Enviando ${total.toLocaleString("pt-BR")} arquivos. Isso pode demorar alguns minutos.`,
      });
    }

    try {
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        const sent = Math.min(i + BATCH, total);
        const pct = Math.round((sent / total) * 100);
        setUploadProgress(
          `Enviando ${sent.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} arquivo${total > 1 ? "s" : ""} (${pct}%)…`
        );
        const formData = new FormData();
        if (currentPath) formData.append("path", currentPath);
        batch.forEach(({ file }) => formData.append("files", file));
        formData.append("relativePaths", JSON.stringify(batch.map((e) => e.relativePath)));
        const resp = await fetch(`${BASE_URL}/api/files/upload`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error((data as {error?: string}).error ?? `HTTP ${resp.status}`);
        }
      }
      invalidate();
      toast({ title: "Envio concluído", description: `${total.toLocaleString("pt-BR")} arquivo(s) enviado(s).` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast({ title: "Falha no envio", description: msg, variant: "destructive" });
    } finally {
      setUploadProgress(null);
      onDone?.();
    }
  }, [currentPath, invalidate, toast]);

  const doUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    // For > 20 files use the same batched path to avoid one huge request
    if (files.length > 20) {
      const entries = files.map((f) => ({ file: f, relativePath: f.name }));
      await doUploadWithPaths(entries, () => {
        if (fileInputRef.current) fileInputRef.current.value = "";
      });
      return;
    }

    setUploadProgress(`Enviando ${files.length} arquivo${files.length > 1 ? "s" : ""}…`);
    try {
      await uploadMutation.mutateAsync({
        data: {
          files,
          ...(currentPath ? { path: currentPath } : {}),
        },
      });
      invalidate();
      toast({ title: "Envio concluído", description: `${files.length} arquivo(s) enviado(s).` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast({ title: "Falha no envio", description: msg, variant: "destructive" });
    } finally {
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [currentPath, uploadMutation, invalidate, toast, doUploadWithPaths]);

  const doUploadFolder = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const entries = Array.from(fileList).map((file) => ({
      file,
      relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));
    await doUploadWithPaths(entries, () => {
      if (folderInputRef.current) folderInputRef.current.value = "";
    });
  }, [doUploadWithPaths]);

  const doMkdir = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) { setNewFolderMode(false); return; }
    const fullPath = currentPath ? `${currentPath}/${name}` : name;
    try {
      await mkdirMutation.mutateAsync({ data: { path: fullPath } });
      invalidate();
      toast({ title: "Pasta criada" });
    } catch {
      toast({ title: "Não foi possível criar a pasta", variant: "destructive" });
    } finally {
      setNewFolderMode(false);
      setNewFolderName("");
    }
  }, [newFolderName, currentPath, mkdirMutation, invalidate, toast]);

  const doDelete = useCallback((path: string, name: string) => {
    setPendingDeleteItem({ path, name });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteItem) return;
    const { path, name } = pendingDeleteItem;
    setPendingDeleteItem(null);
    try {
      await deleteMutation.mutateAsync({ params: { path } });
      invalidate();
      toast({ title: "Excluído", description: name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast({ title: "Não foi possível excluir", description: msg, variant: "destructive" });
    }
  }, [pendingDeleteItem, deleteMutation, invalidate, toast]);

  const openFolder = useCallback((item: FileItem) => {
    if (item.hasPassword && !isMaster) {
      setFolderToUnlock(item);
      setUnlockPassword("");
      setUnlockError(null);
    } else {
      setCurrentPath(item.path);
    }
  }, [isMaster]);

  const submitUnlock = useCallback(async () => {
    if (!folderToUnlock || !unlockPassword) return;
    setUnlockLoading(true);
    setUnlockError(null);
    try {
      const res = await fetch(`${BASE_URL}/api/files/unlock-folder`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderToUnlock.path, password: unlockPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = (body as { error?: string }).error;
        setUnlockError(code === "WRONG_PASSWORD" ? "Senha incorreta." : "Erro ao verificar senha.");
        return;
      }
      setCurrentPath(folderToUnlock.path);
      setFolderToUnlock(null);
      setUnlockPassword("");
    } catch {
      setUnlockError("Erro de conexão.");
    } finally {
      setUnlockLoading(false);
    }
  }, [folderToUnlock, unlockPassword]);

  const submitSetPassword = useCallback(async () => {
    if (!folderToSetPwd) return;
    setSetPwdLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/files/folder-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderToSetPwd.path, password: setPwdValue || null }),
      });
      if (!res.ok) throw new Error();
      invalidate();
      toast({ title: setPwdValue ? "Senha definida com sucesso." : "Senha removida com sucesso." });
      setFolderToSetPwd(null);
      setSetPwdValue("");
    } catch {
      toast({ title: "Erro ao salvar senha.", variant: "destructive" });
    } finally {
      setSetPwdLoading(false);
    }
  }, [folderToSetPwd, setPwdValue, invalidate, toast]);

  const doRename = useCallback(async () => {
    if (!renamingPath) return;
    const newName = renamingValue.trim();
    if (!newName) { setRenamingPath(null); return; }
    const dir = renamingPath.includes("/") ? renamingPath.substring(0, renamingPath.lastIndexOf("/")) : "";
    const newPath = dir ? `${dir}/${newName}` : newName;
    if (newPath === renamingPath) { setRenamingPath(null); return; }
    try {
      await renameMutation.mutateAsync({ data: { oldPath: renamingPath, newPath } });
      invalidate();
      toast({ title: "Renomeado" });
    } catch {
      toast({ title: "Não foi possível renomear", variant: "destructive" });
    } finally {
      setRenamingPath(null);
      setRenamingValue("");
    }
  }, [renamingPath, renamingValue, renameMutation, invalidate, toast]);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); };

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = Array.from(e.dataTransfer.items ?? []);
    const hasFolder = items.some((item) => {
      const entry = item.webkitGetAsEntry?.();
      return entry?.isDirectory;
    });

    if (!hasFolder) {
      doUpload(e.dataTransfer.files);
      return;
    }

    // Traverse directory tree using FileSystem API
    async function collectEntries(
      entry: FileSystemEntry,
      prefix = ""
    ): Promise<Array<{file: File; relativePath: string}>> {
      if (entry.isFile) {
        return new Promise((resolve) => {
          (entry as FileSystemFileEntry).file(
            (f) => resolve([{ file: f, relativePath: prefix + entry.name }]),
            () => resolve([])
          );
        });
      }
      if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const allEntries: FileSystemEntry[] = [];
        await new Promise<void>((resolve) => {
          function readBatch() {
            reader.readEntries((batch) => {
              if (batch.length === 0) { resolve(); return; }
              allEntries.push(...batch);
              readBatch();
            }, () => resolve());
          }
          readBatch();
        });
        const nested = await Promise.all(
          allEntries.map((child) => collectEntries(child, prefix + entry.name + "/"))
        );
        return nested.flat();
      }
      return [];
    }

    const allResults = await Promise.all(
      items.map((item) => {
        const entry = item.webkitGetAsEntry?.();
        return entry ? collectEntries(entry) : Promise.resolve([]);
      })
    );
    const entries = allResults.flat();
    if (entries.length > 0) await doUploadWithPaths(entries);
    else doUpload(e.dataTransfer.files);
  }, [doUpload, doUploadWithPaths]);

  const breadcrumbs = currentPath.split("/").filter(Boolean);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <FilePreviewSheet file={previewItem} onClose={() => setPreviewItem(null)} onRefresh={invalidate} />
      {shareItem && (
        <ShareModal
          filePath={shareItem.path}
          fileName={shareItem.name}
          onClose={() => setShareItem(null)}
        />
      )}

      {/* Folder unlock dialog */}
      <Dialog open={!!folderToUnlock} onOpenChange={(open) => { if (!open) { setFolderToUnlock(null); setUnlockPassword(""); setUnlockError(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-primary" />
              Pasta protegida
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A pasta <strong>"{folderToUnlock?.name}"</strong> está protegida por senha.
          </p>
          <Input
            type="password"
            placeholder="Digite a senha"
            value={unlockPassword}
            onChange={(e) => { setUnlockPassword(e.target.value); setUnlockError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submitUnlock(); }}
            autoFocus
          />
          {unlockError && <p className="text-xs text-destructive">{unlockError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderToUnlock(null)}>Cancelar</Button>
            <Button onClick={submitUnlock} disabled={!unlockPassword || unlockLoading}>
              {unlockLoading ? <span className="flex items-center gap-2"><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Verificando…</span> : "Abrir pasta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set folder password dialog (master only) */}
      <Dialog open={!!folderToSetPwd} onOpenChange={(open) => { if (!open) { setFolderToSetPwd(null); setSetPwdValue(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              {folderToSetPwd?.hasPassword ? "Alterar/remover senha" : "Definir senha da pasta"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pasta: <strong>"{folderToSetPwd?.name}"</strong>
            {folderToSetPwd?.hasPassword && <span className="ml-2 text-xs text-amber-500">(já possui senha)</span>}
          </p>
          <Input
            type="password"
            placeholder={folderToSetPwd?.hasPassword ? "Nova senha (vazio para remover)" : "Senha da pasta"}
            value={setPwdValue}
            onChange={(e) => setSetPwdValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitSetPassword(); }}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">Deixe em branco para remover a senha da pasta.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderToSetPwd(null)}>Cancelar</Button>
            <Button onClick={submitSetPassword} disabled={setPwdLoading}>
              {setPwdLoading ? "Salvando…" : setPwdValue ? "Definir senha" : "Remover senha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!pendingDeleteItem} onOpenChange={(open) => { if (!open) setPendingDeleteItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir item</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir <strong>"{pendingDeleteItem?.name}"</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => doUpload(e.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory="true"
        multiple
        className="hidden"
        onChange={(e) => doUploadFolder(e.target.files)}
      />

      {/* Sidebar */}
      <div className="w-60 border-r border-border bg-card/50 flex flex-col shrink-0">
        <div className="h-14 px-4 flex items-center gap-2 border-b border-border">
          <HardDrive className="w-5 h-5 text-primary" />
          <span className="font-semibold tracking-tight">VPS Drive</span>
        </div>

        <div className="p-4 flex-1 overflow-auto">
          <div className="space-y-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Armazenamento</p>
              <div className="text-2xl font-bold tracking-tight">
                {stats ? formatTotalSize(stats.totalSize) : <Skeleton className="h-8 w-24" />}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {stats
                  ? `${stats.totalFiles} arquivos · ${stats.totalDirectories} pastas`
                  : <Skeleton className="h-4 w-32" />}
              </p>
            </div>

            {stats && stats.recentFiles.length > 0 && (
              <div className="pt-4 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Recentes</p>
                <div className="space-y-1">
                  {stats.recentFiles.slice(0, 5).map((f) => (
                    <button
                      key={f.path}
                      onClick={() => {
                        if (isPreviewable(f.mimeType ?? null) || isOfficeFile(f as FileItem)) setPreviewItem(f as FileItem);
                        else window.open(`${BASE_URL}/api/files/download?path=${encodeURIComponent(f.path)}`, "_blank");
                      }}
                      className="w-full text-left flex items-center gap-2 py-1 px-1 rounded text-sm hover:bg-accent/60 transition-colors"
                    >
                      <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate text-muted-foreground">{f.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-3 border-t border-border space-y-1">
          {isMaster && (
            <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setLocation("/admin")}>
              <Users className="w-4 h-4 mr-2" />
              Administração
            </Button>
          )}
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </Button>
        </div>
      </div>

      {/* Main */}
      <div
        className="flex-1 flex flex-col min-w-0"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Toolbar */}
        <div className="h-14 px-4 border-b border-border flex items-center justify-between bg-card/50 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground min-w-0">
            <button className="hover:text-foreground transition-colors shrink-0" onClick={() => setCurrentPath("")}>
              Início
            </button>
            {breadcrumbs.map((part, i) => (
              <div key={i} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="w-4 h-4 shrink-0" />
                <button
                  className="hover:text-foreground transition-colors truncate max-w-[120px]"
                  onClick={() => setCurrentPath(breadcrumbs.slice(0, i + 1).join("/"))}
                >
                  {part}
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-4">
            {uploadProgress && (
              <span className="text-xs text-muted-foreground animate-pulse">{uploadProgress}</span>
            )}
            <button
              className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground"
              title={viewMode === "grid" ? "Mudar para lista" : "Mudar para grade"}
              onClick={() => {
                const next = viewMode === "grid" ? "list" : "grid";
                setViewMode(next);
                try { localStorage.setItem("vps-drive-view", next); } catch {}
              }}
            >
              {viewMode === "grid" ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
            </button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setNewFolderMode(true)}>
              <FolderPlus className="w-3.5 h-3.5" />
              Nova Pasta
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => folderInputRef.current?.click()}>
              <FolderUp className="w-3.5 h-3.5" />
              Pasta
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" />
              Arquivos
            </Button>
          </div>
        </div>

        {/* Drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary pointer-events-none m-2 rounded-xl">
            <div className="text-center">
              <Upload className="w-12 h-12 text-primary mx-auto mb-2" />
              <p className="text-lg font-semibold text-primary">Solte para enviar</p>
              <p className="text-sm text-muted-foreground">Os arquivos serão adicionados à pasta atual</p>
            </div>
          </div>
        )}

        {/* File grid */}
        <div className="flex-1 overflow-auto p-5">
          {/* New folder input row */}
          {newFolderMode && (
            <div className="mb-4 flex items-center gap-2 p-2 rounded-lg border border-primary/40 bg-card w-fit">
              <Folder className="w-5 h-5 text-primary" />
              <input
                ref={newFolderInputRef}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doMkdir(); if (e.key === "Escape") { setNewFolderMode(false); setNewFolderName(""); } }}
                placeholder="Nome da pasta"
                className="bg-transparent border-none outline-none text-sm w-40"
              />
              <button onClick={doMkdir} className="text-primary hover:text-primary/80"><Check className="w-4 h-4" /></button>
              <button onClick={() => { setNewFolderMode(false); setNewFolderName(""); }} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
          )}

          {isLoadingPage1 ? (
            viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {[...Array(12)].map((_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            )
          ) : displayedItems.length > 0 ? (
            viewMode === "grid" ? (
              /* ── Grid view ── */
              <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {displayedItems.map((file) => (
                  <div
                    key={file.path}
                    className="group relative flex flex-col items-center justify-center p-4 rounded-xl border border-border bg-card hover:bg-accent/40 hover:border-accent-foreground/20 transition-all cursor-pointer select-none"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("[data-nomenu]")) return;
                      if (file.type === "directory") openFolder(file as FileItem);
                      else if (isPreviewable(file.mimeType ?? null) || isOfficeFile(file as FileItem)) setPreviewItem(file as FileItem);
                      else window.open(`${BASE_URL}/api/files/download?path=${encodeURIComponent(file.path)}`, "_blank");
                    }}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          data-nomenu
                          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[160px]">
                        {file.type === "file" && (
                          <DropdownMenuItem className="gap-2" onClick={() => setShareItem(file as FileItem)}>
                            <Share2 className="w-3.5 h-3.5" />Compartilhar
                          </DropdownMenuItem>
                        )}
                        {file.type === "directory" && isMaster && (
                          <DropdownMenuItem className="gap-2" onClick={() => { setFolderToSetPwd(file as FileItem); setSetPwdValue(""); }}>
                            {(file as FileItem).hasPassword ? <ShieldOff className="w-3.5 h-3.5" /> : <KeyRound className="w-3.5 h-3.5" />}
                            {(file as FileItem).hasPassword ? "Alterar/remover senha" : "Definir senha"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem className="gap-2" onClick={() => { setRenamingPath(file.path); setRenamingValue(file.name); }}>
                          <Pencil className="w-3.5 h-3.5" />Renomear
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={() => doDelete(file.path, file.name)}>
                          <Trash2 className="w-3.5 h-3.5" />Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {file.type === "directory" ? (
                      <div className="relative mb-2.5">
                        <Folder className="w-11 h-11 text-primary group-hover:scale-105 transition-transform" strokeWidth={1.5} />
                        {(file as FileItem).hasPassword && (
                          <Lock className="absolute -bottom-1 -right-1 w-4 h-4 text-amber-500 bg-card rounded-full p-0.5" />
                        )}
                      </div>
                    ) : (
                      <File className="w-11 h-11 text-muted-foreground mb-2.5 group-hover:scale-105 transition-transform" strokeWidth={1.5} />
                    )}

                    {renamingPath === file.path ? (
                      <input
                        data-nomenu
                        ref={renameInputRef}
                        value={renamingValue}
                        onChange={(e) => setRenamingValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setRenamingPath(null); }}
                        onBlur={doRename}
                        className="w-full text-sm text-center bg-transparent border-b border-primary outline-none"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="text-sm font-medium text-center w-full truncate px-1">{file.name}</span>
                    )}

                    <div className="flex flex-col items-center gap-0.5 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {file.type === "directory" ? "Pasta" : formatSize(file.size)}
                      </span>
                      <span className="text-xs text-muted-foreground/70">{formatDate(file.modifiedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
              {hasMore && (
                <div className="flex flex-col items-center gap-2 pt-4">
                  <p className="text-xs text-muted-foreground">
                    Exibindo {displayedItems.length.toLocaleString("pt-BR")} de {totalItems.toLocaleString("pt-BR")} itens
                  </p>
                  <Button variant="outline" onClick={() => fetchFilesPage(currentPath, currentPage + 1)} disabled={isLoadingMore}>
                    {isLoadingMore ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Carregando...</> : "Carregar mais"}
                  </Button>
                </div>
              )}
              </>
            ) : (
              /* ── List view ── */
              <>
              <div className="flex flex-col rounded-xl border border-border overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-[auto_1fr_80px_80px_36px] gap-x-3 px-3 py-2 bg-muted/40 border-b border-border text-xs font-medium text-muted-foreground select-none">
                  <span className="w-5" />
                  <span>Nome</span>
                  <span className="text-right">Tamanho</span>
                  <span className="text-right">Modificado</span>
                  <span />
                </div>
                {displayedItems.map((file, idx) => (
                  <div
                    key={file.path}
                    className={`group grid grid-cols-[auto_1fr_80px_80px_36px] gap-x-3 px-3 py-2 items-center cursor-pointer hover:bg-accent/40 transition-colors select-none${idx > 0 ? " border-t border-border/50" : ""}`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("[data-nomenu]")) return;
                      if (file.type === "directory") openFolder(file as FileItem);
                      else if (isPreviewable(file.mimeType ?? null) || isOfficeFile(file as FileItem)) setPreviewItem(file as FileItem);
                      else window.open(`${BASE_URL}/api/files/download?path=${encodeURIComponent(file.path)}`, "_blank");
                    }}
                  >
                    {/* Icon */}
                    {file.type === "directory" ? (
                      <div className="relative shrink-0">
                        <Folder className="w-4 h-4 text-primary" strokeWidth={1.5} />
                        {(file as FileItem).hasPassword && (
                          <Lock className="absolute -bottom-1 -right-1 w-2.5 h-2.5 text-amber-500" />
                        )}
                      </div>
                    ) : (
                      <File className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                    )}

                    {/* Name / rename input */}
                    {renamingPath === file.path ? (
                      <input
                        data-nomenu
                        ref={renameInputRef}
                        value={renamingValue}
                        onChange={(e) => setRenamingValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setRenamingPath(null); }}
                        onBlur={doRename}
                        className="text-sm bg-transparent border-b border-primary outline-none w-full"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="text-sm truncate">{file.name}</span>
                    )}

                    {/* Size */}
                    <span className="text-xs text-muted-foreground text-right">
                      {file.type === "directory" ? "Pasta" : formatSize(file.size)}
                    </span>

                    {/* Date */}
                    <span className="text-xs text-muted-foreground/70 text-right">{formatDate(file.modifiedAt)}</span>

                    {/* Actions */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          data-nomenu
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent justify-self-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[160px]">
                        {file.type === "file" && (
                          <DropdownMenuItem className="gap-2" onClick={() => setShareItem(file as FileItem)}>
                            <Share2 className="w-3.5 h-3.5" />Compartilhar
                          </DropdownMenuItem>
                        )}
                        {file.type === "directory" && isMaster && (
                          <DropdownMenuItem className="gap-2" onClick={() => { setFolderToSetPwd(file as FileItem); setSetPwdValue(""); }}>
                            {(file as FileItem).hasPassword ? <ShieldOff className="w-3.5 h-3.5" /> : <KeyRound className="w-3.5 h-3.5" />}
                            {(file as FileItem).hasPassword ? "Alterar/remover senha" : "Definir senha"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem className="gap-2" onClick={() => { setRenamingPath(file.path); setRenamingValue(file.name); }}>
                          <Pencil className="w-3.5 h-3.5" />Renomear
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={() => doDelete(file.path, file.name)}>
                          <Trash2 className="w-3.5 h-3.5" />Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
              {hasMore && (
                <div className="flex flex-col items-center gap-2 pt-4">
                  <p className="text-xs text-muted-foreground">
                    Exibindo {displayedItems.length.toLocaleString("pt-BR")} de {totalItems.toLocaleString("pt-BR")} itens
                  </p>
                  <Button variant="outline" onClick={() => fetchFilesPage(currentPath, currentPage + 1)} disabled={isLoadingMore}>
                    {isLoadingMore ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Carregando...</> : "Carregar mais"}
                  </Button>
                </div>
              )}
            </>
          )
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-3 text-muted-foreground min-h-[300px]">
              <div className="p-5 rounded-full bg-accent/50">
                <HardDrive className="w-10 h-10 opacity-40" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Esta pasta está vazia</p>
                <p className="text-sm mt-0.5">Solte arquivos aqui ou clique em Enviar</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => folderInputRef.current?.click()}>
                  <FolderUp className="w-3.5 h-3.5 mr-1.5" />
                  Enviar pasta
                </Button>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Enviar arquivos
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
