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
      <div class="scroll" id="subScroll"></div>`;
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
  }

  function back() {
    const leaving = stack.pop();
    if (leaving && ORBIT.routes[leaving].onLeave) ORBIT.routes[leaving].onLeave();
    if (stack.length) buildSub(current());
    else { $('#sub').hidden = true; contentEl = null; }
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
  todoHdr.querySelector('[data-route="analytics"]').innerHTML = icon('chart');
  todoHdr.querySelector('[data-act="launcher"]').innerHTML = icon('grid');
  todoHdr.querySelector('[data-route="settings"]').innerHTML = icon('gear');
  todoHdr.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'open') open(b.dataset.route);
    if (b.dataset.act === 'launcher') toggleLauncher(true);
  });

  const LAUNCH = [['projects', 'folder', 'Projects'], ['review', 'review', 'Review'], ['reading', 'book', 'Reading'], ['habits', 'habit', 'Habits']];
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

  /* ---------- 向き: 横画面（タッチ端末）で 3D ホーム ----------
     ビューポートの縦横比ではなく端末の向きで判定する（キーボード表示で縦横比が変わっても切り替えないため）。 */
  const coarse = matchMedia('(pointer: coarse)');
  function isLandscape() {
    if (location.hash === '#orbit') return true;
    if (!coarse.matches) return false;
    if (screen.orientation && screen.orientation.type) return screen.orientation.type.startsWith('landscape');
    return Math.abs(window.orientation || 0) === 90;
  }
  function syncOrientation() {
    const want = isLandscape() && !store.state.focus;
    ORBIT.home3d.setVisible(want);
  }
  if (screen.orientation) screen.orientation.addEventListener('change', syncOrientation);
  window.addEventListener('orientationchange', syncOrientation);
  window.addEventListener('hashchange', syncOrientation);
  window.addEventListener('resize', () => { if (location.hash === '#orbit') syncOrientation(); });

  /* ---------- 起動 ---------- */
  ORBIT.todo.init();
  ORBIT.focus.init();
  ORBIT.home3d.init();

  store.subscribe((state) => {
    ORBIT.todo.render(state);
    render();
    ORBIT.focus.render(state);
    ORBIT.home3d.render(state);
    syncOrientation();
  });
  const s = store.state;
  ORBIT.todo.render(s);
  ORBIT.focus.render(s);
  ORBIT.home3d.render(s);
  syncOrientation();

  if (ORBIT.loadError) ORBIT.ui.toast('保存データを読み込めませんでした。元データは退避済みです（設定から確認できます）');

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('ORBIT: SW', e)));
  }
})();
