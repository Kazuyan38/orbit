/* ORBIT — UI 共通部品（アイコン・シート・トースト・長押し並べ替え） */
(function () {
  'use strict';
  const ORBIT = (window.ORBIT = window.ORBIT || {});

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const P = {
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
    move: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5"/>',
    review: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5"/><path d="M12 8v4l2.5 2"/>',
    note: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h8M8 18h4"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16H6.5A1.5 1.5 0 0 0 5 20.5zM5 20.5A1.5 1.5 0 0 0 6.5 22H19"/>',
    habit: '<path d="M12 3l2.6 2 3.3-.2.9 3.2 2.7 1.9-1.2 3.1 1.2 3.1-2.7 1.9-.9 3.2-3.3-.2L12 21l-2.6-2-3.3.2-.9-3.2-2.7-1.9L3.7 11 2.5 7.9l2.7-1.9.9-3.2 3.3.2z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    skip: '<path d="M6 5l9 7-9 7zM18 5v14"/>',
    reset: '<path d="M4 12a8 8 0 1 0 8-8M4 4v5h5"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    turtle: '<path d="M4 15c0-4 3.5-7 8-7s8 3 8 7zM8 15v3M16 15v3M20 13h2"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  };
  function icon(name, cls = '') {
    return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
  }

  const COLORS = {
    blue: '#3B82F6', purple: '#8B5CF6', green: '#22C55E', orange: '#F97316',
    pink: '#EC4899', yellow: '#EAB308', cyan: '#06B6D4', red: '#EF4444',
  };
  const COLOR_LABEL = { blue: 'ブルー', purple: 'パープル', green: 'グリーン', orange: 'オレンジ', pink: 'ピンク', yellow: 'イエロー', cyan: 'シアン', red: 'レッド' };
  const URGENCY = { 1: 'できるだけ早く', 2: 'なるべく早めに', 3: '通常', 4: 'ゆっくりでいい' };

  function haptic(kind = 'light') {
    if (navigator.vibrate) navigator.vibrate(kind === 'success' ? [12, 40, 12] : 8);
  }

  function today() { return OrbitCore.Dates.dayKey(Date.now()); }

  function fmtDue(key) {
    if (!key) return '';
    const diff = OrbitCore.Dates.diffDays(today(), key);
    if (diff === 0) return '今日';
    if (diff === 1) return '明日';
    if (diff === -1) return '昨日';
    const [y, m, d] = key.split('-').map(Number);
    return y === new Date().getFullYear() ? `${m}/${d}` : `${y}/${m}/${d}`;
  }

  function fmtDuration(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min}分`;
    const h = Math.floor(min / 60);
    return min % 60 ? `${h}時間${min % 60}分` : `${h}時間`;
  }

  function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  /* ---------- sheet ---------- */
  let sheetOnClose = null;
  let closeTimer = 0;
  function openSheet({ title = '', html = '', done = null, doneLabel = '保存', cancelLabel = '閉じる', onMount = null, onClose = null }) {
    const sheet = $('#sheet');
    const scrim = $('#scrim');
    clearTimeout(closeTimer);
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sh-hdr"><button class="txt" data-sheet="cancel">${esc(cancelLabel)}</button><h3>${esc(title)}</h3>
      ${done ? `<button class="txt strong" data-sheet="done">${esc(doneLabel)}</button>` : '<span class="txt"></span>'}</div>
      <div class="sh-body">${html}</div>`;
    sheet.hidden = false;
    scrim.hidden = false;
    sheetOnClose = onClose;
    requestAnimationFrame(() => { sheet.classList.add('show'); scrim.classList.add('show'); });
    sheet.querySelector('[data-sheet="cancel"]').onclick = () => closeSheet();
    const doneBtn = sheet.querySelector('[data-sheet="done"]');
    if (doneBtn) doneBtn.onclick = () => { if (done(sheet.querySelector('.sh-body')) !== false) closeSheet(); };
    scrim.onclick = () => closeSheet();
    if (onMount) onMount(sheet.querySelector('.sh-body'));
    return sheet.querySelector('.sh-body');
  }
  function closeSheet() {
    const sheet = $('#sheet');
    const scrim = $('#scrim');
    if (sheet.hidden) return;
    sheet.classList.remove('show');
    scrim.classList.remove('show');
    const cb = sheetOnClose;
    sheetOnClose = null;
    closeTimer = setTimeout(() => { sheet.hidden = true; scrim.hidden = true; sheet.innerHTML = ''; }, 260);
    if (cb) cb();
  }
  const sheetOpen = () => !$('#sheet').hidden;

  /* ---------- toast ---------- */
  let toastTimer = 0;
  function toast(message, undo) {
    const el = $('#toast');
    el.querySelector('.msg').textContent = message;
    const btn = el.querySelector('button');
    btn.hidden = !undo;
    btn.onclick = () => { hideToast(); undo && undo(); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 5000 : 2200);
  }
  function hideToast() { $('#toast').classList.remove('show'); }

  /* ---------- 長押しドラッグ並べ替え ----------
     container 内の [data-id] 行を長押し（350ms）で持ち上げ、縦に動かして離すと onDrop(新しい id 配列) を呼ぶ。
     options.dropTargets: 指定すると、行の上に重ねたときに「その中へ入れる」ドロップも扱う（プロジェクトツリー用）。 */
  function sortable(container, { item = '[data-id]', handleIgnore = 'button, input, a, .chk', onDrop, canDrag = () => true,
    dropInto = null, onHoverInto = null } = {}) {
    let pressTimer = 0, drag = null, startY = 0, startX = 0, pointerId = null;

    container.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const row = e.target.closest(item);
      if (!row || !container.contains(row) || e.target.closest(handleIgnore) || !canDrag(row)) return;
      startY = e.clientY; startX = e.clientX; pointerId = e.pointerId;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => begin(row, e), 350);
    });
    const cancelPress = (e) => {
      if (!drag && (Math.abs(e.clientY - startY) > 8 || Math.abs(e.clientX - startX) > 8)) clearTimeout(pressTimer);
    };
    container.addEventListener('pointermove', cancelPress);
    // touch-action は pointerdown 時点で確定するため、持ち上げ後のスクロールは touchmove を止めて抑える（iOS Safari）。
    container.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
    container.addEventListener('contextmenu', (e) => { if (e.target.closest(item)) e.preventDefault(); });
    window.addEventListener('pointerup', () => clearTimeout(pressTimer));
    window.addEventListener('pointercancel', () => { clearTimeout(pressTimer); if (drag) finish(true); });

    function begin(row) {
      const rows = $$(item, container).filter((r) => r.parentElement === row.parentElement);
      const rects = rows.map((r) => r.getBoundingClientRect());
      drag = { row, rows, rects, index: rows.indexOf(row), target: rows.indexOf(row), into: null, hoverTimer: 0 };
      row.classList.add('lift');
      rows.forEach((r) => r !== row && r.classList.add('shift'));
      haptic();
      try { row.setPointerCapture(pointerId); } catch (_) { /* pointer already released */ }
      row.addEventListener('pointermove', move);
      row.addEventListener('pointerup', up, { once: true });
      document.body.style.touchAction = 'none';
      container.style.overflow = 'hidden';
    }
    function move(e) {
      if (!drag) return;
      e.preventDefault();
      const dy = e.clientY - startY;
      drag.row.style.transform = `translateY(${dy}px) scale(1.02)`;
      const { rects, index } = drag;
      const h = rects[index].height;
      const centerY = rects[index].top + h / 2 + dy;
      let into = null;
      if (dropInto) {
        const over = drag.rows.find((r, i) => i !== index && centerY > rects[i].top + rects[i].height * 0.28 && centerY < rects[i].bottom - rects[i].height * 0.28);
        if (over && dropInto(drag.row, over)) into = over;
      }
      if (into !== drag.into) {
        drag.into && drag.into.classList.remove('drop-target');
        clearTimeout(drag.hoverTimer);
        drag.into = into;
        if (into) {
          into.classList.add('drop-target');
          if (onHoverInto) drag.hoverTimer = setTimeout(() => onHoverInto(into), 650);
        }
      }
      let target = index;
      rects.forEach((r, i) => {
        const mid = r.top + r.height / 2;
        if (i < index && centerY < mid) target = Math.min(target, i);
        if (i > index && centerY > mid) target = Math.max(target, i);
      });
      drag.target = into ? index : target;
      drag.rows.forEach((r, i) => {
        if (i === index) return;
        let shift = 0;
        if (!into && index < drag.target && i > index && i <= drag.target) shift = -h;
        if (!into && index > drag.target && i >= drag.target && i < index) shift = h;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    }
    function up() { finish(false); }
    function finish(cancelled) {
      const d = drag;
      drag = null;
      if (!d) return;
      clearTimeout(d.hoverTimer);
      d.row.removeEventListener('pointermove', move);
      document.body.style.touchAction = '';
      container.style.overflow = '';
      d.rows.forEach((r) => { r.style.transform = ''; r.classList.remove('shift', 'lift', 'drop-target'); });
      if (cancelled) return;
      if (d.into) { onDrop({ into: d.into.dataset.id, id: d.row.dataset.id, row: d.row, target: d.into }); return; }
      if (d.target === d.index) return;
      const ids = d.rows.map((r) => r.dataset.id);
      const [moved] = ids.splice(d.index, 1);
      ids.splice(d.target, 0, moved);
      onDrop({ ids, id: moved, row: d.row, index: d.target, rows: d.rows });
    }
  }

  ORBIT.ui = { $, $$, esc, icon, COLORS, COLOR_LABEL, URGENCY, haptic, today, fmtDue, fmtDuration, fmtClock,
    openSheet, closeSheet, sheetOpen, toast, hideToast, sortable };
})();
