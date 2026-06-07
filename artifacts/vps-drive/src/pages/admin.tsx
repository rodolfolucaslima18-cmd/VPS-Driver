import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  HardDrive,
  Users,
  UserPlus,
  Trash2,
  ShieldOff,
  ShieldCheck,
  ArrowLeft,
  Loader2,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: "master" | "user";
  isActive: boolean;
  createdAt: string;
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

function formatDate(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function userInitials(u: AdminUser): string {
  const parts = u.name.trim().split(" ");
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || u.email[0].toUpperCase();
}

type CreateUserForm = { name: string; email: string; password: string };

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateUserForm>({ name: "", email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  const { data, isLoading, error } = useQuery<{ users: AdminUser[]; totalCount: number }>({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch("/api/admin/users"),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateUserForm) =>
      apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (res: { message?: string }) => {
      toast({ title: "Usuário criado", description: res.message });
      setForm({ name: "", email: "", password: "" });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao criar usuário", description: err.message, variant: "destructive" });
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

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      apiFetch(`/api/admin/users/${userId}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password }),
      }),
    onSuccess: (res: { message?: string }) => {
      toast({ title: "Senha redefinida", description: res.message });
      setResetPasswordUserId(null);
      setResetPasswordValue("");
      setShowResetPassword(false);
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao redefinir senha", description: err.message, variant: "destructive" });
    },
  });

  const handleCreate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const { name, email, password } = form;
      if (!name.trim() || !email.trim() || !password) return;
      createMutation.mutate({ name: name.trim(), email: email.trim(), password });
    },
    [form, createMutation],
  );

  const isAccessDenied =
    !isLoading &&
    (error instanceof Error ? error.message.includes("Apenas o usuário Master") : false);

  const resetUserName = data?.users.find((u) => u.id === resetPasswordUserId)?.name ?? "";

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Reset password modal */}
      {resetPasswordUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary shrink-0" />
              <div>
                <h2 className="text-sm font-semibold">Redefinir senha</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Usuário: <span className="font-medium text-foreground">{resetUserName}</span>
                </p>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!resetPasswordUserId || resetPasswordValue.length < 8) return;
                resetPasswordMutation.mutate({ userId: resetPasswordUserId, password: resetPasswordValue });
              }}
              className="space-y-3"
            >
              <div className="relative">
                <input
                  type={showResetPassword ? "text" : "password"}
                  value={resetPasswordValue}
                  onChange={(e) => setResetPasswordValue(e.target.value)}
                  placeholder="Nova senha (mín. 8 caracteres)"
                  required
                  minLength={8}
                  autoFocus
                  className="w-full h-9 rounded-md border border-input bg-background px-3 pr-9 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showResetPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={resetPasswordMutation.isPending}
                  onClick={() => {
                    setResetPasswordUserId(null);
                    setResetPasswordValue("");
                    setShowResetPassword(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={resetPasswordMutation.isPending || resetPasswordValue.length < 8}
                >
                  {resetPasswordMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Salvar senha"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

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
              {/* Create user form */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-primary" />
                  Criar novo usuário
                </h2>
                <form onSubmit={handleCreate} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Nome completo"
                      required
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="email@exemplo.com"
                      required
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder="Senha (mín. 8 caracteres)"
                        required
                        minLength={8}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 pr-9 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      className="h-9 px-4 shrink-0"
                      disabled={createMutation.isPending || !form.name.trim() || !form.email.trim() || !form.password}
                    >
                      {createMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        "Criar"
                      )}
                    </Button>
                  </div>
                </form>
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
                    {data.users.map((u) => {
                      const isCurrentUser = u.id === currentUser?.id;
                      const isMaster = u.role === "master";
                      const isPending = suspendMutation.isPending || deleteMutation.isPending;

                      return (
                        <div
                          key={u.id}
                          className={`flex items-center gap-4 px-5 py-3.5 ${!u.isActive ? "opacity-60" : ""}`}
                        >
                          {/* Avatar */}
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                            {userInitials(u)}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate">{u.name}</span>
                              {isMaster && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                                  <Crown className="w-3 h-3" />
                                  Master
                                </span>
                              )}
                              {isCurrentUser && (
                                <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 shrink-0">
                                  Você
                                </span>
                              )}
                              {!u.isActive && (
                                <span className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-full px-2 py-0.5 shrink-0">
                                  Suspenso
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {u.email} · Criado em {formatDate(u.createdAt)}
                            </p>
                          </div>

                          {/* Actions */}
                          {!isCurrentUser && !isMaster && (
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
                                    title={!u.isActive ? "Reativar usuário" : "Suspender usuário"}
                                  >
                                    {!u.isActive ? (
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
                                    variant="outline"
                                    className="h-7 px-2 text-xs gap-1"
                                    disabled={isPending}
                                    onClick={() => {
                                      setResetPasswordUserId(u.id);
                                      setResetPasswordValue("");
                                      setShowResetPassword(false);
                                    }}
                                    title="Redefinir senha"
                                  >
                                    <KeyRound className="w-3 h-3" />
                                    Redefinir senha
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
