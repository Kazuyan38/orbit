/* ORBIT — コアロジック（DOM・ストレージ・現在時刻に依存しない純粋なデータ操作）
   ブラウザでは window.OrbitCore、Node では require('./core.js') で使う。
   時刻 now はミリ秒、日付はローカル日付の 'YYYY-MM-DD'。すべての変更関数は state を直接書き換える。 */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;
  const URGENCY_DEFAULT = 3;
  const PROJECT_COLORS = ['blue', 'purple', 'green', 'orange', 'pink', 'yellow', 'cyan', 'red'];
  const BOOK_STATUSES = ['want', 'reading', 'done'];

  /* ======================= 基本 ======================= */

  function uid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function defaultSettings() {
    return { focusMin: 25, shortMin: 5, longMin: 15, cycles: 4, reviewIntervals: [1, 3, 7, 14, 30], trashDays: 30, firstWeekday: 1 };
  }

  const MIN_RECORD_MS = 10000;

  function createState() {
    return {
      version: 1,
      tasks: {}, projects: {}, trash: {}, tombstones: {},
      focus: null, carryOver: [], focusLog: [], pomodoroLog: [],
      reviews: {}, books: {}, habits: {},
      settings: defaultSettings(),
      ui: { expanded: [], completedOpen: [] },
    };
  }

  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const live = (x) => !!x && !x.deletedAt;
  const values = (o) => Object.values(o || {});
  const byNum = (key) => (a, b) => (a[key] || 0) - (b[key] || 0);

  function touch(entity, now) {
    entity.updatedAt = now;
    entity.rev = (entity.rev || 0) + 1;
  }

  function migrate(raw) {
    if (!isObj(raw)) throw new Error('invalid state');
    if (raw.version != null && raw.version !== 1) throw new Error(`unsupported version ${raw.version}`);
    const s = createState();
    for (const key of ['tasks', 'projects', 'trash', 'tombstones', 'reviews', 'books', 'habits']) {
      if (raw[key] != null && !isObj(raw[key])) throw new Error(`invalid ${key}`);
      s[key] = raw[key] ? raw[key] : {};
    }
    for (const key of ['carryOver', 'focusLog', 'pomodoroLog']) s[key] = Array.isArray(raw[key]) ? raw[key] : [];
    s.focus = isObj(raw.focus) && isObj(raw.focus.engine) && Array.isArray(raw.focus.items) ? raw.focus : null;
    s.settings = Object.assign(defaultSettings(), isObj(raw.settings) ? raw.settings : {});
    // 復習間隔と週の始まりは固定（設定画面から廃止）。
    s.settings.reviewIntervals = defaultSettings().reviewIntervals;
    s.settings.firstWeekday = 1;
    s.ui = Object.assign({ expanded: [], completedOpen: [] }, isObj(raw.ui) ? raw.ui : {});
    if (!Array.isArray(s.ui.expanded)) s.ui.expanded = [];
    if (!Array.isArray(s.ui.completedOpen)) s.ui.completedOpen = [];
    for (const t of values(s.tasks)) {
      if (!isObj(t) || typeof t.id !== 'string') throw new Error('invalid task');
      if (![1, 2, 3, 4].includes(t.urgency)) t.urgency = URGENCY_DEFAULT;
      t.title = String(t.title == null ? '' : t.title);
      t.notes = String(t.notes == null ? '' : t.notes);
      t.completed = !!t.completed;
      if (t.projectId === undefined) t.projectId = null;
      if (typeof t.todoOrder !== 'number') t.todoOrder = 0;
      if (typeof t.projectOrder !== 'number') t.projectOrder = 0;
      if (t.deletedAt === undefined) t.deletedAt = null;
      if (typeof t.rev !== 'number') t.rev = 0;
    }
    for (const p of values(s.projects)) {
      if (!isObj(p) || typeof p.id !== 'string') throw new Error('invalid project');
      if (!PROJECT_COLORS.includes(p.color)) p.color = 'blue';
      if (p.parentId === undefined) p.parentId = null;
      if (typeof p.order !== 'number') p.order = 0;
      p.archived = !!p.archived;
      if (p.deletedAt === undefined) p.deletedAt = null;
      if (typeof p.rev !== 'number') p.rev = 0;
    }
    return s;
  }

  function importData(json) {
    let parsed;
    try { parsed = JSON.parse(json); } catch (e) { throw new Error('JSON を読み取れません'); }
    return migrate(parsed);
  }

  /* ======================= 日付 ======================= */

  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isDayKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
  function splitKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return [y, m - 1, d];
  }

  const Dates = {
    dayKey(ms) { return keyOf(new Date(ms)); },
    parseDay(key) { const [y, m, d] = splitKey(key); return new Date(y, m, d).getTime(); },
    // 86400000 を足すと DST の日にずれるため、暦の上で日を進める。
    addDays(key, n) { const [y, m, d] = splitKey(key); return keyOf(new Date(y, m, d + n)); },
    weekday(key) { const [y, m, d] = splitKey(key); return new Date(y, m, d).getDay(); },
    startOfDay(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); },
    startOfWeek(ms, firstWeekday = 1) {
      const d = new Date(ms);
      const back = (d.getDay() - firstWeekday + 7) % 7;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
    },
    startOfMonth(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); },
    /** a から b までの日数（b が未来なら正）。 */
    diffDays(aKey, bKey) {
      const [ay, am, ad] = splitKey(aKey);
      const [by, bm, bd] = splitKey(bKey);
      return Math.round((Date.UTC(by, bm, bd) - Date.UTC(ay, am, ad)) / DAY_MS);
    },
  };

  /* ======================= タスク ======================= */

  const liveProject = (state, id) => (id && live(state.projects[id]) ? state.projects[id] : null);

  function nextProjectOrder(state, projectId, excludeId) {
    let max = -1;
    for (const t of values(state.tasks)) {
      if (live(t) && t.projectId === projectId && t.id !== excludeId) max = Math.max(max, t.projectOrder || 0);
    }
    return max + 1;
  }

  function createTask(state, { title, notes = '', projectId = null, urgency = URGENCY_DEFAULT, dueDate = null } = {}, now) {
    const clean = String(title == null ? '' : title).trim();
    if (!clean) return null;
    const project = liveProject(state, projectId);
    let maxTodo = -1;
    for (const t of values(state.tasks)) maxTodo = Math.max(maxTodo, t.todoOrder || 0);
    const task = {
      id: uid(),
      title: clean,
      notes: String(notes || ''),
      completed: false,
      completedAt: null,
      dueDate: isDayKey(dueDate) ? dueDate : null,
      urgency: [1, 2, 3, 4].includes(urgency) ? urgency : URGENCY_DEFAULT,
      projectId: project ? project.id : null,
      todoOrder: maxTodo + 1,
      projectOrder: project ? nextProjectOrder(state, project.id) : 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      rev: 0,
    };
    state.tasks[task.id] = task;
    return task;
  }

  function requireTask(state, id) {
    const t = state.tasks[id];
    if (!t) throw new Error('task not found');
    return t;
  }

  function updateTask(state, id, patch, now) {
    const t = requireTask(state, id);
    let changed = false;
    if ('title' in patch) {
      const v = String(patch.title == null ? '' : patch.title).trim();
      if (v && v !== t.title) { t.title = v; changed = true; }
    }
    if ('notes' in patch) {
      const v = String(patch.notes == null ? '' : patch.notes);
      if (v !== t.notes) { t.notes = v; changed = true; }
    }
    if ('urgency' in patch && [1, 2, 3, 4].includes(patch.urgency) && patch.urgency !== t.urgency) {
      t.urgency = patch.urgency; changed = true;
    }
    if ('dueDate' in patch) {
      const v = isDayKey(patch.dueDate) ? patch.dueDate : null;
      if (v !== t.dueDate) { t.dueDate = v; changed = true; }
    }
    if ('projectId' in patch) {
      const p = liveProject(state, patch.projectId);
      const v = p ? p.id : null;
      if (v !== t.projectId) {
        t.projectId = v;
        t.projectOrder = v ? nextProjectOrder(state, v, t.id) : 0;
        changed = true;
      }
    }
    if (changed) touch(t, now);
    return t;
  }

  function setCompleted(state, id, done, now) {
    const t = requireTask(state, id);
    if (t.completed === !!done) return t;
    t.completed = !!done;
    t.completedAt = done ? now : null;
    touch(t, now);
    return t;
  }

  function newBatch(state, fields, now) {
    const batch = Object.assign({ id: uid(), kind: 'task', title: '', mode: null, at: now, projectIds: [], taskIds: [], reparented: {}, unassigned: {} }, fields);
    state.trash[batch.id] = batch;
    return batch;
  }

  function dropFromFocus(state, taskIds) {
    if (!state.focus) return;
    const set = new Set(taskIds);
    state.focus.items = state.focus.items.filter((it) => !set.has(it.taskId));
  }

  function trashTask(state, id, now) {
    const t = requireTask(state, id);
    if (t.deletedAt) return null;
    t.deletedAt = now;
    touch(t, now);
    dropFromFocus(state, [id]);
    state.carryOver = state.carryOver.filter((x) => x !== id);
    return newBatch(state, { kind: 'task', title: t.title, taskIds: [id] }, now).id;
  }

  const todoSort = (a, b) => (a.todoOrder - b.todoOrder) || (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  function activeTodo(state) {
    return values(state.tasks).filter((t) => live(t) && !t.completed).sort(todoSort);
  }

  function completedTodo(state) {
    return values(state.tasks).filter((t) => live(t) && t.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  }

  function reorderTodo(state, orderedIds, now) {
    const tasks = orderedIds.map((id) => state.tasks[id]).filter((t) => live(t) && !t.completed);
    let slots = tasks.map((t) => t.todoOrder).sort((a, b) => a - b);
    if (new Set(slots).size !== slots.length) {
      const base = slots.length ? slots[0] : 0;
      slots = tasks.map((_, i) => base + i);
    }
    tasks.forEach((t, i) => {
      if (t.todoOrder !== slots[i]) { t.todoOrder = slots[i]; touch(t, now); }
    });
  }

  function orbitTasks(state, n = 6) {
    return activeTodo(state).slice(0, n);
  }

  /* ======================= プロジェクト ======================= */

  /** 表示上の親。欠損・削除済み・自分自身なら null（ルート扱い）。 */
  function effectiveParent(state, p) {
    const parent = p.parentId && p.parentId !== p.id ? state.projects[p.parentId] : null;
    return live(parent) ? parent.id : null;
  }

  function children(state, parentId, { includeArchived = false } = {}) {
    return values(state.projects)
      .filter((p) => live(p) && effectiveParent(state, p) === (parentId || null) && (includeArchived || !p.archived))
      .sort((a, b) => (a.order - b.order) || (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1));
  }

  function descendants(state, id) {
    const out = [];
    const seen = new Set([id]);
    const kids = new Map();
    for (const p of values(state.projects)) {
      if (!live(p)) continue;
      const parent = effectiveParent(state, p);
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(p);
    }
    for (const list of kids.values()) list.sort((a, b) => (a.order - b.order) || (a.createdAt - b.createdAt));
    // 深さ優先・前順
    const visit = (pid) => {
      for (const c of kids.get(pid) || []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c.id);
        visit(c.id);
      }
    };
    visit(id);
    return out;
  }

  function ancestors(state, id) {
    const out = [];
    const seen = new Set([id]);
    let p = state.projects[id];
    while (p) {
      const parentId = effectiveParent(state, p);
      if (!parentId || seen.has(parentId)) break;
      seen.add(parentId);
      out.push(parentId);
      p = state.projects[parentId];
    }
    return out;
  }

  function path(state, id) {
    if (!state.projects[id]) return [];
    return [...ancestors(state, id).reverse(), id].map((x) => state.projects[x]);
  }

  function createProject(state, { name, parentId = null, color } = {}, now) {
    const clean = String(name == null ? '' : name).trim();
    if (!clean) return null;
    const parent = liveProject(state, parentId);
    const siblings = children(state, parent ? parent.id : null, { includeArchived: true });
    const p = {
      id: uid(),
      name: clean,
      parentId: parent ? parent.id : null,
      order: siblings.length ? Math.max(...siblings.map((x) => x.order)) + 1 : 0,
      color: PROJECT_COLORS.includes(color) ? color : (parent ? parent.color : 'blue'),
      archived: false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      rev: 0,
    };
    state.projects[p.id] = p;
    return p;
  }

  function requireProject(state, id) {
    const p = state.projects[id];
    if (!p) throw new Error('project not found');
    return p;
  }

  function updateProject(state, id, { name, color } = {}, now) {
    const p = requireProject(state, id);
    let changed = false;
    const clean = name == null ? '' : String(name).trim();
    if (clean && clean !== p.name) { p.name = clean; changed = true; }
    if (PROJECT_COLORS.includes(color) && color !== p.color) { p.color = color; changed = true; }
    if (changed) touch(p, now);
    return p;
  }

  function canMoveProject(state, id, newParentId) {
    if (!live(state.projects[id])) return false;
    if (newParentId == null) return true;
    if (newParentId === id || !live(state.projects[newParentId])) return false;
    return !descendants(state, id).includes(newParentId);
  }

  function moveProject(state, id, newParentId, index, now) {
    if (!canMoveProject(state, id, newParentId)) throw new Error('cycle');
    const p = state.projects[id];
    const target = newParentId || null;
    const siblings = children(state, target, { includeArchived: true }).filter((x) => x.id !== id);
    const at = Math.max(0, Math.min(Number.isInteger(index) ? index : siblings.length, siblings.length));
    siblings.splice(at, 0, p);
    if (p.parentId !== target) { p.parentId = target; touch(p, now); }
    siblings.forEach((x, i) => {
      if (x.order !== i) { x.order = i; if (x !== p) touch(x, now); }
    });
    if (p.updatedAt !== now) touch(p, now);
    return p;
  }

  function projectTasks(state, projectId) {
    const mine = values(state.tasks).filter((t) => live(t) && t.projectId === projectId);
    return {
      active: mine.filter((t) => !t.completed).sort((a, b) => (a.projectOrder - b.projectOrder) || (a.createdAt - b.createdAt)),
      completed: mine.filter((t) => t.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
    };
  }

  function moveTask(state, taskId, projectId, index, now) {
    const t = requireTask(state, taskId);
    const p = liveProject(state, projectId);
    const target = p ? p.id : null;
    const list = target ? projectTasks(state, target).active.filter((x) => x.id !== taskId) : [];
    const at = Math.max(0, Math.min(Number.isInteger(index) ? index : list.length, list.length));
    list.splice(at, 0, t);
    if (t.projectId !== target) { t.projectId = target; touch(t, now); }
    list.forEach((x, i) => {
      if (x.projectOrder !== i) { x.projectOrder = i; if (x !== t) touch(x, now); }
    });
    if (t.updatedAt !== now) touch(t, now);
    return t;
  }

  function progress(state, id) {
    const ids = new Set([id, ...descendants(state, id)]);
    let done = 0;
    let total = 0;
    for (const t of values(state.tasks)) {
      if (!live(t) || !ids.has(t.projectId)) continue;
      total += 1;
      if (t.completed) done += 1;
    }
    return { done, total };
  }

  function isEffectivelyArchived(state, id) {
    const p = state.projects[id];
    if (!p) return false;
    if (p.archived) return true;
    return ancestors(state, id).some((a) => state.projects[a].archived);
  }

  function setArchived(state, id, archived, now) {
    const p = requireProject(state, id);
    if (p.archived === !!archived) return p;
    p.archived = !!archived;
    p.archivedAt = archived ? now : null;
    touch(p, now);
    return p;
  }

  function archivedProjects(state) {
    return values(state.projects).filter((p) => live(p) && p.archived).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  }

  function deletionPreview(state, id, mode) {
    requireProject(state, id);
    if (mode === 'keep') {
      return {
        projects: 1,
        tasks: 0,
        reparented: children(state, id, { includeArchived: true }).length,
        unassigned: values(state.tasks).filter((t) => live(t) && t.projectId === id).length,
      };
    }
    const ids = new Set([id, ...descendants(state, id)]);
    return {
      projects: ids.size,
      tasks: values(state.tasks).filter((t) => live(t) && ids.has(t.projectId)).length,
      reparented: 0,
      unassigned: 0,
    };
  }

  function deleteProject(state, id, mode, now) {
    const p = requireProject(state, id);
    if (p.deletedAt) return null;
    const parentId = effectiveParent(state, p);
    const batch = newBatch(state, { kind: 'project', title: p.name, mode: mode === 'all' ? 'all' : 'keep', rootId: id, parentId }, now);
    if (batch.mode === 'keep') {
      let nextOrder = children(state, parentId, { includeArchived: true }).reduce((m, x) => Math.max(m, x.order), -1) + 1;
      for (const c of children(state, id, { includeArchived: true })) {
        batch.reparented[c.id] = id;
        c.parentId = parentId;
        c.order = nextOrder++;
        touch(c, now);
      }
      for (const t of values(state.tasks)) {
        if (live(t) && t.projectId === id) {
          batch.unassigned[t.id] = id;
          t.projectId = null;
          touch(t, now);
        }
      }
      batch.projectIds = [id];
      p.deletedAt = now;
      touch(p, now);
    } else {
      const ids = [id, ...descendants(state, id)];
      const set = new Set(ids);
      for (const pid of ids) {
        const x = state.projects[pid];
        x.deletedAt = now;
        touch(x, now);
      }
      for (const t of values(state.tasks)) {
        if (live(t) && set.has(t.projectId)) {
          t.deletedAt = now;
          touch(t, now);
          batch.taskIds.push(t.id);
        }
      }
      batch.projectIds = ids;
      dropFromFocus(state, batch.taskIds);
      const removed = new Set(batch.taskIds);
      state.carryOver = state.carryOver.filter((x) => !removed.has(x));
    }
    return batch.id;
  }

  function treeRows(state, { expanded = [], completedOpen = [] } = {}) {
    const open = new Set(expanded);
    const copen = new Set(completedOpen);
    const rows = [];
    const seen = new Set();
    const walk = (parentId, depth) => {
      for (const p of children(state, parentId)) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const kids = children(state, p.id);
        const tasks = projectTasks(state, p.id);
        const isOpen = open.has(p.id);
        rows.push({
          type: 'project', project: p, depth,
          hasChildren: kids.length + tasks.active.length + tasks.completed.length > 0,
          expanded: isOpen, progress: progress(state, p.id),
        });
        if (!isOpen) continue;
        for (const t of tasks.active) rows.push({ type: 'task', task: t, depth: depth + 1, projectId: p.id });
        if (tasks.completed.length) {
          const cOpen = copen.has(p.id);
          rows.push({ type: 'completedHeader', projectId: p.id, count: tasks.completed.length, open: cOpen, depth: depth + 1 });
          if (cOpen) for (const t of tasks.completed) rows.push({ type: 'completedTask', task: t, depth: depth + 1, projectId: p.id });
        }
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  }

  const norm = (s) => String(s || '').normalize('NFKC').toLowerCase();

  function search(state, query) {
    const q = norm(query).trim();
    if (!q) return [];
    const names = (pid) => (pid ? path(state, pid).map((p) => p.name) : []);
    const projects = values(state.projects)
      .filter((p) => live(p) && norm(p.name).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      .slice(0, 50)
      .map((p) => ({ type: 'project', id: p.id, title: p.name, path: names(p.id).slice(0, -1), archived: isEffectivelyArchived(state, p.id) }));
    const tasks = values(state.tasks)
      .filter((t) => live(t) && norm(t.title).includes(q))
      .sort((a, b) => (a.completed - b.completed) || todoSort(a, b))
      .slice(0, 50)
      .map((t) => {
        const pid = liveProject(state, t.projectId) ? t.projectId : null;
        return { type: 'task', id: t.id, title: t.title, path: names(pid), archived: pid ? isEffectivelyArchived(state, pid) : false };
      });
    return projects.concat(tasks);
  }

  /* ======================= ごみ箱 ======================= */

  function trashList(state) {
    return values(state.trash).sort((a, b) => b.at - a.at);
  }

  function restoreBatch(state, batchId, now) {
    const b = state.trash[batchId];
    if (!b) return false;
    for (const pid of b.projectIds) {
      const p = state.projects[pid];
      if (p && p.deletedAt) { p.deletedAt = null; touch(p, now); }
    }
    for (const tid of b.taskIds) {
      const t = state.tasks[tid];
      if (t && t.deletedAt) {
        t.deletedAt = null;
        if (t.projectId && !liveProject(state, t.projectId)) t.projectId = null;
        touch(t, now);
      }
    }
    // keep モードで動かしたものは、その後ユーザーが別の場所へ動かしていなければ元へ戻す。
    for (const [cid, oldParent] of Object.entries(b.reparented || {})) {
      const c = state.projects[cid];
      if (live(c) && (c.parentId || null) === (b.parentId || null) && live(state.projects[oldParent])) {
        c.parentId = oldParent;
        touch(c, now);
      }
    }
    for (const [tid, oldProject] of Object.entries(b.unassigned || {})) {
      const t = state.tasks[tid];
      if (live(t) && t.projectId === null && live(state.projects[oldProject])) {
        t.projectId = oldProject;
        touch(t, now);
      }
    }
    if (b.rootId) {
      const root = state.projects[b.rootId];
      if (root && root.parentId && !liveProject(state, root.parentId)) { root.parentId = null; touch(root, now); }
    }
    delete state.trash[batchId];
    return true;
  }

  function deleteBatchNow(state, batchId, now) {
    const b = state.trash[batchId];
    if (!b) return false;
    for (const pid of b.projectIds) {
      const p = state.projects[pid];
      if (p && p.deletedAt) { delete state.projects[pid]; state.tombstones[pid] = now; }
    }
    for (const tid of b.taskIds) {
      const t = state.tasks[tid];
      if (t && t.deletedAt) { delete state.tasks[tid]; state.tombstones[tid] = now; }
    }
    delete state.trash[batchId];
    return true;
  }

  function purgeTrash(state, now) {
    const limit = (state.settings.trashDays || 30) * DAY_MS;
    let count = 0;
    for (const b of values(state.trash)) {
      if (now - b.at >= limit && deleteBatchNow(state, b.id, now)) count += 1;
    }
    return count;
  }

  /* ======================= ポモドーロ ======================= */
  // エンジンは JSON 化できるプレーンオブジェクト。経過は「実時刻の差分」で求め、advance の呼び出し回数に依存しない。

  const Pomodoro = {
    create(settings = defaultSettings()) {
      const s = Object.assign(defaultSettings(), settings);
      return {
        focusMs: s.focusMin * 60000,
        shortMs: s.shortMin * 60000,
        longMs: s.longMin * 60000,
        cycles: Math.max(1, s.cycles | 0),
        status: 'idle',
        phase: 'focus',
        phaseElapsed: 0,   // 現フェーズで、現在の走行区間より前に経過した時間
        runStart: null,    // 走行中なら現在の走行区間の開始時刻
        openStart: null,   // 集中中なら現在の集中区間の開始時刻
        completed: 0,
        intervals: [],
        completions: [],
        lastNow: null,
      };
    },

    _now(e, now) {
      // 時計が巻き戻っても経過が負にならないよう単調化する。
      const t = e.lastNow == null ? now : Math.max(now, e.lastNow);
      e.lastNow = t;
      return t;
    },
    _duration(e) {
      return e.phase === 'focus' ? e.focusMs : e.phase === 'longBreak' ? e.longMs : e.shortMs;
    },
    _closeInterval(e, end) {
      if (e.openStart != null && end > e.openStart) e.intervals.push({ start: e.openStart, end });
      e.openStart = null;
    },

    start(e, now) {
      now = Pomodoro._now(e, now);
      if (e.status !== 'idle' && e.status !== 'awaitingFocus') return e;
      e.phase = 'focus';
      e.phaseElapsed = 0;
      e.runStart = now;
      e.openStart = now;
      e.status = 'running';
      return e;
    },

    pause(e, now) {
      now = Pomodoro._now(e, now);
      if (e.status !== 'running') return e;
      Pomodoro.advance(e, now);
      if (e.status !== 'running') return e;
      e.phaseElapsed += now - e.runStart;
      e.runStart = null;
      if (e.phase === 'focus') Pomodoro._closeInterval(e, now);
      e.status = 'paused';
      return e;
    },

    resume(e, now) {
      now = Pomodoro._now(e, now);
      if (e.status !== 'paused') return e;
      e.runStart = now;
      if (e.phase === 'focus') e.openStart = now;
      e.status = 'running';
      return e;
    },

    advance(e, now) {
      now = Pomodoro._now(e, now);
      const events = [];
      while (e.status === 'running') {
        const endAt = e.runStart + (Pomodoro._duration(e) - e.phaseElapsed);
        if (now < endAt) break;
        if (e.phase === 'focus') {
          Pomodoro._closeInterval(e, endAt);
          e.completed += 1;
          e.completions.push(endAt);
          events.push({ type: 'focusCompleted', count: e.completed, at: endAt });
          e.phase = e.completed % e.cycles === 0 ? 'longBreak' : 'shortBreak';
          e.phaseElapsed = 0;
          e.runStart = endAt;
          events.push({ type: 'breakStarted', phase: e.phase, at: endAt });
        } else {
          events.push({ type: 'breakCompleted', at: endAt });
          e.phase = 'focus';
          e.phaseElapsed = 0;
          e.runStart = null;
          e.status = 'awaitingFocus';
        }
      }
      return events;
    },

    skipBreak(e, now) {
      now = Pomodoro._now(e, now);
      if (e.phase === 'focus' || (e.status !== 'running' && e.status !== 'paused')) return e;
      e.phase = 'focus';
      e.phaseElapsed = 0;
      e.runStart = null;
      e.status = 'awaitingFocus';
      return e;
    },

    finish(e, now) {
      now = Pomodoro._now(e, now);
      if (e.status === 'finished') return { intervals: e.intervals.slice(), completions: e.completions.slice() };
      Pomodoro.advance(e, now);
      if (e.status === 'running' && e.phase === 'focus') Pomodoro._closeInterval(e, now);
      e.status = 'finished';
      e.runStart = null;
      e.openStart = null;
      return { intervals: e.intervals.slice(), completions: e.completions.slice() };
    },

    remaining(e, now) {
      if (e.status === 'idle' || e.status === 'awaitingFocus' || e.status === 'finished') return e.focusMs;
      const t = e.lastNow == null ? now : Math.max(now, e.lastNow);
      const elapsed = e.phaseElapsed + (e.status === 'running' ? t - e.runStart : 0);
      return Math.max(0, Pomodoro._duration(e) - elapsed);
    },

    elapsedFocus(e, now) {
      let sum = e.intervals.reduce((acc, x) => acc + (x.end - x.start), 0);
      if (e.status === 'running' && e.phase === 'focus' && e.openStart != null) {
        const t = e.lastNow == null ? now : Math.max(now, e.lastNow);
        sum += Math.min(t, e.runStart + (e.focusMs - e.phaseElapsed)) - e.openStart;
      }
      return Math.max(0, sum);
    },

    status(e) { return e.status; },
    phase(e) { return e.phase; },
  };

  /* ======================= 集中セッション ======================= */

  const Focus = {
    begin(state, firstTaskId, now) {
      if (state.focus) return state.focus;
      const ids = [];
      for (const id of [firstTaskId, ...state.carryOver]) {
        const t = id && state.tasks[id];
        if (live(t) && !t.completed && !ids.includes(id)) ids.push(id);
      }
      state.focus = {
        id: uid(),
        startedAt: now,
        engine: Pomodoro.create(state.settings),
        items: ids.map((taskId, order) => ({ taskId, order })),
      };
      state.carryOver = [];
      return state.focus;
    },

    addTask(state, taskId) {
      const f = state.focus;
      const t = state.tasks[taskId];
      if (!f || !live(t) || f.items.some((it) => it.taskId === taskId)) return false;
      const order = f.items.reduce((m, it) => Math.max(m, it.order), -1) + 1;
      f.items.push({ taskId, order });
      return true;
    },

    addNewTask(state, title, now) {
      const t = createTask(state, { title }, now);
      if (t) Focus.addTask(state, t.id);
      return t;
    },

    removeTask(state, taskId) {
      if (!state.focus) return false;
      const before = state.focus.items.length;
      state.focus.items = state.focus.items.filter((it) => it.taskId !== taskId);
      return state.focus.items.length !== before;
    },

    reorder(state, orderedIds) {
      if (!state.focus) return;
      const pos = new Map(orderedIds.map((id, i) => [id, i]));
      const sorted = state.focus.items.slice().sort((a, b) => {
        const pa = pos.has(a.taskId) ? pos.get(a.taskId) : orderedIds.length + a.order;
        const pb = pos.has(b.taskId) ? pos.get(b.taskId) : orderedIds.length + b.order;
        return pa - pb;
      });
      sorted.forEach((it, i) => { it.order = i; });
      state.focus.items = sorted;
    },

    items(state) {
      if (!state.focus) return [];
      return state.focus.items
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((it) => ({ task: state.tasks[it.taskId], order: it.order }))
        .filter((x) => live(x.task));
    },

    advance(state, now) {
      return state.focus ? Pomodoro.advance(state.focus.engine, now) : [];
    },

    end(state, now, decisions = {}, { carryOver = true } = {}) {
      const f = state.focus;
      if (!f) return { focusMs: 0, pomodoros: 0 };
      const { intervals, completions } = Pomodoro.finish(f.engine, now);
      let valid = intervals.filter((x) => x.end > x.start);
      let done = completions;
      // 開いてすぐ閉じた（合計 10 秒未満でポモドーロも未完了）場合は記録しない。
      if (!done.length && valid.reduce((acc, x) => acc + (x.end - x.start), 0) < MIN_RECORD_MS) { valid = []; done = []; }
      state.focusLog.push(...valid);
      state.pomodoroLog.push(...done);
      for (const { task } of Focus.items(state)) {
        const d = decisions[task.id];
        if (d === true) setCompleted(state, task.id, true, now);
        else if (d === false && carryOver && !task.completed && !state.carryOver.includes(task.id)) state.carryOver.push(task.id);
      }
      state.focus = null;
      return { focusMs: valid.reduce((acc, x) => acc + (x.end - x.start), 0), pomodoros: done.length };
    },
  };

  /* ======================= 統計 ======================= */

  function unionIntervals(list) {
    const sorted = list.filter((x) => x && x.end > x.start).map((x) => ({ start: x.start, end: x.end })).sort((a, b) => a.start - b.start);
    const out = [];
    for (const x of sorted) {
      const last = out[out.length - 1];
      if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
      else out.push(x);
    }
    return out;
  }

  function periodStart(ms, granularity, firstWeekday) {
    if (granularity === 'week') return Dates.startOfWeek(ms, firstWeekday);
    if (granularity === 'month') return Dates.startOfMonth(ms);
    return Dates.startOfDay(ms);
  }
  function nextPeriod(ms, granularity) {
    const d = new Date(ms);
    if (granularity === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    if (granularity === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }

  function collectIntervals(state) {
    const list = state.focusLog.slice();
    const f = state.focus;
    if (f && f.engine) {
      list.push(...f.engine.intervals);
      const e = f.engine;
      if (e.status === 'running' && e.phase === 'focus' && e.openStart != null && e.lastNow != null && e.lastNow > e.openStart) {
        list.push({ start: e.openStart, end: e.lastNow });
      }
    }
    return list;
  }
  function collectCompletions(state) {
    const list = state.pomodoroLog.slice();
    if (state.focus && state.focus.engine) list.push(...state.focus.engine.completions);
    return list;
  }

  const Stats = {
    buckets(state, granularity, rangeStartMs, rangeEndMs) {
      const fw = state.settings.firstWeekday == null ? 1 : state.settings.firstWeekday;
      const intervals = unionIntervals(collectIntervals(state));
      const completions = collectCompletions(state);
      const out = [];
      let start = periodStart(rangeStartMs, granularity, fw);
      let guard = 0;
      while (start < rangeEndMs && guard++ < 2000) {
        const end = nextPeriod(start, granularity);
        const lo = Math.max(start, rangeStartMs);
        const hi = Math.min(end, rangeEndMs);
        let focusMs = 0;
        for (const x of intervals) {
          const a = Math.max(x.start, lo);
          const b = Math.min(x.end, hi);
          if (b > a) focusMs += b - a;
        }
        const pomodoros = completions.filter((c) => c >= lo && c < hi).length;
        out.push({ start, end, focusMs, pomodoros });
        start = end;
      }
      return out;
    },

    defaultRange(granularity, now, firstWeekday = 1) {
      if (granularity === 'week') {
        const thisWeek = Dates.startOfWeek(now, firstWeekday);
        const d = new Date(thisWeek);
        return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7 * 7).getTime(), end: nextPeriod(thisWeek, 'week') };
      }
      if (granularity === 'month') {
        const d = new Date(now);
        return { start: new Date(d.getFullYear(), d.getMonth() - 5, 1).getTime(), end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
      }
      const today = Dates.startOfDay(now);
      const d = new Date(today);
      return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime(), end: nextPeriod(today, 'day') };
    },

    totals(state, startMs, endMs) {
      let focusMs = 0;
      for (const x of unionIntervals(collectIntervals(state))) {
        const a = Math.max(x.start, startMs);
        const b = Math.min(x.end, endMs);
        if (b > a) focusMs += b - a;
      }
      const pomodoros = collectCompletions(state).filter((c) => c >= startMs && c < endMs).length;
      return { focusMs, pomodoros };
    },
  };

  /* ======================= 復習 ======================= */

  const Review = {
    _intervals(state) {
      const iv = state.settings.reviewIntervals;
      return Array.isArray(iv) && iv.length ? iv : defaultSettings().reviewIntervals;
    },

    create(state, { title, notes = '' } = {}, today, now) {
      const clean = String(title == null ? '' : title).trim();
      if (!clean) return null;
      const iv = Review._intervals(state);
      const item = {
        id: uid(), title: clean, notes: String(notes || ''),
        createdOn: today, step: 0, nextDue: Dates.addDays(today, iv[0]), mastered: false, history: [],
        createdAt: now, updatedAt: now, deletedAt: null, rev: 0,
      };
      state.reviews[item.id] = item;
      return item;
    },

    complete(state, id, today, now) {
      const r = state.reviews[id];
      if (!live(r) || r.mastered) return r || null;
      const iv = Review._intervals(state);
      r.history.push({ on: today, at: now, step: r.step });
      r.step += 1;
      if (r.step >= iv.length) {
        // 最後の間隔に達しても終わらせず、以後は最後の間隔で繰り返す。
        r.nextDue = Dates.addDays(today, iv[iv.length - 1]);
      } else {
        // 間隔は学習日からの累積日数。遅れて復習しても次回を今日以前にしない。
        const planned = Dates.addDays(r.createdOn, iv[r.step]);
        const earliest = Dates.addDays(today, 1);
        r.nextDue = planned > earliest ? planned : earliest;
      }
      touch(r, now);
      return r;
    },

    due(state, today) {
      return values(state.reviews)
        .filter((r) => live(r) && !r.mastered && r.nextDue && r.nextDue <= today)
        .sort((a, b) => (a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : a.createdAt - b.createdAt));
    },

    upcoming(state, today) {
      return values(state.reviews)
        .filter((r) => live(r) && !r.mastered && r.nextDue && r.nextDue > today)
        .sort((a, b) => (a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : a.createdAt - b.createdAt));
    },

    mastered(state) {
      const last = (r) => (r.history.length ? r.history[r.history.length - 1].at : 0);
      return values(state.reviews).filter((r) => live(r) && r.mastered).sort((a, b) => last(b) - last(a));
    },

    update(state, id, { title, notes } = {}, now) {
      const r = state.reviews[id];
      if (!r) return null;
      let changed = false;
      const clean = title == null ? '' : String(title).trim();
      if (clean && clean !== r.title) { r.title = clean; changed = true; }
      if (notes != null && String(notes) !== r.notes) { r.notes = String(notes); changed = true; }
      if (changed) touch(r, now);
      return r;
    },

    remove(state, id, now) {
      const r = state.reviews[id];
      if (!r || r.deletedAt) return false;
      r.deletedAt = now;
      touch(r, now);
      return true;
    },

    reset(state, id, today, now) {
      const r = state.reviews[id];
      if (!live(r)) return null;
      r.step = 0;
      r.mastered = false;
      r.createdOn = today;
      r.nextDue = Dates.addDays(today, Review._intervals(state)[0]);
      touch(r, now);
      return r;
    },
  };

  /* ======================= 読書 ======================= */

  const toPages = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const Books = {
    create(state, { title, author = '', totalPages = null } = {}, now) {
      const clean = String(title == null ? '' : title).trim();
      if (!clean) return null;
      const b = {
        id: uid(), title: clean, author: String(author || '').trim(), status: 'want',
        totalPages: toPages(totalPages), currentPage: 0, startedOn: null, finishedOn: null, notes: '',
        createdAt: now, updatedAt: now, deletedAt: null, rev: 0,
      };
      state.books[b.id] = b;
      return b;
    },

    update(state, id, patch = {}, now) {
      const b = state.books[id];
      if (!b) return null;
      if ('title' in patch) { const v = String(patch.title || '').trim(); if (v) b.title = v; }
      if ('author' in patch) b.author = String(patch.author || '').trim();
      if ('notes' in patch) b.notes = String(patch.notes || '');
      if ('totalPages' in patch) {
        b.totalPages = toPages(patch.totalPages);
        if (b.totalPages != null && b.currentPage > b.totalPages) b.currentPage = b.totalPages;
      }
      touch(b, now);
      return b;
    },

    remove(state, id, now) {
      const b = state.books[id];
      if (!b || b.deletedAt) return false;
      b.deletedAt = now;
      touch(b, now);
      return true;
    },

    setStatus(state, id, status, today, now) {
      const b = state.books[id];
      if (!live(b) || !BOOK_STATUSES.includes(status)) return b || null;
      b.status = status;
      if (status === 'reading') {
        if (!b.startedOn) b.startedOn = today;
        b.finishedOn = null;
      } else if (status === 'done') {
        if (!b.startedOn) b.startedOn = today;
        b.finishedOn = today;
        if (b.totalPages) b.currentPage = b.totalPages;
      } else {
        b.finishedOn = null;
      }
      touch(b, now);
      return b;
    },

    setProgress(state, id, page, today, now) {
      const b = state.books[id];
      if (!live(b)) return null;
      let p = Math.round(Number(page));
      if (!Number.isFinite(p)) p = 0;
      p = Math.max(0, b.totalPages ? Math.min(p, b.totalPages) : p);
      b.currentPage = p;
      if (b.status === 'want' && p > 0) {
        b.status = 'reading';
        if (!b.startedOn) b.startedOn = today;
      }
      touch(b, now);
      return b;
    },

    list(state, status) {
      const list = values(state.books).filter((b) => live(b) && b.status === status);
      if (status === 'reading') return list.sort((a, b) => b.updatedAt - a.updatedAt);
      if (status === 'done') return list.sort((a, b) => ((b.finishedOn || '') < (a.finishedOn || '') ? -1 : (b.finishedOn || '') > (a.finishedOn || '') ? 1 : b.updatedAt - a.updatedAt));
      return list.sort((a, b) => a.createdAt - b.createdAt);
    },
  };

  /* ======================= 習慣 ======================= */

  function cleanDays(days) {
    if (!Array.isArray(days)) return null;
    const set = [...new Set(days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    return set.length && set.length < 7 ? set : null;
  }

  const Habits = {
    create(state, { name, days = null } = {}, now) {
      const clean = String(name == null ? '' : name).trim();
      if (!clean) return null;
      const order = values(state.habits).reduce((m, h) => Math.max(m, h.order || 0), -1) + 1;
      const h = { id: uid(), name: clean, days: cleanDays(days), completions: {}, order, createdAt: now, updatedAt: now, deletedAt: null, rev: 0 };
      state.habits[h.id] = h;
      return h;
    },

    update(state, id, patch = {}, now) {
      const h = state.habits[id];
      if (!h) return null;
      if ('name' in patch) { const v = String(patch.name || '').trim(); if (v) h.name = v; }
      if ('days' in patch) h.days = cleanDays(patch.days);
      touch(h, now);
      return h;
    },

    remove(state, id, now) {
      const h = state.habits[id];
      if (!h || h.deletedAt) return false;
      h.deletedAt = now;
      touch(h, now);
      return true;
    },

    isScheduled(habit, dayKey) {
      return !habit.days || habit.days.includes(Dates.weekday(dayKey));
    },

    toggle(state, id, dayKey, now) {
      const h = state.habits[id];
      if (!live(h)) return false;
      if (h.completions[dayKey]) delete h.completions[dayKey];
      else h.completions[dayKey] = true;
      touch(h, now);
      return !!h.completions[dayKey];
    },

    forDay(state, dayKey) {
      return values(state.habits)
        .filter(live)
        .map((habit) => ({ habit, done: !!habit.completions[dayKey], scheduled: Habits.isScheduled(habit, dayKey) }))
        .sort((a, b) => (b.scheduled - a.scheduled) || (a.habit.order - b.habit.order));
    },

    month(state, id, year, month0) {
      const h = state.habits[id];
      if (!h) return [];
      const days = new Date(year, month0 + 1, 0).getDate();
      const out = [];
      for (let d = 1; d <= days; d += 1) {
        const day = keyOf(new Date(year, month0, d));
        out.push({ day, scheduled: Habits.isScheduled(h, day), done: !!h.completions[day] });
      }
      return out;
    },
  };

  /* ======================= 設定 ======================= */

  const SETTING_RANGES = { focusMin: [1, 180], shortMin: [1, 60], longMin: [1, 90], cycles: [1, 12], trashDays: [1, 365], firstWeekday: [0, 6] };

  function updateSettings(state, patch = {}) {
    const s = state.settings;
    for (const [key, [lo, hi]] of Object.entries(SETTING_RANGES)) {
      if (!(key in patch)) continue;
      const v = Number(patch[key]);
      if (Number.isInteger(v) && v >= lo && v <= hi) s[key] = v;
    }
    if ('reviewIntervals' in patch) {
      const iv = patch.reviewIntervals;
      const ok = Array.isArray(iv) && iv.length >= 1 && iv.length <= 10
        && iv.every((x, i) => Number.isInteger(x) && x > 0 && (i === 0 || x > iv[i - 1]));
      if (ok) s.reviewIntervals = iv.slice();
    }
    return s;
  }

  const OrbitCore = {
    createState, migrate, importData, uid,
    Dates,
    createTask, updateTask, setCompleted, trashTask, activeTodo, completedTodo, reorderTodo, orbitTasks,
    createProject, updateProject, children, descendants, ancestors, path, canMoveProject, moveProject, moveTask,
    projectTasks, progress, isEffectivelyArchived, setArchived, archivedProjects, deletionPreview, deleteProject,
    treeRows, search,
    trashList, restoreBatch, purgeTrash, deleteBatchNow,
    Pomodoro, Focus, Stats, Review, Books, Habits,
    updateSettings,
    PROJECT_COLORS,
  };

  root.OrbitCore = OrbitCore;
  if (typeof module === 'object' && module.exports) module.exports = OrbitCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
