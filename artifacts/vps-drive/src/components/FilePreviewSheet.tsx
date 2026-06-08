import { useState, useEffect, useRef } from "react";
import { Download, File, AlertCircle } from "lucide-react";
import DOMPurify from "dompurify";
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

function getExt(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

type OfficeKind = "docx" | "doc" | "xlsx" | "pptx" | null;

function getOfficeKind(file: FileItem): OfficeKind {
  const ext = getExt(file.name);
  if (ext === ".docx") return "docx";
  if (ext === ".doc") return "doc";   // server-side mammoth conversion
  if (ext === ".xlsx" || ext === ".xls") return "xlsx";
  if (ext === ".pptx" || ext === ".ppt") return "pptx";
  const mime = file.mimeType ?? "";
  if (mime.includes("wordprocessingml")) return "docx";
  if (mime.includes("spreadsheetml")) return "xlsx";
  if (mime.includes("presentationml")) return "pptx";
  if (mime.includes("msword")) return "doc";
  if (mime.includes("ms-excel")) return "xlsx";
  if (mime.includes("ms-powerpoint")) return "pptx";
  return null;
}

function getPreviewKind(mimeType: string | null): "image" | "video" | "pdf" | "text" | "unsupported" {
  if (!mimeType) return "unsupported";
  if (["image/jpeg","image/png","image/gif","image/webp","image/svg+xml","image/bmp"].includes(mimeType)) return "image";
  if (["video/mp4","video/webm","video/quicktime"].includes(mimeType)) return "video";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/") || ["application/json","application/javascript","application/xml"].includes(mimeType)) return "text";
  return "unsupported";
}

async function fetchFileBuffer(path: string): Promise<ArrayBuffer> {
  const res = await fetch(`${BASE_URL}/api/files/preview?path=${encodeURIComponent(path)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

// ── DOCX Viewer ──────────────────────────────────────────────────────────────

function DocxViewer({ file }: { file: FileItem }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setState("loading");
    setErrorMsg(null);
    let cancelled = false;

    // We must wait for the ref to be attached before calling renderAsync.
    // Schedule the async work with a microtask so the DOM element from the
    // render below is committed first.
    const run = async () => {
      try {
        const buf = await fetchFileBuffer(file.path);
        if (cancelled) return;
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        // By the time the await above resolves, the component has already
        // committed its initial render, so containerRef.current is non-null.
        if (!containerRef.current) throw new Error("Container não montado.");
        containerRef.current.innerHTML = "";
        await renderAsync(buf, containerRef.current, undefined, {
          className: "docx-viewer",
          inWrapper: true,
          ignoreWidth: true,
          ignoreHeight: true,
          ignoreFonts: false,
          breakPages: true,
          useBase64URL: true,
        });
        if (!cancelled) setState("done");
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : "Erro ao renderizar documento");
          setState("error");
        }
      }
    };

    run();
    return () => { cancelled = true; };
  }, [file.path]);

  return (
    <div className="relative flex-1 flex flex-col" style={{ minHeight: "calc(100vh - 220px)" }}>
      {/* Container always mounted so containerRef is non-null when renderAsync runs */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto rounded-lg border border-border bg-white text-black p-2"
        style={{ display: state === "error" ? "none" : "block", minHeight: "calc(100vh - 220px)" }}
      />
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 rounded-lg">
          <ViewerLoading />
        </div>
      )}
      {state === "error" && errorMsg && <ViewerError message={errorMsg} />}
    </div>
  );
}

// ── XLSX Viewer ───────────────────────────────────────────────────────────────

function XlsxViewer({ file }: { file: FileItem }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [htmls, setHtmls] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let cancelled = false;

    (async () => {
      try {
        const buf = await fetchFileBuffer(file.path);
        if (cancelled) return;
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        if (cancelled) return;
        const names = wb.SheetNames;
        const htmlList = names.map((name) => {
          const ws = wb.Sheets[name];
          return XLSX.utils.sheet_to_html(ws, { header: "", footer: "" });
        });
        setSheets(names);
        setHtmls(htmlList);
        setActiveSheet(0);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao ler planilha");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [file.path]);

  if (loading) return <ViewerLoading />;
  if (error) return <ViewerError message={error} />;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      {sheets.length > 1 && (
        <div className="flex gap-1 flex-wrap shrink-0">
          {sheets.map((name, i) => (
            <button
              key={name}
              onClick={() => setActiveSheet(i)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors border ${
                activeSheet === i
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div
        className="xlsx-container flex-1 overflow-auto rounded-lg border border-border bg-white text-black text-xs"
        style={{ minHeight: "calc(100vh - 260px)" }}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmls[activeSheet] ?? "") }}
      />
    </div>
  );
}

// ── Download-only fallback (shared by PPTX and legacy .doc) ──────────────────

function DownloadFallback({ file, title, description }: { file: FileItem; title: string; description: string }) {
  const downloadUrl = `${BASE_URL}/api/files/download?path=${encodeURIComponent(file.path)}`;
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-5 text-muted-foreground py-8">
      <div className="p-5 rounded-full bg-muted/60">
        <File className="w-12 h-12 opacity-40" />
      </div>
      <div className="text-center space-y-1">
        <p className="font-medium text-foreground">{file.name}</p>
        <p className="text-sm">{formatSize(file.size)} · {formatDate(file.modifiedAt)}</p>
      </div>
      <div className="text-center space-y-1 text-sm max-w-[280px]">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground leading-relaxed">{description}</p>
      </div>
      <Button variant="default" asChild>
        <a href={downloadUrl} download={file.name}>
          <Download className="w-4 h-4 mr-2" />
          Baixar para visualizar
        </a>
      </Button>
    </div>
  );
}

function PptxFallback({ file }: { file: FileItem }) {
  return (
    <DownloadFallback
      file={file}
      title="Apresentações PowerPoint"
      description="Arquivos PPTX/PPT não podem ser renderizados diretamente no navegador. Baixe o arquivo para abrir no PowerPoint ou LibreOffice."
    />
  );
}

// DocHtmlViewer — converts .doc/.docx server-side via mammoth and renders HTML inline
function DocHtmlViewer({ file }: { file: FileItem }) {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [html, setHtml] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setState("loading");
    setErrorMsg(null);
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `${BASE_URL}/api/files/office-html?path=${encodeURIComponent(file.path)}`,
          { credentials: "include" }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const text = await res.text();
        if (!cancelled) { setHtml(text); setState("done"); }
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : "Erro ao converter documento");
          setState("error");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [file.path]);

  if (state === "loading") return <ViewerLoading />;
  if (state === "error" && errorMsg) return <ViewerError message={errorMsg} />;

  return (
    <div
      className="docx-viewer flex-1 overflow-auto rounded-lg border border-border bg-white text-black p-4"
      style={{ minHeight: "calc(100vh - 220px)" }}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ViewerLoading() {
  return (
    <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm gap-2 py-12">
      <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
      Carregando documento…
    </div>
  );
}

function ViewerError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 text-destructive py-12">
      <AlertCircle className="w-8 h-8" />
      <p className="text-sm font-medium">Erro ao carregar documento</p>
      <p className="text-xs text-muted-foreground max-w-[260px] text-center">{message}</p>
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
          if (data.truncated) setTruncated(true);
        } else {
          const text = await res.text();
          setContent(text);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [file.path]);

  if (loading) return <ViewerLoading />;
  if (error) return <ViewerError message="Não foi possível carregar o arquivo." />;

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

// ── Main component ────────────────────────────────────────────────────────────

export function FilePreviewSheet({ file, onClose }: FilePreviewSheetProps) {
  const isOpen = file !== null;
  const officeKind = file ? getOfficeKind(file) : null;
  const kind = file && !officeKind ? getPreviewKind(file.mimeType) : "unsupported";

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
        className="w-full sm:w-[60vw] sm:max-w-[860px] flex flex-col p-0 gap-0"
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
                <Button size="sm" variant="outline" className="shrink-0" asChild>
                  <a href={downloadUrl} download={file.name}>
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Baixar
                  </a>
                </Button>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-auto p-6 flex flex-col min-h-0">
              {officeKind === "docx" && <DocxViewer file={file} />}
              {officeKind === "doc" && <DocHtmlViewer file={file} />}
              {officeKind === "xlsx" && <XlsxViewer file={file} />}
              {officeKind === "pptx" && <PptxFallback file={file} />}

              {!officeKind && kind === "image" && (
                <div className="flex items-center justify-center flex-1 bg-muted/40 rounded-lg overflow-hidden">
                  <img
                    src={previewUrl}
                    alt={file.name}
                    className="max-w-full max-h-[calc(100vh-200px)] object-contain"
                  />
                </div>
              )}

              {!officeKind && kind === "video" && (
                <div className="flex items-center justify-center flex-1 bg-black rounded-lg overflow-hidden">
                  <video key={previewUrl} controls className="max-w-full max-h-[calc(100vh-200px)]">
                    <source src={previewUrl} type={file.mimeType ?? undefined} />
                    Seu navegador não suporta reprodução de vídeo.
                  </video>
                </div>
              )}

              {!officeKind && kind === "pdf" && (
                <iframe
                  key={previewUrl}
                  src={previewUrl}
                  className="flex-1 w-full rounded-lg border border-border"
                  style={{ minHeight: "calc(100vh - 200px)" }}
                  title={file.name}
                />
              )}

              {!officeKind && kind === "text" && <TextPreview file={file} />}

              {!officeKind && kind === "unsupported" && (
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
