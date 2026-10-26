import { Link } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function UnauthorizedPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <ShieldX className="size-12 text-red-400" aria-hidden />
      <h1 className="text-xl font-semibold">{t("errors.accessDenied")}</h1>
      <p className="text-sm text-slate-500">{t("errors.accessDeniedHint")}</p>
      <Link to="/" className="text-teal-700 underline">
        {t("errors.backHome")}
      </Link>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <h1 className="text-xl font-semibold">{t("errors.notFound")}</h1>
      <Link to="/" className="text-teal-700 underline">
        {t("errors.backHome")}
      </Link>
    </div>
  );
}
