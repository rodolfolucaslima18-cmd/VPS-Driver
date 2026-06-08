import { useState, useEffect } from "react";
import { Download, File, Eye, ExternalLink } from "lucide-react";
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
  return new Date(iso).toLocaleString("pt-BR");
}

function getPreviewKind(mimeType: string | null): "image" | "video" | "pdf" | "text" | "office" | "unsupported" {
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
  if (isOfficeMime(mimeType)) return "office";
  return "unsupported";
}

const OFFICE_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);

const OFFICE_EXTS = new Set([".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"]);

function isOfficeMime(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return OFFICE_MIMES.has(mimeType);
}

function isOfficeFile(file: FileItem): boolean {
  if (isOfficeMime(file.mimeType)) return true;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return OFFICE_EXTS.has(ext);
}

type GoogleApp = "document" | "spreadsheets" | "presentation";

function getGoogleApp(file: FileItem): GoogleApp {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls") return "spreadsheets";
  if (ext === ".pptx" || ext === ".ppt") return "presentation";
  return "document";
}

function getGoogleAppLabel(app: GoogleApp): string {
  if (app === "spreadsheets") return "Google Sheets";
  if (app === "presentation") return "Google Slides";
  return "Google Docs";
}

async function fetchToken(filePath: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/files/token?path=${encodeURIComponent(filePath)}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json() as { publicUrl: string };
    return data.publicUrl;
  } catch {
    return null;
  }
}

function OfficeActions({ file }: { file: FileItem }) {
  const [loading, setLoading] = useState<"view" | "edit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const googleApp = getGoogleApp(file);
  const googleLabel = getGoogleAppLabel(googleApp);
  const downloadUrl = `${BASE_URL}/api/files/download?path=${encodeURIComponent(file.path)}`;

  async function handleView() {
    setLoading("view");
    setError(null);
    const publicUrl = await fetchToken(file.path);
    setLoading(null);
    if (!publicUrl) {
      setError("Não foi possível gerar o link de visualização.");
      return;
    }
    const viewerUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(publicUrl)}`;
    window.open(viewerUrl, "_blank", "noopener,noreferrer");
  }

  async function handleEdit() {
    setLoading("edit");
    setError(null);
    const publicUrl = await fetchToken(file.path);
    setLoading(null);

    // Open Google Docs/Sheets/Slides in new tab — user can then use File > Import
    const googleUrl = `https://docs.google.com/${googleApp}/create`;
    window.open(googleUrl, "_blank", "noopener,noreferrer");

    // Trigger download so user has the file ready to import
    if (publicUrl) {
      const a = document.createElement("a");
      a.href = publicUrl;
      a.download = file.name;
      a.click();
    }
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-5 text-muted-foreground py-8">
      <div className="p-5 rounded-full bg-muted/60">
        <File className="w-12 h-12 opacity-40" />
      </div>

      <div className="text-center">
        <p className="font-medium text-foreground">{file.name}</p>
        <p className="text-sm mt-1">{formatSize(file.size)}</p>
        <p className="text-xs mt-0.5">{formatDate(file.modifiedAt)}</p>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <div className="flex flex-col gap-2 w-full max-w-[240px]">
        <Button
          variant="default"
          className="w-full gap-2"
          onClick={handleView}
          disabled={loading !== null}
        >
          <Eye className="w-4 h-4" />
          {loading === "view" ? "Gerando link…" : "Visualizar (Microsoft)"}
        </Button>

        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={handleEdit}
          disabled={loading !== null}
        >
          <ExternalLink className="w-4 h-4" />
          {loading === "edit" ? "Abrindo…" : `Editar no ${googleLabel}`}
        </Button>

        <Button variant="ghost" size="sm" className="w-full gap-2 text-muted-foreground" asChild>
          <a href={downloadUrl} download={file.name}>
            <Download className="w-3.5 h-3.5" />
            Baixar arquivo
          </a>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground/60 text-center max-w-[240px] leading-relaxed">
        "Editar no {googleLabel}" abre um documento em branco — importe o arquivo baixado usando{" "}
        <span className="font-medium">Arquivo → Importar</span>.
      </p>
    </div>
  );
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
        Carregando…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-40 text-destructive text-sm">
        Erro ao carregar o arquivo.
      </div>
    );
  }

  if (truncated) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
        <File className="w-8 h-8 opacity-40" />
        <p>Arquivo muito grande para visualizar (acima de 200 KB).</p>
        <p className="text-xs">Baixe o arquivo para ver o conteúdo completo.</p>
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
  const isOffice = file ? isOfficeFile(file) : false;
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
                {!isOffice && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    asChild
                  >
                    <a href={downloadUrl} download={file.name}>
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Baixar
                    </a>
                  </Button>
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-auto p-6 flex flex-col">
              {isOffice && <OfficeActions file={file} />}

              {!isOffice && kind === "image" && (
                <div className="flex items-center justify-center flex-1 bg-muted/40 rounded-lg overflow-hidden">
                  <img
                    src={previewUrl}
                    alt={file.name}
                    className="max-w-full max-h-[calc(100vh-200px)] object-contain"
                  />
                </div>
              )}

              {!isOffice && kind === "video" && (
                <div className="flex items-center justify-center flex-1 bg-black rounded-lg overflow-hidden">
                  <video
                    key={previewUrl}
                    controls
                    className="max-w-full max-h-[calc(100vh-200px)]"
                  >
                    <source src={previewUrl} type={file.mimeType ?? undefined} />
                    Seu navegador não suporta reprodução de vídeo.
                  </video>
                </div>
              )}

              {!isOffice && kind === "pdf" && (
                <iframe
                  key={previewUrl}
                  src={previewUrl}
                  className="flex-1 w-full rounded-lg border border-border"
                  style={{ minHeight: "calc(100vh - 200px)" }}
                  title={file.name}
                />
              )}

              {!isOffice && kind === "text" && <TextPreview file={file} />}

              {!isOffice && kind === "unsupported" && (
                <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground">
                  <div className="p-6 rounded-full bg-muted/60">
                    <File className="w-12 h-12 opacity-40" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-foreground">{file.name}</p>
                    <p className="text-sm mt-1">{formatSize(file.size)}</p>
                    <p className="text-xs mt-0.5">{formatDate(file.modifiedAt)}</p>
                    <p className="text-sm mt-3 text-muted-foreground">
                      Este tipo de arquivo não pode ser visualizado no navegador.
                    </p>
                  </div>
                  <Button variant="outline" asChild>
                    <a href={downloadUrl} download={file.name}>
                      <Download className="w-4 h-4 mr-2" />
                      Baixar arquivo
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
