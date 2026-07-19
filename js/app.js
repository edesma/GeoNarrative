/**
 * app.js — Main Application Orchestrator
 * Reads STORY_DATA, builds UI, wires scroll engine to map controller.
 */

(function () {
  'use strict';

  const story = window.STORY_DATA;
  if (!story) { console.error('No STORY_DATA found.'); return; }

  // ── Build narrative sections ──────────────────────────────────────

  function buildSections() {
    const container = document.getElementById('sections-container');
    const nav       = document.getElementById('chapter-nav');
    container.innerHTML = '';
    nav.innerHTML = '';

    story.sections.forEach((sec, i) => {
      const el = document.createElement('article');
      el.className = 'story-section' + (i === 0 ? ' intro' : '');
      el.dataset.index = i;

      let html = '';

      if (i > 0) {
        html += `<span class="section-number">Chapter ${i}</span>`;
      }
      if (sec.title) {
        html += `<h2 class="section-title">${escHtml(sec.title)}</h2>`;
      }
      if (i === 0) {
        html += `<div class="intro-divider"></div>`;
      }
      if (sec.image && sec.image.position !== 'after') {
        html += buildImageHtml(sec.image);
      }
      if (sec.text) {
        html += `<div class="section-text">${renderText(sec.text)}</div>`;
      }
      if (sec.callout) {
        html += `<blockquote class="section-callout">${escHtml(sec.callout)}</blockquote>`;
      }
      if (sec.image && sec.image.position === 'after') {
        html += buildImageHtml(sec.image);
      }

      el.innerHTML = html;
      el.addEventListener('click', () => ScrollEngine.jumpTo(i));
      container.appendChild(el);

      const btn = document.createElement('button');
      btn.className = 'chapter-btn';
      btn.textContent = sec.navLabel ?? sec.title ?? `Section ${i + 1}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        ScrollEngine.jumpTo(i);
      });
      nav.appendChild(btn);
    });
  }

  function buildImageHtml(img) {
    return `
      <figure class="section-image">
        <img src="${escHtml(img.src)}" alt="${escHtml(img.alt ?? '')}" loading="lazy" />
        ${img.caption ? `<figcaption>${escHtml(img.caption)}</figcaption>` : ''}
      </figure>
    `;
  }

  // Render section text to HTML paragraphs.
  // Paragraphs from Quill may contain real HTML tags OR accidentally
  // double-escaped entities (&lt;strong&gt;) saved before the fix.
  // We decode once through a textarea so either form renders correctly.
  function decodeHtml(str) {
    const el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
  }

  function renderText(text) {
    if (Array.isArray(text)) {
      return text.map(p => `<p>${decodeHtml(p)}</p>`).join('');
    }
    return text
      .split(/\n\n+/)
      .map(p => `<p>${decodeHtml(p.trim())}</p>`)
      .join('');
  }

  function escHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Section activate callback ─────────────────────────────────────

  function onSectionActivate(index) {
    const sec = story.sections[index];
    if (!sec) return;

    // Static media (image/PDF) replaces the live map for this section
    if (sec.scene?.media) {
      MapController.showMedia(sec.scene.media);
    } else {
      MapController.hideMedia();
      if (sec.scene) MapController.flyToScene(sec.scene);
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────

  function boot() {
    buildSections();
    MapController.init(story);

    const sectionEls = document.querySelectorAll('.story-section');
    ScrollEngine.init(sectionEls, story, onSectionActivate);

    // Fire initial state for section 0
    const first = story.sections?.[0];
    if (first?.scene?.media) {
      MapController.showMedia(first.scene.media);
    } else if (first?.scene) {
      MapController.flyToScene(first.scene);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
