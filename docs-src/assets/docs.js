// The four things the built pages do once they are open: the drawer, the
// copy buttons, the table of contents that follows the reading, and the
// search.
//
// It is one file, it is not minified, and it is not required for any of the
// text to be readable — a page with this script blocked is a page with a
// navigation, a table of contents and code blocks that still say the same
// thing.

(function () {
  'use strict';

  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  /* ── The shortcut hint reads as what this keyboard actually has ─────── */

  document.querySelectorAll('[data-shortcut-hint]').forEach(function (node) {
    node.textContent = isMac ? '⌘ K' : 'Ctrl K';
  });

  /* ── Drawer ─────────────────────────────────────────────────────────── */

  var nav = document.getElementById('site-nav');
  var scrim = document.querySelector('.scrim');
  var openers = document.querySelectorAll('[data-open-drawer]');

  function setDrawer(open) {
    if (!nav) return;
    nav.classList.toggle('is-open', open);
    if (scrim) scrim.hidden = !open;
    openers.forEach(function (button) {
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      var first = nav.querySelector('a');
      if (first) first.focus();
    }
  }

  openers.forEach(function (button) {
    button.addEventListener('click', function () {
      setDrawer(true);
    });
  });

  document.querySelectorAll('[data-close-drawer]').forEach(function (button) {
    button.addEventListener('click', function () {
      setDrawer(false);
    });
  });

  // A link in the drawer is a navigation; the drawer should not survive it
  // on a phone, where the new page would open behind an open drawer.
  if (nav) {
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setDrawer(false);
    });
  }

  /* ── Copy a code block ──────────────────────────────────────────────── */

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var figure = button.closest('.code');
      var code = figure && figure.querySelector('code');
      if (!code) return;

      copyText(code.textContent).then(function (copied) {
        var label = button.querySelector('span');
        if (!label) return;
        var original = label.textContent;
        label.textContent = copied ? 'Copied' : 'Press Ctrl C';
        button.classList.toggle('is-done', copied);
        window.setTimeout(function () {
          label.textContent = original;
          button.classList.remove('is-done');
        }, 1500);
      });
    });
  });

  // navigator.clipboard is not there when the page is opened from a file://
  // path, which is exactly how somebody checks a site with the network off.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var done = false;
    try {
      done = document.execCommand('copy');
    } catch (error) {
      done = false;
    }
    document.body.removeChild(area);
    return done;
  }

  /* ── The table of contents follows the reading ──────────────────────── */

  var tocLinks = Array.prototype.slice.call(
    document.querySelectorAll('.toc .toc-list a')
  );

  if (tocLinks.length > 0 && 'IntersectionObserver' in window) {
    var byId = {};
    var headings = [];

    tocLinks.forEach(function (link) {
      var id = decodeURIComponent(link.getAttribute('href').slice(1));
      var heading = document.getElementById(id);
      if (!heading) return;
      byId[id] = link;
      headings.push(heading);
    });

    var visible = new Set();
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });

        var current = null;
        for (var i = 0; i < headings.length; i += 1) {
          if (visible.has(headings[i].id)) {
            current = headings[i].id;
            break;
          }
        }
        if (!current) return;

        tocLinks.forEach(function (link) {
          link.classList.remove('is-active');
        });
        if (byId[current]) byId[current].classList.add('is-active');
      },
      { rootMargin: '-72px 0px -70% 0px', threshold: 0 }
    );

    headings.forEach(function (heading) {
      observer.observe(heading);
    });
  }

  /* ── Search ─────────────────────────────────────────────────────────── */

  var palette = document.getElementById('palette');
  var input = document.getElementById('palette-input');
  var results = document.getElementById('palette-results');
  var lastFocus = null;
  var indexState = 'idle';
  var active = -1;

  function openSearch() {
    if (!palette) return;
    lastFocus = document.activeElement;
    palette.hidden = false;
    document.body.style.overflow = 'hidden';
    loadIndex();
    input.value = '';
    render([]);
    input.focus();
  }

  function closeSearch() {
    if (!palette || palette.hidden) return;
    palette.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.querySelectorAll('[data-open-search]').forEach(function (button) {
    button.addEventListener('click', openSearch);
  });

  document.querySelectorAll('[data-close-search]').forEach(function (button) {
    button.addEventListener('click', closeSearch);
  });

  document.addEventListener('keydown', function (event) {
    var key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'k') {
      event.preventDefault();
      if (palette && palette.hidden) openSearch();
      else closeSearch();
      return;
    }
    if (event.key === 'Escape') {
      closeSearch();
      setDrawer(false);
      return;
    }
    if (
      event.key === '/' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
    ) {
      event.preventDefault();
      openSearch();
    }
  });

  // The index is a second file, and it is fetched by adding a script tag
  // rather than by fetch(), because fetch() of a neighbouring file is
  // refused when the site is opened from disk and the search would then be
  // a search box that cannot search.
  function loadIndex() {
    if (indexState !== 'idle') return;
    indexState = 'loading';
    var script = document.createElement('script');
    script.src = 'assets/search.js';
    script.onload = function () {
      indexState = 'ready';
      if (input.value) search(input.value);
    };
    script.onerror = function () {
      indexState = 'failed';
      results.innerHTML =
        '<p class="palette-empty">The search index did not load. Every page is still in the navigation.</p>';
    };
    document.head.appendChild(script);
  }

  if (input) {
    input.addEventListener('input', function () {
      search(input.value);
    });

    input.addEventListener('keydown', function (event) {
      var items = results.querySelectorAll('.palette-result');
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (items.length === 0) return;
        active += event.key === 'ArrowDown' ? 1 : -1;
        if (active < 0) active = items.length - 1;
        if (active >= items.length) active = 0;
        highlightActive(items);
        return;
      }
      if (event.key === 'Enter') {
        var target = items[active] || items[0];
        if (target) {
          event.preventDefault();
          window.location.href = target.getAttribute('href');
        }
      }
    });
  }

  function highlightActive(items) {
    Array.prototype.forEach.call(items, function (item, index) {
      item.classList.toggle('is-active', index === active);
      if (index === active) item.scrollIntoView({ block: 'nearest' });
    });
  }

  function search(query) {
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
      render([]);
      return;
    }
    if (indexState !== 'ready') {
      results.innerHTML = '<p class="palette-empty">Loading the index…</p>';
      return;
    }

    var index = window.GEEBOARD_SEARCH || [];
    var scored = [];

    for (var i = 0; i < index.length; i += 1) {
      var entry = index[i];
      var heading = entry.heading.toLowerCase();
      var page = entry.page.toLowerCase();
      var text = entry.text.toLowerCase();
      var score = 0;
      var matchedAll = true;

      for (var t = 0; t < terms.length; t += 1) {
        var term = terms[t];
        var here = 0;
        if (heading.indexOf(term) === 0) here += 14;
        else if (heading.indexOf(term) !== -1) here += 9;
        if (page.indexOf(term) !== -1) here += 4;
        if (text.indexOf(term) !== -1) here += 2;
        if (here === 0) {
          matchedAll = false;
          break;
        }
        score += here;
      }

      if (matchedAll) scored.push({ entry: entry, score: score });
    }

    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    render(scored.slice(0, 12).map(function (hit) {
      return hit.entry;
    }), terms);
  }

  function render(entries, terms) {
    if (!results) return;
    active = -1;

    if (!entries || entries.length === 0) {
      results.innerHTML = input && input.value
        ? '<p class="palette-empty">Nothing matches that.</p>'
        : '<p class="palette-empty">Type to search every page of the documentation.</p>';
      return;
    }

    results.innerHTML = entries
      .map(function (entry) {
        return (
          '<a class="palette-result" href="' + entry.href + '">' +
          '<span class="palette-result-meta">' + escapeHtml(entry.page) + ' · ' + escapeHtml(entry.section) + '</span>' +
          '<span class="palette-result-title">' + mark(entry.heading, terms) + '</span>' +
          '<span class="palette-result-text">' + mark(entry.text, terms) + '</span>' +
          '</a>'
        );
      })
      .join('');
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mark(text, terms) {
    var html = escapeHtml(text);
    if (!terms) return html;
    terms.forEach(function (term) {
      var safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp('(' + safe + ')', 'ig'), '<mark>$1</mark>');
    });
    return html;
  }
})();
