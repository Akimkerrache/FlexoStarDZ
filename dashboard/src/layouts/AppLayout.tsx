import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  CreditCard,
  FileText,
  Files,
  Globe,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Palette,
  Printer as PrinterIcon,
  Receipt,
  Settings as SettingsIcon,
  ShieldCheck,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wrench,
  Factory,
  FilePlus2,
  Cog,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { applyLanguage } from "@/i18n";
import { auth as authApi, notifications } from "@/services/api";
import { can, isStaff, useAuth, useUi } from "@/stores";
import type { Permission, User } from "@/types";
import { Toasts } from "@/components/Toasts";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  show: (u: User) => boolean;
  end?: boolean;
}
const ic = "size-4 shrink-0";
const any = (u: User, ...p: Permission[]) => p.some((x) => can(u, x));

const NAV: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      {
        to: "/",
        label: "nav.dashboard",
        icon: <LayoutDashboard className={ic} />,
        show: () => true,
        end: true,
      },
      {
        to: "/orders/new",
        label: "nav.newOrder",
        icon: <FilePlus2 className={ic} />,
        show: (u) => u.role === "client" || can(u, "orders.create"),
      },
      {
        to: "/orders",
        label: "nav.orders",
        icon: <ClipboardList className={ic} />,
        show: (u) => u.role !== "manager" || can(u, "orders.view"),
        end: true,
      },
      {
        to: "/quotations",
        label: "nav.quotations",
        icon: <FileText className={ic} />,
        show: (u) => u.role === "client" || can(u, "quotations.manage"),
      },
      {
        to: "/plates",
        label: "nav.plates",
        icon: <Layers className={ic} />,
        show: (u) => u.role === "client" || can(u, "plates.manage"),
      },
      {
        to: "/production",
        label: "nav.production",
        icon: <Factory className={ic} />,
        show: (u) => u.role === "printer" || can(u, "production.manage"),
      },
      {
        to: "/deliveries",
        label: "nav.deliveries",
        icon: <Truck className={ic} />,
        show: (u) => u.role === "client" || can(u, "deliveries.manage"),
      },
      {
        to: "/files",
        label: "nav.files",
        icon: <Files className={ic} />,
        show: (u) =>
          u.role !== "manager" ||
          any(
            u,
            "orders.view",
            "plates.manage",
            "finance.view",
            "deliveries.manage",
          ),
      },
    ],
  },
  {
    title: "nav.finance",
    items: [
      {
        to: "/invoices",
        label: "nav.invoices",
        icon: <Receipt className={ic} />,
        show: (u) =>
          u.role === "client" || any(u, "finance.view", "finance.manage"),
      },
      {
        to: "/payments",
        label: "nav.payments",
        icon: <CreditCard className={ic} />,
        show: (u) =>
          u.role === "client" || any(u, "finance.view", "finance.manage"),
      },
      {
        to: "/expenses",
        label: "nav.expenses",
        icon: <Wallet className={ic} />,
        show: (u) => any(u, "finance.view", "finance.manage"),
      },
      {
        to: "/reports",
        label: "nav.reports",
        icon: <BarChart3 className={ic} />,
        show: (u) => isStaff(u) && any(u, "reports.view", "finance.view"),
      },
    ],
  },
  {
    title: "nav.masterData",
    items: [
      {
        to: "/clients",
        label: "nav.clients",
        icon: <Users className={ic} />,
        show: (u) => isStaff(u) && can(u, "clients.view"),
      },
      {
        to: "/printers",
        label: "nav.printers",
        icon: <PrinterIcon className={ic} />,
        show: (u) => isStaff(u) && can(u, "printers.view"),
      },
      {
        to: "/managers",
        label: "nav.managers",
        icon: <UserCog className={ic} />,
        show: (u) => u.role === "admin",
      },
      {
        to: "/suppliers",
        label: "nav.suppliers",
        icon: <Building2 className={ic} />,
        show: (u) => isStaff(u) && any(u, "suppliers.view", "suppliers.manage"),
      },
      {
        to: "/catalog/categories",
        label: "nav.categories",
        icon: <Boxes className={ic} />,
        show: (u) => isStaff(u),
      },
      {
        to: "/catalog/items",
        label: "nav.catalog",
        icon: <Package className={ic} />,
        show: (u) => isStaff(u),
      },
      {
        to: "/machines",
        label: "nav.machines",
        icon: <Wrench className={ic} />,
        show: (u) => isStaff(u),
      },
      {
        to: "/technical-options",
        label: "nav.technicalOptions",
        icon: <Cog className={ic} />,
        show: (u) => isStaff(u),
      },
      {
        to: "/pantone",
        label: "nav.pantone",
        icon: <Palette className={ic} />,
        show: (u) => isStaff(u),
      },
    ],
  },
  {
    title: "nav.administration",
    items: [
      {
        to: "/audit-logs",
        label: "nav.auditLogs",
        icon: <History className={ic} />,
        show: (u) => u.role === "admin",
      },
      {
        to: "/settings",
        label: "nav.settings",
        icon: <SettingsIcon className={ic} />,
        show: (u) => u.role === "admin",
      },
    ],
  },
];

