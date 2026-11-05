/* ORBIT — Schedule: Google カレンダーの埋め込み表示。
   カレンダー ID（または埋め込み URL）は端末ごとに state.ui.gcal へ保存する。ID は利用者が入力したものだけを使う。 */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const { esc, icon, toast, openSheet } = ORBIT.ui;
  const store = ORBIT.store;
  const routes = (ORBIT.routes = ORBIT.routes || {});

  // 入力は「メールアドレス形式の ID」「埋め込みコード（iframe）」「埋め込み URL」のどれでもよい。
  function parseId(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    const m = t.match(/[?&]src=([^&"'\s]+)/);
    const id = decodeURIComponent(m ? m[1] : t);
    return /^[^\s<>"']+$/.test(id) ? id : '';
  }
  const embedUrl = (id) => `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(id)}&ctz=Asia%2FTokyo&mode=MONTH&showTitle=0&showPrint=0&showTz=0&hl=ja&wkst=2`;

  function configSheet() {
    const cur = store.state.ui.gcal || '';
    openSheet({
      title: 'Google カレンダー', doneLabel: '保存',
      html: `<p class="note">Google カレンダーの「設定と共有」→「カレンダーの統合」にある<b>カレンダー ID</b>、または<b>埋め込みコード</b>を貼り付けてください。</p>
        <label class="field"><span>カレンダー ID / 埋め込みコード</span>
          <textarea class="inp" name="gcal" rows="3" autocapitalize="none" autocorrect="off" spellcheck="false" style="min-height:0">${esc(cur)}</textarea></label>
        <p class="note">非公開のカレンダーは、この端末のブラウザで Google にログインしている場合だけ表示されます（iPhone の Safari では表示されないことがあります）。確実に表示するには、カレンダー側の「一般公開」を有効にしてください。公開すると誰でも予定を見られる点にご注意ください。</p>
        ${cur ? '<button class="btn danger" type="button" data-clear>連携を解除</button>' : ''}`,
      onMount(body) {
        const clear = body.querySelector('[data-clear]');
        if (clear) clear.onclick = () => { store.setUI('gcal', ''); ORBIT.ui.closeSheet(); ORBIT.nav.render(); };
      },
      done(body) {
        const raw = body.querySelector('[name="gcal"]').value;
        const id = parseId(raw);
        if (raw.trim() && !id) { toast('カレンダー ID を読み取れませんでした'); return false; }
        store.setUI('gcal', id);
        ORBIT.nav.render();
        return true;
      },
    });
  }

  routes.schedule = {
    title: 'スケジュール',
    header: () => `<button class="ib" data-hdr="cfg" aria-label="カレンダーの設定">${icon('gear')}</button>`,
    onHeader(act) { if (act === 'cfg') configSheet(); },
    mount(el) {
      el.addEventListener('click', (e) => { if (e.target.closest('[data-cfg]')) configSheet(); });
    },
    render(state, el) {
      const id = state.ui.gcal;
      if (!id) {
        el.innerHTML = `<div class="pad" style="text-align:center;padding-top:60px">
          <div style="color:var(--hi);margin-bottom:12px">${icon('cal')}</div>
          <p class="note">Google カレンダーを埋め込んで、予定をここで確認できます。</p>
          <button class="btn primary" data-cfg style="max-width:260px;margin:16px auto 0">カレンダーを連携する</button></div>`;
        return;
      }
      // iframe を作り直すとちらつくので、同じ ID なら再利用する。
      const cur = el.querySelector('iframe');
      if (cur && cur.dataset.id === id) return;
      el.innerHTML = `<div style="height:100%;padding:0 12px calc(var(--safe-b) + 12px)">
        <iframe class="cal-frame" data-id="${esc(id)}" src="${esc(embedUrl(id))}" title="Google カレンダー" loading="lazy" referrerpolicy="no-referrer"></iframe></div>`;
    },
  };
})();
