import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import en from "./src/i18n/en.mjs";
import fr from "./src/i18n/fr.mjs";
import ar from "./src/i18n/ar.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

// ---- Company configuration (edit here) -------------------------------------------------------
const SITE = (process.env.SITE_URL || "https://flexostardz.com").replace(
  /\/$/,
  "",
);
const C = {
  phone: "+213550093270",
  phoneDisplay: "+213 550 09 32 70",
  whatsapp: "213550093270",
  email: "contact@flexostardz.com",
  map: "https://maps.app.goo.gl/Hp1i7QN3eBERPA6y8",
  // Client portal where customers create orders (same platform as the CRM dashboard).
  orderUrl: process.env.ORDER_URL || "https://flexostargroup-order.com",
  ogImage: "/assets/banner1.jpg",
  slides: ["banner1.jpg", "banner2.jpg", "banner3.jpg", "banner4.jpg"],
};
// -----------------------------------------------------------------------------------------------

const LANGS = { en, fr, ar };
const PREFIX = { en: "", fr: "/fr", ar: "/ar" };
const PAGES = { home: "/", services: "/services/", contact: "/contact/" };
const url = (lang, page) =>
  `${PREFIX[lang]}${PAGES[page]}`.replace(/\/\//g, "/") || "/";
const abs = (p) => `${SITE}${p}`;
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const I = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plates:
    '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".5"/>',
  packaging:
    '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  design:
    '<path d="m12 19 7-7 3 3-7 7-3-3Z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5Z"/><path d="m2 2 7.6 7.6"/><circle cx="11" cy="11" r="2"/>',
  equipment:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  phone:
    '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 18v-6m-3 3 3-3 3 3"/>',
  jobs: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  truck:
    '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2Z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
};
const svg = (n, cls = "") =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${I[n]}</svg>`;
const WA =
  '<svg class="ic" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false"><path d="M16.04 3C9.4 3 4 8.4 4 15.03c0 2.12.55 4.18 1.6 6L4 29l8.2-1.56a12 12 0 0 0 5.84 1.5h.01C24.7 28.94 30 23.6 30 16.97 30 10.4 24.7 3 16.04 3Zm0 21.9a10 10 0 0 1-5.1-1.4l-.37-.22-4.87.93.95-4.74-.24-.38a9.9 9.9 0 0 1-1.52-5.26c0-5.5 4.5-9.97 10.04-9.97 5.54 0 10 4.47 10 9.97 0 5.5-4.46 9.07-8.9 11.07Zm5.5-7.47c-.3-.15-1.8-.89-2.08-.99-.28-.1-.48-.15-.68.15-.2.3-.78.99-.96 1.19-.18.2-.35.22-.65.07-.3-.15-1.28-.47-2.44-1.5-.9-.8-1.5-1.8-1.69-2.1-.18-.3-.02-.46.13-.6.14-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.68-1.64-.93-2.25-.25-.59-.5-.5-.68-.51h-.58c-.2 0-.53.08-.8.38-.28.3-1.05 1.03-1.05 2.5 0 1.48 1.08 2.9 1.23 3.1.15.2 2.1 3.2 5.08 4.5.7.3 1.26.48 1.7.62.72.23 1.37.2 1.88.12.58-.09 1.8-.74 2.05-1.45.25-.7.25-1.3.18-1.43-.08-.13-.28-.2-.58-.35Z"/></svg>';

const waLink = (text) =>
  `https://wa.me/${C.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

