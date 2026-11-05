/* ORBIT — 縦画面の ToDo とタスク詳細シート */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const C = window.OrbitCore;
  const { $, esc, icon, COLORS, URGENCY, REPEAT, fmtDue, today, haptic, urlsIn, linkLabel } = ORBIT.ui;
  const store = ORBIT.store;

  function projectColor(state, task) {
    const p = task.projectId && state.projects[task.projectId];
    return p && !p.deletedAt ? COLORS[p.color] || COLORS.blue : null;
  }

  /** タスク行。ToDo・集中画面・プロジェクトで共通に使う。 */
  function taskRow(state, task, { play = false, dot = true, extra = '', cls = '' } = {}) {
    const meta = [];
    if (task.urgency === 1) meta.push(`<span class="u1">${icon('flag', 'sm')}${URGENCY[1]}</span>`);
    if (task.urgency === 2) meta.push(`<span class="u2">${icon('flag', 'sm')}${URGENCY[2]}</span>`);
    if (task.urgency === 4) meta.push(`<span>${icon('turtle', 'sm')}${URGENCY[4]}</span>`);
    if (task.dueDate) {
      const late = !task.completed && task.dueDate < today();
      meta.push(`<span class="${late ? 'late' : ''}">${icon('cal', 'sm')}${fmtDue(task.dueDate)}</span>`);
    }
    if (task.repeat) meta.push(`<span>${icon('repeat', 'sm')}${REPEAT[task.repeat]}</span>`);
    if (urlsIn(task.notes).length) meta.push(`<span>${icon('link', 'sm')}リンク</span>`);
    const color = dot && projectColor(state, task);
    return `<li class="row ${task.completed ? 'done' : ''} ${cls}" data-id="${esc(task.id)}" data-kind="task">
      <button class="chk ${task.completed ? 'done' : ''}" data-act="toggle" aria-label="${task.completed ? '未完了に戻す' : '完了にする'}">
        <span class="ring">${task.completed ? icon('check') : ''}</span></button>
      <div class="body" data-act="detail"><div class="title">${esc(task.title)}</div>${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}</div>
      ${color ? `<span class="dot" style="background:${color}" aria-hidden="true"></span>` : ''}
      ${play ? `<button class="play" data-act="focus" aria-label="集中モードを開始">${icon('play')}</button>` : ''}
      ${extra}
    </li>`;
  }

  function reviewRow(r) {
    const n = r.history.length + 1;
    return `<li class="row rv" data-id="${esc(r.id)}" data-kind="review">
      <button class="chk" data-act="rvDone" aria-label="復習した"><span class="ring"></span></button>
      <div class="body" data-act="rvOpen"><div class="title">${esc(r.title)}</div>
        <div class="meta"><span class="rvtag">${icon('review', 'sm')}復習 ${n} 回目</span>${r.source ? `<span>${esc(r.source.label)}</span>` : ''}</div></div></li>`;
  }

  function completeReview(id, rowEl) {
    const r = store.state.reviews[id];
    if (!r) return;
    haptic('success');
    if (rowEl) { rowEl.classList.add('done'); rowEl.querySelector('.chk .ring').innerHTML = icon('check'); }
    setTimeout(() => store.commit((s, now) => C.Review.complete(s, id, today(), now),
      { undo: (x) => `次回の復習は ${fmtDue(x.nextDue)}` }), 240);
  }

  function render(state) {
    const active = C.activeTodo(state);
    const dueReviews = C.Review.due(state, today());
    const done = C.completedTodo(state);
    const open = state.ui.completedOpen.includes('todo');
    const el = $('#todoList');
    if (!active.length && !done.length && !dueReviews.length) {
      el.innerHTML = `<div class="empty"><div class="orb"></div>タスクはありません<br><small>右上の ＋ からも追加できます</small><button class="btn primary" data-act="addFirst">最初のタスクを追加</button></div>`;
      return;
    }
    const focusRunning = !!state.focus;
    el.innerHTML = `${dueReviews.length ? `<h4 class="sec-title">今日の復習 <span class="num">${dueReviews.length}</span></h4><ul class="list" id="todoReviews">${dueReviews.map(reviewRow).join('')}</ul>` : ''}<ul class="list" id="todoActive">${active.map((t, i) => taskRow(state, t, { play: i === 0 && !focusRunning })).join('')}</ul>
      ${done.length ? `<button class="sec-h ${open ? 'open' : ''}" data-act="toggleDone" aria-expanded="${open}">
          <span class="chev">${icon('chev', 'sm')}</span>完了済み <span class="num">${done.length}</span></button>
        ${open ? `<ul class="list">${done.map((t) => taskRow(state, t)).join('')}</ul>` : ''}` : ''}`;
  }

  /** チェック操作。チェックの描画を先に見せてから確定する。 */
  function toggle(id, rowEl) {
    const task = store.state.tasks[id];
    if (!task) return;
    const next = !task.completed;
    if (rowEl) {
      rowEl.classList.toggle('done', next);
      const chk = rowEl.querySelector('.chk');
      chk.classList.toggle('done', next);
      chk.querySelector('.ring').innerHTML = next ? icon('check') : '';
    }
    haptic(next ? 'success' : 'light');
    setTimeout(() => {
      store.commit((s, now) => C.setCompleted(s, id, next, now),
        { undo: next ? `「${task.title}」を完了しました` : '未完了に戻しました' });
    }, next ? 240 : 0);
  }

  function bindList(container, { onFocus } = {}) {
    container.addEventListener('click', (e) => {
      const actEl = e.target.closest('[data-act]');
      const row = e.target.closest('[data-id]');
      if (!actEl) return;
      const act = actEl.dataset.act;
      if (act === 'addFirst') newTask();
      else if (act === 'rvDone' && row) completeReview(row.dataset.id, row);
      else if (act === 'rvOpen' && row) ORBIT.reviewForm(row.dataset.id);
      else if (act === 'toggle' && row) toggle(row.dataset.id, row);
      else if (act === 'detail' && row) openTaskSheet(row.dataset.id);
      else if (act === 'focus' && row && onFocus) onFocus(row.dataset.id);
      else if (act === 'toggleDone') {
        const list = store.state.ui.completedOpen.filter((k) => k !== 'todo');
        if (!store.state.ui.completedOpen.includes('todo')) list.push('todo');
        store.setUI('completedOpen', list);
        render(store.state);
      }
    });
  }

  /** 繰り返しの選択（なし／毎日／平日／毎週／毎月）。 */
  function repeatField(current) {
    const opts = [['', 'なし'], ...Object.entries(REPEAT)];
    return `<div class="field"><span>繰り返し</span><div class="seg" data-seg="repeat">
      ${opts.map(([v, label]) => `<button type="button" data-v="${v}" class="${v === (current || '') ? 'on' : ''}">${label}</button>`).join('')}</div></div>`;
  }
  function bindRepeat(body, onPick) {
    body.querySelector('[data-seg="repeat"]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      onPick(b.dataset.v || null);
      body.querySelectorAll('[data-seg="repeat"] button').forEach((x) => x.classList.toggle('on', x === b));
    });
  }

  /* ---------- タスク詳細 ---------- */
  function openTaskSheet(id) {
    const s = store.state;
    const t = s.tasks[id];
    if (!t) return;
    const opts = ORBIT.projectOptions(s);
    let urgency = t.urgency;
    let repeat = t.repeat || null;
    const inFocus = s.focus && s.focus.items.some((it) => it.taskId === id);
    ORBIT.ui.openSheet({
      title: 'タスク',
      html: `
        <label class="field"><span>タイトル</span><textarea class="inp" name="title" rows="2" style="min-height:0">${esc(t.title)}</textarea></label>
        <label class="field"><span>メモ・リンク（URL を貼り付けられます）</span><textarea class="inp" name="notes" placeholder="メモ / https://…">${esc(t.notes)}</textarea></label>
        <div class="links" data-links></div>
        <div class="field"><span>緊急度</span><div class="seg" data-seg="urgency">
          ${[1, 2, 3, 4].map((u) => `<button type="button" data-v="${u}" class="${u === urgency ? 'on' : ''}">${URGENCY[u]}</button>`).join('')}</div></div>
        <label class="field"><span>期限</span><div class="btn-row" style="align-items:center">
          <input class="inp" type="date" name="due" value="${esc(t.dueDate || '')}">
          <button type="button" class="ib" data-clear="due" aria-label="期限をなくす">${icon('close')}</button></div></label>
        ${repeatField(repeat)}
        <label class="field"><span>プロジェクト</span><select class="inp" name="project">
          <option value="">未分類</option>
          ${opts.map((o) => `<option value="${esc(o.id)}" ${o.id === t.projectId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select></label>
        ${s.focus && !inFocus && !t.completed ? `<button type="button" class="btn" data-x="focusAdd">${icon('plus')}集中リストに追加</button>` : ''}
        <button type="button" class="btn" data-x="complete">${icon('check')}${t.completed ? '未完了に戻す' : '完了にする'}</button>
        <button type="button" class="btn" data-x="archive">${icon('archive')}アーカイブ</button>
        <button type="button" class="btn danger" data-x="delete">${icon('trash')}削除</button>`,
      onMount(body) {
        body.querySelector('[data-seg="urgency"]').addEventListener('click', (e) => {
          const b = e.target.closest('button'); if (!b) return;
          urgency = Number(b.dataset.v);
          body.querySelectorAll('[data-seg="urgency"] button').forEach((x) => x.classList.toggle('on', x === b));
        });
        body.querySelector('[data-clear="due"]').onclick = () => { body.querySelector('[name="due"]').value = ''; };
        bindRepeat(body, (v) => { repeat = v; });
        bindLinks(body);
        body.addEventListener('click', (e) => {
          const x = e.target.closest('[data-x]'); if (!x) return;
          ORBIT.ui.closeSheet();
          if (x.dataset.x === 'delete') store.commit((st, now) => C.trashTask(st, id, now), { undo: `「${t.title}」を削除しました` });
          if (x.dataset.x === 'complete') toggle(id);
          if (x.dataset.x === 'archive') archive(id);
          if (x.dataset.x === 'focusAdd') store.commit((st) => C.Focus.addTask(st, id));
        });
      },
      done(body) {
        const title = body.querySelector('[name="title"]').value.trim();
        if (!title) { body.querySelector('[name="title"]').focus(); return false; }
        const patch = {
          title,
          notes: body.querySelector('[name="notes"]').value,
          urgency,
          dueDate: body.querySelector('[name="due"]').value || (repeat ? today() : null),
          projectId: body.querySelector('[name="project"]').value || null,
          repeat,
        };
        store.commit((st, now) => C.updateTask(st, id, patch, now));
        return true;
      },
    });
  }

  /** メモ欄に貼られた URL を、タップで開けるリンクとして並べる。 */
  function bindLinks(body) {
    const ta = body.querySelector('[name="notes"]');
    const box = body.querySelector('[data-links]');
    if (!ta || !box) return;
    const paint = () => {
      box.innerHTML = urlsIn(ta.value).map((u) => `<a class="link-chip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon('link', 'sm')}<span>${esc(linkLabel(u))}</span></a>`).join('');
    };
    ta.addEventListener('input', paint);
    paint();
  }

  function archive(id) {
    const t = store.state.tasks[id];
    if (!t) return;
    store.commit((s, now) => C.setTaskArchived(s, id, true, now), { undo: `「${t.title}」をアーカイブしました` });
  }

  /* ---------- スワイプ: 右へ=完了、左へ=アーカイブ ---------- */
  const SWIPE_AT = 88;
  function bindSwipe(container) {
    let g = null;
    container.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('li.row[data-kind="task"], li.row[data-kind="review"]');
      // 画面左端 24px からの右スワイプは Safari の「戻る」ジェスチャーが先に動くので、行のスワイプとしては扱わない。
      if (!row || e.target.closest('.chk, .play') || (e.pointerType === 'mouse' && e.button !== 0) || (e.pointerType === 'touch' && e.clientX < 24)) return;
      g = { row, id: row.dataset.id, x: e.clientX, y: e.clientY, pid: e.pointerId, on: false };
    });
    container.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.pid) return;
      if (g.row.classList.contains('lift')) { g = null; return; }
      const isRv = g.row.dataset.kind === 'review';
      const dx = isRv ? Math.max(0, e.clientX - g.x) : e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (!g.on) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        g.on = true;
        g.row.classList.add('swiping');
        try { g.row.setPointerCapture(g.pid); } catch (_) { /* 既に離れている */ }
      }
      const done = g.row.classList.contains('done');
      g.row.classList.toggle('sw-r', dx > 0);
      g.row.classList.toggle('sw-l', dx < 0);
      g.row.dataset.swr = isRv ? '復習した' : done ? '未完了に戻す' : '完了';
      g.row.classList.toggle('armed', Math.abs(dx) >= SWIPE_AT);
      g.row.style.transform = `translateX(${dx}px)`;
      g.dx = dx;
    });
    const end = (e, cancelled) => {
      if (!g || e.pointerId !== g.pid) return;
      const { row, id, on, dx } = g;
      g = null;
      if (!on) return;
      // スワイプ直後のクリックでシートが開かないようにする。
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      container.addEventListener('click', swallow, true);
      setTimeout(() => container.removeEventListener('click', swallow, true), 60);
      const hit = !cancelled && Math.abs(dx || 0) >= SWIPE_AT;
      row.classList.remove('swiping', 'armed');
      row.style.transition = 'transform .18s var(--ease)';
      row.style.transform = hit ? `translateX(${dx > 0 ? '' : '-'}110%)` : '';
      setTimeout(() => {
        row.style.transition = '';
        row.classList.remove('sw-r', 'sw-l');
        if (!hit) { row.style.transform = ''; return; }
        haptic('success');
        if (row.dataset.kind === 'review') completeReview(id);
        else if (dx > 0) toggle(id);
        else archive(id);
      }, 180);
    };
    container.addEventListener('pointerup', (e) => end(e, false));
    container.addEventListener('pointercancel', (e) => end(e, true));
  }

  // 右上の ＋: 詳細つきの新規タスク入力。
  function newTask(prefill = {}) {
    const opts = ORBIT.projectOptions(store.state);
    let urgency = 3;
    let repeat = null;
    ORBIT.ui.openSheet({
      title: '新しいタスク', doneLabel: '追加', cancelLabel: 'キャンセル',
      html: `
        <label class="field"><span>タイトル</span><textarea class="inp" name="title" rows="2" style="min-height:0" placeholder="例: 明日 牛乳を買う ／ 毎週月曜 ゴミ出し">${esc(prefill.title || '')}</textarea></label>
        <p class="note" data-quick hidden style="margin:-6px 0 10px"></p>
        <details class="more" ${prefill.notes ? 'open' : ''}><summary>メモ・期限などを追加</summary>
          <label class="field"><span>メモ・リンク（URL を貼り付けられます）</span><textarea class="inp" name="notes" placeholder="メモ / https://…">${esc(prefill.notes || '')}</textarea></label>
          <div class="links" data-links></div>
          <div class="field"><span>緊急度</span><div class="seg" data-seg="urgency">
            ${[1, 2, 3, 4].map((u) => `<button type="button" data-v="${u}" class="${u === urgency ? 'on' : ''}">${URGENCY[u]}</button>`).join('')}</div></div>
          <label class="field"><span>期限</span><div class="btn-row" style="align-items:center">
            <input class="inp" type="date" name="due"><button type="button" class="ib" data-clear="due" aria-label="期限をなくす">${icon('close')}</button></div></label>
          ${repeatField(null)}
          <label class="field"><span>プロジェクト</span><select class="inp" name="project"><option value="">未分類</option>
            ${opts.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}</select></label></details>`,
      onMount(body) {
        body.querySelector('[data-seg="urgency"]').addEventListener('click', (e) => {
          const b = e.target.closest('button'); if (!b) return;
          urgency = Number(b.dataset.v);
          body.querySelectorAll('[data-seg="urgency"] button').forEach((x) => x.classList.toggle('on', x === b));
        });
        body.querySelector('[data-clear="due"]').onclick = () => { body.querySelector('[name="due"]').value = ''; };
        bindRepeat(body, (v) => { repeat = v; });
        bindLinks(body);
        const titleEl = body.querySelector('[name="title"]');
        const hint = body.querySelector('[data-quick]');
        const paintQuick = () => {
          const q = C.parseQuick(titleEl.value, today());
          const parts = [];
          if (q.dueDate) parts.push(`期限 ${fmtDue(q.dueDate)}`);
          if (q.repeat) parts.push(`繰り返し ${REPEAT[q.repeat]}`);
          hint.hidden = !parts.length;
          hint.textContent = parts.length ? `${parts.join('・')} として追加します（「${q.title}」）` : '';
        };
        titleEl.addEventListener('input', paintQuick);
        paintQuick();
        titleEl.focus();
      },
      done(body) {
        const raw = body.querySelector('[name="title"]').value.trim();
        if (!raw) { body.querySelector('[name="title"]').focus(); return false; }
        const q = C.parseQuick(raw, today());
        const useRepeat = repeat || q.repeat;
        const patch = {
          notes: body.querySelector('[name="notes"]').value, urgency,
          // 手で選んだ期限・繰り返しを、タイトルの文面より優先する。
          dueDate: body.querySelector('[name="due"]').value || q.dueDate || (useRepeat ? today() : null),
          projectId: body.querySelector('[name="project"]').value || null,
          repeat: useRepeat,
        };
        store.commit((st, now) => { const t = C.createTask(st, { title: q.title }, now); C.updateTask(st, t.id, patch, now); });
        return true;
      },
    });
  }

  function init() {
    const list = $('#todoList');
    bindList(list, { onFocus: (id) => ORBIT.focus.open(id) });
    bindSwipe(list);
    ORBIT.ui.sortable(list, {
      canDrag: (row) => !!row.closest('#todoActive'),
      onDrop: ({ ids }) => store.commit((s, now) => C.reorderTodo(s, ids, now)),
    });
  }

  ORBIT.todo = { init, render, taskRow, bindList, toggle, newTask };
  ORBIT.openTaskSheet = openTaskSheet;
})();
