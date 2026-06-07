import { useState, useRef, useCallback, useEffect } from "react";
import {
  HardDrive, Folder, File, Upload, Plus, LogOut, ChevronRight,
  Pencil, Trash2, MoreVertical, FolderPlus, X, Check
} from "lucide-react";
import { useClerk } from "@clerk/react";
import {
  useListFiles, useGetStorageStats,
  getListFilesQueryKey, getGetStorageStatsQueryKey,
  useUploadFiles, useCreateDirectory, useDeleteItem, useRenameItem
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

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
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
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
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const { signOut } = useClerk();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: files, isLoading } = useListFiles({ path: currentPath });
  const { data: stats } = useGetStorageStats();

  const uploadMutation = useUploadFiles();
  const mkdirMutation = useCreateDirectory();
  const deleteMutation = useDeleteItem();
  const renameMutation = useRenameItem();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListFilesQueryKey({ path: currentPath }) });
    queryClient.invalidateQueries({ queryKey: getGetStorageStatsQueryKey() });
  }, [queryClient, currentPath]);

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

  // Close menus on outside click
  useEffect(() => {
    if (!openMenuPath) return;
    const handler = () => setOpenMenuPath(null);
    window.addEventListener("click", handler, { capture: true });
    return () => window.removeEventListener("click", handler, { capture: true });
  }, [openMenuPath]);

  const doUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setUploadProgress(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`);
    try {
      await uploadMutation.mutateAsync({
        data: {
          files,
          ...(currentPath ? { path: currentPath } : {}),
        },
      });
      invalidate();
      toast({ title: "Upload complete", description: `${files.length} file(s) uploaded.` });
    } catch {
      toast({ title: "Upload failed", description: "Could not upload files.", variant: "destructive" });
    } finally {
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [currentPath, uploadMutation, invalidate, toast]);

  const doMkdir = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) { setNewFolderMode(false); return; }
    const fullPath = currentPath ? `${currentPath}/${name}` : name;
    try {
      await mkdirMutation.mutateAsync({ data: { path: fullPath } });
      invalidate();
      toast({ title: "Folder created" });
    } catch {
      toast({ title: "Could not create folder", variant: "destructive" });
    } finally {
      setNewFolderMode(false);
      setNewFolderName("");
    }
  }, [newFolderName, currentPath, mkdirMutation, invalidate, toast]);

  const doDelete = useCallback(async (path: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await deleteMutation.mutateAsync({ params: { path } } as never);
      invalidate();
      toast({ title: "Deleted", description: name });
    } catch {
      toast({ title: "Could not delete", variant: "destructive" });
    }
  }, [deleteMutation, invalidate, toast]);

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
      toast({ title: "Renamed" });
    } catch {
      toast({ title: "Could not rename", variant: "destructive" });
    } finally {
      setRenamingPath(null);
      setRenamingValue("");
    }
  }, [renamingPath, renamingValue, renameMutation, invalidate, toast]);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); doUpload(e.dataTransfer.files); };

  const breadcrumbs = currentPath.split("/").filter(Boolean);

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => doUpload(e.target.files)}
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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Storage</p>
              <div className="text-2xl font-bold tracking-tight">
                {stats ? formatTotalSize(stats.totalSize) : <Skeleton className="h-8 w-24" />}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {stats
                  ? `${stats.totalFiles} files · ${stats.totalDirectories} folders`
                  : <Skeleton className="h-4 w-32" />}
              </p>
            </div>

            {stats && stats.recentFiles.length > 0 && (
              <div className="pt-4 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Recent</p>
                <div className="space-y-1">
                  {stats.recentFiles.slice(0, 5).map((f) => (
                    <button
                      key={f.path}
                      onClick={() => window.open(`${BASE_URL}/api/files/download?path=${encodeURIComponent(f.path)}`, "_blank")}
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

        <div className="p-3 border-t border-border">
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => signOut({ redirectUrl: "/" })}>
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
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
              Root
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
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setNewFolderMode(true)}>
              <FolderPlus className="w-3.5 h-3.5" />
              New Folder
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" />
              Upload
            </Button>
          </div>
        </div>

        {/* Drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary pointer-events-none m-2 rounded-xl">
            <div className="text-center">
              <Upload className="w-12 h-12 text-primary mx-auto mb-2" />
              <p className="text-lg font-semibold text-primary">Drop to upload</p>
              <p className="text-sm text-muted-foreground">Files will be added to the current folder</p>
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
                placeholder="Folder name"
                className="bg-transparent border-none outline-none text-sm w-40"
              />
              <button onClick={doMkdir} className="text-primary hover:text-primary/80"><Check className="w-4 h-4" /></button>
              <button onClick={() => { setNewFolderMode(false); setNewFolderName(""); }} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
          )}

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {[...Array(12)].map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : files && files.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {files.map((file) => (
                <div
                  key={file.path}
                  className="group relative flex flex-col items-center justify-center p-4 rounded-xl border border-border bg-card hover:bg-accent/40 hover:border-accent-foreground/20 transition-all cursor-pointer select-none"
                  onClick={(e) => {
                    // Skip if clicking the action menu or rename input
                    if ((e.target as HTMLElement).closest("[data-nomenu]")) return;
                    if (file.type === "directory") setCurrentPath(file.path);
                    else window.open(`${BASE_URL}/api/files/download?path=${encodeURIComponent(file.path)}`, "_blank");
                  }}
                >
                  {/* Action menu button */}
                  <button
                    data-nomenu
                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
                    onClick={(e) => { e.stopPropagation(); setOpenMenuPath(openMenuPath === file.path ? null : file.path); }}
                  >
                    <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>

                  {/* Dropdown menu */}
                  {openMenuPath === file.path && (
                    <div
                      data-nomenu
                      className="absolute top-8 right-1.5 z-20 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[120px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        data-nomenu
                        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                        onClick={() => {
                          setOpenMenuPath(null);
                          setRenamingPath(file.path);
                          setRenamingValue(file.name);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Rename
                      </button>
                      <button
                        data-nomenu
                        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-accent transition-colors"
                        onClick={() => { setOpenMenuPath(null); doDelete(file.path, file.name); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  )}

                  {/* Icon */}
                  {file.type === "directory" ? (
                    <Folder className="w-11 h-11 text-primary mb-2.5 group-hover:scale-105 transition-transform" strokeWidth={1.5} />
                  ) : (
                    <File className="w-11 h-11 text-muted-foreground mb-2.5 group-hover:scale-105 transition-transform" strokeWidth={1.5} />
                  )}

                  {/* Name — inline rename or label */}
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
                      {file.type === "directory" ? "Folder" : formatSize(file.size)}
                    </span>
                    <span className="text-xs text-muted-foreground/70">{formatDate(file.modifiedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-3 text-muted-foreground min-h-[300px]">
              <div className="p-5 rounded-full bg-accent/50">
                <HardDrive className="w-10 h-10 opacity-40" />
              </div>
              <div>
                <p className="font-semibold text-foreground">This folder is empty</p>
                <p className="text-sm mt-0.5">Drop files here or click Upload</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                Upload files
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