function head(lang, page, t, extraLd = []) {
  const m = t.meta[page];
  const canon = abs(url(lang, page));
  const alts = Object.keys(LANGS)
    .map(
      (l) =>
        `<link rel="alternate" hreflang="${l}" href="${abs(url(l, page))}">`,
    )
    .join("\n  ");
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": ["LocalBusiness", "Organization"],
      "@id": `${SITE}/#organization`,
      name: "FlexoStar Group Algérie",
      alternateName: ["FlexoStar Group", "Flexostar DZ", "فليكسوستار غروب"],
      url: SITE,
      logo: abs("/logo.png"),
      image: abs(C.ogImage),
      telephone: C.phone,
      email: C.email,
      slogan: LANGS.en.slogan,
      hasMap: C.map,
      areaServed: { "@type": "Country", name: "Algeria" },
      address: { "@type": "PostalAddress", addressCountry: "DZ" },
      description: LANGS.en.meta.home.desc,
      knowsLanguage: ["en", "fr", "ar"],
      contactPoint: [
        {
          "@type": "ContactPoint",
          telephone: C.phone,
          email: C.email,
          contactType: "sales",
          availableLanguage: ["English", "French", "Arabic"],
          areaServed: "DZ",
        },
      ],
      makesOffer: LANGS.en.overview.items.map((s) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: s.title,
          description: s.text,
          provider: { "@id": `${SITE}/#organization` },
        },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      url: SITE,
      name: "FlexoStar Group Algérie",
      inLanguage: ["en", "fr", "ar"],
      publisher: { "@id": `${SITE}/#organization` },
    },
    ...extraLd,
  ];
  return `<!doctype html>
<html lang="${lang}" dir="${t.dir}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(m.title)}</title>
  <meta name="description" content="${esc(m.desc)}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="theme-color" content="#0b3d91">
  <meta name="author" content="FlexoStar Group Algérie">
  <meta name="geo.region" content="DZ">
  <link rel="canonical" href="${canon}">
  ${alts}
  <link rel="alternate" hreflang="x-default" href="${abs(url("en", page))}">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/logo.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="FlexoStar Group Algérie">
  <meta property="og:title" content="${esc(m.title)}">
  <meta property="og:description" content="${esc(m.desc)}">
  <meta property="og:url" content="${canon}">
  <meta property="og:image" content="${abs(C.ogImage)}">
  <meta property="og:locale" content="${t.locale}">
  ${Object.keys(LANGS)
    .filter((l) => l !== lang)
    .map(
      (l) =>
        `<meta property="og:locale:alternate" content="${LANGS[l].locale}">`,
    )
    .join("\n  ")}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(m.title)}">
  <meta name="twitter:description" content="${esc(m.desc)}">
  <meta name="twitter:image" content="${abs(C.ogImage)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Poppins:wght@400;500;600;700;800&display=swap">
  <link rel="stylesheet" href="/css/style.css">
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>`;
}

function header(lang, page, t) {
  const link = (p, label) =>
    `<a href="${url(lang, p)}"${page === p ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
  const langs = Object.keys(LANGS)
    .map(
      (l) =>
        `<a href="${url(l, page)}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ""}>${LANGS[l].short}</a>`,
    )
    .join("");
  return `<body>
<a class="skip" href="#main">${esc(t.nav.skip)}</a>
<header class="site-header" id="top">
  <div class="container bar">
    <a class="brand" href="${url(lang, "home")}" aria-label="${esc(t.brand)}">
      <img src="/logo.png" alt="${esc(t.brand)}" width="44" height="44" onerror="this.style.display='none'"><span>${esc(t.brand)}</span>
    </a>
    <nav class="nav" id="nav" aria-label="${esc(t.nav.menu)}">
      ${link("home", t.nav.home)}${link("services", t.nav.services)}${link("contact", t.nav.contact)}
      <a class="nav-order" href="${C.orderUrl}" target="_blank" rel="noopener">${esc(t.nav.order)}</a>
    </nav>
    <div class="actions">
      <div class="langs" role="group" aria-label="${esc(t.nav.language)}">${svg("globe")}${langs}</div>
      <a class="btn btn-gold btn-sm hide-sm" href="${url(lang, "contact")}">${esc(t.nav.quote)}</a>
      <button class="burger" id="burger" aria-label="${esc(t.nav.menu)}" aria-expanded="false" aria-controls="nav"><span></span><span></span><span></span></button>
    </div>
  </div>
</header>
<main id="main">`;
}

