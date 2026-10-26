import { create } from "zustand";
import type { Lang, Permission, User } from "@/types";
import { auth as authApi } from "@/services/api";
import {
  refreshSession,
  setAccessToken,
  setAuthLostHandler,
} from "@/services/http";

interface AuthState {
  user: User | null;
  status: "loading" | "authed" | "anon";
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  init: async () => {
    try {
      const r = await refreshSession();
      set(
        r ? { user: r.user, status: "authed" } : { user: null, status: "anon" },
      );
    } catch {
      set({ user: null, status: "anon" });
    }
  },
  login: async (email, password) => {
    const r = await authApi.login(email, password);
    setAccessToken(r.accessToken);
    set({ user: r.user, status: "authed" });
    return r.user;
  },
  logout: async () => {
    await authApi.logout().catch(() => undefined);
    setAccessToken(null);
    set({ user: null, status: "anon" });
  },
  setUser: (user) => set({ user }),
}));

setAuthLostHandler(() => {
  setAccessToken(null);
  useAuth.setState({ user: null, status: "anon" });
});

/** UI-only permission helper: the server enforces every rule independently. */
export function can(user: User | null, permission: Permission): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.role === "manager" && user.permissions.includes(permission);
}
export const useCan = () => {
  const user = useAuth((s) => s.user);
  return (p: Permission) => can(user, p);
};

export const isStaff = (u: User | null) =>
  u?.role === "admin" || u?.role === "manager";

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}
interface UiState {
  lang: Lang;
  sidebarOpen: boolean;
  toasts: Toast[];
  setLang: (l: Lang) => void;
  setSidebar: (o: boolean) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismiss: (id: number) => void;
}
let toastId = 0;
export const useUi = create<UiState>((set, get) => ({
  lang: (localStorage.getItem("lang") as Lang) === "ar" ? "ar" : "en",
  sidebarOpen: false,
  toasts: [],
  setLang: (lang) => {
    localStorage.setItem("lang", lang);
    set({ lang });
  },
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  toast: (kind, text) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), kind === "error" ? 7000 : 4000);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
