/* PI FRAMES — shared behaviour */
(function () {
  "use strict";

  const $  = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- nav ---------- */
  const nav = $(".nav");
  const onScroll = () => nav && nav.classList.toggle("scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const burger = $(".nav-burger");
  const menu = $("#menu");
  if (burger && menu) {
    burger.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      burger.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    });
    $$("a", menu).forEach(a => a.addEventListener("click", () => {
      menu.classList.remove("open");
      burger.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }));
  }

  /* ---------- reveal on scroll ---------- */
  const revealEls = $$(".reveal");
  if (revealEls.length && "IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add("in"));
  }

  /* ---------- hero video: pause for reduced motion ---------- */
  const heroVideo = $(".hero-media video");
  if (heroVideo && reduceMotion) {
    heroVideo.removeAttribute("autoplay");
    heroVideo.pause();
  }

  /* ---------- film strip: auto-slide + drag-to-scroll ---------- */
  $$(".filmstrip").forEach(strip => {
    let down = false, startX = 0, startLeft = 0;

    /* drag-to-scroll (mouse) */
    strip.addEventListener("pointerdown", e => {
      if (e.pointerType !== "mouse") return;
      down = true; startX = e.clientX; startLeft = strip.scrollLeft;
      strip.classList.add("dragging");
      strip.setPointerCapture(e.pointerId);
    });
    strip.addEventListener("pointermove", e => {
      if (!down) return;
      strip.scrollLeft = startLeft - (e.clientX - startX);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(ev =>
      strip.addEventListener(ev, () => { down = false; strip.classList.remove("dragging"); })
    );

    /* auto-slide — gentle continuous drift, truly infinite, pauses on interaction */
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      const SPEED = 0.4;              // px per frame (~24px/sec) — slow, ambient
      let paused = false;
      let rafId;

      const inner = strip.querySelector(".film");
      let loopWidth = 0;             // width of the ORIGINAL set of cells (wrap distance)

      if (inner) {
        // Keep ONE continuous film strip (one black background + sprockets) and
        // duplicate the IMAGE CELLS inside it enough times that the row is always
        // at least ~2.5× the viewport wide. Looping by the original cells' width
        // then lands an identical cell exactly where the first was — a seamless,
        // never-ending roll with no gaps between separate strips.
        const originals = Array.from(inner.children);   // the real .film-cell nodes
        const build = () => {
          // remove previously-added clones
          inner.querySelectorAll("[data-clone]").forEach(n => n.remove());
          // rough original width to decide how many copies we need
          let approx = 0;
          originals.forEach(c => { approx += c.getBoundingClientRect().width; });
          const gap = parseFloat(getComputedStyle(inner).gap || 0) || 0;
          approx += gap * Math.max(0, originals.length - 1);

          if (approx > 0) {
            const need = Math.ceil((strip.clientWidth * 2.5) / approx) + 1;
            for (let r = 0; r < need; r++) {
              originals.forEach(c => {
                const cc = c.cloneNode(true);
                cc.setAttribute("aria-hidden", "true");
                cc.setAttribute("data-clone", "1");
                inner.appendChild(cc);
              });
            }
            // exact loop distance = left edge of the FIRST clone minus the first
            // original's left edge (pixel-perfect, accounts for gaps/rounding).
            const firstClone = inner.querySelector("[data-clone]");
            if (firstClone) {
              loopWidth = firstClone.offsetLeft - originals[0].offsetLeft;
            }
          }
        };
        build();
        window.addEventListener("resize", build);
        window.addEventListener("load", build);
        setTimeout(build, 800);
        setTimeout(build, 2500);
      }

      const pause  = () => { paused = true; };
      const resume = () => { paused = false; };

      // pause while the pointer is over it, or during touch/drag
      strip.addEventListener("pointerenter", pause);
      strip.addEventListener("pointerleave", resume);
      strip.addEventListener("touchstart", pause, { passive: true });
      strip.addEventListener("touchend",   () => setTimeout(resume, 1200), { passive: true });
      strip.addEventListener("focusin",  pause);
      strip.addEventListener("focusout", resume);
      let wheelT;
      strip.addEventListener("wheel", () => {
        pause(); clearTimeout(wheelT); wheelT = setTimeout(resume, 1500);
      }, { passive: true });

      // Track position as a float; scrollLeft rounds to int so += 0.4 alone
      // would never accumulate.
      let pos = strip.scrollLeft;
      const tick = () => {
        if (!paused && !down) {
          pos += SPEED;
          // loop by exactly one original strip width — the next identical copy
          // is already there, so the wrap is invisible and content never ends.
          if (loopWidth > 0 && pos >= loopWidth) pos -= loopWidth;
          strip.scrollLeft = pos;
        } else {
          // keep in sync while the user drags; keep pos within one loop length
          pos = strip.scrollLeft;
          if (loopWidth > 0) { pos = ((pos % loopWidth) + loopWidth) % loopWidth; }
        }
        rafId = requestAnimationFrame(tick);
      };

      // only run when the strip is actually on screen (saves battery)
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver(entries => {
          entries.forEach(en => {
            if (en.isIntersecting) { if (!rafId) rafId = requestAnimationFrame(tick); }
            else { cancelAnimationFrame(rafId); rafId = null; }
          });
        }, { threshold: 0 });
        io.observe(strip);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    }
  });

  /* ---------- before / after slider (auto-swipes, pauses on touch) ---------- */
  $$(".ba").forEach(ba => {
    const range = $("input[type=range]", ba);
    if (!range) return;
    const set = v => {
      ba.style.setProperty("--pos", v + "%");
      range.value = v;
    };
    set(range.value);

    let userControlled = false;   // true once the person grabs it
    let raf = null;
    let visible = false;

    // gentle ease-in-out sweep between 18% and 82%
    const LO = 18, HI = 82, PERIOD = 5200; // ms for a full there-and-back
    let start = null;
    const tick = now => {
      if (start === null) start = now;
      const t = ((now - start) % PERIOD) / PERIOD;          // 0..1
      const eased = 0.5 - 0.5 * Math.cos(t * 2 * Math.PI);   // smooth 0..1..0
      set((LO + (HI - LO) * eased).toFixed(1));
      raf = requestAnimationFrame(tick);
    };
    const play = () => {
      if (raf || userControlled || !visible || reduceMotion) return;
      start = null;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };

    // stop autoplay the moment the user interacts, hand control to them
    const grab = () => { userControlled = true; stop(); };
    range.addEventListener("input", () => { grab(); set(range.value); });
    range.addEventListener("pointerdown", grab);

    // only animate while on screen (saves battery, feels intentional)
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(entries => {
        entries.forEach(e => {
          visible = e.isIntersecting;
          visible ? play() : stop();
        });
      }, { threshold: 0.35 }).observe(ba);
    } else {
      visible = true; play();
    }
  });

  /* ---------- portfolio: filters + lightbox ---------- */
  const gallery = $("#gallery");
  if (gallery) {
    const chips = $$(".chip[data-filter]");
    const prints = $$(".print", gallery);

    /* smooth fade-in: mark each image loaded so CSS can fade it in. Handles
       images that are already cached/complete when the script runs. */
    const galleryImgs = $$("img", gallery);
    galleryImgs.forEach(img => {
      const done = () => img.classList.add("loaded");
      if (img.complete && img.naturalWidth > 0) done();
      else {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true }); // don't leave broken imgs invisible
      }
    });
    /* safety net: if any load event is ever missed, force-reveal after 6s so
       no image can get stuck invisible. */
    setTimeout(() => galleryImgs.forEach(img => img.classList.add("loaded")), 6000);

    // dropdown elements (mobile)
    const dd        = $("#filter-select");
    const ddTrigger = $("#filter-trigger");
    const ddMenu    = $("#filter-menu");
    const ddOptions = $$(".filter-option", ddMenu);
    const ddCurrent = $("#ft-current");
    const ddCurrentCount = $("#ft-current-count");

    const labelFor = key => {
      const opt = ddOptions.find(o => o.dataset.filter === key);
      return opt ? {
        label: $(".fo-label", opt).textContent,
        count: $(".fo-count", opt).textContent,
      } : { label: "All", count: "" };
    };

    const applyFilter = key => {
      chips.forEach(c => c.setAttribute("aria-pressed", String(c.dataset.filter === key)));
      // sync dropdown
      ddOptions.forEach(o => {
        const on = o.dataset.filter === key;
        o.classList.toggle("is-active", on);
        o.setAttribute("aria-selected", String(on));
      });
      const info = labelFor(key);
      if (ddCurrent) ddCurrent.textContent = info.label;
      if (ddCurrentCount) ddCurrentCount.textContent = info.count;

      prints.forEach(p => {
        const cats = (p.dataset.cat || "").split(/\s+/);
        p.classList.toggle("hidden", key !== "all" && !cats.includes(key));
      });
      const count = prints.filter(p => !p.classList.contains("hidden")).length;
      const status = $("#gallery-status");
      if (status) status.textContent = count + (count === 1 ? " frame" : " frames") + " on the wall";
    };

    const setFilter = key => {
      applyFilter(key);
      history.replaceState(null, "", key === "all" ? location.pathname : "#" + key);
    };

    chips.forEach(chip => chip.addEventListener("click", () => setFilter(chip.dataset.filter)));

    // dropdown open/close
    const openMenu = () => {
      ddMenu.classList.add("open");
      ddTrigger.setAttribute("aria-expanded", "true");
    };
    const closeMenu = () => {
      ddMenu.classList.remove("open");
      ddTrigger.setAttribute("aria-expanded", "false");
    };
    if (ddTrigger) {
      ddTrigger.addEventListener("click", e => {
        e.stopPropagation();
        ddMenu.classList.contains("open") ? closeMenu() : openMenu();
      });
      ddOptions.forEach(o => o.addEventListener("click", () => {
        setFilter(o.dataset.filter);
        closeMenu();
      }));
      document.addEventListener("click", e => {
        if (dd && !dd.contains(e.target)) closeMenu();
      });
      document.addEventListener("keydown", e => {
        if (e.key === "Escape" && ddMenu.classList.contains("open")) { closeMenu(); ddTrigger.focus(); }
      });
    }

    // deep-link e.g. portfolio.html#weddings
    const initial = location.hash.replace("#", "");
    applyFilter(chips.some(c => c.dataset.filter === initial) ? initial : "all");

    /* lightbox */
    const lb      = $("#lightbox");
    const lbImg   = $("#lb-img");
    const lbCap   = $("#lb-cap");
    const lbCount = $("#lb-count");
    let current = -1;

    const visible = () => prints.filter(p => !p.classList.contains("hidden"));

    const show = i => {
      const list = visible();
      if (!list.length) return;
      current = (i + list.length) % list.length;
      const p = list[current];
      const img = $("img", p);
      lbImg.src = img.currentSrc || img.src;
      lbImg.alt = img.alt || "";
      lbCap.textContent = p.dataset.cap || "";
      lbCount.textContent = String(current + 1).padStart(2, "0") + " / " + String(list.length).padStart(2, "0");
    };

    const open = p => {
      show(visible().indexOf(p));
      lb.classList.add("open");
      document.body.style.overflow = "hidden";
      $(".lb-close", lb).focus();
    };
    const close = () => {
      lb.classList.remove("open");
      document.body.style.overflow = "";
      lbImg.src = "";
    };

    prints.forEach(p => p.addEventListener("click", () => open(p)));
    $(".lb-close", lb).addEventListener("click", close);
    $(".lb-prev",  lb).addEventListener("click", () => show(current - 1));
    $(".lb-next",  lb).addEventListener("click", () => show(current + 1));
    lb.addEventListener("click", e => { if (e.target === lb) close(); });
    document.addEventListener("keydown", e => {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(current - 1);
      if (e.key === "ArrowRight") show(current + 1);
    });
  }

  /* ---------- lite YouTube embeds: load the real player only on click ---------- */
  $$(".yt-lite").forEach(el => {
    const activate = () => {
      if (el.classList.contains("yt-active")) return;
      const id = el.getAttribute("data-yt");
      const isShort = el.getAttribute("data-short") === "1";
      if (!id) return;
      const iframe = document.createElement("iframe");
      // autoplay on click; loop the short vertical reels like the old players did
      const params = "autoplay=1&rel=0&playsinline=1&modestbranding=1" +
                     (isShort ? "&loop=1&playlist=" + encodeURIComponent(id) : "");
      // standard youtube.com is the most permissive for embedding (the -nocookie
      // domain can be stricter). This works on a real https:// domain; note that
      // some videos won't embed from a local file:// page.
      iframe.src = "https://www.youtube.com/embed/" + encodeURIComponent(id) + "?" + params;
      iframe.title = el.getAttribute("aria-label") || "YouTube video";
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.setAttribute("allowfullscreen", "");
      iframe.loading = "eager";
      el.appendChild(iframe);
      el.classList.add("yt-active");
    };
    el.addEventListener("click", activate);
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
    });
  });


  $$(".reel-card").forEach(card => {
    const frame = $(".film-frame", card);
    const video = $(".film-video", card);
    const playBtn = $(".film-play", card);
    if (!frame || !video) return;

    const start = () => {
      // pause any other films first
      $$(".film-video").forEach(v => { if (v !== video) { v.pause(); } });
      video.play();
    };
    if (playBtn) playBtn.addEventListener("click", start);
    video.addEventListener("play",  () => frame.classList.add("is-playing"));
    video.addEventListener("pause", () => frame.classList.remove("is-playing"));
    video.addEventListener("ended", () => frame.classList.remove("is-playing"));
  });

  /* booking form is handled by js/booking.js (calendar + availability) */

  /* ---------- footer year ---------- */
  const yr = $("#year");
  if (yr) yr.textContent = new Date().getFullYear();
})();