function footer(lang, t) {
  return `</main>
<footer class="site-footer">
  <div class="container fgrid">
    <div>
      <a class="brand light" href="${url(lang, "home")}"><img src="/logo.png" alt="" width="44" height="44" onerror="this.style.display='none'"><span>${esc(t.brand)}</span></a>
      <p class="fabout">${esc(t.footer.about)}</p>
      <p class="slogan-f">${esc(t.slogan)}</p>
    </div>
    <div>
      <h2>${esc(t.footer.explore)}</h2>
      <ul>
        <li><a href="${url(lang, "home")}">${esc(t.nav.home)}</a></li>
        <li><a href="${url(lang, "services")}">${esc(t.nav.services)}</a></li>
        <li><a href="${url(lang, "contact")}">${esc(t.nav.contact)}</a></li>
        <li><a href="${C.orderUrl}" target="_blank" rel="noopener">${esc(t.nav.order)}</a></li>
      </ul>
    </div>
    <div>
      <h2>${esc(t.footer.contact)}</h2>
      <ul class="fcontact">
        <li>${svg("phone")}<a href="tel:${C.phone}" dir="ltr">${C.phoneDisplay}</a></li>
        <li>${WA}<a href="${waLink()}" target="_blank" rel="noopener" dir="ltr">${C.phoneDisplay}</a></li>
        <li>${svg("mail")}<a href="mailto:${C.email}">${C.email}</a></li>
        <li>${svg("pin")}<a href="${C.map}" target="_blank" rel="noopener">${esc(t.contact.openMap)}</a></li>
      </ul>
    </div>
  </div>
  <div class="container fbottom"><span>© ${new Date().getFullYear()} ${esc(t.footer.legal)}. ${esc(t.footer.rights)}</span></div>
</footer>
<a class="wa-float" href="${waLink()}" target="_blank" rel="noopener" aria-label="${esc(t.common.whatsappLabel)}" title="${esc(t.common.whatsappLabel)}">${WA}</a>
<button class="to-top" id="toTop" aria-label="${esc(t.common.backTop)}">${svg("up")}</button>
<script src="/js/main.js" defer></script>
</body>
</html>`;
}

const reveal = "data-reveal";
const eyebrow = (s) => `<span class="eyebrow">${esc(s)}</span>`;
const sectionHead = (e, title, sub) =>
  `<div class="sec-head" ${reveal}>${eyebrow(e)}<h2 class="gold-text">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`;

