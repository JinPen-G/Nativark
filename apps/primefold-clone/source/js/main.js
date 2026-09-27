/**
 * Primefold homepage — hand-authored, framework-free interaction source.
 * No React, Framer, generated component IDs or build step are required.
 * Visual content lives in index.html; layout lives in styles.css.
 */
(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  const wrap = (index, count) => (index + count) % count;

  // Storage may be disabled in a private browsing session. The site still works.
  const storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* optional */
      }
    },
  };

  /* ── Navigation ───────────────────────────────────────────────────────── */
  const header = $("#site-header");
  const menuToggle = $(".menu-toggle");
  const mobileMenu = $("#mobile-menu");
  let scrollTick = false;

  function updateHeader() {
    header.classList.toggle("is-scrolled", window.scrollY > 30);
    updateProductStack();
    scrollTick = false;
  }

  function closeDropdowns(except) {
    $$(".nav-dropdown").forEach((dropdown) => {
      if (dropdown === except) return;
      dropdown.classList.remove("is-open");
      $(".nav-trigger", dropdown).setAttribute("aria-expanded", "false");
    });
  }

  $$(".nav-dropdown").forEach((dropdown) => {
    const trigger = $(".nav-trigger", dropdown);
    function open() {
      closeDropdowns(dropdown);
      dropdown.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
    }
    function close() {
      dropdown.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
    }
    dropdown.addEventListener("mouseenter", open);
    dropdown.addEventListener("mouseleave", close);
    dropdown.addEventListener("focusin", (event) => {
      if (event.target !== trigger || trigger.matches(":focus-visible")) open();
    });
    dropdown.addEventListener("focusout", (event) => {
      if (!dropdown.contains(event.relatedTarget)) close();
    });
    trigger.addEventListener("click", () => {
      open();
    });
  });

  function setMobileMenu(open) {
    header.classList.toggle("menu-open", open);
    mobileMenu.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.style.overflow = open ? "hidden" : "";
  }
  menuToggle.addEventListener("click", () => setMobileMenu(mobileMenu.hidden));
  mobileMenu.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMobileMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeDropdowns();
    if (!mobileMenu.hidden) {
      setMobileMenu(false);
      menuToggle.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".nav-dropdown")) closeDropdowns();
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!scrollTick) {
        requestAnimationFrame(updateHeader);
        scrollTick = true;
      }
    },
    { passive: true },
  );

  /* ── Hero carousel ────────────────────────────────────────────────────── */
  const hero = $(".hero");
  const heroSlides = $$(".hero-slide");
  const heroTabs = $$("[data-slide]");
  const heroTabList = $(".hero-tabs");
  const heroDuration = 7000;
  let heroIndex = 0;
  let heroStarted = performance.now();
  let heroElapsed = 0;
  let heroPaused = false;
  let heroHover = false;
  let heroInView = true;

  function showHero(index, { focus = false } = {}) {
    heroIndex = wrap(index, heroSlides.length);
    heroSlides.forEach((slide, i) => {
      const active = i === heroIndex;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
      slide.inert = !active;
    });
    heroTabs.forEach((tab, i) => {
      const active = i === heroIndex;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      $(".hero-progress", tab).style.transform = "scaleX(0)";
    });
    heroStarted = performance.now();
    heroElapsed = 0;
    if (focus) heroTabs[heroIndex].focus();
    if (window.innerWidth < 600) {
      const tab = heroTabs[heroIndex];
      heroTabList.scrollTo({
        left: Math.max(0, tab.offsetLeft - 20),
        behavior: reducedMotion.matches ? "instant" : "smooth",
      });
    }
  }

  heroTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => showHero(index));
    tab.addEventListener("mouseenter", () => {
      if (window.matchMedia("(hover: hover)").matches && heroIndex !== index)
        showHero(index);
    });
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? heroSlides.length - 1
            : heroIndex + (event.key === "ArrowLeft" ? -1 : 1);
      showHero(next, { focus: true });
    });
  });
  $(".hero-next").addEventListener("click", () => showHero(heroIndex + 1));
  $(".hero-prev").addEventListener("click", () => showHero(heroIndex - 1));
  heroTabList.addEventListener("mouseenter", () => {
    heroHover = true;
  });
  heroTabList.addEventListener("mouseleave", () => {
    heroHover = false;
    heroStarted = performance.now() - heroElapsed;
  });
  const autoplayToggle = $(".autoplay-toggle");
  autoplayToggle.addEventListener("click", () => {
    heroPaused = !heroPaused;
    autoplayToggle.textContent = heroPaused
      ? "Resume autoplay"
      : "Pause autoplay";
    autoplayToggle.setAttribute("aria-label", autoplayToggle.textContent);
    heroStarted = performance.now() - heroElapsed;
  });
  new IntersectionObserver((entries) => {
    heroInView = entries[0].isIntersecting;
    heroStarted = performance.now() - heroElapsed;
  }).observe(hero);

  function animateHero(now) {
    if (
      !heroPaused &&
      !heroHover &&
      heroInView &&
      !document.hidden &&
      !reducedMotion.matches
    ) {
      heroElapsed = now - heroStarted;
      if (heroElapsed >= heroDuration) showHero(heroIndex + 1);
      $(".hero-progress", heroTabs[heroIndex]).style.transform =
        `scaleX(${Math.min(heroElapsed / heroDuration, 1)})`;
    } else {
      heroStarted = now - heroElapsed;
    }
    requestAnimationFrame(animateHero);
  }
  requestAnimationFrame(animateHero);

  /* ── Logo marquee ─────────────────────────────────────────────────────── */
  const marquee = $(".marquee-track");
  [...marquee.children].forEach((image) => {
    const duplicate = image.cloneNode(true);
    duplicate.alt = "";
    duplicate.setAttribute("aria-hidden", "true");
    marquee.append(duplicate);
  });

  /* ── Customer stories: looped carousel, drag, keyboard and autoplay ─────── */
  const quoteSection = $(".quote-section");
  const quoteTrack = $(".quote-track");
  const quoteOriginals = $$(".quote-card", quoteTrack);
  const quoteDots = $$(".quote-dots button");
  const before = quoteOriginals.at(-1).cloneNode(true);
  const after = quoteOriginals[0].cloneNode(true);
  before.inert = true;
  after.inert = true;
  before.setAttribute("aria-hidden", "true");
  after.setAttribute("aria-hidden", "true");
  quoteTrack.prepend(before);
  quoteTrack.append(after);
  let quoteIndex = 0;
  let quotePosition = 1;
  let quoteMoving = false;
  let quotePause = false;
  let quoteHover = false;
  let quoteVisible = false;
  let quoteTimer;

  function quoteStep() {
    return (
      quoteOriginals[0].getBoundingClientRect().width +
      parseFloat(getComputedStyle(quoteTrack).gap)
    );
  }
  function positionQuote(animate = true) {
    quoteTrack.style.transition =
      animate && !reducedMotion.matches ? "" : "none";
    quoteTrack.style.transform = `translateX(${-quotePosition * quoteStep()}px)`;
    quoteDots.forEach((dot, i) =>
      dot.setAttribute("aria-current", String(i === quoteIndex)),
    );
    quoteOriginals.forEach((card, i) => {
      card.inert = i !== quoteIndex;
      card.setAttribute("aria-hidden", String(i !== quoteIndex));
    });
  }
  function moveQuote(direction) {
    if (quoteMoving) return;
    quoteMoving = true;
    quotePosition += direction;
    quoteIndex = wrap(quoteIndex + direction, quoteOriginals.length);
    positionQuote();
    window.setTimeout(
      () => {
        if (quotePosition === 0) quotePosition = quoteOriginals.length;
        if (quotePosition === quoteOriginals.length + 1) quotePosition = 1;
        positionQuote(false);
        quoteMoving = false;
      },
      reducedMotion.matches ? 10 : 720,
    );
  }
  $(".quote-prev").addEventListener("click", () => moveQuote(-1));
  $(".quote-next").addEventListener("click", () => moveQuote(1));
  quoteDots.forEach((dot, i) =>
    dot.addEventListener("click", () => {
      quoteIndex = i;
      quotePosition = i + 1;
      positionQuote();
    }),
  );
  quoteSection.addEventListener("mouseenter", () => {
    quoteHover = true;
  });
  quoteSection.addEventListener("mouseleave", () => {
    quoteHover = false;
  });
  quoteSection.addEventListener("focusin", () => {
    quoteHover = true;
  });
  quoteSection.addEventListener("focusout", (event) => {
    if (!quoteSection.contains(event.relatedTarget)) quoteHover = false;
  });
  $(".quote-autoplay").addEventListener("click", (event) => {
    quotePause = !quotePause;
    event.currentTarget.textContent = quotePause
      ? "Resume customer stories"
      : "Pause customer stories";
    event.currentTarget.setAttribute(
      "aria-label",
      event.currentTarget.textContent,
    );
  });
  new IntersectionObserver(
    (entries) => {
      quoteVisible = entries[0].isIntersecting;
    },
    { threshold: 0.25 },
  ).observe(quoteSection);
  quoteTimer = window.setInterval(() => {
    if (
      quoteVisible &&
      !quotePause &&
      !quoteHover &&
      !document.hidden &&
      !reducedMotion.matches
    )
      moveQuote(1);
  }, 8500);
  let quoteDragStart = null;
  quoteTrack.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("a,button")) return;
    quoteDragStart = event.clientX;
  });
  window.addEventListener("pointerup", (event) => {
    if (quoteDragStart === null) return;
    const distance = event.clientX - quoteDragStart;
    quoteDragStart = null;
    if (Math.abs(distance) > 45) moveQuote(distance < 0 ? 1 : -1);
  });
  quoteTrack.addEventListener("pointercancel", () => {
    quoteDragStart = null;
  });
  positionQuote(false);

  /* ── Team carousel: native touch scrolling and mouse dragging ──────────── */
  const teams = $(".teams-track");
  const teamStep = () => $(".team-card").getBoundingClientRect().width + 24;
  $(".teams-prev").addEventListener("click", () =>
    teams.scrollBy({
      left: -teamStep(),
      behavior: reducedMotion.matches ? "instant" : "smooth",
    }),
  );
  $(".teams-next").addEventListener("click", () =>
    teams.scrollBy({
      left: teamStep(),
      behavior: reducedMotion.matches ? "instant" : "smooth",
    }),
  );
  teams.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    teams.scrollBy({
      left: teamStep() * (event.key === "ArrowLeft" ? -1 : 1),
      behavior: reducedMotion.matches ? "instant" : "smooth",
    });
  });
  let dragging = null;
  teams.addEventListener("pointerdown", (event) => {
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      event.target.closest("a,button")
    )
      return;
    dragging = { x: event.clientX, scroll: teams.scrollLeft, moved: false };
    teams.setPointerCapture(event.pointerId);
    teams.classList.add("is-dragging");
    event.preventDefault();
  });
  teams.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const distance = event.clientX - dragging.x;
    if (Math.abs(distance) > 5) dragging.moved = true;
    teams.scrollLeft = dragging.scroll - distance;
  });
  function finishDrag() {
    dragging = null;
    teams.classList.remove("is-dragging");
  }
  teams.addEventListener("pointerup", finishDrag);
  teams.addEventListener("pointercancel", finishDrag);
  teams.addEventListener("dragstart", (event) => event.preventDefault());

  /* ── Mobile stacked cards and outcome character reveals ───────────────── */
  // The template's section entrance is a vertical fade, independent of layout.
  // Without JavaScript the content remains visible.
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("has-entered");
        revealObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.1 },
  );
  $$(".section-heading, .flow-card, .trust-visual").forEach((element) => {
    if (reducedMotion.matches) return;
    element.classList.add("entrance-ready");
    revealObserver.observe(element);
  });

  const productCards = $$(".product-card");
  function updateProductStack() {
    productCards.forEach((card, i) => {
      if (window.innerWidth >= 600 || reducedMotion.matches) {
        card.style.transform = "";
        return;
      }
      if (i === productCards.length - 1) {
        card.style.transform =
          card.getBoundingClientRect().top <= 120 ? "scale(0.96)" : "";
        return;
      }
      const next = productCards[i + 1].getBoundingClientRect();
      const progress = Math.max(
        0,
        Math.min(
          1,
          (2 * (card.offsetHeight + 108 - next.top)) / card.offsetHeight,
        ),
      );
      card.style.transform = `scale(${1 - progress * (i === 0 ? 0.14 : 0.09)})`;
    });
  }
  const metricObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        metricObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.5 },
  );
  $$(".metric").forEach((metric) => {
    const text = metric.dataset.metric;
    metric.setAttribute("aria-label", text);
    metric.replaceChildren(
      ...[...text].map((character, i) => {
        const span = document.createElement("span");
        span.className = "metric-character";
        span.textContent = character;
        span.setAttribute("aria-hidden", "true");
        span.style.setProperty("--i", i);
        return span;
      }),
    );
    metricObserver.observe(metric);
  });

  /* ── Original Lottie assets, controlled by readable native code ────────── */
  const animationInstances = new Map();
  const mobile = window.matchMedia("(max-width: 599px)");

  function createAnimation(element) {
    const name =
      mobile.matches && element.dataset.mobileAnimation
        ? element.dataset.mobileAnimation
        : element.dataset.animation;
    if (element.dataset.loadedAnimation === name) return;
    animationInstances.get(element)?.destroy();
    element.dataset.loadedAnimation = name;
    const animation = window.lottie.loadAnimation({
      container: element,
      renderer: "svg",
      loop: element.dataset.loop === "true",
      autoplay: false,
      path: `assets/animations/${name}.json`,
      rendererSettings: {
        preserveAspectRatio: "xMidYMid meet",
        progressiveLoad: false,
      },
    });
    animationInstances.set(element, animation);
    if (element.closest(".trust-visual")) {
      // Keep the text indicator on the same phase as the original Lottie.
      animation.addEventListener("enterFrame", () => {
        const index = Math.min(
          2,
          Math.floor((animation.currentFrame * 3) / animation.totalFrames),
        );
        $$(".trust-point").forEach((step, i) =>
          step.classList.toggle("is-active", i === index),
        );
      });
    }
    animation.addEventListener("DOMLoaded", () => {
      if (element.dataset.hoverAnimation) {
        if (
          mobile.matches &&
          !reducedMotion.matches &&
          element.closest(".experience-card") &&
          element.getBoundingClientRect().top < innerHeight &&
          element.getBoundingClientRect().bottom > 0
        ) {
          element.closest(".product-card").classList.add("is-animating");
          animation.loop = true;
          animation.play();
        }
        return;
      }
      if (reducedMotion.matches)
        animation.goToAndStop(Math.floor(animation.totalFrames * 0.7), true);
      else if (
        element.getBoundingClientRect().top < innerHeight &&
        element.getBoundingClientRect().bottom > 0
      )
        animation.play();
    });
    if (element.dataset.hoverAnimation) {
      const card = element.closest(".product-card");
      const startHover = () => {
        // Hover callouts overlay the original card rather than replace its image.
        // Touch layouts keep the static visual and the scroll-stack animation.
        if (mobile.matches || reducedMotion.matches || !animation.isLoaded)
          return;
        card.classList.add("is-animating");
        animation.goToAndPlay(0, true);
      };
      const stopHover = () => {
        card.classList.remove("is-animating");
        animation.stop();
      };
      card.addEventListener("mouseenter", startHover);
      card.addEventListener("mouseleave", stopHover);
      card.addEventListener("focusin", startHover);
      card.addEventListener("focusout", stopHover);
      mobile.addEventListener("change", stopHover);
    }
  }
  if (window.lottie) {
    const visibility = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const instance = animationInstances.get(entry.target);
          if (!instance || reducedMotion.matches) return;
          if (entry.target.dataset.hoverAnimation) {
            if (!mobile.matches || !entry.target.closest(".experience-card"))
              return;
            entry.target
              .closest(".product-card")
              .classList.toggle("is-animating", entry.isIntersecting);
            instance.loop = true;
            if (entry.isIntersecting && !document.hidden) instance.play();
            else instance.pause();
            return;
          }
          if (entry.isIntersecting && !document.hidden) instance.play();
          else instance.pause();
        });
      },
      { threshold: 0.1 },
    );
    $$(".lottie-animation").forEach((element) => {
      createAnimation(element);
      visibility.observe(element);
    });
    mobile.addEventListener("change", () =>
      $$(".lottie-animation[data-mobile-animation]").forEach(createAnimation),
    );
  }
  const trustSteps = $$(".trust-point");
  trustSteps.forEach((step, index) =>
    step.addEventListener("click", () => {
      trustSteps.forEach((item) =>
        item.classList.toggle("is-active", item === step),
      );
      const animation = animationInstances.get(
        $(".trust-visual .lottie-animation"),
      );
      if (!animation?.isLoaded) return;
      const frame = Math.floor((animation.totalFrames * index) / 3);
      if (reducedMotion.matches) animation.goToAndStop(frame, true);
      else animation.goToAndPlay(frame, true);
    }),
  );

  /* ── Frontend-only newsletter: never transmit to the original company ──── */
  $("#newsletter-form").addEventListener("submit", (event) => {
    event.preventDefault();
    $("#newsletter-message").textContent =
      "Preview only — no subscription has been sent.";
  });

  /* ── Local consent state and native settings dialog ────────────────────── */
  const consentKey = "primefold-source-cookie-consent";
  const consentBanner = $("#cookie-banner");
  const consentDialog = $("#cookie-dialog");
  consentBanner.hidden = Boolean(storage.get(consentKey));
  function saveConsent(action) {
    const analytics =
      action === "accept" ||
      (action === "save" && $("#analytics-consent").checked);
    storage.set(consentKey, JSON.stringify({ essential: true, analytics }));
    consentBanner.hidden = true;
  }
  $$("[data-cookie-action]").forEach((button) =>
    button.addEventListener("click", () =>
      saveConsent(button.dataset.cookieAction),
    ),
  );
  $$("[data-cookie-settings]").forEach((button) =>
    button.addEventListener("click", () => {
      try {
        $("#analytics-consent").checked = Boolean(
          JSON.parse(storage.get(consentKey))?.analytics,
        );
      } catch {
        /* no prior state */
      }
      consentDialog.showModal();
    }),
  );
  consentDialog.addEventListener("close", () => {
    if (["reject", "accept", "save"].includes(consentDialog.returnValue))
      saveConsent(consentDialog.returnValue);
  });

  /* ── Shared lifecycle ─────────────────────────────────────────────────── */
  window.addEventListener(
    "resize",
    () => {
      positionQuote(false);
      if (innerWidth >= 960 && !mobileMenu.hidden) setMobileMenu(false);
      updateProductStack();
    },
    { passive: true },
  );
  document.addEventListener("visibilitychange", () => {
    heroStarted = performance.now() - heroElapsed;
    animationInstances.forEach((animation, element) => {
      if (document.hidden) animation.pause();
      else if (
        !element.dataset.hoverAnimation &&
        !reducedMotion.matches &&
        element.getBoundingClientRect().top < innerHeight &&
        element.getBoundingClientRect().bottom > 0
      )
        animation.play();
    });
  });
  updateHeader();
})();
