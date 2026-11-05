/* ============================================================
    ONBOARDING — reusable controller ( serif base)
   ------------------------------------------------------------
   Drives the multi-step founder-narrative onboarding. Extension-
   agnostic: step count and labels are read from the DOM, so the
   same file drives a 4-step or an 8-step flow with no edits.
   ------------------------------------------------------------
   Works packaged (chrome.*) AND standalone (file:// preview) via
   graceful fallbacks. Preserves the fleet conventions so the SW
   snippets + phase-3 i18n keep working unchanged:
     storage  defif0f1_onboardingComplete / defif0f1_onboardingPrefs /
              defif0f1_onboardingConfig (runtime overrides)
     i18n     [data-i18n="key"] → chrome.i18n.getMessage(key)
     events   chrome.runtime → { type:'DEFIF0F1_ONBOARDING_EVENT' }
   ------------------------------------------------------------
   DOM contract (what a bespoke onboarding.html must provide):
     .step[data-step="N"]           one per step, N = 1..TOTAL
       [data-next="Label"]          (optional) next-button label
       [data-role="pricing"]        (optional) step that converts
     #nextBtn #nextLabel #backBtn   bottom nav
     #counter #progressFill         indicator + progress bar
     .dot[data-step="N"]            one per step (jump nav)
   Optional wired-by-convention blocks (present → auto-wired):
     #planSeg[data-plans='{...}'][data-upgrade-url]  pricing toggle
     .faq-item > .faq-q + .faq-a                     FAQ accordion
     [data-demo-fill] + .ffrow[data-v]               fill demo
     .chip input[data-field]  /  #defif0f1-perm-prime    prefs / perms
   Rules: no eval, textContent only on dynamic strings, bounded
   loops, functions <= 60 lines, guarded returns.
   ============================================================ */
