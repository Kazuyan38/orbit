/* ORBIT — 永続化と変更の一元管理。
   state は OrbitCore が定義するプレーンな JSON。すべての変更は commit() を通し、保存・再描画・Undo をここで扱う。 */
(function () {
  'use strict';
  const ORBIT = (window.ORBIT = window.ORBIT || {});
  const C = window.OrbitCore;
  const KEY = 'orbit.state.v1';

  let state = null;
  let saveTimer = 0;
  const listeners = new Set();
  const savedListeners = new Set();

  function storageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { console.error('ORBIT: save failed', e); return false; }
  }

  function load() {
    const raw = storageGet(KEY);
    if (!raw) { state = C.createState(); return; }
    try {
      state = C.migrate(JSON.parse(raw));
    } catch (e) {
      // 読めないデータは捨てずに退避してから空で起動する（設定画面から書き出し可能）。
      storageSet(`${KEY}.corrupt.${Date.now()}`, raw);
      ORBIT.loadError = e;
      state = C.createState();
    }
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!storageSet(KEY, JSON.stringify(state))) ORBIT.ui.toast('保存できませんでした（ストレージ容量を確認してください）');
    savedListeners.forEach((fn) => fn(state));
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 120);
  }

  function emit() { listeners.forEach((fn) => fn(state)); }

  /** 変更を適用して保存・再描画する。undo にメッセージを渡すと「元に戻す」付きトーストを出す。 */
  function commit(fn, { undo = null, silent = false } = {}) {
    const snapshot = undo ? JSON.stringify(state) : null;
    let result;
    try {
      result = fn(state, Date.now());
    } catch (e) {
      console.error(e);
      ORBIT.ui.toast(e && e.message === 'cycle' ? 'その場所へは移動できません' : '操作できませんでした');
      if (snapshot) state = JSON.parse(snapshot);
      return undefined;
    }
    scheduleSave();
    if (!silent) emit();
    if (undo) {
      ORBIT.ui.toast(typeof undo === 'function' ? undo(result) : undo, () => restore(snapshot));
    }
    return result;
  }

  // Undo はスナップショット復元。ただし集中セッションと計測記録は「その後に進んだ時間」を失わないよう現在値を保つ。
  function restore(snapshot) {
    const current = state;
    const prev = JSON.parse(snapshot);
    prev.focus = current.focus;
    prev.focusLog = current.focusLog;
    prev.pomodoroLog = current.pomodoroLog;
    prev.ui = current.ui;
    state = prev;
    saveNow();
    emit();
  }

  function replace(next) {
    state = next;
    saveNow();
    emit();
  }

  function setUI(key, value) {
    state.ui[key] = value;
    scheduleSave();
  }

  load();
  try {
    if (C.purgeTrash(state, Date.now()) > 0) saveNow();
  } catch (e) { console.error(e); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) saveNow(); });
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

  ORBIT.store = {
    get state() { return state; },
    commit, replace, setUI, saveNow,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onSaved(fn) { savedListeners.add(fn); },
    exportJSON() { return JSON.stringify(state, null, 1); },
  };
})();
