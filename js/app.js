/* ORBIT — 起動・画面遷移・向きによる 3D ホーム切替 */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const { $, icon, esc } = ORBIT.ui;
  const store = ORBIT.store;

  /* ---------- 機能画面のスタック ---------- */
  const stack = [];
  let contentEl = null;
  let armed = false;
  function armBack() {
    if (armed) return;
    armed = true;
    history.pushState({ orbit: 1 }, '');
  }

  function current() { return stack[stack.length - 1] || null; }

  function buildSub(name) {
    const route = ORBIT.routes[name];
    const sub = $('#sub');
    sub.innerHTML = `<header class="sub-hdr"><button class="ib" data-hdr="back" aria-label="戻る">${icon('back')}</button>
      <h2>${esc(route.title)}</h2><div class="hdr-actions" style="display:flex">${route.header ? route.header() : '<span class="spacer"></span>'}</div></header>
      <div class="scroll" id="subScroll"></div>${route.fab ? `<button class="fab" data-hdr="add" aria-label="${esc(route.fab)}">${icon('plus')}</button>` : ''}`;
    contentEl = $('#subScroll');
    if (route.mount) route.mount(contentEl);
    sub.hidden = false;
    sub.classList.remove('layer');
    void sub.offsetWidth;
    sub.classList.add('layer');
    render();
  }

  function open(name, { replace = false } = {}) {
    if (!ORBIT.routes[name]) return;
    const prev = current();
    if (prev && ORBIT.routes[prev].onLeave) ORBIT.routes[prev].onLeave();
    if (replace && stack.length) stack.pop();
    stack.push(name);
    armBack();
    buildSub(name);
    paintSide();
  }

  function back() {
    const leaving = stack.pop();
    if (leaving && ORBIT.routes[leaving].onLeave) ORBIT.routes[leaving].onLeave();
    if (stack.length) buildSub(current());
    else { $('#sub').hidden = true; contentEl = null; }
    paintSide();
  }

  function render() {
    const name = current();
    if (name && contentEl) {
      const scroll = contentEl.scrollTop;
      ORBIT.routes[name].render(store.state, contentEl);
      contentEl.scrollTop = scroll;
    }
  }

  function refreshHeader() {
    const name = current();
    if (!name) return;
    const holder = $('#sub .hdr-actions');
    holder.innerHTML = ORBIT.routes[name].header ? ORBIT.routes[name].header() : '<span class="spacer"></span>';
  }

  /* ---------- PC: 左サイドバー ---------- */
  const SIDE = [['todo', 'check', 'ToDo'], ['projects', 'folder', 'プロジェクト'], ['review', 'review', '復習'], ['reading', 'book', '読書'],
    ['habits', 'habit', '習慣'], ['schedule', 'cal', 'スケジュール'], ['memos', 'note', 'メモ'], ['analytics', 'chart', '統計']];
  function paintSide() {
    const side = $('#side');
    const cur = current() || 'todo';
    side.innerHTML = `<div class="brand">ORB<b>I</b>T</div>
      ${SIDE.map(([r, ic, label]) => `<button class="nav ${r === cur ? 'on' : ''}" data-go="${r}">${icon(ic)}${label}</button>`).join('')}
      <div class="sp"></div>
      <button class="nav ${cur === 'settings' ? 'on' : ''}" data-go="settings">${icon('gear')}設定</button>
      <div class="keys"><kbd>N</kbd> 新しいタスク　<kbd>M</kbd> メモ　<kbd>B</kbd> サイドバー</div>
      <button class="collapse" data-collapse aria-label="サイドバーを閉じる">${icon('back')}</button>`;
  }
  // サイドバーの開閉は端末ごとの好みなので localStorage に持つ（同期しない）。
  function setSide(collapsed) {
    document.body.classList.toggle('side-collapsed', collapsed);
    try { localStorage.setItem('orbit.side', collapsed ? '0' : '1'); } catch (_) { /* 保存できなくても動く */ }
  }
  try { if (localStorage.getItem('orbit.side') === '0') document.body.classList.add('side-collapsed'); } catch (_) { /* 既定は開く */ }
  $('#sideOpen').innerHTML = icon('chev');
  $('#sideOpen').addEventListener('click', () => setSide(false));
  $('#side').addEventListener('click', (e) => {
    if (e.target.closest('[data-collapse]')) { setSide(true); return; }
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const to = b.dataset.go;
    if (to === (current() || 'todo')) return;
    if (to === 'todo') { while (stack.length) back(); return; }
    if (stack.length) open(to, { replace: true }); else open(to);
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || ORBIT.ui.sheetOpen()) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (!$('#auth').hidden || store.state.focus) return;
    if (e.key === 'n') { e.preventDefault(); ORBIT.todo.newTask(); }
    if (e.key === 'm') { e.preventDefault(); ORBIT.memo.open(); }
    if (e.key === 'b') { e.preventDefault(); setSide(!document.body.classList.contains('side-collapsed')); }
  });

  ORBIT.nav = { open, back, render, refreshHeader, current };

  $('#sub').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hdr]');
    if (!b) return;
    if (b.dataset.hdr === 'back') back();
    else ORBIT.routes[current()].onHeader && ORBIT.routes[current()].onHeader(b.dataset.hdr, b);
  });
  $('#sub').addEventListener('input', (e) => {
    const route = ORBIT.routes[current()];
    if (e.target.closest('.sub-hdr') && route && route.onHeaderInput) route.onHeaderInput(e);
  });
  // 端末の「戻る」用に履歴の番兵を 1 つだけ置く。history.back() は非同期で、連続操作すると履歴がずれて
  // ページ外へ出てしまうため、アプリ内の戻る操作では履歴に触れない。
  window.addEventListener('popstate', () => {
    armed = false;
    if (ORBIT.ui.sheetOpen()) ORBIT.ui.closeSheet();
    else if (stack.length) back();
    if (stack.length || ORBIT.ui.sheetOpen()) armBack();
  });

  /* ---------- ToDo ヘッダーとランチャー ---------- */
  const todoHdr = $('#todo .hdr');
  todoHdr.querySelector('[data-act="add"]').innerHTML = icon('plus');
  todoHdr.querySelector('[data-act="launcher"]').innerHTML = icon('grid');
  todoHdr.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'add') ORBIT.todo.newTask();
    if (b.dataset.act === 'open') open(b.dataset.route);
    if (b.dataset.act === 'launcher') toggleLauncher(true);
  });

  const LAUNCH = [['projects', 'folder', 'プロジェクト'], ['review', 'review', '復習'], ['reading', 'book', '読書'], ['habits', 'habit', '習慣'],
    ['schedule', 'cal', 'スケジュール'], ['memos', 'note', 'メモ'], ['analytics', 'chart', '統計'], ['settings', 'gear', '設定']];
  function toggleLauncher(show) {
    const el = $('#launcher');
    const scrim = $('#scrim');
    if (show) {
      el.innerHTML = LAUNCH.map(([r, ic, label]) => `<button role="menuitem" data-r="${r}">${icon(ic)}${label}</button>`).join('');
      el.hidden = false;
      scrim.hidden = false;
      requestAnimationFrame(() => scrim.classList.add('show'));
      scrim.onclick = () => toggleLauncher(false);
      el.querySelector('button').focus();
    } else {
      el.hidden = true;
      scrim.classList.remove('show');
      setTimeout(() => { if (!ORBIT.ui.sheetOpen()) scrim.hidden = true; }, 200);
    }
  }
  $('#launcher').addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    toggleLauncher(false);
    open(b.dataset.r);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#launcher').hidden) toggleLauncher(false);
    else if (ORBIT.ui.sheetOpen()) ORBIT.ui.closeSheet();
  });

  /* ---------- 起動 ---------- */
  ORBIT.todo.init();
  paintSide();
  ORBIT.focus.init();

  store.subscribe((state) => {
    ORBIT.todo.render(state);
    render();
    ORBIT.focus.render(state);
  });
  const s = store.state;
  ORBIT.todo.render(s);
  ORBIT.focus.render(s);

  ORBIT.account.init();

  if (ORBIT.loadError) ORBIT.ui.toast('保存データを読み込めませんでした。元データは退避済みです（設定から確認できます）');

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('ORBIT: SW', e)));
  }
})();
