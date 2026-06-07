import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  HardDrive,
  Users,
  UserPlus,
  Trash2,
  ShieldOff,
  ShieldCheck,
  ArrowLeft,
  Loader2,
  Mail,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type AdminUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  createdAt: number;
  banned: boolean;
  lastSignInAt: number | null;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return data as T;
}

function formatDate(ts: number | null): string {
  if (!ts) return "Nunca";
  return new Date(ts).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function userName(u: AdminUser): string {
  const parts = [u.firstName, u.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : u.email ?? "Sem nome";
}

function userInitials(u: AdminUser): string {
  const first = u.firstName?.[0] ?? "";
  const last = u.lastName?.[0] ?? "";
  return (first + last).toUpperCase() || (u.email?.[0]?.toUpperCase() ?? "?");
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<{ users: AdminUser[]; totalCount: number }>({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch("/api/admin/users"),
    retry: false,
  });

  const inviteMutation = useMutation({
    mutationFn: (email: string) =>
      apiFetch("/api/admin/users/invite", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    onSuccess: (res: { message?: string }) => {
      toast({ title: "Convite enviado", description: res.message });
      setInviteEmail("");
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao enviar convite", description: err.message, variant: "destructive" });
    },
  });

  const suspendMutation = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/api/admin/users/${userId}/suspend`, { method: "PATCH" }),
    onSuccess: (res: { message?: string }) => {
      toast({ title: "Alteração realizada", description: res.message });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: (res: { message?: string }) => {
      toast({ title: "Usuário removido", description: res.message });
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao remover", description: err.message, variant: "destructive" });
      setConfirmDeleteId(null);
    },
  });

  const handleInvite = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const email = inviteEmail.trim();
      if (!email) return;
      inviteMutation.mutate(email);
    },
    [inviteEmail, inviteMutation],
  );

  const isMasterUser = data?.users[0]?.id === user?.id;
  const isAccessDenied =
    !isLoading &&
    (error instanceof Error ? error.message.includes("Apenas o usuário Master") : false);

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <div className="w-60 border-r border-border bg-card/50 flex flex-col shrink-0">
        <div className="h-14 px-4 flex items-center gap-2 border-b border-border">
          <HardDrive className="w-5 h-5 text-primary" />
          <span className="font-semibold tracking-tight">VPS Drive</span>
        </div>

        <div className="p-4 flex-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Administração
          </p>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-accent/60 text-sm font-medium">
            <Users className="w-4 h-4 text-primary" />
            Usuários
          </div>
        </div>

        <div className="p-3 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => setLocation("/drive")}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar ao Drive
          </Button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="h-14 px-6 border-b border-border flex items-center bg-card/50 backdrop-blur-sm shrink-0">
          <h1 className="font-semibold text-base">Gerenciar Usuários</h1>
          {data && (
            <span className="ml-3 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {data.totalCount} {data.totalCount === 1 ? "usuário" : "usuários"}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Access denied */}
          {isAccessDenied && (
            <div className="flex flex-col items-center justify-center text-center space-y-3 text-muted-foreground min-h-[300px]">
              <div className="p-5 rounded-full bg-destructive/10">
                <ShieldOff className="w-10 h-10 text-destructive/60" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Acesso negado</p>
                <p className="text-sm mt-0.5">
                  Apenas o usuário Master pode acessar o painel de administração.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setLocation("/drive")}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Voltar ao Drive
              </Button>
            </div>
          )}

          {/* Generic error */}
          {error && !isAccessDenied && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {(error as Error).message}
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center min-h-[200px]">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {data && !isAccessDenied && (
            <>
              {/* Invite form */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-primary" />
                  Convidar novo usuário
                </h2>
                <form onSubmit={handleInvite} className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="email@exemplo.com"
                      className="w-full pl-9 pr-3 h-9 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    className="h-9 px-4"
                    disabled={inviteMutation.isPending || !inviteEmail.trim()}
                  >
                    {inviteMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      "Enviar convite"
                    )}
                  </Button>
                </form>
                <p className="text-xs text-muted-foreground mt-2">
                  Um e-mail de convite será enviado pelo Clerk para o endereço informado.
                </p>
              </div>

              {/* Users list */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border">
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    Usuários cadastrados
                  </h2>
                </div>

                {data.users.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Nenhum usuário encontrado.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {data.users.map((u, idx) => {
                      const isCurrentUser = u.id === user?.id;
                      const isMaster = idx === 0;
                      const isPending =
                        suspendMutation.isPending || deleteMutation.isPending;

                      return (
                        <div
                          key={u.id}
                          className={`flex items-center gap-4 px-5 py-3.5 ${u.banned ? "opacity-60" : ""}`}
                        >
                          {/* Avatar */}
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                            {userInitials(u)}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {userName(u)}
                              </span>
                              {isMaster && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                                  <Crown className="w-3 h-3" />
                                  Master
                                </span>
                              )}
                              {isCurrentUser && !isMaster && (
                                <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 shrink-0">
                                  Você
                                </span>
                              )}
                              {u.banned && (
                                <span className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-full px-2 py-0.5 shrink-0">
                                  Suspenso
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {u.email ?? "Sem e-mail"} · Criado em {formatDate(u.createdAt)}
                            </p>
                            <p className="text-xs text-muted-foreground/70">
                              Último acesso: {formatDate(u.lastSignInAt)}
                            </p>
                          </div>

                          {/* Actions */}
                          {!isCurrentUser && (
                            <div className="flex items-center gap-2 shrink-0">
                              {confirmDeleteId === u.id ? (
                                <>
                                  <span className="text-xs text-muted-foreground">Confirmar?</span>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-7 px-2 text-xs"
                                    disabled={deleteMutation.isPending}
                                    onClick={() => deleteMutation.mutate(u.id)}
                                  >
                                    {deleteMutation.isPending ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      "Remover"
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setConfirmDeleteId(null)}
                                  >
                                    Cancelar
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs gap-1"
                                    disabled={isPending}
                                    onClick={() => suspendMutation.mutate(u.id)}
                                    title={u.banned ? "Reativar usuário" : "Suspender usuário"}
                                  >
                                    {u.banned ? (
                                      <>
                                        <ShieldCheck className="w-3 h-3" />
                                        Reativar
                                      </>
                                    ) : (
                                      <>
                                        <ShieldOff className="w-3 h-3" />
                                        Suspender
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 gap-1"
                                    disabled={isPending}
                                    onClick={() => setConfirmDeleteId(u.id)}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    Remover
                                  </Button>
                                </>
                              )}
                            </div>
                          )}

                          {isCurrentUser && isMasterUser && (
                            <div className="shrink-0 text-xs text-muted-foreground italic">
                              sua conta
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
