import { Suspense, lazy, useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loading } from "@/components/ui";
import { AppLayout } from "@/layouts/AppLayout";
import { ApiError } from "@/services/http";
import { can, isStaff, useAuth } from "@/stores";
import type { Permission, Role, User } from "@/types";
import LoginPage from "@/pages/Login";
import { NotFoundPage, UnauthorizedPage } from "@/pages/Errors";
import {
  OrderDetailsPage,
  OrdersPage,
  EditOrderPage,
  NewOrderPage,
} from "@/pages/Orders";
import { DashboardPage, ReportsPage as Reports } from "@/pages/Dashboard";

const M = (name: string) =>
  lazy(() =>
    import("@/pages/MasterData").then((m) => ({ default: (m as any)[name] })),
  );
const Clients = M("ClientsPage"),
  Printers = M("PrintersPage"),
  Suppliers = M("SuppliersPage"),
  Categories = M("CategoriesPage"),
  Items = M("ItemsPage"),
  Machines = M("MachinesPage"),
  Options = M("OptionsPage"),
  Pantone = M("PantonePage"),
  Expenses = M("ExpensesPage"),
  Managers = M("ManagersPage");
const C = (name: string) =>
  lazy(() =>
    import("@/pages/Commercial").then((m) => ({ default: (m as any)[name] })),
  );
const Quotations = C("QuotationsPage"),
  Invoices = C("InvoicesPage"),
  Payments = C("PaymentsPage");
const O = (name: string) =>
  lazy(() =>
    import("@/pages/Operations").then((m) => ({ default: (m as any)[name] })),
  );
const Plates = O("PlatesPage"),
  Production = O("ProductionPage"),
  Deliveries = O("DeliveriesPage");
const S = (name: string) =>
  lazy(() =>
    import("@/pages/System").then((m) => ({ default: (m as any)[name] })),
  );
const Files = S("FilesPage"),
  Notifications = S("NotificationsPage"),
  AuditLogs = S("AuditLogsPage"),
  Settings = S("SettingsPage"),
  Profile = S("ProfilePage");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

function Protected() {
  const { status, user } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <Loading />;
  if (!user)
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <AppLayout />;
}

/** UI guard only (hides pages). Every API call is authorised again on the server. */
function Guard({
  allow,
  children,
}: {
  allow: (u: User) => boolean;
  children: JSX.Element;
}) {
  const user = useAuth((s) => s.user)!;
  return allow(user) ? (
    <Suspense fallback={<Loading />}>{children}</Suspense>
  ) : (
    <Navigate to="/unauthorized" replace />
  );
}

const roles =
  (...r: Role[]) =>
  (u: User) =>
    r.includes(u.role);
const perm =
  (...p: Permission[]) =>
  (u: User) =>
    p.some((x) => can(u, x));
const staffPerm =
  (...p: Permission[]) =>
  (u: User) =>
    isStaff(u) && perm(...p)(u);
const staffOnly = (u: User) => isStaff(u);
const clientOr =
  (...p: Permission[]) =>
  (u: User) =>
    u.role === "client" || perm(...p)(u);

export default function App() {
  const init = useAuth((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Protected />}>
            <Route index element={<DashboardPage />} />
            <Route
              path="orders"
              element={
                <Guard
                  allow={(u) => u.role !== "manager" || can(u, "orders.view")}
                >
                  <OrdersPage />
                </Guard>
              }
            />
            <Route
              path="orders/new"
              element={
                <Guard allow={clientOr("orders.create")}>
                  <NewOrderPage />
                </Guard>
              }
            />
            <Route
              path="orders/:id"
              element={
                <Guard
                  allow={(u) => u.role !== "manager" || can(u, "orders.view")}
                >
                  <OrderDetailsPage />
                </Guard>
              }
            />
            <Route
              path="orders/:id/edit"
              element={
                <Guard
                  allow={(u) => u.role === "client" || can(u, "orders.edit")}
                >
                  <EditOrderPage />
                </Guard>
              }
            />
            <Route
              path="quotations"
              element={
                <Guard allow={clientOr("quotations.manage")}>
                  <Quotations />
                </Guard>
              }
            />
            <Route
              path="plates"
              element={
                <Guard allow={clientOr("plates.manage")}>
                  <Plates />
                </Guard>
              }
            />
            <Route
              path="production"
              element={
                <Guard
                  allow={(u) =>
                    u.role === "printer" || can(u, "production.manage")
                  }
                >
                  <Production />
                </Guard>
              }
            />
            <Route
              path="deliveries"
              element={
                <Guard allow={clientOr("deliveries.manage")}>
                  <Deliveries />
                </Guard>
              }
            />
            <Route
              path="files"
              element={
                <Guard
                  allow={(u) =>
                    u.role !== "manager" ||
                    perm(
                      "orders.view",
                      "plates.manage",
                      "finance.view",
                      "deliveries.manage",
                    )(u)
                  }
                >
                  <Files />
                </Guard>
              }
            />
            <Route
              path="invoices"
              element={
                <Guard allow={clientOr("finance.view", "finance.manage")}>
                  <Invoices />
                </Guard>
              }
            />
            <Route
              path="payments"
              element={
                <Guard allow={clientOr("finance.view", "finance.manage")}>
                  <Payments />
                </Guard>
              }
            />
            <Route
              path="expenses"
              element={
                <Guard allow={staffPerm("finance.view", "finance.manage")}>
                  <Expenses />
                </Guard>
              }
            />
            <Route
              path="reports"
              element={
                <Guard allow={staffPerm("reports.view", "finance.view")}>
                  <Reports />
                </Guard>
              }
            />
            <Route
              path="clients"
              element={
                <Guard allow={staffPerm("clients.view")}>
                  <Clients />
                </Guard>
              }
            />
            <Route
              path="printers"
              element={
                <Guard allow={staffPerm("printers.view")}>
                  <Printers />
                </Guard>
              }
            />
            <Route
              path="managers"
              element={
                <Guard allow={roles("admin")}>
                  <Managers />
                </Guard>
              }
            />
            <Route
              path="suppliers"
              element={
                <Guard allow={staffPerm("suppliers.view", "suppliers.manage")}>
                  <Suppliers />
                </Guard>
              }
            />
            <Route
              path="catalog/categories"
              element={
                <Guard allow={staffOnly}>
                  <Categories />
                </Guard>
              }
            />
            <Route
              path="catalog/items"
              element={
                <Guard allow={staffOnly}>
                  <Items />
                </Guard>
              }
            />
            <Route
              path="machines"
              element={
                <Guard allow={staffOnly}>
                  <Machines />
                </Guard>
              }
            />
            <Route
              path="technical-options"
              element={
                <Guard allow={staffOnly}>
                  <Options />
                </Guard>
              }
            />
            <Route
              path="pantone"
              element={
                <Guard allow={staffOnly}>
                  <Pantone />
                </Guard>
              }
            />
            <Route
              path="notifications"
              element={
                <Suspense fallback={<Loading />}>
                  <Notifications />
                </Suspense>
              }
            />
            <Route
              path="profile"
              element={
                <Suspense fallback={<Loading />}>
                  <Profile />
                </Suspense>
              }
            />
            <Route
              path="audit-logs"
              element={
                <Guard allow={roles("admin")}>
                  <AuditLogs />
                </Guard>
              }
            />
            <Route
              path="settings"
              element={
                <Guard allow={roles("admin")}>
                  <Settings />
                </Guard>
              }
            />
            <Route path="unauthorized" element={<UnauthorizedPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