function home(lang, t) {
  const slides = C.slides
    .map(
      (f, i) =>
        `<div class="slide${i === 0 ? " active" : ""} s${i % 4}" data-label="${esc(t.hero.slides[i] ?? "")}"><img src="/assets/${f}" alt="${esc(t.hero.slides[i] ?? t.brand)}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} width="1920" height="1080"></div>`,
    )
    .join("");
  const dots = C.slides
    .map(
      (_, i) =>
        `<button class="dot${i === 0 ? " active" : ""}" aria-label="${esc(t.hero.goto)} ${i + 1}" data-i="${i}"></button>`,
    )
    .join("");
  return `
<section class="hero" aria-roledescription="carousel" aria-label="${esc(t.brand)}">
  <div class="slides" id="slides">${slides}</div>
  <div class="hero-overlay"></div>
  <div class="container hero-in">
    <div class="glass">
      ${eyebrow(t.hero.eyebrow)}
      <h1 class="gold-text-light">${esc(t.hero.title)}</h1>
      <p class="lead">${esc(t.hero.text)}</p>
      <div class="cta-row">
        <a class="btn btn-gold" href="${url(lang, "services")}">${esc(t.hero.cta1)}${svg("arrow", "flip")}</a>
        <a class="btn btn-glass" href="${url(lang, "contact")}">${esc(t.hero.cta2)}</a>
      </div>
      <ul class="badges">${t.hero.badges.map((b) => `<li>${svg("check")}${esc(b)}</li>`).join("")}</ul>
    </div>
  </div>
  <div class="hero-ctrl container">
    <button class="arrow" id="prev" aria-label="${esc(t.hero.prev)}">${svg("arrow", "flip rev")}</button>
    <div class="dots" id="dots">${dots}</div>
    <button class="arrow" id="next" aria-label="${esc(t.hero.next)}">${svg("arrow", "flip")}</button>
    <p class="caption" id="caption" aria-live="polite">${esc(t.hero.slides[0] ?? "")}</p>
  </div>
</section>

<section class="band-blue stats" aria-label="${esc(t.about.eyebrow)}">
  <div class="container stats-grid">${t.about.stats.map((s) => `<div ${reveal}><strong class="gold-text-light">${esc(s.n)}</strong><span>${esc(s.l)}</span></div>`).join("")}</div>
</section>

<section class="section about">
  <div class="container about-grid">
    <div ${reveal}>
      ${eyebrow(t.about.eyebrow)}
      <h2 class="gold-text">${esc(t.about.title)}</h2>
      <p>${esc(t.about.p1)}</p><p>${esc(t.about.p2)}</p><p>${esc(t.about.p3)}</p>
    </div>
    <div class="about-card" ${reveal}>
      <p class="slogan">${esc(t.slogan)}</p>
      <ul>${t.why.items.map((w) => `<li>${svg("check")}<div><strong>${esc(w.t)}</strong><span>${esc(w.d)}</span></div></li>`).join("")}</ul>
    </div>
  </div>
</section>

<section class="section soft" id="what">
  <div class="container">
    ${sectionHead(t.overview.eyebrow, t.overview.title, t.overview.sub)}
    <div class="cards">${t.overview.items
      .map(
        (s) => `
      <article class="card" ${reveal}>
        <div class="card-ic">${svg(s.id)}</div>
        <h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>
        <a class="more" href="${url(lang, "services")}#${s.id}">${esc(t.overview.more)}${svg("arrow", "flip")}</a>
      </article>`,
      )
      .join("")}
    </div>
  </div>
</section>

<section class="section band-blue order">
  <div class="container">
    <div class="sec-head light" ${reveal}>${eyebrow(t.order.eyebrow)}<h2 class="gold-text-light">${esc(t.order.title)}</h2><p>${esc(t.order.sub)}</p></div>
    <ol class="steps">${t.order.steps
      .map(
        (s, i) => `
      <li ${reveal}><span class="num">${i + 1}</span><div class="step-ic">${svg(["user", "file", "jobs", "truck"][i])}</div><h3>${esc(s.t)}</h3><p>${esc(s.d)}</p></li>`,
      )
      .join("")}
    </ol>
    <div class="center" ${reveal}>
      <a class="btn btn-gold" href="${C.orderUrl}" target="_blank" rel="noopener">${esc(t.order.cta)}${svg("arrow", "flip")}</a>
      <a class="btn btn-glass" href="${url(lang, "contact")}">${esc(t.order.ask)}</a>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    ${sectionHead(t.clients.eyebrow, t.clients.title)}
    <ul class="chips" ${reveal}>${t.clients.items.map((c) => `<li>${svg("star")}${esc(c)}</li>`).join("")}</ul>
  </div>
</section>

<section class="section cta">
  <div class="container cta-box" ${reveal}>
    <div><h2 class="gold-text-light">${esc(t.cta.title)}</h2><p>${esc(t.cta.text)}</p></div>
    <div class="cta-row">
      <a class="btn btn-gold" href="${url(lang, "contact")}">${esc(t.cta.btn)}</a>
      <a class="btn btn-wa" href="${waLink(t.contact.form.prefix)}" target="_blank" rel="noopener">${WA}${esc(t.cta.wa)}</a>
    </div>
  </div>
</section>`;
}

