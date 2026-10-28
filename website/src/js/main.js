(() => {
  const doc = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Header state, back-to-top
  const header = $(".site-header");
  const toTop = $("#toTop");
  const onScroll = () => {
    header.classList.toggle("scrolled", window.scrollY > 30);
    toTop.classList.toggle("show", window.scrollY > 600);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  toTop.addEventListener("click", () =>
    window.scrollTo({ top: 0, behavior: "smooth" }),
  );

  // Mobile menu
  const burger = $("#burger");
  const nav = $("#nav");
  burger.addEventListener("click", () => {
    const open = burger.getAttribute("aria-expanded") !== "true";
    burger.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("open", open);
  });
  $$("#nav a").forEach((a) =>
    a.addEventListener("click", () => {
      burger.setAttribute("aria-expanded", "false");
      nav.classList.remove("open");
    }),
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      burger.setAttribute("aria-expanded", "false");
      nav.classList.remove("open");
    }
  });

  // Reveal on scroll
  const items = $$("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12 },
    );
    items.forEach((el, i) => {
      el.style.transitionDelay = `${(i % 4) * 80}ms`;
      io.observe(el);
    });
  } else items.forEach((el) => el.classList.add("in"));

  // Hero slider: images that are not uploaded yet fall back to the CSS gradient of each slide
  const slidesEl = $("#slides");
  if (slidesEl) {
    const slides = $$(".slide", slidesEl);
    slides.forEach((s) => {
      const img = $("img", s);
      const drop = () => img.remove();
      img.addEventListener("error", drop);
      if (img.complete && img.naturalWidth === 0) drop();
    });
    const dots = $$(".dot");
    const caption = $("#caption");
    let i = 0;
    let timer;
    const show = (n) => {
      i = (n + slides.length) % slides.length;
      slides.forEach((s, k) => s.classList.toggle("active", k === i));
      dots.forEach((d, k) => d.classList.toggle("active", k === i));
      if (caption) caption.textContent = slides[i].dataset.label || "";
    };
    const play = () => {
      clearInterval(timer);
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
        timer = setInterval(() => show(i + 1), 6500);
    };
    $("#next").addEventListener("click", () => {
      show(i + 1);
      play();
    });
    $("#prev").addEventListener("click", () => {
      show(i - 1);
      play();
    });
    dots.forEach((d) =>
      d.addEventListener("click", () => {
        show(Number(d.dataset.i));
        play();
      }),
    );
    document.addEventListener("visibilitychange", () =>
      document.hidden ? clearInterval(timer) : play(),
    );
    let x0 = null;
    slidesEl.parentElement.addEventListener(
      "touchstart",
      (e) => {
        x0 = e.touches[0].clientX;
      },
      { passive: true },
    );
    slidesEl.parentElement.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) {
        show(i + (dx < 0 ? 1 : -1));
        play();
      }
      x0 = null;
    });
    play();
  }

  // Contact form: no backend needed, the message is prepared for WhatsApp or email
  const form = $("#contactForm");
  if (form) {
    let via = "wa";
    $$("button[type=submit]", form).forEach((b) =>
      b.addEventListener("click", () => {
        via = b.dataset.via;
      }),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      $$(".err", form).forEach((n) => n.remove());
      let ok = true;
      $$("[required]", form).forEach((f) => {
        const bad = !f.value.trim();
        f.classList.toggle("invalid", bad);
        if (bad) {
          ok = false;
          const m = document.createElement("span");
          m.className = "err";
          m.textContent = form.dataset.required;
          f.after(m);
        }
      });
      if (!ok) return;
      const d = Object.fromEntries(new FormData(form));
      const text = `${form.dataset.prefix}\n\n${d.service}\n${d.name} - ${d.phone}${d.email ? ` - ${d.email}` : ""}\n\n${d.message}`;
      const target =
        via === "mail"
          ? `mailto:${form.dataset.mail}?subject=${encodeURIComponent(`${d.service} - ${d.name}`)}&body=${encodeURIComponent(text)}`
          : `https://wa.me/${form.dataset.wa}?text=${encodeURIComponent(text)}`;
      if (via === "mail") window.location.href = target;
      else window.open(target, "_blank", "noopener");
    });
  }
  doc.classList.remove("no-js");
})();
