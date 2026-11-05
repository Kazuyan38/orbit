/* ORBIT — 横画面の 3D Orbital Home
   サファイアは WebGL、タスクカードは DOM（タップ・読み上げ・文字の鮮明さのため）。
   カード位置は WebGL と同じビュー射影行列で投影して毎フレーム配置する。 */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const C = window.OrbitCore;
  const { $, esc, icon, haptic } = ORBIT.ui;
  const store = ORBIT.store;

  const RX = 3.1, RZ = 2.05;
  const FRONT = Math.PI / 2;            // カメラは +Z 側。sin(a)=1 の位置が手前
  const DEFAULT_VIEW = { pitch: 0.32, dist: 7.2 };

  let root, gem, cardsEl, emptyEl, holoEl;
  let visible = false;
  let tasks = [];
  const cards = new Map();              // taskId -> element
  let orbit = 0, orbitTarget = null, velocity = 0;
  let selected = null;
  const completing = new Set();

  function init() {
    root = $('#home3d');
    root.innerHTML = `<canvas class="gl" aria-hidden="true"></canvas>
      <div class="cards"></div>
      <div class="h3d-ctl tl"><button class="ib" data-h="reset" aria-label="視点をリセット">${icon('reset')}</button></div>
      <div class="h3d-ctl tr"><button class="ib" data-h="add" aria-label="タスクを追加">${icon('plus')}</button></div>
      <div class="h3d-empty" hidden>未完了のタスクはありません</div>
      <div class="h3d-brand">ORBIT</div>`;
    cardsEl = root.querySelector('.cards');
    emptyEl = root.querySelector('.h3d-empty');
    root.addEventListener('click', onClick);
    bindGestures();
  }

  function ensureGem() {
    if (gem) return;
    gem = ORBIT.Sapphire.create(root.querySelector('canvas.gl'), { ring: { rx: RX, rz: RZ }, gemScale: 1.2 });
    gem.setView(DEFAULT_VIEW);
    gem.onFrame(frame);
  }

  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    root.hidden = !v;
    if (v) {
      ensureGem();
      render(store.state);
      gem.start();
    } else if (gem) {
      gem.stop();                       // 非表示中は描画を止める（発熱・電池対策）
      closeHolo();
    }
  }

  function render(state) {
    if (!visible) return;
    tasks = C.orbitTasks(state, 6);
    const ids = new Set(tasks.map((t) => t.id));
    for (const [id, el] of cards) {
      if (!ids.has(id) && !completing.has(id)) { el.remove(); cards.delete(id); }
    }
    tasks.forEach((t, i) => {
      let el = cards.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'card';
        el.dataset.id = t.id;
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        cardsEl.appendChild(el);
        cards.set(t.id, el);
      }
      const sel = selected === t.id;
      el.classList.toggle('sel', sel);
      el.setAttribute('aria-label', `${i + 1}番目のタスク: ${t.title}`);
      el.innerHTML = `<div class="n num">${String(i + 1).padStart(2, '0')}</div><div class="t">${esc(t.title)}</div>
        ${sel ? `<div class="acts"><button data-c="done">${icon('check', 'sm')}完了</button><button data-c="detail">${icon('edit', 'sm')}詳細</button></div>` : ''}`;
    });
    if (selected && !ids.has(selected)) selected = null;
    emptyEl.hidden = tasks.length > 0;
  }

  function slotAngle(i, n) { return orbit + FRONT + (i / Math.max(n, 1)) * Math.PI * 2; }

  function frame(api) {
    const n = tasks.length;
    if (orbitTarget != null) {
      const d = orbitTarget - orbit;
      orbit += d * 0.14;
      if (Math.abs(d) < 0.002) { orbit = orbitTarget; orbitTarget = null; }
    } else if (Math.abs(velocity) > 0.0001) {
      orbit += velocity;
      velocity *= 0.92;
    }
    tasks.forEach((t, i) => {
      const el = cards.get(t.id);
      if (!el) return;
      const a = slotAngle(i, n);
      const p = api.project(Math.cos(a) * RX, 0.05, Math.sin(a) * RZ);
      if (!p) { el.style.opacity = '0'; return; }
      const near = api.view.dist - RZ, far = api.view.dist + RZ;
      const k = Math.max(0, Math.min(1, (far - p.depth) / (far - near)));   // 1 = 手前
      const scale = 0.62 + k * 0.48;
      el.style.transform = `translate(${p.x - 95}px, ${p.y - 40}px) scale(${scale.toFixed(3)})`;
      el.style.opacity = completing.has(t.id) ? '' : (0.28 + k * 0.72).toFixed(3);
      el.style.zIndex = String(Math.round(k * 100));
      el.style.filter = k < 0.35 ? `blur(${((0.35 - k) * 3).toFixed(2)}px)` : '';
    });
  }

  function bringToFront(id) {
    const i = tasks.findIndex((t) => t.id === id);
    if (i < 0) return;
    // slotAngle(i) が FRONT（mod 2π）になる最短の orbit
    const want = -(i / tasks.length) * Math.PI * 2;
    let d = (want - orbit) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    orbitTarget = orbit + d;
    velocity = 0;
  }

  function complete(id) {
    const el = cards.get(id);
    const task = store.state.tasks[id];
    if (!task) return;
    haptic('success');
    gem && gem.pulse();
    completing.add(id);
    if (el) el.classList.add('pulse');
    selected = null;
    setTimeout(() => {
      completing.delete(id);
      if (el) { el.remove(); cards.delete(id); }
      store.commit((s, now) => C.setCompleted(s, id, true, now), { undo: `「${task.title}」を完了しました` });
    }, 650);
  }

  function onClick(e) {
    const c = e.target.closest('[data-c]');
    const card = e.target.closest('.card');
    const h = e.target.closest('[data-h]');
    if (c && card) {
      e.stopPropagation();
      if (c.dataset.c === 'done') complete(card.dataset.id);
      if (c.dataset.c === 'detail') ORBIT.openTaskSheet(card.dataset.id);
      return;
    }
    if (card) {
      if (dragMoved) return;
      selected = selected === card.dataset.id ? null : card.dataset.id;
      if (selected) bringToFront(selected);
      render(store.state);
      return;
    }
    if (h) {
      if (h.dataset.h === 'reset') { gem.setView(DEFAULT_VIEW); bringToFront(tasks[0] && tasks[0].id); selected = null; render(store.state); }
      if (h.dataset.h === 'add') openHolo();
      return;
    }
    if (!dragMoved && selected && !e.target.closest('.holo-input')) { selected = null; render(store.state); }
  }

  /* ---------- ジェスチャー: 横ドラッグ=軌道回転 / 縦ドラッグ=視点の傾き / ピンチ=ズーム ---------- */
  let dragMoved = false;
  function bindGestures() {
    const pts = new Map();
    let last = null, pinch = null, axis = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.h3d-ctl, .holo-input, .acts')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragMoved = false;
      axis = null;
      if (pts.size === 1) { last = { x: e.clientX, y: e.clientY, t: performance.now() }; velocity = 0; orbitTarget = null; }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: gem.view.dist };
      }
    });
    root.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !gem) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        gem.setView({ dist: pinch.dist * (pinch.d / Math.max(d, 1)) });
        dragMoved = true;
        return;
      }
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (!axis && Math.hypot(dx, dy) > 6) axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (!axis) return;
      dragMoved = true;
      const now = performance.now();
      if (axis === 'x') {
        const delta = dx / Math.max(root.clientWidth, 1) * Math.PI * 1.6;
        orbit += delta;
        velocity = delta * (16 / Math.max(now - last.t, 1));
      } else {
        gem.setView({ pitch: gem.view.pitch + dy * 0.005 });
      }
      last = { x: e.clientX, y: e.clientY, t: now };
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) { last = null; setTimeout(() => { dragMoved = false; }, 0); }
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('wheel', (e) => { e.preventDefault(); gem && gem.setView({ dist: gem.view.dist * (1 + e.deltaY * 0.001) }); }, { passive: false });
  }

  /* ---------- ホログラム風の追加入力 ---------- */
  function openHolo() {
    if (holoEl) { holoEl.querySelector('input').focus(); return; }
    holoEl = document.createElement('form');
    holoEl.className = 'holo-input';
    holoEl.autocomplete = 'off';
    holoEl.innerHTML = `<input name="title" placeholder="新しいタスク" enterkeyhint="done" aria-label="新しいタスク">
      <div class="row2"><button type="button" data-holo="close">閉じる</button><span><button type="button" data-holo="detail">詳細を入力</button><button type="submit">追加</button></span></div>`;
    root.appendChild(holoEl);
    const input = holoEl.querySelector('input');
    input.focus();
    holoEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = store.commit((s, now) => C.createTask(s, { title: input.value }, now));
      if (t) { input.value = ''; gem && gem.pulse(); }
    });
    holoEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-holo]'); if (!b) return;
      if (b.dataset.holo === 'close') closeHolo();
      if (b.dataset.holo === 'detail') {
        const t = store.commit((s, now) => C.createTask(s, { title: input.value }, now));
        if (t) { closeHolo(); ORBIT.openTaskSheet(t.id); } else input.focus();
      }
    });
  }
  function closeHolo() { if (holoEl) { holoEl.remove(); holoEl = null; } }

  ORBIT.home3d = { init, render, setVisible };
})();