function Sidebar({ user, onNavigate }: { user: User; onNavigate: () => void }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("nav.main")}
      className="flex-1 space-y-4 overflow-y-auto px-3 py-4"
    >
      {NAV.map((g, i) => {
        const items = g.items.filter((n) => n.show(user));
        if (!items.length) return null;
        return (
          <div key={i}>
            {g.title && (
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-teal-200/70">
                {t(g.title)}
              </p>
            )}
            <ul className="space-y-0.5">
              {items.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                        isActive
                          ? "bg-white/15 text-white"
                          : "text-teal-50/80 hover:bg-white/10 hover:text-white",
                      )
                    }
                  >
                    {n.icon}
                    <span>{t(n.label)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const user = useAuth((s) => s.user)!;
  const { logout, setUser } = useAuth();
  const { lang, setLang, sidebarOpen, setSidebar } = useUi();
  const [menu, setMenu] = useState(false);

  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => notifications.list({ limit: 1, unread: "true" }),
    refetchInterval: 60_000,
  });

  useEffect(() => applyLanguage(lang), [lang]);
  // Use the language saved on the account the first time we see this user.
  useEffect(() => {
    if (
      user.language &&
      user.language !== lang &&
      !localStorage.getItem("lang")
    )
      setLang(user.language);
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchLang = () => {
    const next = lang === "en" ? "ar" : "en";
    setLang(next);
    authApi
      .updateMe({ language: next })
      .then(setUser)
      .catch(() => undefined);
  };

  const side = (
    <div className="flex h-full flex-col bg-teal-900 text-white">
      <div className="flex h-14 items-center justify-between px-5">
        <span className="text-lg font-bold tracking-tight">
          {import.meta.env.VITE_APP_NAME ?? "Flexostar CRM"}
        </span>
        <button
          className="rounded p-1 hover:bg-white/10 lg:hidden"
          onClick={() => setSidebar(false)}
          aria-label={t("common.close")}
        >
          <X className="size-5" />
        </button>
      </div>
      <Sidebar user={user} onNavigate={() => setSidebar(false)} />
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2"
      >
        {t("common.skipToContent")}
      </a>
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="fixed inset-y-0 w-64">{side}</div>
      </aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setSidebar(false)}
          />
          <div className="absolute inset-y-0 start-0 w-64 shadow-xl">
            {side}
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
          <button
            className="rounded p-2 hover:bg-slate-100 lg:hidden"
            onClick={() => setSidebar(true)}
            aria-label={t("nav.openMenu")}
          >
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <button
              onClick={switchLang}
              className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              aria-label={t("common.language")}
            >
              <Globe className="size-4" />{" "}
              {lang === "en" ? "العربية" : "English"}
            </button>
            <NavLink
              to="/notifications"
              className="relative rounded-md p-2 text-slate-700 hover:bg-slate-100"
              aria-label={t("nav.notifications")}
            >
              <Bell className="size-5" />
              {!!unread.data?.meta.unread && (
                <span className="absolute end-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {unread.data.meta.unread}
                </span>
              )}
            </NavLink>
            <div className="relative">
              <button
                onClick={() => setMenu((m) => !m)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100"
                aria-haspopup="menu"
                aria-expanded={menu}
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden text-start sm:block">
                  <span className="block font-medium leading-tight">
                    {user.name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {t(`roles.${user.role}`)}
                  </span>
                </span>
              </button>
              {menu && (
                <div
                  role="menu"
                  className="absolute end-0 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                  onClick={() => setMenu(false)}
                >
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"
                    onClick={() => nav("/profile")}
                  >
                    <ShieldCheck className="size-4" /> {t("nav.profile")}
                  </button>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-slate-50"
                    onClick={() => logout().then(() => nav("/login"))}
                  >
                    <LogOut className="size-4" /> {t("nav.logout")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
      <Toasts />
    </div>
  );
}
