/* ORBIT — プロジェクト（階層ツリー・移動・アーカイブ・削除・検索）とごみ箱 */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const C = window.OrbitCore;
  const { $, esc, icon, COLORS, COLOR_LABEL } = ORBIT.ui;
  const store = ORBIT.store;

  /** タスク詳細などで使う「大学 › 英語学習」形式の選択肢（実効アーカイブ済みは除外）。 */
  function projectOptions(state, { exclude = null } = {}) {
    const out = [];
    const walk = (parentId, names) => {
      C.children(state, parentId).forEach((p) => {
        if (exclude && (p.id === exclude)) return;
        const label = [...names, p.name];
        out.push({ id: p.id, label: label.join(' › '), depth: names.length, project: p });
        walk(p.id, label);
      });
    };
    walk(null, []);
    return out;
  }
  ORBIT.projectOptions = projectOptions;

  const folderIcon = (color) => `<svg class="folder" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
      fill="${color}33" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

  /* ---------- Projects ルート ---------- */
  const view = { addingTo: null, searching: false, query: '', flash: null };

  function expandedSet(state) { return state.ui.expanded || []; }
  function setExpanded(id, on) {
    const list = expandedSet(store.state).filter((x) => x !== id);
    if (on) list.push(id);
    store.setUI('expanded', list);
  }

  function renderTree(state, el) {
    if (view.searching) { renderSearch(state, el); return; }
    const rows = C.treeRows(state, { expanded: expandedSet(state), completedOpen: state.ui.completedOpen });
    if (!rows.length) {
      el.innerHTML = `<div class="empty"><div class="orb"></div>プロジェクトはありません<br><small>右上の ＋ から作成できます</small></div>`;
      return;
    }
    const indent = (d) => `<span class="indent" style="width:${d * 18}px"></span>`;
    const html = rows.map((r) => {
      if (r.type === 'project') {
        const p = r.project;
        const color = COLORS[p.color] || COLORS.blue;
        const adding = view.addingTo === p.id;
        return `<li class="row proj ${view.flash === p.id ? 'drop-target' : ''}" data-id="${esc(p.id)}" data-kind="project" data-parent="${esc(p.parentId || '')}">
            ${indent(r.depth)}<button class="tw ${r.expanded ? 'open' : ''}" data-act="twist" aria-label="${r.expanded ? '折りたたむ' : '展開する'}" aria-expanded="${r.expanded}">${icon('chev', 'sm')}</button>
            ${folderIcon(color)}
            <span class="pname" data-act="twist">${esc(p.name)}<span class="count num">${r.progress.done}/${r.progress.total}</span></span>
            <button class="add" data-act="addTask" aria-label="${esc(p.name)} にタスクを追加">${icon('plus')}</button>
            <button class="more" data-act="menu" aria-label="${esc(p.name)} のメニュー">${icon('more')}</button>
          </li>${adding ? `<li class="inline-add" data-inline style="padding-left:${16 + (r.depth + 1) * 18}px">
            <form data-inline-form="${esc(p.id)}" autocomplete="off"><input class="inp" name="title" enterkeyhint="done" placeholder="${esc(p.name)} にタスクを追加"></form></li>` : ''}`;
      }
      if (r.type === 'completedHeader') {
        return `<li class="row chead" data-act="completed" data-pid="${esc(r.projectId)}">${indent(r.depth)}
          <span class="tw ${r.open ? 'open' : ''}">${icon('chev', 'sm')}</span>完了済み <span class="num">${r.count}</span></li>`;
      }
      const t = r.task;
      const p = state.projects[r.projectId];
      return `<li class="row task ${t.completed ? 'done' : ''}" data-id="${esc(t.id)}" data-kind="task" data-parent="${esc(r.projectId)}">
          ${indent(r.depth)}<span class="tw"></span>
          <button class="chk ${t.completed ? 'done' : ''}" data-act="toggle" aria-label="${t.completed ? '未完了に戻す' : '完了にする'}"><span class="ring">${t.completed ? icon('check') : ''}</span></button>
          <span class="pname" data-act="detail" style="font-weight:400"><span class="title">${esc(t.title)}</span></span>
          <span class="mini-mark" style="background:${COLORS[p && p.color] || COLORS.blue}" aria-hidden="true"></span>
        </li>`;
    }).join('');
    el.innerHTML = `<ul class="list tree" id="treeList">${html}</ul><div style="height:120px"></div>`;
    const inline = el.querySelector('[data-inline-form] input');
    if (inline) inline.focus({ preventScroll: false });
    if (view.flash) setTimeout(() => { view.flash = null; }, 0);
  }

  function renderSearch(state, el) {
    const q = view.query.trim();
    if (!q) { el.innerHTML = `<div class="empty">プロジェクト名・タスク名で検索</div>`; return; }
    const results = C.search(state, q);
    el.innerHTML = results.length ? `<ul class="list">${results.map((r) => `
      <li class="row" data-id="${esc(r.id)}" data-kind="${r.type}" data-act="result">
        ${r.type === 'project' ? folderIcon(COLORS[state.projects[r.id] && state.projects[r.id].color] || COLORS.blue) : icon(state.tasks[r.id] && state.tasks[r.id].completed ? 'check' : 'chev', 'sm')}
        <div class="body"><div class="title">${esc(r.title)}${r.archived ? ' <span class="badge">アーカイブ</span>' : ''}</div>
        <div class="res-path">${r.path.length ? esc(r.path.join(' › ')) : (r.type === 'task' ? '未分類' : 'ルート')}</div></div></li>`).join('')}</ul>`
      : `<div class="empty">「${esc(q)}」に一致するものはありません</div>`;
  }

  function revealProject(id) {
    const s = store.state;
    const ids = [...C.ancestors(s, id)];
    const list = new Set(expandedSet(s));
    ids.forEach((a) => list.add(a));
    store.setUI('expanded', [...list]);
  }

  function openResult(kind, id) {
    const s = store.state;
    view.searching = false;
    view.query = '';
    ORBIT.nav.refreshHeader();
    if (kind === 'project') {
      revealProject(id);
      view.flash = id;
      ORBIT.nav.render();
      const row = document.querySelector(`#treeList [data-id="${CSS.escape(id)}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
    } else {
      const t = s.tasks[id];
      if (t && t.projectId) {
        revealProject(t.projectId);
        setExpanded(t.projectId, true);
      }
      ORBIT.nav.render();
      ORBIT.openTaskSheet(id);
    }
  }

  function projectMenu(id) {
    const p = store.state.projects[id];
    if (!p) return;
    ORBIT.ui.openSheet({
      title: p.name,
      html: `
        <button class="menu-item" data-m="edit">${icon('edit')}名前と色を変更</button>
        <button class="menu-item" data-m="sub">${icon('folder')}サブプロジェクトを追加</button>
        <button class="menu-item" data-m="move">${icon('move')}移動</button>
        <button class="menu-item" data-m="archive">${icon('archive')}アーカイブ</button>
        <button class="menu-item danger" data-m="delete">${icon('trash')}削除</button>`,
      onMount(body) {
        body.addEventListener('click', (e) => {
          const m = e.target.closest('[data-m]'); if (!m) return;
          const act = m.dataset.m;
          ORBIT.ui.closeSheet();
          setTimeout(() => {
            if (act === 'edit') editProject(id);
            if (act === 'sub') editProject(null, id);
            if (act === 'move') movePicker(id);
            if (act === 'archive') store.commit((s, now) => C.setArchived(s, id, true, now), { undo: `「${p.name}」をアーカイブしました` });
            if (act === 'delete') deleteDialog(id);
          }, 280);
        });
      },
    });
  }

  /** 作成（id=null）と編集を兼ねる。子は親の色を初期値として引き継ぐ。 */
  function editProject(id, parentId = null) {
    const s = store.state;
    const p = id ? s.projects[id] : null;
    const parent = parentId ? s.projects[parentId] : null;
    let color = p ? p.color : (parent ? parent.color : 'blue');
    ORBIT.ui.openSheet({
      title: p ? 'プロジェクトを編集' : (parent ? `${parent.name} のサブプロジェクト` : '新しいプロジェクト'),
      doneLabel: p ? '保存' : '作成',
      html: `<label class="field"><span>名前</span><input class="inp" name="name" value="${esc(p ? p.name : '')}" placeholder="例: 英語学習" enterkeyhint="done"></label>
        <div class="field"><span>カラー</span><div class="swatches">${Object.keys(COLORS).map((c) =>
          `<button type="button" data-c="${c}" class="${c === color ? 'on' : ''}" style="background:${COLORS[c]}" aria-label="${COLOR_LABEL[c]}"></button>`).join('')}</div></div>`,
      onMount(body) {
        const input = body.querySelector('[name="name"]');
        setTimeout(() => input.focus(), 320);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#sheet [data-sheet="done"]').click(); } });
        body.querySelector('.swatches').addEventListener('click', (e) => {
          const b = e.target.closest('[data-c]'); if (!b) return;
          color = b.dataset.c;
          body.querySelectorAll('.swatches button').forEach((x) => x.classList.toggle('on', x === b));
        });
      },
      done(body) {
        const name = body.querySelector('[name="name"]').value.trim();
        if (!name) return false;
        if (p) store.commit((st, now) => C.updateProject(st, id, { name, color }, now));
        else {
          if (parentId) setExpanded(parentId, true);
          store.commit((st, now) => C.createProject(st, { name, parentId, color }, now));
        }
        return true;
      },
    });
  }

  function movePicker(id) {
    const s = store.state;
    const p = s.projects[id];
    const opts = projectOptions(s);
    ORBIT.ui.openSheet({
      title: `「${p.name}」の移動先`,
      html: `<button class="pick ${!p.parentId ? 'on' : ''}" data-to="">${icon('folder')}ルート（最上位）</button>
        ${opts.map((o) => {
          const ok = o.id !== p.parentId && C.canMoveProject(s, id, o.id);
          return `<button class="pick ${o.id === p.parentId ? 'on' : ''}" data-to="${esc(o.id)}" ${ok ? '' : 'disabled'} style="padding-left:${6 + o.depth * 18}px">
            ${folderIcon(COLORS[o.project.color] || COLORS.blue)}${esc(o.project.name)}</button>`;
        }).join('')}`,
      onMount(body) {
        body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-to]'); if (!b || b.disabled) return;
          const to = b.dataset.to || null;
          ORBIT.ui.closeSheet();
          if (to === p.parentId) return;
          if (to) setExpanded(to, true);
          store.commit((st, now) => C.moveProject(st, id, to, C.children(st, to).length, now), { undo: `「${p.name}」を移動しました` });
        });
      },
    });
  }

  function deleteDialog(id) {
    const s = store.state;
    const p = s.projects[id];
    const keep = C.deletionPreview(s, id, 'keep');
    const all = C.deletionPreview(s, id, 'all');
    ORBIT.ui.openSheet({
      title: `「${p.name}」を削除`,
      cancelLabel: 'キャンセル',
      html: `<p class="note">どちらの方法で削除しますか？ ごみ箱から ${s.settings.trashDays} 日間は復元できます。</p>
        <button class="btn" data-del="keep" style="flex-direction:column;align-items:flex-start;text-align:left">
          <b>関連データを残す</b><small class="note" style="margin:4px 0 0">このプロジェクトだけを削除。タスク ${keep.unassigned} 件は未分類へ、子プロジェクト ${keep.reparented} 件は一つ上の階層へ移動します。</small></button>
        <button class="btn danger" data-del="all" style="flex-direction:column;align-items:flex-start;text-align:left">
          <b>関連データも削除</b><small class="note" style="margin:4px 0 0">プロジェクト ${all.projects} 件とタスク ${all.tasks} 件をまとめて削除します。</small></button>`,
      onMount(body) {
        body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-del]'); if (!b) return;
          const mode = b.dataset.del;
          ORBIT.ui.closeSheet();
          store.commit((st, now) => C.deleteProject(st, id, mode, now), { undo: `「${p.name}」を削除しました` });
        });
      },
    });
  }

  function bindTree(el) {
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const row = e.target.closest('[data-id]');
      const s = store.state;
      switch (act.dataset.act) {
        case 'twist': {
          const id = row.dataset.id;
          setExpanded(id, !expandedSet(s).includes(id));
          if (view.addingTo === id) view.addingTo = null;
          ORBIT.nav.render();
          break;
        }
        case 'addTask': {
          const id = row.dataset.id;
          view.addingTo = view.addingTo === id ? null : id;
          if (view.addingTo) setExpanded(id, true);
          ORBIT.nav.render();
          break;
        }
        case 'menu': projectMenu(row.dataset.id); break;
        case 'toggle': ORBIT.todo.toggle(row.dataset.id, row); break;
        case 'detail': ORBIT.openTaskSheet(row.dataset.id); break;
        case 'completed': {
          const pid = act.dataset.pid;
          const list = s.ui.completedOpen.filter((x) => x !== pid);
          if (!s.ui.completedOpen.includes(pid)) list.push(pid);
          store.setUI('completedOpen', list);
          ORBIT.nav.render();
          break;
        }
        case 'result': openResult(row.dataset.kind, row.dataset.id); break;
        default: break;
      }
    });
    el.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-inline-form]');
      if (!form) return;
      e.preventDefault();
      const title = form.title.value.trim();
      if (!title) { view.addingTo = null; ORBIT.nav.render(); return; }
      const projectId = form.dataset.inlineForm;
      store.commit((s, now) => C.createTask(s, { title, projectId }, now));
    });
    el.addEventListener('focusout', (e) => {
      const form = e.target.closest && e.target.closest('[data-inline-form]');
      if (form && !form.title.value.trim()) {
        setTimeout(() => { if (view.addingTo && !el.contains(document.activeElement)) { view.addingTo = null; ORBIT.nav.render(); } }, 150);
      }
    });
    ORBIT.ui.sortable(el, {
      item: '.row[data-kind]',
      canDrag: (row) => !view.searching && (row.dataset.kind === 'project' || !row.classList.contains('done')),
      dropInto: (dragRow, over) => over.dataset.kind === 'project' && over.dataset.id !== dragRow.dataset.id
        && (dragRow.dataset.kind === 'task' || C.canMoveProject(store.state, dragRow.dataset.id, over.dataset.id)),
      onDrop: ({ into, id, row, ids }) => {
        const s = store.state;
        if (into) {
          setExpanded(into, true);
          if (row.dataset.kind === 'project') {
            store.commit((st, now) => C.moveProject(st, id, into, C.children(st, into).length, now), { undo: '移動しました' });
          } else {
            store.commit((st, now) => C.moveTask(st, id, into, C.projectTasks(st, into).active.length, now), { undo: '移動しました' });
          }
          return;
        }
        // 同じ親・同じ種類の並びだけを取り出して並べ替える（別の親への移動は「中へドロップ」かメニューで行う）。
        const parent = row.dataset.parent;
        const kind = row.dataset.kind;
        const siblings = ids.filter((x) => {
          const r = el.querySelector(`.row[data-id="${CSS.escape(x)}"]`);
          return r && r.dataset.kind === kind && r.dataset.parent === parent && !r.classList.contains('done');
        });
        const index = siblings.indexOf(id);
        if (kind === 'project') store.commit((st, now) => C.moveProject(st, id, parent || null, index, now));
        else store.commit((st, now) => C.moveTask(st, id, parent, index, now));
        void s;
      },
    });
  }

  ORBIT.routes = ORBIT.routes || {};
  ORBIT.routes.projects = {
    title: 'プロジェクト',
    header() {
      if (view.searching) {
        return `<div class="searchbar" style="flex:1;padding:0 4px;border:0"><input class="inp" id="projSearch" type="search" placeholder="検索" value="${esc(view.query)}" enterkeyhint="search"></div>
          <button class="txt ib" data-hdr="cancelSearch" style="width:auto;padding:0 10px;color:var(--hi)">完了</button>`;
      }
      return `<button class="ib" data-hdr="search" aria-label="検索">${icon('search')}</button>
        <button class="ib" data-hdr="new" aria-label="新しいプロジェクト">${icon('plus')}</button>
        <button class="ib" data-hdr="more" aria-label="アーカイブとごみ箱">${icon('more')}</button>`;
    },
    onHeader(act) {
      if (act === 'search') { view.searching = true; ORBIT.nav.refreshHeader(); ORBIT.nav.render(); setTimeout(() => { const i = $('#projSearch'); i && i.focus(); }, 30); }
      if (act === 'cancelSearch') { view.searching = false; view.query = ''; ORBIT.nav.refreshHeader(); ORBIT.nav.render(); }
      if (act === 'new') editProject(null, null);
      if (act === 'more') {
        ORBIT.ui.openSheet({
          title: 'プロジェクト',
          html: `<button class="menu-item" data-m="archive">${icon('archive')}アーカイブ済み</button>
            <button class="menu-item" data-m="trash">${icon('trash')}ごみ箱</button>`,
          onMount(body) {
            body.addEventListener('click', (e) => {
              const m = e.target.closest('[data-m]'); if (!m) return;
              ORBIT.ui.closeSheet();
              ORBIT.nav.open(m.dataset.m);
            });
          },
        });
      }
    },
    onHeaderInput(e) {
      if (e.target.id === 'projSearch') { view.query = e.target.value; ORBIT.nav.render(); }
    },
    mount: bindTree,
    render: renderTree,
    onLeave() { view.addingTo = null; view.searching = false; view.query = ''; },
  };

  /* ---------- アーカイブ済み ---------- */
  ORBIT.routes.archive = {
    title: 'アーカイブ',
    render(state, el) {
      const list = C.archivedProjects(state);
      const tasks = C.archivedTasks(state);
      const taskHtml = tasks.length ? `<h4 class="note" style="margin:16px 20px 4px">アーカイブしたタスク</h4><ul class="list">${tasks.map((t) => `<li class="row" data-tid="${esc(t.id)}" style="align-items:center">
          <div class="body"><div class="title">${esc(t.title)}</div></div>
          <button class="pill" data-act="untask" style="min-width:0;height:38px;padding:0 14px">${icon('restore', 'sm')}復元</button></li>`).join('')}</ul>` : '';
      el.innerHTML = taskHtml + (list.length ? `<h4 class="note" style="margin:16px 20px 4px">アーカイブしたプロジェクト</h4>` : '') + (list.length ? `<ul class="list">${list.map((p) => {
        const path = C.path(state, p.id).slice(0, -1).map((x) => x.name).join(' › ');
        const pr = C.progress(state, p.id);
        return `<li class="row" data-id="${esc(p.id)}" style="align-items:center">${folderIcon(COLORS[p.color] || COLORS.blue)}
          <div class="body"><div class="title">${esc(p.name)} <span class="count num" style="color:var(--fg-2);font-size:12.5px">${pr.done}/${pr.total}</span></div>
          ${path ? `<div class="res-path">${esc(path)}</div>` : ''}</div>
          <button class="pill" data-act="unarchive" style="min-width:0;height:38px;padding:0 14px">${icon('restore', 'sm')}復元</button></li>`;
      }).join('')}</ul>` : (tasks.length ? '' : `<div class="empty"><div class="orb"></div>アーカイブ済みの項目はありません</div>`));
    },
    mount(el) {
      el.addEventListener('click', (e) => {
        const tb = e.target.closest('[data-act="untask"]');
        if (tb) { store.commit((s, now) => C.setTaskArchived(s, tb.closest('[data-tid]').dataset.tid, false, now), { undo: '復元しました' }); return; }
        const b = e.target.closest('[data-act="unarchive"]'); if (!b) return;
        const id = b.closest('[data-id]').dataset.id;
        store.commit((s, now) => C.setArchived(s, id, false, now), { undo: '復元しました' });
      });
    },
  };

  /* ---------- ごみ箱 ---------- */
  ORBIT.routes.trash = {
    title: 'ごみ箱',
    render(state, el) {
      const list = C.trashList(state);
      const days = state.settings.trashDays;
      el.innerHTML = `<p class="note" style="margin:12px 20px">削除から ${days} 日経つと完全に削除されます。</p>` + (list.length ? `<ul class="list">${list.map((b) => {
        const left = Math.max(0, days - Math.floor((Date.now() - b.at) / 86400000));
        const what = b.kind === 'project'
          ? `プロジェクト${b.mode === 'all' ? `・配下 ${b.projectIds.length - 1} 件・タスク ${b.taskIds.length} 件` : '（中身は残した削除）'}`
          : 'タスク';
        return `<li class="row" data-id="${esc(b.id)}" style="align-items:center">${icon(b.kind === 'project' ? 'folder' : 'check', 'sm')}
          <div class="body"><div class="title">${esc(b.title)}</div><div class="res-path">${what} ・ あと ${left} 日</div></div>
          <button class="pill" data-act="restore" style="min-width:0;height:38px;padding:0 14px">${icon('restore', 'sm')}復元</button></li>`;
      }).join('')}</ul>` : `<div class="empty"><div class="orb"></div>ごみ箱は空です</div>`);
    },
    mount(el) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act="restore"]'); if (!b) return;
        const id = b.closest('[data-id]').dataset.id;
        store.commit((s, now) => C.restoreBatch(s, id, now));
        ORBIT.ui.toast('復元しました');
      });
    },
  };
})();
