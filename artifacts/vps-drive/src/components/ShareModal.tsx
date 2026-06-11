import { useState } from "react";
import { Link, Copy, Check, Trash2, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type ShareToken = {
  token: string;
  filePath: string;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
};

type TTLOption = { label: string; value: string };

const TTL_OPTIONS: TTLOption[] = [
  { label: "1 hora", value: "1h" },
  { label: "24 horas", value: "24h" },
  { label: "7 dias", value: "7d" },
];

type Props = {
  filePath: string;
  fileName: string;
  onClose: () => void;
};

export function ShareModal({ filePath, fileName, onClose }: Props) {
  const [ttl, setTtl] = useState("24h");
  const [shareToken, setShareToken] = useState<ShareToken | null>(null);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const shareUrl = shareToken
    ? `${window.location.origin}${BASE_URL}/api/share/${shareToken.token}`
    : null;

  async function createLink() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, ttl }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Erro ao criar link");
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
      });
      if (!res.ok && res.status !== 404) {
        throw new Error("Erro ao revogar link");
      }
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

  function formatExpiry(iso: string) {
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
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <h2 className="font-semibold text-base">Compartilhar arquivo</h2>
              <p className="text-sm text-muted-foreground truncate">{fileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!shareToken ? (
          <>
            {/* TTL selection */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Validade do link</p>
              <div className="flex gap-2">
                {TTL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTtl(opt.value)}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      ttl === opt.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-accent/50 text-muted-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <Button className="w-full" onClick={createLink} disabled={loading}>
              {loading ? "Gerando link…" : "Gerar link de compartilhamento"}
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
              <p className="text-xs text-muted-foreground">
                Expira em {formatExpiry(shareToken.expiresAt)}
              </p>
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
