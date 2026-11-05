/* ORBIT — 集中モード（ポモドーロ）と休憩画面
   時間は OrbitCore.Pomodoro が実時刻の差分で計算する。ここでは表示更新と操作だけを扱う。 */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const C = window.OrbitCore;
  const P = C.Pomodoro;
  const { $, esc, icon, fmtClock, fmtDuration, haptic, toast } = ORBIT.ui;
  const store = ORBIT.store;

  let focusEl, breakEl, breakGem = null, ticker = 0, wakeLock = null, audio = null;
  let lastListKey = '';

  /* ---------- 音（休憩・集中の切り替わりを静かに知らせる） ---------- */
  function unlockAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audio = new Ctx();
  }
  function chime() {
    haptic('success');
    if (!audio || document.visibilityState !== 'visible') return;
    const t = audio.currentTime;
    [659.25, 987.77].forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.18);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 1.6);
      o.connect(g).connect(audio.destination);
      o.start(t + i * 0.18);
      o.stop(t + i * 0.18 + 1.7);
    });
  }

  async function syncWakeLock(on) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (_) { wakeLock = null; }
  }

  /* ---------- 開始・終了 ---------- */
  function open(firstTaskId) {
    unlockAudio();
    store.commit((s, now) => {
      const f = C.Focus.begin(s, firstTaskId, now);
      if (P.status(f.engine) === 'idle') P.start(f.engine, now);
    });
  }

  function requestEnd() {
    const s = store.state;
    const f = s.focus;
    if (!f) return;
    const wasRunning = P.status(f.engine) === 'running';
    // 確認中はタイマーを止め、キャンセル時は元の状態に戻す。
    if (wasRunning) store.commit((st, now) => P.pause(st.focus.engine, now), { silent: true });
    const items = C.Focus.items(s);
    const decisions = {};
    items.forEach(({ task }) => { decisions[task.id] = task.completed; });
    let carry = true;
    let confirmed = false;
    const elapsed = P.elapsedFocus(f.engine, Date.now());
    ORBIT.ui.openSheet({
      title: '集中モードを終了',
      cancelLabel: 'キャンセル',
      done: () => { confirmed = true; finish(decisions, carry); return true; },
      doneLabel: '終了する',
      html: `<p class="note">今回の集中 <b class="num">${fmtDuration(elapsed)}</b>・ポモドーロ <b class="num">${f.engine.completed}</b> 回</p>
        ${items.length ? `<div>${items.map(({ task }) => `<div class="rv-row" data-id="${esc(task.id)}"><span class="t">${esc(task.title)}</span>
          <div class="toggle2"><button type="button" data-v="1" class="${task.completed ? 'on y' : ''}">完了</button><button type="button" data-v="0" class="${task.completed ? '' : 'on'}">未完了</button></div></div>`).join('')}</div>
          <label class="setting" style="border:0"><span>未完了のタスクを次回の集中に引き継ぐ</span><input type="checkbox" checked data-carry style="width:22px;height:22px;accent-color:var(--hi)"></label>`
          : '<p class="note">集中リストは空です。</p>'}`,
      onMount(body) {
        body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-v]'); if (!b) return;
          const row = b.closest('[data-id]');
          decisions[row.dataset.id] = b.dataset.v === '1';
          row.querySelectorAll('[data-v]').forEach((x) => { x.classList.toggle('on', x === b); x.classList.toggle('y', x === b && b.dataset.v === '1'); });
        });
        const cb = body.querySelector('[data-carry]');
        if (cb) cb.addEventListener('change', () => { carry = cb.checked; });
      },
      onClose() {
        if (!confirmed && wasRunning && store.state.focus) store.commit((st, now) => P.resume(st.focus.engine, now));
      },
    });
  }

  function finish(decisions, carry) {
    const r = store.commit((s, now) => C.Focus.end(s, now, decisions, { carryOver: carry }));
    if (r) toast(`集中 ${fmtDuration(r.focusMs)}・ポモドーロ ${r.pomodoros} 回を記録しました`);
  }

  /* ---------- 描画 ---------- */
  function render(state) {
    const f = state.focus;
    if (!f) {
      if (!focusEl.hidden) { focusEl.hidden = true; breakEl.hidden = true; stopTicker(); breakGem && breakGem.stop(); syncWakeLock(false); }
      return;
    }
    focusEl.hidden = false;
    renderList(state);
    tick(true);
    startTicker();
  }

  function renderShell() {
    focusEl.innerHTML = `<div class="timer-wrap">
        <div class="timer-top"><button class="ib" data-f="end" aria-label="集中モードを終了">${icon('close')}</button>
          <span class="phase-label" data-r="phase"></span><span style="width:44px"></span></div>
        <div class="timer num" data-r="clock" role="timer" aria-live="off">25:00</div>
        <div class="cycle-dots" data-r="dots" aria-hidden="true"></div>
        <div class="timer-ctl" data-r="ctl"></div>
        <div class="progress-line" data-r="bar"></div>
      </div>
      <div class="scroll"><ul class="list" id="focusList"></ul>
        <button class="row" data-f="add" style="width:100%;color:var(--hi);align-items:center">${icon('plus')}<span>タスクを追加</span></button>
        <div style="height:60px"></div></div>`;
    breakEl.innerHTML = `<canvas aria-hidden="true"></canvas>
      <div class="break-ui"><div class="phase-label" data-r="bphase">休憩</div><div class="timer num" data-r="bclock">05:00</div>
        <div class="timer-ctl" data-r="bctl"></div></div>`;
  }

  function renderList(state) {
    const items = C.Focus.items(state);
    const key = items.map(({ task }) => `${task.id}:${task.completed}:${task.title}:${task.urgency}:${task.dueDate}`).join('|');
    if (key === lastListKey) return;
    lastListKey = key;
    $('#focusList').innerHTML = items.map(({ task }) => ORBIT.todo.taskRow(state, task, {
      extra: `<button class="ib" data-f="remove" aria-label="集中リストから外す" style="margin:-10px -10px -10px 0;width:40px;height:40px">${icon('close', 'sm')}</button>`,
    })).join('') || `<li class="empty" style="padding:40px 20px">集中するタスクを追加してください</li>`;
  }

  function controls(e) {
    const st = P.status(e);
    if (st === 'running') return `<button class="pill" data-f="pause">${icon('pause')}一時停止</button>`;
    if (st === 'paused') return `<button class="pill primary" data-f="resume">${icon('play')}再開</button>`;
    if (st === 'awaitingFocus') return `<button class="pill primary" data-f="next">${icon('play')}次の集中を開始</button>`;
    return '';
  }

  /** 毎フレームではなく 250ms ごと。表示する残り時間は毎回、保存済みの開始・停止時刻から計算し直す。 */
  function tick(force) {
    const s = store.state;
    const f = s.focus;
    if (!f) return;
    const now = Date.now();
    const events = C.Focus.advance(s, now);
    if (events.length) {
      store.saveNow();
      if (events.some((ev) => ev.type === 'focusCompleted' || ev.type === 'breakCompleted')) chime();
      if (events.some((ev) => ev.type === 'breakCompleted')) toast('休憩が終わりました。準備ができたら集中を開始してください');
      force = true;
    }
    const e = f.engine;
    const st = P.status(e);
    const phase = P.phase(e);
    const isBreak = phase !== 'focus' && (st === 'running' || st === 'paused');
    const awaiting = st === 'awaitingFocus';
    const remaining = P.remaining(e, now);
    const total = phase === 'focus' ? e.focusMs : phase === 'longBreak' ? e.longMs : e.shortMs;

    // 休憩中（と、休憩明けの待機中）はサファイアを表示する
    const showBreak = isBreak || (awaiting && e.completed > 0);
    if (showBreak !== !breakEl.hidden) {
      breakEl.hidden = !showBreak;
      if (showBreak) {
        if (!breakGem) breakGem = ORBIT.Sapphire.create(breakEl.querySelector('canvas'), { gemScale: 1.25 });
        breakGem.start();
      } else if (breakGem) breakGem.stop();
      force = true;
    }

    $('[data-r="clock"]', focusEl).textContent = fmtClock(awaiting ? e.focusMs : remaining);
    $('[data-r="bar"]', focusEl).style.width = `${(phase === 'focus' && st !== 'awaitingFocus' ? 1 - remaining / total : 0) * 100}%`;
    if (showBreak) {
      $('[data-r="bclock"]', breakEl).textContent = fmtClock(awaiting ? 0 : remaining);
      breakEl.querySelector('.break-ui').classList.toggle('done', awaiting);
    }
    if (force) {
      const label = st === 'paused' ? '一時停止中' : awaiting ? '待機中' : phase === 'focus' ? 'Focus' : phase === 'longBreak' ? 'Long Break' : 'Break';
      $('[data-r="phase"]', focusEl).textContent = label;
      const inCycle = e.completed % e.cycles;
      $('[data-r="dots"]', focusEl).innerHTML = Array.from({ length: e.cycles }, (_, i) => `<i class="${i < inCycle || (inCycle === 0 && e.completed > 0 && phase === 'longBreak') ? 'on' : ''}"></i>`).join('');
      $('[data-r="ctl"]', focusEl).innerHTML = controls(e);
      if (showBreak) {
        $('[data-r="bphase"]', breakEl).textContent = awaiting ? '休憩終了' : phase === 'longBreak' ? '長い休憩' : '休憩';
        $('[data-r="bctl"]', breakEl).innerHTML = awaiting
          ? `<button class="pill primary" data-f="next">${icon('play')}集中を開始</button><button class="pill" data-f="end">終了</button>`
          : `${st === 'paused' ? `<button class="pill" data-f="resume">${icon('play')}再開</button>` : `<button class="pill" data-f="pause">${icon('pause')}一時停止</button>`}<button class="pill" data-f="skip">${icon('skip')}休憩をスキップ</button>`;
      }
      document.title = st === 'running' ? `${fmtClock(remaining)} · ORBIT` : 'ORBIT';
      syncWakeLock(st === 'running');
    } else if (st === 'running') {
      document.title = `${fmtClock(remaining)} · ORBIT`;
    }
  }

  function startTicker() { if (!ticker) ticker = setInterval(() => tick(false), 250); }
  function stopTicker() { clearInterval(ticker); ticker = 0; document.title = 'ORBIT'; }

  /* ---------- 追加 ---------- */
  function addSheet() {
    const s = store.state;
    const inFocus = new Set(s.focus.items.map((it) => it.taskId));
    const candidates = C.activeTodo(s).filter((t) => !inFocus.has(t.id));
    ORBIT.ui.openSheet({
      title: 'タスクを追加',
      html: `<form data-new autocomplete="off" class="field"><span>新規タスク（通常 ToDo にも追加されます）</span>
          <div class="btn-row" style="align-items:center"><input class="inp" name="title" placeholder="タスク名" enterkeyhint="done"><button class="pill primary" style="min-width:0;height:46px">追加</button></div></form>
        <div class="field"><span>既存のタスク</span>${candidates.length ? candidates.map((t) => `<button class="pick" data-add="${esc(t.id)}">${icon('plus', 'sm')}${esc(t.title)}</button>`).join('') : '<p class="note">追加できる未完了タスクはありません</p>'}</div>`,
      onMount(body) {
        body.querySelector('[data-new]').addEventListener('submit', (e) => {
          e.preventDefault();
          const input = e.target.title;
          const t = store.commit((st, now) => C.Focus.addNewTask(st, input.value, now));
          if (t) { input.value = ''; toast(`「${t.title}」を追加しました`); }
        });
        body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-add]'); if (!b) return;
          store.commit((st) => C.Focus.addTask(st, b.dataset.add));
          b.remove();
        });
      },
    });
  }

  function onAction(act, row) {
    unlockAudio();
    const now = Date.now();
    switch (act) {
      case 'pause': store.commit((s) => P.pause(s.focus.engine, now)); break;
      case 'resume': store.commit((s) => P.resume(s.focus.engine, now)); break;
      case 'next': store.commit((s) => P.start(s.focus.engine, now)); break;
      case 'skip': store.commit((s) => P.skipBreak(s.focus.engine, now)); break;
      case 'end': requestEnd(); break;
      case 'add': addSheet(); break;
      case 'remove': if (row) store.commit((s) => C.Focus.removeTask(s, row.dataset.id)); break;
      default: break;
    }
  }

  function init() {
    focusEl = $('#focus');
    breakEl = $('#breakView');
    renderShell();
    const handler = (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      onAction(b.dataset.f, e.target.closest('[data-id]'));
    };
    focusEl.addEventListener('click', handler);
    breakEl.addEventListener('click', handler);
    ORBIT.todo.bindList($('#focusList'));
    ORBIT.ui.sortable($('#focusList'), {
      onDrop: ({ ids }) => store.commit((s) => C.Focus.reorder(s, ids)),
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && store.state.focus) { tick(true); }
    });
  }

  ORBIT.focus = { init, render, open };
})();
