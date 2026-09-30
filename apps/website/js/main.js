/**
 * Rental OS 2.0 — hand-authored, framework-free interaction source.
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
  const t = (key) => window.RentalOSCopy.text(key);

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
    updateHeroParallax();
    updateQuoteSpread();
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
    menuToggle.setAttribute("aria-label", t(open ? "menu.close" : "menu.open"));
    document.body.style.overflow = open ? "hidden" : "";
  }
  menuToggle.addEventListener("click", () => setMobileMenu(mobileMenu.hidden));
  mobileMenu.addEventListener("click", (event) => {
    if (event.target.closest("a") && !event.target.closest("[data-demo-open]")) setMobileMenu(false);
  });
  document.addEventListener("rentalos:demo-open", () => {
    closeDropdowns();
    if (!mobileMenu.hidden) setMobileMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
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
  function updateHeroParallax() {
    // Source Hero speed 40: compensate 60% of normal document scrolling.
    // The z-index 4 foreground content supplies the cover; no extra mask.
    hero.style.transform = reducedMotion.matches
      ? ""
      : `translateY(${Math.max(0, scrollY - hero.offsetTop) * 0.6}px)`;
  }
  const heroSlides = $$(".hero-slide");
  $$(".hero-copy .button").forEach((button) => {
    const wrapper = document.createElement("span");
    wrapper.className = `hero-cta-wrap${button.classList.contains("glass") ? " secondary" : ""}`;
    button.replaceWith(wrapper);
    wrapper.append(button);
  });
  const heroTabs = $$("[data-slide]");
  const heroTabList = $(".hero-tabs");
  const heroDuration = 6000;
  let heroIndex = 0;
  let heroStarted = performance.now();
  let heroElapsed = 0;
  let heroPaused = false;
  let heroHover = false;
  let heroInView = true;
  let heroTransition = 0;

  function showHero(index, { focus = false } = {}) {
    const previous = heroIndex;
    heroIndex = wrap(index, heroSlides.length);
    const revision = ++heroTransition;
    heroSlides.forEach((slide) => {
      slide
        .getAnimations({ subtree: true })
        .forEach((animation) => animation.cancel());
      slide.classList.remove("is-outgoing");
    });
    if (previous !== heroIndex && !reducedMotion.matches) {
      const outgoing = heroSlides[previous];
      outgoing.classList.add("is-outgoing");
      const direction =
        heroIndex > previous || (previous === 2 && heroIndex === 0) ? 1 : -1;
      const incoming = heroSlides[heroIndex];
      const easing = "cubic-bezier(0.42, 0, 0, 1)";
      // Background: 300ms horizontal wipe. Copy: 1s, increasing travel per row.
      // These are the downloaded template's values, not a crossfade approximation.
      const imageMotion = incoming.animate(
        [
          { transform: `translateX(${direction * 100}%)` },
          { transform: "translateX(0)" },
        ],
        { duration: 300, easing },
      );
      $$("h1, p, .button-row", $(".hero-copy", incoming)).forEach(
        (element, i) => {
          element.animate(
            [
              {
                transform: `translateX(${direction * [60, 80, 100, 120][Math.min(i, 3)]}px)`,
              },
              { transform: "translateX(0)" },
            ],
            { duration: 1000, easing },
          );
        },
      );
      imageMotion.finished
        .then(() => {
          if (revision === heroTransition)
            outgoing.classList.remove("is-outgoing");
        })
        .catch(() => {}); // A new selection may interrupt this animation.
    }
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
    autoplayToggle.textContent = t(heroPaused ? "hero.resume" : "hero.pause");
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

  /* ── Capability marquee ───────────────────────────────────────────────── */
  const marquee = $(".marquee-track");
  [...marquee.children].forEach((item) => {
    const duplicate = item.cloneNode(true);
    duplicate.setAttribute("aria-hidden", "true");
    marquee.append(duplicate);
  });
  // Preserve the original 20px entrance and stagger; replay on re-entry.
  const logoObserver = new IntersectionObserver(
    ([entry]) => {
      const logos = [...marquee.children];
      logos.forEach((logo) =>
        logo.getAnimations().forEach((animation) => animation.cancel()),
      );
      if (!entry.isIntersecting || reducedMotion.matches) return;
      logos.forEach((logo, i) => {
        logo.animate(
          [
            { transform: "translateY(20px)", opacity: 0 },
            {
              transform: "translateY(0)",
              opacity: getComputedStyle(logo).opacity,
            },
          ],
          {
            duration: 300,
            delay: (i % (logos.length / 2)) * 80,
            easing: "ease-out",
            fill: "backwards",
          },
        );
      });
    },
    { threshold: 0.5 },
  );
  logoObserver.observe($(".client-marquee"));

  // The source spinner changes Braille frames; rotating one glyph looks different.
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const visibleSpinners = new Set();
  const spinnerObserver = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (isIntersecting) visibleSpinners.add(target);
      else visibleSpinners.delete(target);
    });
  });
  $$(".intelligence-dots").forEach((spinner) =>
    spinnerObserver.observe(spinner),
  );
  let spinnerFrame = 0;
  setInterval(() => {
    if (document.hidden || reducedMotion.matches) return;
    spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
    visibleSpinners.forEach((spinner) => {
      spinner.textContent = spinnerFrames[spinnerFrame];
    });
  }, 80);

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
  // Fixed-width slots keep carousel stepping independent of the scroll spread.
  // The editable articles stay intact inside their layout-only wrappers.
  const quoteSlots = $$(".quote-card", quoteTrack).map((card) => {
    const slot = document.createElement("div");
    slot.className = "quote-slot";
    card.replaceWith(slot);
    slot.append(card);
    return slot;
  });
  let quoteIndex = 0;
  let quotePosition = 1;
  let quoteMoving = false;
  let quotePause = false;
  let quoteHover = false;
  let quoteVisible = false;
  let quoteTimer;

  function quoteStep() {
    return (
      quoteSlots[0].getBoundingClientRect().width +
      parseFloat(getComputedStyle(quoteTrack).gap)
    );
  }
  function updateQuoteSpread() {
    const viewport = $(".quote-viewport", quoteSection);
    const base = quoteSlots[0].getBoundingClientRect().width;
    const progress = Math.max(
      0,
      Math.min(
        1,
        (innerHeight - viewport.getBoundingClientRect().top) /
          (innerHeight * 0.72),
      ),
    );
    // Original cubic-in-out, 24px full-page inset, rounding to 4px.
    const eased =
      progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    const spread = reducedMotion.matches
      ? 0
      : Math.round((Math.max(innerWidth - 48 - base, 0) * (1 - eased)) / 4) * 4;
    quoteSlots.forEach((slot, i) => {
      const relative = i - quotePosition;
      const card = slot.firstElementChild;
      card.style.width = `${base + (relative === 0 ? spread : 0)}px`;
      card.style.transform = `translateX(${(Math.sign(relative) * spread) / 2}px)`;
      slot.dataset.quoteRelative = relative;
    });
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
    updateQuoteSpread();
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
    event.currentTarget.textContent = t(
      quotePause ? "story.resume" : "story.pause",
    );
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
  let quoteDragOrigin = 0;
  let quoteDragMoved = false;
  quoteTrack.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || quoteMoving || event.target.closest("a,button"))
      return;
    quoteDragStart = { x: event.clientX, y: event.clientY };
    quoteDragMoved = false;
    quoteDragOrigin = new DOMMatrixReadOnly(
      getComputedStyle(quoteTrack).transform,
    ).m41;
  });
  quoteTrack.addEventListener("pointermove", (event) => {
    if (!quoteDragStart) return;
    const distance = event.clientX - quoteDragStart.x;
    const vertical = event.clientY - quoteDragStart.y;
    if (!quoteDragMoved) {
      if (Math.abs(vertical) > 8 && Math.abs(vertical) > Math.abs(distance)) {
        quoteDragStart = null;
        return;
      }
      if (Math.abs(distance) < 6) return;
      quoteDragMoved = true;
      quoteTrack.setPointerCapture(event.pointerId);
    }
    quoteTrack.style.transition = "none";
    quoteTrack.style.transform = `translateX(${quoteDragOrigin + distance}px)`;
  });
  window.addEventListener("pointerup", (event) => {
    if (quoteDragStart === null) return;
    const distance = event.clientX - quoteDragStart.x;
    quoteDragStart = null;
    quoteDragMoved = false;
    if (Math.abs(distance) > 45) moveQuote(distance < 0 ? 1 : -1);
    else positionQuote();
  });
  quoteTrack.addEventListener("pointercancel", () => {
    quoteDragStart = null;
    quoteDragMoved = false;
    positionQuote();
  });
  quoteTrack.addEventListener("dragstart", (event) => event.preventDefault());
  positionQuote(false);

  /* ── Team carousel: native touch scrolling and mouse dragging ──────────── */
  const teams = $(".teams-track");
  teams.scrollLeft = 0;
  let teamFrame = 0;
  let teamTime = 0;
  let teamPosition = teams.scrollLeft;
  let teamTarget = teamPosition;
  let teamVelocity = 0;
  let lastTeamWrite = teamPosition;
  let lastTeamScrollY = scrollY;
  let teamManualUntil = 0;
  const teamLimit = () => Math.max(0, teams.scrollWidth - teams.clientWidth);
  const clampTeam = (position) => Math.max(0, Math.min(teamLimit(), position));

  function stopTeamSpring() {
    cancelAnimationFrame(teamFrame);
    teamFrame = 0;
    teamTime = 0;
    teamVelocity = 0;
    teamTarget = teamPosition = lastTeamWrite = teams.scrollLeft;
  }
  function takeTeamControl() {
    stopTeamSpring();
    // Button focus may also scroll the page. Let native/manual rail motion
    // finish before page scrolling can drive it again; native scroll renews it.
    teamManualUntil = performance.now() + 800;
  }
  function animateTeamSpring(now) {
    if (reducedMotion.matches) {
      teams.classList.remove("is-scroll-driven");
      stopTeamSpring();
      return;
    }
    const elapsed = teamTime ? Math.min((now - teamTime) / 1000, 0.04) : 1 / 60;
    teamTime = now;
    // Source scroll-drive spring: stiffness 110, damping 28, mass 0.6.
    // Small integration steps retain velocity when the scroll direction reverses.
    const steps = Math.ceil(elapsed / (1 / 120));
    const dt = elapsed / steps;
    for (let i = 0; i < steps; i++) {
      teamVelocity +=
        (((teamTarget - teamPosition) * 110 - teamVelocity * 28) / 0.6) * dt;
      teamPosition = clampTeam(teamPosition + teamVelocity * dt);
    }
    if (
      Math.abs(teamTarget - teamPosition) < 0.05 &&
      Math.abs(teamVelocity) < 0.05
    ) {
      teamPosition = teamTarget;
      teamFrame = 0;
      teamTime = 0;
    } else teamFrame = requestAnimationFrame(animateTeamSpring);
    teams.scrollLeft = teamPosition;
    lastTeamWrite = teams.scrollLeft;
  }
  function updateTeamScrollDrive() {
    const delta = scrollY - lastTeamScrollY;
    lastTeamScrollY = scrollY;
    teams.classList.toggle("is-scroll-driven", !reducedMotion.matches);
    if (reducedMotion.matches) {
      stopTeamSpring();
      return;
    }
    if (dragging || !mobileMenu.hidden || performance.now() < teamManualUntil)
      return;
    const rect = teams.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight || !delta) return;
    if (!teamFrame) teamPosition = teams.scrollLeft;
    // Same 40% scroll delta and +/-150px per-event clamp as the source.
    teamTarget = clampTeam(
      teamTarget + Math.max(-150, Math.min(150, delta)) * 0.4,
    );
    if (!teamFrame) teamFrame = requestAnimationFrame(animateTeamSpring);
  }
  teams.classList.toggle("is-scroll-driven", !reducedMotion.matches);
  window.addEventListener("scroll", updateTeamScrollDrive, { passive: true });
  teams.addEventListener(
    "scroll",
    () => {
      // A native touch swipe, trackpad or scrollbar takes over from the spring.
      if (Math.abs(teams.scrollLeft - lastTeamWrite) > 2) takeTeamControl();
    },
    { passive: true },
  );
  teams.addEventListener("pointerdown", takeTeamControl, { passive: true });
  teams.addEventListener("wheel", takeTeamControl, { passive: true });
  const teamStep = () => $(".team-card").getBoundingClientRect().width + 24;
  $(".teams-prev").addEventListener("click", () => moveTeam(-1));
  $(".teams-next").addEventListener("click", () => moveTeam(1));
  function moveTeam(direction) {
    takeTeamControl();
    teams.scrollBy({
      left: teamStep() * direction,
      behavior: reducedMotion.matches ? "instant" : "smooth",
    });
  }
  teams.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    moveTeam(event.key === "ArrowLeft" ? -1 : 1);
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
    takeTeamControl();
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
  const productGrid = $(".product-grid");
  const accordionDesktop = window.matchMedia("(min-width: 1200px)");
  // Source spring: mass 1, stiffness 210, damping 30. Retarget from live values
  // and velocities so moving quickly between cards never resets the animation.
  const cardWeights = [1, 1, 1];
  const cardVelocities = [0, 0, 0];
  let expandedCard = -1;
  let accordionFrame = 0;
  let accordionTime = 0;
  function drawAccordion() {
    productGrid.style.gridTemplateColumns = cardWeights
      .map((weight) => `minmax(0, ${weight}fr)`)
      .join(" ");
  }
  function animateAccordion(now) {
    const dt = Math.min((now - accordionTime) / 1000, 1 / 30);
    accordionTime = now;
    let settled = true;
    cardWeights.forEach((weight, i) => {
      const target = i === expandedCard ? 2.7 : 1;
      // Two integration steps keep the physical spring stable at lower frame rates.
      for (let step = 0; step < 2; step++) {
        cardVelocities[i] +=
          (((target - cardWeights[i]) * 210 - cardVelocities[i] * 30) * dt) / 2;
        cardWeights[i] += (cardVelocities[i] * dt) / 2;
      }
      if (
        Math.abs(target - cardWeights[i]) > 0.001 ||
        Math.abs(cardVelocities[i]) > 0.001
      )
        settled = false;
      else {
        cardWeights[i] = target;
        cardVelocities[i] = 0;
      }
    });
    drawAccordion();
    accordionFrame = settled ? 0 : requestAnimationFrame(animateAccordion);
  }
  function expandProduct(index) {
    expandedCard = accordionDesktop.matches ? index : -1;
    productCards.forEach((card, i) =>
      card.classList.toggle("is-expanded", i === expandedCard),
    );
    if (!accordionDesktop.matches) {
      cancelAnimationFrame(accordionFrame);
      accordionFrame = 0;
      cardWeights.fill(1);
      cardVelocities.fill(0);
      productGrid.style.gridTemplateColumns = "";
    } else if (reducedMotion.matches) {
      cancelAnimationFrame(accordionFrame);
      accordionFrame = 0;
      cardWeights.forEach((_, i) => {
        cardWeights[i] = i === expandedCard ? 2.7 : 1;
        cardVelocities[i] = 0;
      });
      drawAccordion();
    } else if (!accordionFrame) {
      accordionTime = performance.now();
      accordionFrame = requestAnimationFrame(animateAccordion);
    }
  }
  // The third "coming soon" card has no hover expansion in the live template.
  productCards.slice(0, 2).forEach((card, i) => {
    card.addEventListener("mouseenter", () => expandProduct(i));
    card.addEventListener("focusin", () => expandProduct(i));
    card.addEventListener("mouseleave", () => expandProduct(-1));
    card.addEventListener("focusout", () => expandProduct(-1));
  });
  const propertyCard = $(".property-card");
  propertyCard.addEventListener("mouseenter", () =>
    propertyCard.classList.add("is-animating"),
  );
  propertyCard.addEventListener("mouseleave", () =>
    propertyCard.classList.remove("is-animating"),
  );
  propertyCard.addEventListener("focusin", () =>
    propertyCard.classList.add("is-animating"),
  );
  propertyCard.addEventListener("focusout", () =>
    propertyCard.classList.remove("is-animating"),
  );
  accordionDesktop.addEventListener("change", () => expandProduct(-1));
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
  const metricAnimations = new Map();
  function rollMetric(metric) {
    metricAnimations.get(metric)?.forEach((animation) => animation.cancel());
    const animations = [];
    $$(".metric-track", metric).forEach((track, i) => {
      if (reducedMotion.matches) return;
      const height = track.firstElementChild.getBoundingClientRect().height;
      const options = {
        duration: 500,
        delay: 100 + i * 100,
        fill: "both",
        easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      };
      animations.push(
        track.animate(
          [
            { transform: "translateY(0)" },
            { transform: `translateY(${-3 * height}px)` },
          ],
          options,
        ),
      );
      animations.push(
        track.animate(
          [
            { filter: "blur(0px)", offset: 0 },
            { filter: "blur(2px)", offset: 0.2 },
            { filter: "blur(2px)", offset: 0.8 },
            { filter: "blur(0px)", offset: 1 },
          ],
          { ...options, easing: "ease-out" },
        ),
      );
    });
    metricAnimations.set(metric, animations);
    metric.classList.add("is-revealed");
  }
  const metricObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        rollMetric(entry.target);
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
        const track = document.createElement("span");
        track.className = "metric-track";
        for (let repeat = 0; repeat < 4; repeat++) {
          const glyph = document.createElement("span");
          glyph.className = "metric-glyph";
          glyph.textContent = character;
          track.append(glyph);
        }
        span.append(track);
        span.setAttribute("aria-hidden", "true");
        span.style.setProperty("--i", i);
        return span;
      }),
    );
    metric.tabIndex = 0;
    metric.setAttribute("role", "button");
    metric.setAttribute("aria-label", `${text} — ${t("metric.replay")}`);
    metric.addEventListener("click", () => rollMetric(metric));
    metric.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        rollMetric(metric);
      }
    });
    metricObserver.observe(metric);
  });
  reducedMotion.addEventListener("change", () => {
    heroSlides.forEach((slide) => {
      slide
        .getAnimations({ subtree: true })
        .forEach((animation) => animation.cancel());
      slide.classList.remove("is-outgoing");
    });
    [...marquee.children].forEach((logo) =>
      logo.getAnimations().forEach((animation) => animation.cancel()),
    );
    $$(".metric").forEach((metric) =>
      metricAnimations.get(metric)?.forEach((animation) => animation.cancel()),
    );
    expandProduct(expandedCard);
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
        const card = element.closest(".product-card");
        if (
          !mobile.matches &&
          !reducedMotion.matches &&
          card.matches(":hover, :focus-within")
        ) {
          card.classList.add("is-animating");
          animation.goToAndPlay(0, true);
        }
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
  reducedMotion.addEventListener("change", () => {
    animationInstances.forEach((animation, element) => {
      if (!animation.isLoaded) return;
      if (reducedMotion.matches) {
        animation.goToAndStop(Math.floor(animation.totalFrames * 0.7), true);
      } else if (
        !document.hidden &&
        element.getBoundingClientRect().top < innerHeight &&
        element.getBoundingClientRect().bottom > 0 &&
        (!element.dataset.hoverAnimation ||
          mobile.matches ||
          element.closest(".product-card").matches(":hover, :focus-within"))
      ) {
        animation.play();
      }
    });
  });
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
    $("#newsletter-message").textContent = t("newsletter.preview");
  });

  function updateLocalizedControls() {
    menuToggle.setAttribute(
      "aria-label",
      t(mobileMenu.hidden ? "menu.open" : "menu.close"),
    );
    autoplayToggle.textContent = t(heroPaused ? "hero.resume" : "hero.pause");
    autoplayToggle.setAttribute("aria-label", autoplayToggle.textContent);
    const quoteToggle = $(".quote-autoplay");
    quoteToggle.textContent = t(quotePause ? "story.resume" : "story.pause");
    quoteToggle.setAttribute("aria-label", quoteToggle.textContent);
    if ($("#newsletter-message").textContent) {
      $("#newsletter-message").textContent = t("newsletter.preview");
    }
    $$(".metric").forEach((metric) => {
      metric.setAttribute(
        "aria-label",
        `${metric.dataset.metric} — ${t("metric.replay")}`,
      );
    });
  }
  document.addEventListener("rentalos:languagechange", updateLocalizedControls);
  updateLocalizedControls();

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
  // Original Lenis options: smoothWheel=true, lerp=.1, syncTouch=false,
  // allowNestedScroll=true. A small native controller preserves that wheel
  // damping without importing the template's compiled framework runtime.
  let wheelFrame = 0;
  let wheelTarget = scrollY;
  let wheelPosition = scrollY;
  let wheelTime = 0;
  let lastWheelWrite = scrollY;
  function stopWheel() {
    cancelAnimationFrame(wheelFrame);
    wheelFrame = 0;
    wheelTarget = wheelPosition = lastWheelWrite = scrollY;
  }
  function easeWheel(now) {
    const elapsed = Math.min((now - wheelTime) / 1000, 0.05);
    wheelTime = now;
    const limit = Math.max(
      0,
      document.documentElement.scrollHeight - innerHeight,
    );
    wheelTarget = Math.max(0, Math.min(limit, wheelTarget));
    // Lenis' lerp .1 is normalized to time with damping factor 6/sec.
    wheelPosition +=
      (wheelTarget - wheelPosition) * (1 - Math.exp(-6 * elapsed));
    if (Math.abs(wheelTarget - wheelPosition) < 0.5)
      wheelPosition = wheelTarget;
    lastWheelWrite = wheelPosition;
    window.scrollTo({ top: wheelPosition, behavior: "instant" });
    wheelFrame =
      wheelPosition === wheelTarget ? 0 : requestAnimationFrame(easeWheel);
  }
  window.addEventListener(
    "wheel",
    (event) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        reducedMotion.matches ||
        !mobileMenu.hidden ||
        document.querySelector("dialog[open]") ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      // Native scroll areas (menus, story/team rails, form controls) keep their
      // own input. Never steal a wheel gesture from a nested scroll container.
      for (const element of event.composedPath()) {
        if (
          !(element instanceof HTMLElement) ||
          element === document.body ||
          element === document.documentElement
        )
          continue;
        const style = getComputedStyle(element);
        if (
          element.matches("input,textarea,select") ||
          (/(auto|scroll)/.test(style.overflowY) &&
            element.scrollHeight > element.clientHeight) ||
          (/(auto|scroll)/.test(style.overflowX) &&
            element.scrollWidth > element.clientWidth)
        )
          return;
      }
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
      const limit = Math.max(
        0,
        document.documentElement.scrollHeight - innerHeight,
      );
      if ((scrollY <= 0 && delta < 0) || (scrollY >= limit && delta > 0))
        return;
      event.preventDefault();
      if (!wheelFrame) wheelTarget = wheelPosition = scrollY;
      wheelTarget = Math.max(0, Math.min(limit, wheelTarget + delta));
      if (!wheelFrame) {
        wheelTime = performance.now();
        wheelFrame = requestAnimationFrame(easeWheel);
      }
    },
    { passive: false },
  );
  window.addEventListener(
    "scroll",
    () => {
      // Scrollbar, keyboard, native anchors, and external scrollTo take priority.
      if (wheelFrame && Math.abs(scrollY - lastWheelWrite) > 3) stopWheel();
    },
    { passive: true },
  );
  window.addEventListener("pointerdown", stopWheel, { passive: true });
  window.addEventListener("touchstart", stopWheel, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        " ",
      ].includes(event.key)
    )
      stopWheel();
  });
  reducedMotion.addEventListener("change", stopWheel);
  reducedMotion.addEventListener("change", () => {
    stopTeamSpring();
    teams.classList.toggle("is-scroll-driven", !reducedMotion.matches);
    lastTeamScrollY = scrollY;
    updateHeroParallax();
    updateQuoteSpread();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopWheel();
  });
  window.addEventListener(
    "resize",
    () => {
      positionQuote(false);
      if (innerWidth >= 960 && !mobileMenu.hidden) setMobileMenu(false);
      updateProductStack();
      updateHeroParallax();
      stopTeamSpring();
      lastTeamScrollY = scrollY;
      stopWheel();
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
