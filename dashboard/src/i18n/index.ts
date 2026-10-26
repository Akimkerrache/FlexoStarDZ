import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { ar } from "./ar";

const saved = localStorage.getItem("lang") === "ar" ? "ar" : "en";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: saved,
  fallbackLng: "en", // English is the primary language
  interpolation: { escapeValue: false },
});

export function applyLanguage(lang: "en" | "ar") {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}
applyLanguage(saved);

export default i18n;
