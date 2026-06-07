import { useState } from "react";
import { useLocation } from "wouter";
import { HardDrive, Folder, File, Upload, Plus, LogOut, ChevronRight, LayoutGrid, List } from "lucide-react";
import { useClerk } from "@clerk/react";
import { useListFiles, useGetStorageStats, getListFilesQueryKey, getGetStorageStatsQueryKey, useUploadFiles, useCreateDirectory, useDeleteItem, useRenameItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function DrivePage() {
  const [currentPath, setCurrentPath] = useState("");
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: files, isLoading } = useListFiles({ path: currentPath });
  const { data: stats } = useGetStorageStats();

  const handleSignOut = () => {
    signOut({ redirectUrl: "/" });
  };

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card/50 flex flex-col">
        <div className="h-14 px-4 flex items-center gap-2 border-b border-border">
          <HardDrive className="w-5 h-5 text-primary" />
          <span className="font-semibold tracking-tight text-foreground">VPS Drive</span>
        </div>
        
        <div className="p-4 flex-1 overflow-auto">
          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Storage</h4>
              <div className="space-y-2">
                <div className="text-2xl font-semibold tracking-tight">
                  {stats ? `${(stats.totalSize / 1024 / 1024).toFixed(2)} MB` : <Skeleton className="h-8 w-24" />}
                </div>
                <p className="text-sm text-muted-foreground">
                  {stats ? `${stats.totalFiles} files • ${stats.totalDirectories} folders` : <Skeleton className="h-4 w-32" />}
                </p>
              </div>
            </div>
            
            <div className="pt-4 border-t border-border">
              <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground" onClick={handleSignOut}>
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Toolbar */}
        <div className="h-14 px-4 border-b border-border flex items-center justify-between bg-card/50 backdrop-blur-sm">
          <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            <button 
              className="hover:text-foreground transition-colors"
              onClick={() => setCurrentPath("")}
            >
              Root
            </button>
            {currentPath.split('/').filter(Boolean).map((part, i, arr) => (
              <div key={i} className="flex items-center gap-1">
                <ChevronRight className="w-4 h-4" />
                <button 
                  className="hover:text-foreground transition-colors"
                  onClick={() => setCurrentPath(arr.slice(0, i + 1).join('/'))}
                >
                  {part}
                </button>
              </div>
            ))}
          </div>
          
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8">
              <Plus className="w-4 h-4 mr-1.5" />
              New Folder
            </Button>
            <Button size="sm" className="h-8">
              <Upload className="w-4 h-4 mr-1.5" />
              Upload
            </Button>
          </div>
        </div>

        {/* File Grid/List */}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : files && files.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {files.map((file) => (
                <div 
                  key={file.path}
                  className="group relative flex flex-col items-center justify-center p-4 rounded-xl border border-border bg-card hover:bg-accent/50 hover:border-accent-foreground/20 transition-all cursor-pointer select-none"
                  onDoubleClick={() => file.type === "directory" ? setCurrentPath(file.path) : null}
                  onClick={() => file.type === "file" ? window.open(`/api/files/download?path=${encodeURIComponent(file.path)}`, '_blank') : null}
                >
                  {file.type === "directory" ? (
                    <Folder className="w-12 h-12 text-primary mb-3 group-hover:scale-105 transition-transform" strokeWidth={1.5} />
                  ) : (
                    <File className="w-12 h-12 text-muted-foreground mb-3 group-hover:scale-105 transition-transform" strokeWidth={1.5} />
                  )}
                  <span className="text-sm font-medium text-center w-full truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground mt-1">
                    {file.type === "directory" ? "Folder" : `${(file.size / 1024).toFixed(1)} KB`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 text-muted-foreground">
              <div className="p-4 rounded-full bg-accent/50">
                <HardDrive className="w-8 h-8 opacity-50" />
              </div>
              <div>
                <p className="font-medium text-foreground">This folder is empty</p>
                <p className="text-sm">Drag and drop files here to upload</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
