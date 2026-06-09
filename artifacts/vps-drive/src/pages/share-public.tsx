import { useState, useEffect, useCallback } from "react";
import { useParams } from "wouter";
import { Download, Lock, AlertCircle, FileX, Timer, CheckCircle2, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type ShareInfo =
  | { found: false }
  | {
      found: true;
      fileName: string;
      isExpired: boolean;
      isLimitReached: boolean;
      requiresPassword: boolean;
      expiresAt: string | null;
      downloadCount: number;
      maxDownloads: number | null;
    };

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

export default function SharePublicPage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!info?.found) return;
    if (info.isExpired || info.isLimitReached || info.requiresPassword) return;
    const t = setTimeout(() => triggerDownload(), 800);
    return () => clearTimeout(t);
  }, [info, triggerDownload]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlocking(true);
    setUnlockError(null);
    try {
      const resp = await fetch(`${BASE_URL}/api/share/${token}/unlock`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setUnlockError((data as { error?: string }).error ?? "Senha incorreta.");
        return;
      }
      setUnlocked(true);
      triggerDownload();
    } catch {
      setUnlockError("Erro ao verificar senha. Tente novamente.");
    } finally {
      setUnlocking(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!info || !info.found) {
    return (
      <ErrorCard
        icon={FileX}
        title="Link inválido"
        description="Este link não existe ou foi removido."
      />
    );
  }

  if (info.isExpired) {
    return (
      <ErrorCard
        icon={Timer}
        title="Link expirado"
        description="Este link de compartilhamento expirou."
      />
    );
  }

  if (info.isLimitReached) {
    return (
      <ErrorCard
        icon={AlertCircle}
        title="Limite atingido"
        description="Este link atingiu o número máximo de downloads."
      />
    );
  }

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

        {info.requiresPassword && !unlocked ? (
          <form onSubmit={handleUnlock} className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
              <Lock className="w-4 h-4 shrink-0 text-amber-500" />
              Este arquivo é protegido por senha.
            </div>
            <Input
              type="password"
              placeholder="Digite a senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {unlockError && <p className="text-xs text-destructive">{unlockError}</p>}
            <Button type="submit" className="w-full" disabled={unlocking || !password}>
              {unlocking ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verificando…
                </span>
              ) : (
                "Acessar arquivo"
              )}
            </Button>
          </form>
        ) : unlocked ? (
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
