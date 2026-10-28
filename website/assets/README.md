# Assets

Put the hero slider images here (landscape, ideally 1920x1080, under ~400 KB each, optimised JPG/WebP):

- `banner1.jpg` (also used as the social-sharing image)
- `banner2.jpg`
- `banner3.jpg`
- `banner4.jpg` (optional)

Also place `logo.png` here for your own reference/design files. The website itself reads `logo.png` and `favicon.ico`
from the `public/` folder (served at `/logo.png` and `/favicon.ico`).

Missing images do not break the site: each slide falls back to a branded blue/gold gradient.
To add more slides, add file names to `C.slides` in `build.mjs` and a matching label in each `src/i18n/*.mjs` (`hero.slides`).
