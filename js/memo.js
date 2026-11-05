/* ORBIT — メモ: どの画面からでも思いつきを書き留める（タイピング／音声）。
   メモは state.memos に入り、ログイン中はほかのデータと一緒に同期される。 */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const C = window.OrbitCore;
  const { $, esc, icon, toast, openSheet, closeSheet, linkify } = ORBIT.ui;
  const store = ORBIT.store;
  const routes = (ORBIT.routes = ORBIT.routes || {});

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  function stamp(ms) {
    return new Date(ms).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function openMemo() {
    let rec = null;
    const stop = () => { if (rec) { try { rec.stop(); } catch (_) { /* すでに停止 */ } rec = null; } };
    openSheet({
      title: 'メモ', doneLabel: '保存', cancelLabel: 'キャンセル',
      html: `<div class="memo-box"><textarea class="inp" name="memo" placeholder="思いついたことをそのまま書く" autocapitalize="none"></textarea>
          ${Recognition ? `<button type="button" class="memo-mic" aria-label="音声で入力">${icon('mic')}</button>` : ''}</div>
        ${Recognition ? '' : '<p class="note">音声入力は、キーボードのマイクボタンから使えます。</p>'}
        <button type="button" class="btn" data-list>${icon('note')}メモの一覧（${C.Memos.list(store.state).length}）</button>`,
      onMount(body) {
        const ta = body.querySelector('[name="memo"]');
        ta.focus();
        body.querySelector('[data-list]').onclick = () => { stop(); closeSheet(); ORBIT.nav.open('memos'); };
        const mic = body.querySelector('.memo-mic');
        if (!mic) return;
        mic.onclick = () => {
          if (rec) { stop(); return; }
          rec = new Recognition();
          rec.lang = 'ja-JP';
          rec.interimResults = false;
          rec.continuous = true;
          rec.onresult = (e) => {
            let add = '';
            for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) add += e.results[i][0].transcript;
            if (add) ta.value = ta.value + (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + add;
          };
          rec.onerror = (e) => {
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('マイクの使用が許可されていません');
            else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('音声入力できませんでした');
          };
          rec.onend = () => { mic.classList.remove('rec'); rec = null; };
          mic.classList.add('rec');
          try { rec.start(); } catch (_) { mic.classList.remove('rec'); rec = null; }
        };
      },
      done(body) {
        stop();
        const text = body.querySelector('[name="memo"]').value;
        if (!text.trim()) { body.querySelector('[name="memo"]').focus(); return false; }
        store.commit((s, now) => C.Memos.create(s, text, now), { silent: true });
        toast('メモしました');
        ORBIT.nav.render();
        return true;
      },
      onClose: stop,
    });
  }

  routes.memos = {
    title: 'メモ',
    mount(el) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        const id = b.closest('[data-id]').dataset.id;
        if (b.dataset.m === 'task') {
          const t = store.commit((s, now) => C.Memos.toTask(s, id, now), { undo: 'タスクにしました' });
          if (!t) return;
        } else if (b.dataset.m === 'del') {
          store.commit((s, now) => C.Memos.remove(s, id, now), { undo: 'メモを削除しました' });
        } else if (b.dataset.m === 'copy') {
          const m = store.state.memos[id];
          if (m && navigator.clipboard) navigator.clipboard.writeText(m.text).then(() => toast('コピーしました'), () => {});
        }
      });
    },
    render(state, el) {
      const list = C.Memos.list(state);
      el.innerHTML = list.length
        ? `<div class="pad">${list.map((m) => `<div class="memo-item" data-id="${esc(m.id)}"><div class="t">${linkify(m.text)}</div>
            <div class="d">${esc(stamp(m.createdAt))}</div>
            <div class="acts"><button data-m="task">タスクにする</button><button data-m="copy">コピー</button><button class="danger" data-m="del">削除</button></div></div>`).join('')}</div>`
        : '<div class="empty"><div class="orb"></div>メモはまだありません<br><small>左下のメモボタンから書き留められます</small></div>';
    },
  };

  const fab = $('#memoFab');
  fab.innerHTML = icon('note');
  fab.hidden = false;
  fab.addEventListener('click', openMemo);
  ORBIT.memo = { open: openMemo };
})();
