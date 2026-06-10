import { useState, useEffect, useCallback } from "react";
import { useParams } from "wouter";
import {
  Download, Lock, AlertCircle, FileX, Timer, CheckCircle2,
  HardDrive, Folder, File, ChevronRight, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type ShareInfo =
  | { found: false }
  | {
      found: true;
      fileName: string;
      shareType: "file" | "folder";
      isExpired: boolean;
      isLimitReached: boolean;
      requiresPassword: boolean;
      expiresAt: string | null;
      downloadCount: number;
      maxDownloads: number | null;
    };

type BrowseItem = {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
};

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function ErrorCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-6">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <HardDrive className="w-4 h-4" />
        VPS Drive
      </div>
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-sm p-6 space-y-4 text-center">
        <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <Icon className="w-7 h-7 text-destructive" />
        </div>
        <div>
          <h1 className="font-semibold text-lg">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
    </div>
  );
}

// ── Folder browser ──────────────────────────────────────────────────────────

function FolderBrowser({
  token,
  rootName,
  info,
}: {
  token: string;
  rootName: string;
  info: Extract<ShareInfo, { found: true }>;
}) {
  // subPath is relative to the share root (e.g. "" = root, "subfolder/nested" = nested)
  const [subPath, setSubPath] = useState("");
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async (sub: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (sub) params.set("sub", sub);
      const resp = await fetch(`${BASE_URL}/api/share/${token}/browse?${params}`, {
        credentials: "include",
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? `HTTP ${resp.status}`);
        return;
      }
      const data = await resp.json() as { items: BrowseItem[] };
      setItems(data.items);
    } catch {
      setError("Erro ao carregar a pasta.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchItems(subPath); }, [subPath, fetchItems]);

  // Breadcrumb segments from subPath
  const breadcrumbs = subPath
    ? [rootName, ...subPath.split("/").filter(Boolean)]
    : [rootName];

  function navigateToSegment(idx: number) {
    if (idx === 0) { setSubPath(""); return; }
    const parts = subPath.split("/").filter(Boolean);
    setSubPath(parts.slice(0, idx).join("/"));
  }

  function navigateInto(item: BrowseItem) {
    setSubPath(item.relativePath);
  }

  function downloadFile(item: BrowseItem) {
    const params = new URLSearchParams({ path: item.relativePath });
    const url = `${BASE_URL}/api/share/${token}/file?${params}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <HardDrive className="w-4 h-4" />
          <span>VPS Drive</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-sm min-w-0">
          {breadcrumbs.map((seg, idx) => (
            <span key={idx} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
              {idx < breadcrumbs.length - 1 ? (
                <button
                  className="text-primary hover:underline truncate max-w-[120px]"
                  onClick={() => navigateToSegment(idx)}
                  title={seg}
                >
                  {seg}
                </button>
              ) : (
                <span className="font-medium truncate max-w-[160px]" title={seg}>{seg}</span>
              )}
            </span>
          ))}
        </div>
        {info.expiresAt && (
          <p className="text-xs text-muted-foreground shrink-0 hidden sm:block">
            Expira {new Date(info.expiresAt).toLocaleDateString("pt-BR")}
          </p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-4">
        {/* Back button when inside a subfolder */}
        {subPath && (
          <button
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              const parts = subPath.split("/").filter(Boolean);
              setSubPath(parts.slice(0, -1).join("/"));
            }}
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-destructive text-sm">{error}</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Pasta vazia.</div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            {items.map((item) => (
              <div
                key={item.relativePath}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group"
              >
                {/* Icon */}
                <div className="shrink-0">
                  {item.isDirectory ? (
                    <Folder className="w-5 h-5 text-blue-500" />
                  ) : (
                    <File className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0">
                  {item.isDirectory ? (
                    <button
                      className="text-sm font-medium text-left truncate w-full hover:text-primary transition-colors"
                      onClick={() => navigateInto(item)}
                      title={item.name}
                    >
                      {item.name}
                    </button>
                  ) : (
                    <span className="text-sm truncate block" title={item.name}>
                      {item.name}
                    </span>
                  )}
                  {!item.isDirectory && (
                    <span className="text-xs text-muted-foreground">{formatSize(item.size)}</span>
                  )}
                </div>

                {/* Actions */}
                {item.isDirectory ? (
                  <button
                    className="shrink-0 p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground"
                    onClick={() => navigateInto(item)}
                    title="Abrir pasta"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors opacity-0 group-hover:opacity-100"
                    onClick={() => downloadFile(item)}
                    title="Baixar arquivo"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Password unlock form ────────────────────────────────────────────────────

function UnlockForm({
  token,
  isFolder,
  onUnlocked,
}: {
  token: string;
  isFolder: boolean;
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUnlocking(true);
    setError(null);
    try {
      const resp = await fetch(`${BASE_URL}/api/share/${token}/unlock`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Senha incorreta.");
        return;
      }
      onUnlocked();
    } catch {
      setError("Erro ao verificar senha. Tente novamente.");
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-6">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <HardDrive className="w-4 h-4" />
        VPS Drive
      </div>
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-sm p-6 space-y-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
            <Lock className="w-7 h-7 text-amber-500" />
          </div>
          <div>
            <h1 className="font-semibold text-lg">Conteúdo protegido</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isFolder
                ? "Esta pasta é protegida por senha."
                : "Este arquivo é protegido por senha."}
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="password"
            placeholder="Digite a senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={unlocking || !password}>
            {unlocking ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Verificando…
              </span>
            ) : (
              isFolder ? "Acessar pasta" : "Acessar arquivo"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function SharePublicPage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetch(`${BASE_URL}/api/share/${token}/info`)
      .then((r) => r.json())
      .then((data: ShareInfo) => {
        setInfo(data);
        setLoading(false);
      })
      .catch(() => {
        setInfo({ found: false });
        setLoading(false);
      });
  }, [token]);

  const triggerDownload = useCallback(() => {
    setDownloading(true);
    const a = document.createElement("a");
    a.href = `${BASE_URL}/api/share/${token}`;
    if (info?.found) a.download = (info as { found: true; fileName: string }).fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setDownloading(false), 2000);
  }, [token, info]);

  // Auto-download for file shares with no password and no issues
  useEffect(() => {
    if (!info?.found) return;
    if (info.shareType === "folder") return;
    if (info.isExpired || info.isLimitReached || info.requiresPassword) return;
    const t = setTimeout(() => triggerDownload(), 800);
    return () => clearTimeout(t);
  }, [info, triggerDownload]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!info || !info.found) {
    return <ErrorCard icon={FileX} title="Link inválido" description="Este link não existe ou foi removido." />;
  }

  if (info.isExpired) {
    return <ErrorCard icon={Timer} title="Link expirado" description="Este link de compartilhamento expirou." />;
  }

  if (info.isLimitReached) {
    return <ErrorCard icon={AlertCircle} title="Limite atingido" description="Este link atingiu o número máximo de downloads." />;
  }

  const isFolder = info.shareType === "folder";

  // Password gate — applies to both file and folder shares
  if (info.requiresPassword && !unlocked) {
    return (
      <UnlockForm
        token={token}
        isFolder={isFolder}
        onUnlocked={() => setUnlocked(true)}
      />
    );
  }

  // ── Folder share: full browsing UI ────────────────────────────────────────
  if (isFolder) {
    return <FolderBrowser token={token} rootName={info.fileName} info={info} />;
  }

  // ── File share: download UI (existing behaviour) ──────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-6">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <HardDrive className="w-4 h-4" />
        VPS Drive
      </div>

      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-sm p-6 space-y-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Download className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-lg">Arquivo compartilhado</h1>
            <p className="text-sm text-muted-foreground mt-0.5 break-all">{info.fileName}</p>
          </div>

          <div className="flex flex-col items-center gap-1">
            {info.expiresAt && (
              <p className="text-xs text-muted-foreground">
                Expira em{" "}
                {new Date(info.expiresAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
            {info.maxDownloads !== null && (
              <p className="text-xs text-muted-foreground">
                {info.downloadCount} / {info.maxDownloads} downloads
              </p>
            )}
          </div>
        </div>

        {unlocked ? (
          <div className="space-y-3 text-center">
            <div className="flex items-center gap-2 text-sm text-green-600 justify-center">
              <CheckCircle2 className="w-4 h-4" />
              Download iniciado!
            </div>
            <Button variant="outline" className="w-full" onClick={triggerDownload} disabled={downloading}>
              <Download className="w-4 h-4 mr-2" />
              {downloading ? "Baixando…" : "Baixar novamente"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              {downloading ? "Iniciando download…" : "O download iniciará automaticamente."}
            </p>
            <Button className="w-full" onClick={triggerDownload} disabled={downloading}>
              <Download className="w-4 h-4 mr-2" />
              {downloading ? "Baixando…" : "Baixar agora"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
