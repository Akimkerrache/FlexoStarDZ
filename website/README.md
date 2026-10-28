# FlexoStar Group – public website (flexostardz.com)

Static, dependency-free, multilingual site (English `/`, French `/fr/`, Arabic `/ar/`, RTL) with per-language HTML for SEO.

## Commands
```bash
cd website
npm run build     # generates ./dist (9 pages, 404, sitemap.xml, robots.txt)
npm run dev       # build + preview on http://localhost:4000
SITE_URL=https://flexostardz.com npm run build   # production URLs in canonical/hreflang/sitemap
```
Deploy the `dist/` folder to any static host (Cloudflare Pages, Netlify, Nginx, cPanel). Serve `404.html` for unknown routes.

## Files you provide
- `public/logo.png` and `public/favicon.ico` (copied to the site root).
- `assets/banner1.jpg`, `banner2.jpg`, `banner3.jpg` (+ `banner4.jpg` optional): hero slider. `banner1.jpg` is also the social share image. Missing images fall back to a branded gradient.

## Where to edit
- Texts (EN/FR/AR): `src/i18n/*.mjs`. Contact data, map link, order-portal URL, slider files: top of `build.mjs` (`C`).
- Design: `src/css/style.css` (brand blue `--blue`, gold gradients `--gold-*`). Confirm the exact blue against the brochure and adjust `--blue`/`--blue-d`.
- Order portal button points to `https://flexostargroup-order.com` (override with `ORDER_URL`).

## SEO included
Unique title/description per page and language, canonical + `hreflang` (en/fr/ar/x-default), Open Graph/Twitter, JSON-LD (LocalBusiness/Organization, WebSite, BreadcrumbList, FAQPage, Service list, ContactPage), sitemap with alternates, robots.txt, semantic landmarks, alt text, lazy images, fast static HTML.
After launch: add the site to Google Search Console / Bing Webmaster, submit `sitemap.xml`, and add the postal address to the JSON-LD (`build.mjs`) once confirmed.

## Notes
- Contact form has no backend: it opens a prefilled WhatsApp or email message.
- The WhatsApp button (bottom-right) opens `https://wa.me/213550093270`.
- Department phones/email from the old brochure (`pao.flexostargroup@gmail.com`, etc.) were intentionally not published; add them in `build.mjs` if still valid.
