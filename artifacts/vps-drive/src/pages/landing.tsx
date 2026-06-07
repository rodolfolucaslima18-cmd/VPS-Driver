import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { HardDrive, Server, Shield, Zap, Terminal, Copy, Check, Download } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

function CopyCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="flex items-center gap-2 bg-zinc-900 text-zinc-100 rounded-xl px-4 py-3 font-mono text-sm">
      <Terminal className="w-4 h-4 text-zinc-400 shrink-0" />
      <span className="flex-1 truncate">{cmd}</span>
      <button
        onClick={copy}
        className="shrink-0 text-zinc-400 hover:text-zinc-100 transition-colors"
        title="Copiar"
      >
        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default function LandingPage() {
  const installCmd = `bash <(curl -sL ${window.location.origin}${BASE_URL}/api/download/install.sh)`;

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground selection:bg-primary/20">
      <header className="px-6 h-16 flex items-center justify-between border-b border-border/50 sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-2 text-primary">
          <HardDrive className="w-6 h-6" />
          <span className="font-semibold tracking-tight text-lg text-foreground">VPS Drive</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#instalacao" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors hidden sm:block">
            Instalação
          </a>
          <Link href="/sign-in" className="text-sm font-medium hover:text-primary transition-colors">
            Entrar
          </Link>
          <Button asChild size="sm">
            <Link href="/sign-up">Começar agora</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center text-center px-4 relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>

        {/* Hero */}
        <section className="w-full flex flex-col items-center py-24 sm:py-32 space-y-8 max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm text-primary font-medium">
            <span className="flex h-2 w-2 rounded-full bg-primary mr-2 animate-pulse"></span>
            v1.0 disponível
          </div>

          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight text-foreground">
            Seus arquivos.<br />
            <span className="text-primary">Seu servidor.</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Compartilhamento de arquivos auto-hospedado, rápido e seguro.
            Sem rastreamento, sem assinaturas — apenas desempenho.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Button asChild size="lg" className="w-full sm:w-auto h-12 px-8 text-base">
              <a href="#instalacao">Instalar agora</a>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto h-12 px-8 text-base bg-background/50">
              <Link href="/sign-in">Acessar arquivos</Link>
            </Button>
          </div>
        </section>

        {/* Feature cards */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-5xl mx-auto px-4 w-full">
          <div className="flex flex-col items-center text-center space-y-3 p-6 rounded-2xl border border-border bg-card/50 backdrop-blur-sm">
            <div className="p-3 rounded-full bg-primary/10 text-primary">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-lg">Extremamente rápido</h3>
            <p className="text-sm text-muted-foreground">Construído sobre uma pilha leve projetada para máxima performance e zero latência.</p>
          </div>

          <div className="flex flex-col items-center text-center space-y-3 p-6 rounded-2xl border border-border bg-card/50 backdrop-blur-sm">
            <div className="p-3 rounded-full bg-primary/10 text-primary">
              <Shield className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-lg">Privacidade total</h3>
            <p className="text-sm text-muted-foreground">Auto-hospedado significa que você controla tudo. Privacidade completa para seus arquivos mais importantes.</p>
          </div>

          <div className="flex flex-col items-center text-center space-y-3 p-6 rounded-2xl border border-border bg-card/50 backdrop-blur-sm">
            <div className="p-3 rounded-full bg-primary/10 text-primary">
              <Server className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-lg">Fluxo profissional</h3>
            <p className="text-sm text-muted-foreground">Arraste e solte, visualização em grade e uma interface que parece uma ferramenta nativa.</p>
          </div>
        </div>

        {/* Seção de instalação */}
        <section id="instalacao" className="w-full max-w-3xl mx-auto mt-32 mb-16 px-4 scroll-mt-20">
          <div className="space-y-6 text-left bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <Terminal className="w-5 h-5" />
                <span className="text-xs font-semibold uppercase tracking-wider">Instalação</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Instale em 1 comando</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Execute o comando abaixo na sua VPS (Ubuntu 20.04+ ou Debian 11+) como <code className="bg-muted px-1 rounded text-xs">root</code>.
                O instalador cuida de todo o resto.
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Comando de instalação:</p>
              <CopyCommand cmd={installCmd} />
            </div>

            <div className="space-y-3 pt-2 border-t border-border">
              <p className="text-sm font-medium text-foreground">O que o instalador faz:</p>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {[
                  "Instala Node.js 22 LTS, pnpm e PM2 automaticamente",
                  "Instala e configura o Nginx como proxy reverso",
                  "Pergunta IP/domínio, pasta de armazenamento e porta",
                  "Faz o build completo do app e inicia com PM2",
                  "Mostra a URL de acesso ao finalizar",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button asChild variant="outline" size="sm" className="gap-2">
                <a href={`${BASE_URL}/api/download/install.sh`} download="install.sh">
                  <Download className="w-4 h-4" />
                  Baixar install.sh
                </a>
              </Button>
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground gap-2">
                <a href="/DEPLOY.md" target="_blank" rel="noopener noreferrer">
                  Ver guia completo (DEPLOY.md)
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-6 text-center text-sm text-muted-foreground border-t border-border/50">
        &copy; {new Date().getFullYear()} VPS Drive. Todos os direitos reservados.
      </footer>
    </div>
  );
}
