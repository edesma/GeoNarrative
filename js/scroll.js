/**
 * scroll.js — Scroll → Map Sync Engine
 * Watches narrative panel scroll position and fires map scene changes
 * when a section crosses the active threshold.
 */

const ScrollEngine = (() => {

  let sections    = [];
  let activeIndex = -1;
  let onActivate  = null;
  let ticking     = false;
  let lastScrollTop = 0;

  // Trigger thresholds as fraction of panel height.
  // Scrolling DOWN: activate a section when its top crosses 38% mark.
  // Scrolling UP:   re-activate the previous section when the current
  //                 section's top rises BELOW 60% mark (earlier handoff).
  const TRIGGER_DOWN = 0.38;
  const TRIGGER_UP   = 0.60;

  // ── Init ─────────────────────────────────────────────────────────

  function init(sectionEls, storyData, activateCallback) {
    sections   = Array.from(sectionEls);
    onActivate = activateCallback;

    const panel = document.getElementById('narrative-panel');
    lastScrollTop = panel.scrollTop;
    panel.addEventListener('scroll', onScroll, { passive: true });

    // Activate first section immediately
    activateSection(0);
  }

  // ── Scroll handler ───────────────────────────────────────────────

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(processScroll);
      ticking = true;
    }
  }

  function processScroll() {
    ticking = false;

    const panel      = document.getElementById('narrative-panel');
    const panelRect  = panel.getBoundingClientRect();
    const scrollTop  = panel.scrollTop;
    const scrollH    = panel.scrollHeight - panel.clientHeight;

    // Detect scroll direction
    const scrollingDown = scrollTop >= lastScrollTop;
    lastScrollTop = scrollTop;

    // Progress bar
    const pct = scrollH > 0 ? (scrollTop / scrollH) * 100 : 0;
    document.getElementById('progress-fill').style.width = pct + '%';

    // Choose trigger line based on direction
    const ratio    = scrollingDown ? TRIGGER_DOWN : TRIGGER_UP;
    const triggerY = panelRect.top + panelRect.height * ratio;

    // Find the deepest section whose top is above the trigger line
    let candidate = 0;
    for (let i = 0; i < sections.length; i++) {
      const rect = sections[i].getBoundingClientRect();
      if (rect.top <= triggerY) {
        candidate = i;
      }
    }
    
    if (candidate !== activeIndex) {
      activateSection(candidate);
    }
  }

  // ── Activate section ─────────────────────────────────────────────

  function activateSection(index) {
    if (index === activeIndex) return;
    activeIndex = index;

    // Update DOM active state
    sections.forEach((el, i) => {
      el.classList.toggle('active', i === index);
    });

    // Fire callback → app.js → map
    if (onActivate) onActivate(index);

    // Update chapter nav buttons
    document.querySelectorAll('.chapter-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === index);
    });
  }

  // ── Jump to section (from nav click) ─────────────────────────────

  function jumpTo(index) {
    const panel = document.getElementById('narrative-panel');
    const el    = sections[index];
    if (!el) return;

    panel.scrollTo({
      top:      el.offsetTop - 20,
      behavior: 'smooth',
    });
  }

  // ── Public API ───────────────────────────────────────────────────
  return { init, jumpTo };

})();