function services(lang, t) {
  const s = t.svc;
  const sections = s.sections
    .map(
      (x, i) => `
<section class="section ${i % 2 ? "soft" : ""} svc" id="${x.id}">
  <div class="container svc-grid ${i % 2 ? "rev" : ""}">
    <div class="svc-media" ${reveal}>
      <div class="svc-badge"><span class="big gold-text-light">${x.num}</span>${svg(x.id)}</div>
      <p>${esc(x.sub)}</p>
    </div>
    <div ${reveal}>
      <h2 class="gold-text">${esc(x.title)}</h2>
      <p class="lead-d">${esc(x.intro)}</p>
      <div class="blocks">${x.blocks.map((b) => `<div class="block"><h3>${esc(b.h)}</h3><ul>${b.list.map((l) => `<li>${svg("check")}${esc(l)}</li>`).join("")}</ul></div>`).join("")}</div>
      <a class="btn btn-blue" href="${url(lang, "contact")}">${esc(t.nav.quote)}${svg("arrow", "flip")}</a>
    </div>
  </div>
</section>`,
    )
    .join("");
  return `
<section class="page-hero band-blue">
  <div class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="${url(lang, "home")}">${esc(t.nav.home)}</a><span>/</span><span aria-current="page">${esc(t.nav.services)}</span></nav>
    ${eyebrow(s.eyebrow)}<h1 class="gold-text-light">${esc(s.title)}</h1><p class="lead">${esc(s.intro)}</p>
    <ul class="jump" aria-label="${esc(s.nav)}">${s.sections.map((x) => `<li><a href="#${x.id}">${x.num} · ${esc(x.title)}</a></li>`).join("")}</ul>
  </div>
</section>
${sections}
<section class="section band-blue order">
  <div class="container">
    <div class="sec-head light" ${reveal}>${eyebrow(t.order.eyebrow)}<h2 class="gold-text-light">${esc(t.order.title)}</h2><p>${esc(t.order.sub)}</p></div>
    <ol class="steps">${t.order.steps.map((x, i) => `<li ${reveal}><span class="num">${i + 1}</span><div class="step-ic">${svg(["user", "file", "jobs", "truck"][i])}</div><h3>${esc(x.t)}</h3><p>${esc(x.d)}</p></li>`).join("")}</ol>
    <div class="center"><a class="btn btn-gold" href="${C.orderUrl}" target="_blank" rel="noopener">${esc(t.order.cta)}${svg("arrow", "flip")}</a></div>
  </div>
</section>
<section class="section">
  <div class="container narrow">
    <div class="after" ${reveal}>${svg("equipment")}<div><h2>${esc(s.extras.title)}</h2><p>${esc(s.extras.text)}</p></div></div>
    <h2 class="gold-text faq-title" ${reveal}>${esc(s.faqTitle)}</h2>
    <div class="faq">${s.faq.map((f) => `<details ${reveal}><summary>${esc(f.q)}${svg("chevron")}</summary><p>${esc(f.a)}</p></details>`).join("")}</div>
  </div>
</section>
<section class="section cta"><div class="container cta-box"><div><h2 class="gold-text-light">${esc(t.cta.title)}</h2><p>${esc(t.cta.text)}</p></div><div class="cta-row"><a class="btn btn-gold" href="${url(lang, "contact")}">${esc(t.cta.btn)}</a><a class="btn btn-wa" href="${waLink(t.contact.form.prefix)}" target="_blank" rel="noopener">${WA}${esc(t.cta.wa)}</a></div></div></section>`;
}

function contact(lang, t) {
  const c = t.contact;
  const f = c.form;
  const card = (icon, title, value, href, label, ext = false) => `
    <a class="ccard" href="${href}"${ext ? ' target="_blank" rel="noopener"' : ""} ${reveal}>
      <span class="card-ic">${icon}</span><span class="ctext"><small>${esc(title)}</small><strong dir="ltr">${value}</strong><em>${esc(label)}</em></span>
    </a>`;
  return `
<section class="page-hero band-blue">
  <div class="container">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="${url(lang, "home")}">${esc(t.nav.home)}</a><span>/</span><span aria-current="page">${esc(t.nav.contact)}</span></nav>
    ${eyebrow(c.eyebrow)}<h1 class="gold-text-light">${esc(c.title)}</h1><p class="lead">${esc(c.sub)}</p>
  </div>
</section>
<section class="section">
  <div class="container cgrid">
    <div class="cards-col">
      ${card(svg("phone"), c.phone, C.phoneDisplay, `tel:${C.phone}`, c.call)}
      ${card(WA, c.whatsapp, C.phoneDisplay, waLink(), c.chat, true)}
      ${card(svg("mail"), c.email, C.email, `mailto:${C.email}`, c.write)}
      ${card(svg("pin"), c.map, "Google Maps", C.map, c.openMap, true)}
    </div>
    <form class="form" id="contactForm" novalidate ${reveal} data-wa="${C.whatsapp}" data-mail="${C.email}" data-prefix="${esc(f.prefix)}" data-required="${esc(f.required)}">
      <h2 class="gold-text">${esc(f.title)}</h2>
      <p class="hint">${esc(f.hint)}</p>
      <div class="row2">
        <label>${esc(f.name)}<input name="name" required autocomplete="name"></label>
        <label>${esc(f.phone)}<input name="phone" type="tel" required autocomplete="tel" dir="ltr"></label>
      </div>
      <div class="row2">
        <label>${esc(f.email)}<input name="email" type="email" autocomplete="email" dir="ltr"></label>
        <label>${esc(f.service)}<select name="service">${f.services.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label>
      </div>
      <label>${esc(f.message)}<textarea name="message" rows="5" required></textarea></label>
      <div class="cta-row">
        <button class="btn btn-wa" type="submit" data-via="wa">${WA}${esc(f.byWa)}</button>
        <button class="btn btn-blue" type="submit" data-via="mail">${svg("mail")}${esc(f.byMail)}</button>
      </div>
    </form>
  </div>
</section>
<section class="section soft mapsec">
  <div class="container map-box" ${reveal}>
    <div class="map-art" aria-hidden="true">${svg("pin")}</div>
    <div><h2 class="gold-text">${esc(c.map)}</h2><p>${esc(c.mapText)}</p><a class="btn btn-blue" href="${C.map}" target="_blank" rel="noopener">${svg("pin")}${esc(c.openMap)}</a></div>
  </div>
</section>`;
}

