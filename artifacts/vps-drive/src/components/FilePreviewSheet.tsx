import { useState, useEffect, useRef, useCallback } from "react";
import { Download, File, AlertCircle, ExternalLink, Loader2, Pencil } from "lucide-react";
import DOMPurify from "dompurify";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const ONLYOFFICE_URL = (import.meta.env.VITE_ONLYOFFICE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

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

// "docx"  → DocxViewer    (docx-preview client-side, OOXML)
// "doc"   → DocHtmlViewer (mammoth server-side; graceful fallback for binary .doc)
// "xlsx"  → XlsxViewer   (SheetJS)
// "pptx"  → PptxFallback (download/online only)
type OfficeKind = "docx" | "doc" | "xlsx" | "pptx" | null;

function getOfficeKind(file: FileItem): OfficeKind {
  const ext = getExt(file.name);
  if (ext === ".docx") return "docx";
  if (ext === ".doc") return "doc";
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

function getMsLabel(kind: OfficeKind): string {
  if (kind === "xlsx") return "Excel Online";
  if (kind === "pptx") return "PowerPoint Online";
  return "Word Online";
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

// ── DOCX Viewer ───────────────────────────────────────────────────────────────

function DocxViewer({ file }: { file: FileItem }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setState("loading");
    setErrorMsg(null);
    let cancelled = false;

    const run = async () => {
      try {
        const buf = await fetchFileBuffer(file.path);
        if (cancelled) return;
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
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

// ── PPTX / download-only fallback ─────────────────────────────────────────────

function PptxFallback({
  file,
  onOpenMicrosoft,
}: {
  file: FileItem;
  onOpenMicrosoft?: () => void;
}) {
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
        <p className="font-medium text-foreground">Apresentações PowerPoint</p>
        <p className="text-muted-foreground leading-relaxed">
          Arquivos PPTX/PPT não podem ser renderizados diretamente no navegador.
          Abra online ou baixe o arquivo.
        </p>
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        {onOpenMicrosoft && (
          <Button variant="default" onClick={onOpenMicrosoft}>
            <ExternalLink className="w-4 h-4 mr-2" />
            PowerPoint Online
          </Button>
        )}
        <Button variant="outline" asChild>
          <a href={downloadUrl} download={file.name}>
            <Download className="w-4 h-4 mr-2" />
            Baixar
          </a>
        </Button>
      </div>
    </div>
  );
}

// ── DOC Viewer (mammoth) ──────────────────────────────────────────────────────
// Handles .docx and .doc via server-side mammoth. Binary BIFF .doc files
// return a "body element" error; in that case a friendly fallback is shown
// with "Abrir no Word Online" + download buttons.

function DocHtmlViewer({
  file,
  onTryMicrosoftOnline,
}: {
  file: FileItem;
  onTryMicrosoftOnline?: () => void;
}) {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [html, setHtml] = useState("");
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

  if (state === "error" && errorMsg) {
    const isBinaryDoc = errorMsg.includes("body element") || errorMsg.includes("docx file");
    if (isBinaryDoc) {
      const downloadUrl = `${BASE_URL}/api/files/download?path=${encodeURIComponent(file.path)}`;
      return (
        <div className="flex flex-col items-center justify-center flex-1 gap-5 text-muted-foreground py-8">
          <div className="p-5 rounded-full bg-amber-50 dark:bg-amber-950/30">
            <AlertCircle className="w-12 h-12 text-amber-400" />
          </div>
          <div className="text-center space-y-1 max-w-[300px]">
            <p className="font-medium text-foreground">Formato .doc legado</p>
            <p className="text-sm leading-relaxed">
              Este arquivo está no formato binário antigo do Word e não pode ser
              visualizado diretamente. Abra-o no Word Online ou baixe-o.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            {onTryMicrosoftOnline && (
              <Button variant="default" onClick={onTryMicrosoftOnline}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Abrir no Word Online
              </Button>
            )}
            <Button variant="outline" asChild>
              <a href={downloadUrl} download={file.name}>
                <Download className="w-4 h-4 mr-2" />
                Baixar
              </a>
            </Button>
          </div>
        </div>
      );
    }
    return <ViewerError message={errorMsg} />;
  }

  return (
    <div
      className="docx-viewer flex-1 overflow-auto rounded-lg border border-border bg-white text-black p-4"
      style={{ minHeight: "calc(100vh - 220px)" }}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  );
}

// ── OnlyOffice Editor ─────────────────────────────────────────────────────────

interface EditSession {
  documentServerUrl: string;
  fileUrl: string;
  callbackUrl: string;
  fileName: string;
  fileType: string;
  key: string;
}

function getDocumentType(fileType: string): string {
  if (["doc", "docx", "odt", "rtf", "txt"].includes(fileType)) return "word";
  if (["xls", "xlsx", "ods", "csv"].includes(fileType)) return "cell";
  if (["ppt", "pptx", "odp"].includes(fileType)) return "slide";
  return "word";
}

function OnlyOfficeEditor({ session, onClose }: { session: EditSession; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instanceRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const initEditor = () => {
      if (cancelled || !containerRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const DocsAPI = (window as any).DocsAPI;
      if (!DocsAPI) {
        setError("OnlyOffice API não carregou. Verifique se o servidor está acessível.");
        return;
      }
      try {
        instanceRef.current = new DocsAPI.DocEditor(containerRef.current.id, {
          document: {
            fileType: session.fileType,
            key: session.key,
            title: session.fileName,
            url: session.fileUrl,
          },
          documentType: getDocumentType(session.fileType),
          editorConfig: {
            callbackUrl: session.callbackUrl,
            lang: "pt-BR",
          },
          height: "100%",
          width: "100%",
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao inicializar o editor.");
      }
    };

    // Poll for window.DocsAPI — React 19 intercepts scripts added to document.head
    // and may suppress the onload callback, so we detect readiness via polling instead.
    const waitForDocsAPI = () => {
      let attempts = 0;
      pollTimer = setInterval(() => {
        if (cancelled) { clearInterval(pollTimer!); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).DocsAPI) {
          clearInterval(pollTimer!);
          initEditor();
        } else if (++attempts > 100) { // 10 s timeout
          clearInterval(pollTimer!);
          if (!cancelled) setError("OnlyOffice API não carregou. Verifique se o servidor está acessível.");
        }
      }, 100);
    };

    const scriptId = "onlyoffice-api-script";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (!existing) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = `${session.documentServerUrl}/web-apps/apps/api/documents/api.js`;
      script.onerror = () => {
        if (!cancelled) setError("Não foi possível carregar o script do OnlyOffice. Verifique se o servidor está acessível.");
      };
      document.head.appendChild(script);
    }

    // Whether the script was already present or just injected, poll for DocsAPI
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).DocsAPI) {
      initEditor();
    } else {
      waitForDocsAPI();
    }

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (instanceRef.current) {
        try { instanceRef.current.destroyEditor?.(); } catch { /* ignore */ }
        instanceRef.current = null;
      }
    };
  }, [session]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-destructive p-8">
        <AlertCircle className="w-10 h-10" />
        <p className="text-sm font-medium text-center max-w-[320px]">{error}</p>
        <Button variant="outline" onClick={onClose}>Fechar</Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      id="onlyoffice-editor-container"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

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

// ── Main component ─────────────────────────────────────────────────────────────

export function FilePreviewSheet({ file, onClose }: FilePreviewSheetProps) {
  const isOpen = file !== null;
  const officeKind = file ? getOfficeKind(file) : null;
  const kind = file && !officeKind ? getPreviewKind(file.mimeType) : "unsupported";

  const [tokenLoadingFor, setTokenLoadingFor] = useState<"microsoft" | "google" | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editSession, setEditSession] = useState<EditSession | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  const openEditor = useCallback(async () => {
    if (!file || !officeKind) return;
    setEditLoading(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/files/edit-session?path=${encodeURIComponent(file.path)}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Falha ao criar sessão de edição");
      }
      const session = (await res.json()) as EditSession;
      setEditSession(session);
      setIsEditorOpen(true);
    } catch (e) {
      console.error("openEditor:", e);
    } finally {
      setEditLoading(false);
    }
  }, [file, officeKind]);

  const openInService = useCallback(
    async (service: "microsoft" | "google") => {
      if (!file || !officeKind) return;
      setTokenLoadingFor(service);
      try {
        const res = await fetch(
          `${BASE_URL}/api/files/token?path=${encodeURIComponent(file.path)}`,
          { credentials: "include" }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Falha ao gerar link");
        }
        const data = (await res.json()) as { token: string; publicUrl: string };
        const encoded = encodeURIComponent(data.publicUrl);
        const url =
          service === "microsoft"
            ? `https://view.officeapps.live.com/op/view.aspx?src=${encoded}`
            : `https://docs.google.com/viewer?url=${encoded}`;
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        // silently ignore — the download button is always available as fallback
      } finally {
        setTokenLoadingFor(null);
      }
    },
    [file, officeKind]
  );

  const previewUrl = file
    ? `${BASE_URL}/api/files/preview?path=${encodeURIComponent(file.path)}`
    : "";
  const downloadUrl = file
    ? `${BASE_URL}/api/files/download?path=${encodeURIComponent(file.path)}`
    : "";

  return (
    <>
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:w-[60vw] sm:max-w-[860px] flex flex-col p-0 gap-0"
      >
        {file && (
          <>
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
              <div className="flex items-start justify-between gap-3 pr-6">
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base">{file.name}</SheetTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatSize(file.size)} · {formatDate(file.modifiedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  {officeKind && ONLYOFFICE_URL && (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-8 px-2.5 gap-1.5 text-xs"
                      onClick={openEditor}
                      disabled={editLoading}
                      title="Editar com OnlyOffice — salva automaticamente no VPS Drive"
                    >
                      {editLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Pencil className="w-3 h-3" />
                      )}
                      Editar
                    </Button>
                  )}
                  {officeKind && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5 gap-1.5 text-xs"
                        onClick={() => openInService("microsoft")}
                        disabled={tokenLoadingFor !== null}
                        title={getMsLabel(officeKind)}
                      >
                        {tokenLoadingFor === "microsoft" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3 h-3" />
                        )}
                        {getMsLabel(officeKind)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5 gap-1.5 text-xs"
                        onClick={() => openInService("google")}
                        disabled={tokenLoadingFor !== null}
                        title="Visualização apenas — edições não são salvas no VPS Drive"
                      >
                        {tokenLoadingFor === "google" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3 h-3" />
                        )}
                        Google Viewer
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="outline" className="h-8 px-2.5 gap-1.5 text-xs shrink-0" asChild>
                    <a href={downloadUrl} download={file.name}>
                      <Download className="w-3 h-3" />
                      Baixar
                    </a>
                  </Button>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-auto p-6 flex flex-col min-h-0">
              {officeKind === "docx" && <DocxViewer file={file} />}
              {officeKind === "doc" && (
                <DocHtmlViewer
                  file={file}
                  onTryMicrosoftOnline={() => openInService("microsoft")}
                />
              )}
              {officeKind === "xlsx" && <XlsxViewer file={file} />}
              {officeKind === "pptx" && (
                <PptxFallback
                  file={file}
                  onOpenMicrosoft={() => openInService("microsoft")}
                />
              )}

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

    {/* OnlyOffice Editor — fullscreen dialog */}
    <Dialog open={isEditorOpen} onOpenChange={(open) => { if (!open) { setIsEditorOpen(false); setEditSession(null); } }}>
      <DialogContent className="max-w-none w-screen h-screen p-0 m-0 rounded-none border-0 flex flex-col">
        {editSession && (
          <OnlyOfficeEditor
            session={editSession}
            onClose={() => { setIsEditorOpen(false); setEditSession(null); }}
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
