// Breadcrumb trail — first extracted SPA module (no build step; plain <script>).
//
// Decoupled from portal.js on purpose: it derives the trail from the static
// sidebar nav in the DOM and from the URL hash, so it needs no internal app
// state. Because portal.js navigates with history.replaceState (which does NOT
// fire `hashchange`), we wrap pushState/replaceState to emit a `locationchange`
// event and render off that plus the native hash/popstate events.
(function () {
  'use strict';

  var container = document.getElementById('breadcrumbs');
  if (!container) return;

  function basePageFromHash() {
    var raw = String(location.hash || '').replace(/^#/, '');
    var path = raw.split('?')[0];
    var parts = path.split('/').filter(Boolean);
    return parts[0] || 'home';
  }

  function labelOf(el) {
    if (!el) return '';
    var labelSpan = el.querySelector('.nav-label');
    return ((labelSpan ? labelSpan.textContent : el.textContent) || '').trim();
  }

  function navInfo(page) {
    var links = document.querySelectorAll('.sidebar .nav-link[data-page]');
    var link = null;
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('data-page') === page) { link = links[i]; break; }
    }
    if (!link) return null;
    var group = '';
    var groupEl = link.closest ? link.closest('.nav-group') : null;
    if (groupEl) group = labelOf(groupEl.querySelector('.nav-parent'));
    return { label: labelOf(link), group: group };
  }

  function esc(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function hide() {
    container.hidden = true;
    container.innerHTML = '';
  }

  function render() {
    var page = basePageFromHash();
    if (page === 'home') return hide();
    var info = navInfo(page);
    if (!info) return hide();

    var crumbs = ['<a class="crumb crumb-link" href="#home">Home</a>'];
    if (info.group) crumbs.push('<span class="crumb crumb-group">' + esc(info.group) + '</span>');
    crumbs.push('<span class="crumb crumb-current" aria-current="page">' + esc(info.label) + '</span>');

    container.hidden = false;
    container.innerHTML = crumbs.join('<span class="crumb-sep" aria-hidden="true">&rsaquo;</span>');
  }

  // Make replaceState/pushState observable so in-app navigation re-renders.
  ['pushState', 'replaceState'].forEach(function (method) {
    var original = history[method];
    if (typeof original !== 'function') return;
    history[method] = function () {
      var result = original.apply(this, arguments);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
  });

  window.addEventListener('hashchange', render);
  window.addEventListener('popstate', render);
  window.addEventListener('locationchange', render);

  render();
})();