(function () {
  'use strict';

  var STORAGE_DONE = 'defif0f1_onboardingComplete';
  var STORAGE_PREFS = 'defif0f1_onboardingPrefs';
  var STORAGE_CONFIG = 'defif0f1_onboardingConfig';
  var MSG_TRACK = 'DEFIF0F1_ONBOARDING_EVENT';
  var DEFAULT_UPGRADE = '';

  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var dots = Array.prototype.slice.call(document.querySelectorAll('.dot'));
  var TOTAL = steps.length || 1;
  var current = 1;
  var plan = null;

  var $ = function (id) { return document.getElementById(id); };
  var nextBtn = $('nextBtn'), backBtn = $('backBtn'), nextLabel = $('nextLabel');
  var counter = $('counter'), fillBar = $('progressFill');

  function hasChrome() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  /* ---- storage (promisified, degrade gracefully) ---- */
  function sGet(key) {
    return new Promise(function (res) {
      if (!hasChrome()) { res(null); return; }
      chrome.storage.local.get(key, function (r) { res(r ? r[key] : null); });
    });
  }
  function sSet(obj) {
    return new Promise(function (res) {
      if (!hasChrome()) { res(); return; }
      chrome.storage.local.set(obj, function () { res(); });
    });
  }

  /* ---- analytics (fire-and-forget, never throws) ---- */
  function track(event, props) {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
      chrome.runtime.sendMessage({ type: MSG_TRACK, event: event, props: props || {} },
        function () { void chrome.runtime.lastError; });
    } catch (e) { /* no receiver */ }
  }

  /* ---- step meta read from the DOM ---- */
  function stepEl(n) { return document.querySelector('.step[data-step="' + n + '"]'); }
  function stepRole(n) { var s = stepEl(n); return s ? (s.getAttribute('data-role') || '') : ''; }
  function nextText(n) {
    var s = stepEl(n);
    var label = s && s.getAttribute('data-next');
    if (label) return label;
    if (n >= TOTAL) return 'Get started';
    return 'Continue';
  }

  /* ---- navigation ---- */
  function render() {
    for (var i = 0; i < steps.length; i++) {
      steps[i].classList.toggle('active', +steps[i].dataset.step === current);
    }
    for (var j = 0; j < dots.length; j++) {
      var n = +dots[j].dataset.step;
      dots[j].classList.toggle('active', n === current);
      dots[j].classList.toggle('done', n < current);
    }
    if (counter) counter.textContent = pad(current) + ' / ' + pad(TOTAL);
    if (fillBar) fillBar.style.width = (current / TOTAL) * 100 + '%';
    if (backBtn) backBtn.hidden = current === 1;
    if (nextLabel) nextLabel.textContent = nextText(current);
    if (nextBtn) { var a = nextBtn.querySelector('svg'); if (a) a.style.display = stepRole(current) === 'pricing' ? 'none' : ''; }
    if (stepRole(current) === 'demo-fill') resetFill(current);
    track('onboarding_step', { step: current });
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function go(n) { current = Math.max(1, Math.min(TOTAL, n)); render(); }

  function onNext() {
    if (stepRole(current) === 'setup') savePrefs();
    if (stepRole(current) === 'pricing') { convert(); return; }
    if (current >= TOTAL) { finish(); return; }
    go(current + 1);
  }

  function bindNav() {
    if (nextBtn) nextBtn.addEventListener('click', onNext);
    if (backBtn) backBtn.addEventListener('click', function () { go(current - 1); });
    for (var i = 0; i < dots.length; i++) {
      (function (d) { d.addEventListener('click', function () { go(+d.dataset.step); }); })(dots[i]);
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' && current < TOTAL) go(current + 1);
      if (e.key === 'ArrowLeft' && current > 1) go(current - 1);
    });
  }

  /* ---- fill demo: [data-demo-fill] fills .ffrow[data-v] in its step ---- */
  function fillRows(scope) {
    return Array.prototype.slice.call(scope.querySelectorAll('.ffrow[data-v]'));
  }
  function resetFill(n) {
    var s = stepEl(n); if (!s) return;
    var rows = fillRows(s), cnt = s.querySelector('[data-fill-count]');
    if (cnt) cnt.textContent = '0 of ' + rows.length + ' filled';
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.remove('filled', 'filling');
      var v = rows[i].querySelector('.ffval'); if (v) v.textContent = '';
      if (v) { var ph = document.createElement('span'); ph.className = 'ph'; ph.textContent = 'empty'; v.appendChild(ph); }
    }
    var b = s.querySelector('[data-demo-fill]'); if (b) { b.disabled = false; b.style.opacity = ''; }
  }
  function bindFill() {
    var btns = document.querySelectorAll('[data-demo-fill]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var s = btn.closest('.step'); if (!s || btn.disabled) return;
          var rows = fillRows(s), cnt = s.querySelector('[data-fill-count]');
          btn.disabled = true; btn.style.opacity = '.55';
          rows.forEach(function (r, i) {
            setTimeout(function () {
              r.classList.add('filling');
              setTimeout(function () {
                r.classList.remove('filling'); r.classList.add('filled');
                var v = r.querySelector('.ffval'); if (v) v.textContent = r.dataset.v || '';
                if (cnt) cnt.textContent = (i + 1) + ' of ' + rows.length + ' filled';
              }, 160);
            }, 180 * i);
          });
        });
      })(btns[i]);
    }
  }

  /* ---- setup step: persist selected fields + toggles ---- */
  function savePrefs() {
    var prefs = { fields: [], toggles: {} };
    var chips = document.querySelectorAll('.chip input[data-field]');
    for (var i = 0; i < chips.length; i++) { if (chips[i].checked) prefs.fields.push(chips[i].dataset.field); }
    var tgls = document.querySelectorAll('.tgl input[id], [data-config]');
    for (var j = 0; j < tgls.length; j++) {
      var key = tgls[j].id || tgls[j].getAttribute('data-config'); if (key) prefs.toggles[key] = !!tgls[j].checked;
    }
    var patch = {}; patch[STORAGE_PREFS] = prefs;
    track('onboarding_setup', { fields: prefs.fields.length });
    return sSet(patch);
  }

  /* ---- pricing: seg toggle + FAQ + convert ---- */
  function bindPricing() {
    var seg = $('planSeg'); if (!seg) return;
    var plans = readJSON(seg.getAttribute('data-plans')) || {};
    var order = Object.keys(plans);
    plan = order[0] || null;
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-plan]'); if (!btn) return;
      plan = btn.dataset.plan;
      var all = seg.querySelectorAll('button');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i] === btn);
      applyPlan(plans[plan] || {});
      if (stepRole(current) === 'pricing' && nextLabel) nextLabel.textContent = nextText(current);
    });
  }
  function applyPlan(p) {
    setText('priceAmt', p.amt); setText('pricePer', p.per);
    setText('priceSub', p.sub); setText('reassure1', p.r1);
    var be = $('breakeven'); if (be) be.style.display = p.breakeven ? '' : 'none';
    if (p.breakeven) setText('breakeven', p.breakeven);
  }
  function setText(id, v) { var el = $(id); if (el && typeof v === 'string') el.textContent = v; }
  function readJSON(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }

  function bindFAQ() {
    var items = document.querySelectorAll('.faq-item');
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var q = item.querySelector('.faq-q'), a = item.querySelector('.faq-a');
        if (!q || !a) return;
        q.addEventListener('click', function () {
          var open = item.classList.toggle('open');
          a.style.maxHeight = open ? a.scrollHeight + 'px' : '0';
        });
      })(items[i]);
    }
  }

  function upgradeUrl() {
    var seg = $('planSeg');
    var base = (seg && seg.getAttribute('data-upgrade-url')) ||
      document.body.getAttribute('data-upgrade-url') || DEFAULT_UPGRADE;
    return base + (base.indexOf('?') < 0 ? '?' : '&') + 'plan=' + encodeURIComponent(plan || 'lifetime');
  }
  function convert() {
    if (hasChrome()) { try { chrome.storage.local.set({ defif0f1_upgradeIntentAt: Date.now(), defif0f1_upgradePlan: plan }); } catch (e) {} }
    track('onboarding_pro_click', { plan: plan });
    var url = upgradeUrl();
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) { try { chrome.tabs.create({ url: url }); } catch (e) { window.open(url, '_blank', 'noopener'); } }
    else window.open(url, '_blank', 'noopener');
    if (current < TOTAL) go(current + 1);
  }

  /* ---- finish ---- */
  function finish() {
    savePrefs();
    sSet(mk(STORAGE_DONE, true)).then(function () {
      track('onboarding_complete', { step: current });
      closeTab();
    });
  }
  function mk(k, v) { var o = {}; o[k] = v; return o; }
  function closeTab() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.getCurrent) {
      chrome.tabs.getCurrent(function (t) { if (t && t.id != null) chrome.tabs.remove(t.id); else window.close(); });
      return;
    }
    if (nextLabel) nextLabel.textContent = 'Done ✓';
    window.close();
  }

  /* ---- i18n + runtime config overrides ---- */
  function applyI18n() {
    if (typeof chrome === 'undefined' || !chrome.i18n || !chrome.i18n.getMessage) return;
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var msg = chrome.i18n.getMessage(nodes[i].getAttribute('data-i18n'));
      if (msg) nodes[i].textContent = msg;
    }
  }
  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    var slots = document.querySelectorAll('[data-slot]');
    for (var i = 0; i < slots.length; i++) {
      var k = slots[i].getAttribute('data-slot');
      if (typeof cfg[k] === 'string') slots[i].textContent = cfg[k];
    }
    if (typeof cfg.upgradeUrl === 'string') document.body.setAttribute('data-upgrade-url', cfg.upgradeUrl);
    if (cfg.plans && $('planSeg')) $('planSeg').setAttribute('data-plans', JSON.stringify(cfg.plans));
    if (Array.isArray(cfg.permOrigins) && cfg.permOrigins.length) enablePerm(cfg.permOrigins);
  }

  /* ---- optional host-permission priming (from a user gesture) ---- */
  function enablePerm(origins) {
    var box = $('defif0f1-perm-prime'); if (!box) return;
    box.setAttribute('data-perm-origins', origins.join(',')); box.hidden = false;
  }
  function bindPerm() {
    var btn = $('defif0f1-btn-grant'), box = $('defif0f1-perm-prime'), status = $('defif0f1-perm-status');
    if (!btn || !box) return;
    btn.addEventListener('click', function () {
      var raw = (box.getAttribute('data-perm-origins') || '').trim();
      var origins = raw ? raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
      if (!origins.length) { setStatus(status, 'No hosts configured.', 'err'); return; }
      if (typeof chrome === 'undefined' || !chrome.permissions) { setStatus(status, 'Permissions unavailable.', 'err'); return; }
      btn.disabled = true;
      chrome.permissions.request({ origins: origins }, function (granted) {
        btn.disabled = false;
        if ((chrome.runtime && chrome.runtime.lastError) || !granted) { setStatus(status, 'Not enabled — you can enable it later in Settings.', 'err'); track('onboarding_perm_denied', {}); return; }
        setStatus(status, 'Access enabled.', 'ok'); btn.disabled = true; track('onboarding_perm_granted', {});
      });
    });
  }
  function setStatus(el, text, kind) {
    if (!el) return; el.textContent = text;
    el.classList.remove('defif0f1-perm-status--ok', 'defif0f1-perm-status--err');
    if (kind) el.classList.add('defif0f1-perm-status--' + kind);
  }

  /* ---- init ---- */
  function init() {
    applyI18n();
    sGet(STORAGE_CONFIG).then(function (cfg) {
      applyConfig(cfg);
      bindNav(); bindFill(); bindPricing(); bindFAQ(); bindPerm();
      try { var q = +new URLSearchParams(location.search).get('step'); if (q >= 1 && q <= TOTAL) current = q; } catch (e) {}
      render();
      track('onboarding_started', { total: TOTAL });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
