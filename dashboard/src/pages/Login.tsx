import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, errorText, Field, Input } from "@/components/ui";
import { applyLanguage } from "@/i18n";
import { useAuth, useUi } from "@/stores";
import { Toasts } from "@/components/Toasts";

export default function LoginPage() {
  const { t } = useTranslation();
  const { login, user } = useAuth();
  const { lang, setLang } = useUi();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [error, setError] = useState<string>();
  const schema = z.object({
    email: z
      .string()
      .trim()
      .min(1, t("validation.required"))
      .email(t("validation.email")),
    password: z.string().min(1, t("validation.required")),
  });
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to="/" replace />;

  const toggle = () => {
    const next = lang === "en" ? "ar" : "en";
    setLang(next);
    applyLanguage(next);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-teal-900 to-slate-900 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-7 shadow-2xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-teal-800">
              {import.meta.env.VITE_APP_NAME ?? "Flexostar CRM"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">{t("login.subtitle")}</p>
          </div>
          <button
            onClick={toggle}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
            aria-label={t("common.language")}
          >
            <Globe className="size-4" /> {lang === "en" ? "العربية" : "English"}
          </button>
        </div>
        <form
          noValidate
          className="space-y-4"
          onSubmit={f.handleSubmit(async (v) => {
            setError(undefined);
            try {
              await login(v.email, v.password);
              nav(loc.state?.from ?? "/", { replace: true });
            } catch (e) {
              setError(errorText(e, t));
            }
          })}
        >
          <Field
            label={t("login.email")}
            htmlFor="email"
            error={f.formState.errors.email?.message}
          >
            <Input
              id="email"
              type="email"
              autoComplete="username"
              className="ltr-text"
              aria-invalid={!!f.formState.errors.email}
              {...f.register("email")}
            />
          </Field>
          <Field
            label={t("login.password")}
            htmlFor="password"
            error={f.formState.errors.password?.message}
          >
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!f.formState.errors.password}
              {...f.register("password")}
            />
          </Field>
          {error && (
            <p
              role="alert"
              className="rounded-md bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            loading={f.formState.isSubmitting}
          >
            {t("login.submit")}
          </Button>
        </form>
        <p className="mt-5 text-center text-xs text-slate-400">
          {t("login.noRegistration")}
        </p>
      </div>
      <Toasts />
    </div>
  );
}
