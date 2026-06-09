import { useState } from "react";
import { Link, Copy, Check, Trash2, X, ExternalLink, Lock, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type ShareToken = {
  token: string;
  filePath: string;
  createdAt: string;
  expiresAt: string | null;
  createdBy: string;
  hasPassword: boolean;
  maxDownloads: number | null;
  downloadCount: number;
};

type TTLOption = { label: string; value: string; seconds: number | null };

const TTL_OPTIONS: TTLOption[] = [
  { label: "1 hora",   value: "1h",    seconds: 3600 },
  { label: "24 horas", value: "24h",   seconds: 86400 },
  { label: "7 dias",   value: "7d",    seconds: 604800 },
  { label: "30 dias",  value: "30d",   seconds: 2592000 },
  { label: "Nunca",    value: "never", seconds: null },
];

type Props = {
  filePath: string;
  fileName: string;
  onClose: () => void;
};

export function ShareModal({ filePath, fileName, onClose }: Props) {
  const [ttlKey, setTtlKey] = useState("24h");
  const [password, setPassword] = useState("");
  const [maxDlInput, setMaxDlInput] = useState("");
  const [shareToken, setShareToken] = useState<ShareToken | null>(null);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const shareUrl = shareToken
    ? `${window.location.origin}${BASE_URL}/share/${shareToken.token}`
    : null;

  async function createLink() {
    setLoading(true);
    try {
      const selected = TTL_OPTIONS.find((o) => o.value === ttlKey) ?? TTL_OPTIONS[1];
      const maxDownloads = maxDlInput ? parseInt(maxDlInput, 10) || null : null;

      const res = await fetch(`${BASE_URL}/api/share`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          expiresIn: selected.seconds,
          password: password || undefined,
          maxDownloads: maxDownloads ?? undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Erro ao criar link");
      }
      const data: ShareToken = await res.json();
      setShareToken(data);
    } catch (err) {
      toast({
        title: "Erro ao criar link",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function revokeLink() {
    if (!shareToken) return;
    setRevoking(true);
    try {
      const res = await fetch(`${BASE_URL}/api/share/${shareToken.token}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 404) throw new Error("Erro ao revogar link");
      setShareToken(null);
      toast({ title: "Link revogado com sucesso." });
    } catch {
      toast({ title: "Não foi possível revogar o link", variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
    }
  }

  function formatExpiry(iso: string | null) {
    if (!iso) return "Nunca expira";
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <h2 className="font-semibold text-base">Compartilhar arquivo</h2>
              <p className="text-sm text-muted-foreground truncate">{fileName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!shareToken ? (
          <>
            {/* Expiry */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Validade</p>
              <Select value={ttlKey} onValueChange={setTtlKey}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TTL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Password (optional) */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                Senha{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </p>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  type="password"
                  placeholder="Sem senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            {/* Max downloads (optional) */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                Máx. downloads{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </p>
              <div className="relative">
                <Download className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  type="number"
                  min="1"
                  placeholder="Ilimitado"
                  value={maxDlInput}
                  onChange={(e) => setMaxDlInput(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <Button className="w-full" onClick={createLink} disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Gerando link…
                </span>
              ) : (
                "Gerar link de compartilhamento"
              )}
            </Button>
          </>
        ) : (
          <>
            {/* Share link */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Link público</p>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border">
                <p className="text-sm text-foreground truncate flex-1 font-mono select-all">
                  {shareUrl}
                </p>
                <button
                  onClick={copyLink}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copiar link"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <a
                  href={shareUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  title="Abrir link"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>

              {/* Metadata badges */}
              <div className="flex flex-wrap gap-2 pt-0.5">
                <span className="text-xs text-muted-foreground">
                  Expira: {formatExpiry(shareToken.expiresAt)}
                </span>
                {shareToken.hasPassword && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded px-1.5 py-0.5">
                    <Lock className="w-2.5 h-2.5" />
                    Com senha
                  </span>
                )}
                {shareToken.maxDownloads !== null && (
                  <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/30 rounded px-1.5 py-0.5">
                    <Download className="w-2.5 h-2.5" />
                    Máx. {shareToken.maxDownloads} downloads
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" onClick={copyLink} variant="outline">
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-2 text-green-500" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copiar link
                  </>
                )}
              </Button>
              <Button
                variant="destructive"
                onClick={revokeLink}
                disabled={revoking}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {revoking ? "Revogando…" : "Revogar"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