function ldFor(lang, page, t) {
  const crumbs = (name) => ({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: t.nav.home,
        item: abs(url(lang, "home")),
      },
      { "@type": "ListItem", position: 2, name, item: abs(url(lang, page)) },
    ],
  });
  if (page === "services")
    return [
      crumbs(t.nav.services),
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: t.svc.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: t.svc.title,
        itemListElement: t.svc.sections.map((s, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "Service",
            name: s.title,
            description: s.intro,
            provider: { "@id": `${SITE}/#organization` },
            areaServed: "DZ",
            url: `${abs(url(lang, "services"))}#${s.id}`,
          },
        })),
      },
    ];
  if (page === "contact")
    return [
      crumbs(t.nav.contact),
      {
        "@context": "https://schema.org",
        "@type": "ContactPage",
        url: abs(url(lang, "contact")),
        name: t.meta.contact.title,
      },
    ];
  return [];
}

function write(path, content) {
  const full = join(dist, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const body = { home, services, contact };
for (const lang of Object.keys(LANGS)) {
  const t = LANGS[lang];
  for (const page of Object.keys(PAGES)) {
    const out = join(PREFIX[lang], PAGES[page], "index.html");
    write(
      out,
      head(lang, page, t, ldFor(lang, page, t)) +
        "\n" +
        header(lang, page, t) +
        body[page](lang, t) +
        footer(lang, t),
    );
  }
}
// 404 (English, with language links)
{
  const t = en;
  write(
    "404.html",
    head("en", "home", t).replace(
      /<meta name="robots"[^>]*>/,
      '<meta name="robots" content="noindex">',
    ) +
      header("en", "home", t) +
      `<section class="page-hero band-blue"><div class="container center"><p class="big404 gold-text-light">404</p><h1 class="gold-text-light">${t.notFound.title}</h1><p class="lead">${t.notFound.text}</p><a class="btn btn-gold" href="/">${t.notFound.btn}</a></div></section>` +
      footer("en", t),
  );
}

// static files
cpSync(join(root, "src/css"), join(dist, "css"), { recursive: true });
cpSync(join(root, "src/js"), join(dist, "js"), { recursive: true });
if (existsSync(join(root, "assets")))
  cpSync(join(root, "assets"), join(dist, "assets"), { recursive: true });
if (existsSync(join(root, "public")))
  cpSync(join(root, "public"), join(dist, ""), { recursive: true });

// sitemap + robots
const today = new Date().toISOString().slice(0, 10);
const urls = [];
for (const page of Object.keys(PAGES))
  for (const lang of Object.keys(LANGS)) {
    const alt = [
      ...Object.keys(LANGS).map(
        (l) =>
          `<xhtml:link rel="alternate" hreflang="${l}" href="${abs(url(l, page))}"/>`,
      ),
      `<xhtml:link rel="alternate" hreflang="x-default" href="${abs(url("en", page))}"/>`,
    ].join("");
    urls.push(
      `<url><loc>${abs(url(lang, page))}</loc><lastmod>${today}</lastmod><changefreq>${page === "home" ? "weekly" : "monthly"}</changefreq><priority>${page === "home" ? (lang === "en" ? "1.0" : "0.9") : "0.8"}</priority>${alt}</url>`,
    );
  }
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`,
);
write(
  "robots.txt",
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
);
console.log(
  `Website built in ${dist} (${Object.keys(LANGS).length * Object.keys(PAGES).length} pages) for ${SITE}`,
);
