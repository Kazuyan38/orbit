/* ORBIT — 縦画面の ToDo とタスク詳細シート */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const C = window.OrbitCore;
  const { $, esc, icon, COLORS, URGENCY, fmtDue, today, haptic } = ORBIT.ui;
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

  function render(state) {
    const active = C.activeTodo(state);
    const done = C.completedTodo(state);
    const open = state.ui.completedOpen.includes('todo');
    const el = $('#todoList');
    if (!active.length && !done.length) {
      el.innerHTML = `<div class="empty"><div class="orb"></div>タスクはありません<br><small>下の入力欄から追加できます</small></div>`;
      return;
    }
    const focusRunning = !!state.focus;
    el.innerHTML = `<ul class="list" id="todoActive">${active.map((t, i) => taskRow(state, t, { play: i === 0 && !focusRunning })).join('')}</ul>
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
      if (act === 'toggle' && row) toggle(row.dataset.id, row);
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

  /* ---------- タスク詳細 ---------- */
  function openTaskSheet(id) {
    const s = store.state;
    const t = s.tasks[id];
    if (!t) return;
    const opts = ORBIT.projectOptions(s);
    let urgency = t.urgency;
    const inFocus = s.focus && s.focus.items.some((it) => it.taskId === id);
    ORBIT.ui.openSheet({
      title: 'タスク',
      html: `
        <label class="field"><span>タイトル</span><textarea class="inp" name="title" rows="2" style="min-height:0">${esc(t.title)}</textarea></label>
        <label class="field"><span>メモ</span><textarea class="inp" name="notes" placeholder="メモ">${esc(t.notes)}</textarea></label>
        <div class="field"><span>緊急度</span><div class="seg" data-seg="urgency">
          ${[1, 2, 3, 4].map((u) => `<button type="button" data-v="${u}" class="${u === urgency ? 'on' : ''}">${URGENCY[u]}</button>`).join('')}</div></div>
        <label class="field"><span>期限</span><div class="btn-row" style="align-items:center">
          <input class="inp" type="date" name="due" value="${esc(t.dueDate || '')}">
          <button type="button" class="ib" data-clear="due" aria-label="期限をなくす">${icon('close')}</button></div></label>
        <label class="field"><span>プロジェクト</span><select class="inp" name="project">
          <option value="">未分類</option>
          ${opts.map((o) => `<option value="${esc(o.id)}" ${o.id === t.projectId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select></label>
        ${s.focus && !inFocus && !t.completed ? `<button type="button" class="btn" data-x="focusAdd">${icon('plus')}集中リストに追加</button>` : ''}
        <button type="button" class="btn" data-x="complete">${icon('check')}${t.completed ? '未完了に戻す' : '完了にする'}</button>
        <button type="button" class="btn danger" data-x="delete">${icon('trash')}削除</button>`,
      onMount(body) {
        body.querySelector('[data-seg="urgency"]').addEventListener('click', (e) => {
          const b = e.target.closest('button'); if (!b) return;
          urgency = Number(b.dataset.v);
          body.querySelectorAll('[data-seg="urgency"] button').forEach((x) => x.classList.toggle('on', x === b));
        });
        body.querySelector('[data-clear="due"]').onclick = () => { body.querySelector('[name="due"]').value = ''; };
        body.addEventListener('click', (e) => {
          const x = e.target.closest('[data-x]'); if (!x) return;
          ORBIT.ui.closeSheet();
          if (x.dataset.x === 'delete') store.commit((st, now) => C.trashTask(st, id, now), { undo: `「${t.title}」を削除しました` });
          if (x.dataset.x === 'complete') toggle(id);
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
          dueDate: body.querySelector('[name="due"]').value || null,
          projectId: body.querySelector('[name="project"]').value || null,
        };
        store.commit((st, now) => C.updateTask(st, id, patch, now));
        return true;
      },
    });
  }

  function init() {
    const list = $('#todoList');
    bindList(list, { onFocus: (id) => ORBIT.focus.open(id) });
    ORBIT.ui.sortable(list, {
      canDrag: (row) => !!row.closest('#todoActive'),
      onDrop: ({ ids }) => store.commit((s, now) => C.reorderTodo(s, ids, now)),
    });
    const form = $('#todoAdd');
    const input = $('#todoInput');
    const go = form.querySelector('.go');
    input.addEventListener('input', () => { go.hidden = !input.value.trim(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      store.commit((s, now) => C.createTask(s, { title }, now));
      input.value = '';
      go.hidden = true;
      input.focus();
      const scroller = $('#todoScroll');
      requestAnimationFrame(() => {
        const last = $('#todoActive li:last-child');
        if (last) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        else scroller.scrollTop = 0;
      });
    });
  }

  ORBIT.todo = { init, render, taskRow, bindList, toggle };
  ORBIT.openTaskSheet = openTaskSheet;
})();
