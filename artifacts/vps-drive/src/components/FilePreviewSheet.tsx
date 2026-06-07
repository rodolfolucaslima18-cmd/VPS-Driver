import { useState, useEffect } from "react";
import { Download, File } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FileItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
  mimeType: string | null;
}

interface FilePreviewSheetProps {
  file: FileItem | null;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function getPreviewKind(mimeType: string | null): "image" | "video" | "pdf" | "text" | "unsupported" {
  if (!mimeType) return "unsupported";
  if (
    mimeType.startsWith("image/") &&
    ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/bmp"].includes(mimeType)
  ) return "image";
  if (["video/mp4", "video/webm", "video/quicktime"].includes(mimeType)) return "video";
  if (mimeType === "application/pdf") return "pdf";
  const textMimePrefixes = ["text/"];
  const textMimeTypes = ["application/json", "application/javascript", "application/xml"];
  if (textMimePrefixes.some((p) => mimeType.startsWith(p)) || textMimeTypes.includes(mimeType)) return "text";
  return "unsupported";
}

function TextPreview({ file }: { file: FileItem }) {
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setContent(null);
    setTruncated(false);
    setLoading(true);
    setError(false);

    const url = `${BASE_URL}/api/files/preview?path=${encodeURIComponent(file.path)}`;
    fetch(url, { credentials: "include" })
      .then(async (res) => {
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          if (data.truncated) {
            setTruncated(true);
          }
        } else {
          const text = await res.text();
          setContent(text);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [file.path]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-40 text-destructive text-sm">
        Failed to load file content.
      </div>
    );
  }

  if (truncated) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
        <File className="w-8 h-8 opacity-40" />
        <p>File is too large to preview (over 200 KB).</p>
        <p className="text-xs">Download the file to view its contents.</p>
      </div>
    );
  }

  return (
    <pre className="bg-muted rounded-lg p-4 overflow-auto text-xs font-mono whitespace-pre-wrap break-all flex-1 max-h-[calc(100vh-220px)]">
      {content}
    </pre>
  );
}

export function FilePreviewSheet({ file, onClose }: FilePreviewSheetProps) {
  const isOpen = file !== null;
  const kind = file ? getPreviewKind(file.mimeType) : "unsupported";
  const previewUrl = file
    ? `${BASE_URL}/api/files/preview?path=${encodeURIComponent(file.path)}`
    : "";
  const downloadUrl = file
    ? `${BASE_URL}/api/files/download?path=${encodeURIComponent(file.path)}`
    : "";

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:w-[50vw] sm:max-w-[720px] flex flex-col p-0 gap-0"
      >
        {file && (
          <>
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
              <div className="flex items-start justify-between gap-4 pr-6">
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base">{file.name}</SheetTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatSize(file.size)} · {formatDate(file.modifiedAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  asChild
                >
                  <a href={downloadUrl} download={file.name}>
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Download
                  </a>
                </Button>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-auto p-6 flex flex-col">
              {kind === "image" && (
                <div className="flex items-center justify-center flex-1 bg-muted/40 rounded-lg overflow-hidden">
                  <img
                    src={previewUrl}
                    alt={file.name}
                    className="max-w-full max-h-[calc(100vh-200px)] object-contain"
                  />
                </div>
              )}

              {kind === "video" && (
                <div className="flex items-center justify-center flex-1 bg-black rounded-lg overflow-hidden">
                  <video
                    key={previewUrl}
                    controls
                    className="max-w-full max-h-[calc(100vh-200px)]"
                  >
                    <source src={previewUrl} type={file.mimeType ?? undefined} />
                    Your browser does not support the video tag.
                  </video>
                </div>
              )}

              {kind === "pdf" && (
                <iframe
                  key={previewUrl}
                  src={previewUrl}
                  className="flex-1 w-full rounded-lg border border-border"
                  style={{ minHeight: "calc(100vh - 200px)" }}
                  title={file.name}
                />
              )}

              {kind === "text" && <TextPreview file={file} />}

              {kind === "unsupported" && (
                <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground">
                  <div className="p-6 rounded-full bg-muted/60">
                    <File className="w-12 h-12 opacity-40" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-foreground">{file.name}</p>
                    <p className="text-sm mt-1">{formatSize(file.size)}</p>
                    <p className="text-xs mt-0.5">{formatDate(file.modifiedAt)}</p>
                    <p className="text-sm mt-3 text-muted-foreground">
                      This file type cannot be previewed.
                    </p>
                  </div>
                  <Button variant="outline" asChild>
                    <a href={downloadUrl} download={file.name}>
                      <Download className="w-4 h-4 mr-2" />
                      Download file
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
