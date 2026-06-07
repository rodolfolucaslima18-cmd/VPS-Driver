import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { HardDrive, Server, Shield, Zap } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground selection:bg-primary/20">
      <header className="px-6 h-16 flex items-center justify-between border-b border-border/50 sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-2 text-primary">
          <HardDrive className="w-6 h-6" />
          <span className="font-semibold tracking-tight text-lg text-foreground">VPS Drive</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="text-sm font-medium hover:text-primary transition-colors">
            Entrar
          </Link>
          <Button asChild size="sm">
            <Link href="/sign-up">Começar agora</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-24 sm:py-32 relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>
        
        <div className="max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
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
              <Link href="/sign-up">Instalar o Drive</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto h-12 px-8 text-base bg-background/50">
              <Link href="/sign-in">Acessar arquivos</Link>
            </Button>
          </div>
        </div>

        <div className="mt-32 grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-5xl mx-auto px-4 w-full">
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
      </main>
      
      <footer className="py-6 text-center text-sm text-muted-foreground border-t border-border/50">
        &copy; {new Date().getFullYear()} VPS Drive. Todos os direitos reservados.
      </footer>
    </div>
  );
}
