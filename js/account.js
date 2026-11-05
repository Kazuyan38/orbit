/* ORBIT — 招待コード制アカウントとクラウド同期。
   Supabase の RPC（supabase/orbit.sql）を fetch で直接呼ぶ（SDK を CDN から読まない）。
   データの正本は端末の localStorage。クラウドは rev 付きの 1 文書で、別端末の変更とぶつかったら利用者に選ばせる。 */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const C = window.OrbitCore;
  const { $, esc, icon, toast, openSheet, closeSheet, sheetOpen } = ORBIT.ui;
  const store = ORBIT.store;

  /* ---------- 設定 ---------- */
  const API_URL = '';   // https://<project-ref>.supabase.co
  const API_KEY = '';   // publishable key（公開してよい鍵。権限は RPC 側で絞っている）
  const SESSION_KEY = 'orbit.session.v1';
  const SYNC_KEY = 'orbit.sync.v1';
  const BACKUP_PREFIX = 'orbit.state.v1.saved.';
  const PUSH_DELAY = 2500;
  const RETRY_DELAY = 30000;
  const PULL_INTERVAL = 60000;
  const KEEPALIVE_LIMIT = 60000;   // fetch keepalive の本文上限（64KB）未満

  const ERR = {
    bad_credentials: 'ユーザー名またはパスワードが違います',
    locked: 'ログインの失敗が続いたため、15 分間ロックしています',
    invalid_invite: '招待コードが無効です（入力ミス・使用済み・期限切れ）',
    username_taken: 'このユーザー名は使われています',
    bad_username: 'ユーザー名は半角の英小文字・数字・_ で 3〜24 文字です',
    weak_password: 'パスワードは 8 文字以上にしてください',
    unauthorized: 'ログインの有効期限が切れました。もう一度ログインしてください',
    forbidden: '管理者だけが行える操作です',
    not_found: '該当するユーザーがいません',
    too_large: 'データが大きすぎてクラウドに保存できません',
    network: 'サーバーに接続できません。通信状態を確認してください',
    config: 'サーバーが未設定です',
  };

  const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } };
  const write = (key, v) => {
    try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch (_) { /* 容量不足は保存側で通知済み */ }
  };

  let session = read(SESSION_KEY);   // { token, username, is_admin }
  let sync = Object.assign({ owner: null, rev: 0, dirty: false, hash: 0, at: 0, error: null }, read(SYNC_KEY));
  let pushTimer = 0, pushing = null, pulling = false, applying = false, conflictShown = false, editSeq = 0;

  class ApiError extends Error { constructor(code) { super(code); this.code = code; } }
  const message = (e) => ERR[e && e.code] || '処理できませんでした';

  async function rpc(name, args, { keepalive = false } = {}) {
    if (!API_URL || !API_KEY) throw new ApiError('config');
    let res;
    try {
      res = await fetch(`${API_URL}/rest/v1/rpc/${name}`, {
        method: 'POST', keepalive,
        headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch (_) { throw new ApiError('network'); }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { /* 本文が JSON でない（障害時の HTML など） */ }
    if (!res.ok) throw new ApiError(body && ERR[body.message] ? body.message : 'network');
    if (body && body.error) throw new ApiError(body.error);
    return body;
  }

  /* ---------- 同期 ---------- */
  // ui（開閉状態など）は端末ごとの表示状態なので送らない。
  function payloadText() {
    const { ui, ...rest } = store.state;
    return JSON.stringify(rest);
  }
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function saveSync() { write(SYNC_KEY, sync); renderStatus(); }

  function isEmptyState(s) {
    return !Object.keys(s.tasks).length && !Object.keys(s.projects).length && !Object.keys(s.reviews).length
      && !Object.keys(s.books).length && !Object.keys(s.habits).length && !s.focusLog.length;
  }

  function stash(text, label) {
    write(`${BACKUP_PREFIX}${Date.now()}`, { label, at: Date.now(), data: JSON.parse(text) });
    const keys = backupKeys();
    keys.slice(0, Math.max(0, keys.length - 5)).forEach((k) => write(k, null));
  }
  function backupKeys() {
    const keys = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(BACKUP_PREFIX)) keys.push(k); } } catch (_) { /* 読めなければ空 */ }
    return keys.sort();
  }

  function onSaved() {
    if (applying || !session) return;
    const h = hash(payloadText());
    if (h === sync.hash && !sync.dirty) return;
    editSeq++;
    sync.dirty = true;
    saveSync();
    schedulePush(PUSH_DELAY);
  }

  function schedulePush(delay) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push(), delay);
  }

  function push({ keepalive = false } = {}) {
    clearTimeout(pushTimer);
    if (!session || !sync.dirty || conflictShown) return Promise.resolve();
    if (pushing) return pushing;
    const seq = editSeq;
    const text = payloadText();
    pushing = rpc('orbit_push', { p_token: session.token, p_data: JSON.parse(text), p_base_rev: sync.rev },
      { keepalive: keepalive && text.length < KEEPALIVE_LIMIT })
      .then((res) => {
        if (!res.ok) { conflict(res); return; }
        sync.rev = res.rev;
        sync.hash = hash(text);
        sync.at = Date.now();
        sync.error = null;
        if (seq === editSeq) sync.dirty = false;
        saveSync();
      })
      .catch(failed)
      .finally(() => {
        pushing = null;
        if (sync.dirty && session && !conflictShown) schedulePush(sync.error ? RETRY_DELAY : PUSH_DELAY);
      });
    return pushing;
  }

  async function pull() {
    if (!session || pulling || conflictShown) return;
    pulling = true;
    try {
      const res = await rpc('orbit_pull', { p_token: session.token, p_rev: sync.rev });
      sync.error = null;
      if (res.unchanged || (res.data == null && sync.rev === 0)) {
        sync.at = Date.now();
        saveSync();
        if (sync.dirty) push();
      } else if (res.data == null) {
        // クラウド側の文書が無い（作り直し等）。この端末の内容で作り直す。
        sync.rev = 0; sync.dirty = true; saveSync(); push();
      } else if (sync.dirty) {
        conflict(res);
      } else {
        apply(res);
      }
    } catch (e) {
      failed(e);
    } finally {
      pulling = false;
    }
  }

  function apply(res) {
    let next;
    try { next = C.migrate(res.data); } catch (e) {
      console.error(e);
      sync.error = 'クラウドのデータを読み込めませんでした';
      saveSync();
      return;
    }
    next.ui = store.state.ui;
    applying = true;
    try { store.replace(next); } finally { applying = false; }
    sync.rev = res.rev;
    sync.hash = hash(payloadText());
    sync.dirty = false;
    sync.at = Date.now();
    saveSync();
  }

  function failed(e) {
    if (e && e.code === 'unauthorized') { expire(); return; }
    sync.error = message(e);
    saveSync();
  }

  // 両方に変更があるときは自動で片方を捨てない。選ばなかった方は端末内に退避する。
  function conflict(res) {
    if (conflictShown) return;
    if (sheetOpen()) { setTimeout(() => conflict(res), 3000); return; }
    conflictShown = true;
    const when = res.updated_at ? new Date(res.updated_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    let decided = false;
    openSheet({
      title: '別の端末の変更があります',
      cancelLabel: 'あとで',
      html: `<p class="note">この端末とクラウド${when ? `（${esc(when)} 更新）` : ''}の両方で変更がありました。どちらを残しますか？
        残さなかった方は、この端末に「退避データ」として保存され、設定から戻せます。</p>
        <button class="btn primary" data-pick="cloud">クラウドの内容を使う</button>
        <button class="btn" data-pick="local">この端末の内容を使う</button>`,
      onMount(body) {
        body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-pick]');
          if (!b) return;
          decided = true;
          if (b.dataset.pick === 'cloud') {
            stash(payloadText(), '同期の競合（この端末側）');
            conflictShown = false;
            apply(res);
            toast('クラウドの内容に切り替えました');
          } else {
            stash(JSON.stringify(res.data), '同期の競合（クラウド側）');
            conflictShown = false;
            sync.rev = res.rev;
            sync.dirty = true;
            saveSync();
            push();
            toast('この端末の内容でクラウドを更新します');
          }
          closeSheet();
        });
      },
      onClose() {
        if (decided) return;
        // 「あとで」: 1 分後の定期確認でもう一度聞く。
        setTimeout(() => { conflictShown = false; }, PULL_INTERVAL - 5000);
      },
    });
  }

  /* ---------- ログイン状態 ---------- */
  function begin(s) {
    session = { token: s.token, username: s.username, is_admin: !!s.is_admin };
    write(SESSION_KEY, session);
    if (sync.owner !== session.username) {
      const local = payloadText();
      const hadOwner = !!sync.owner;
      if (hadOwner && !isEmptyState(store.state)) {
        stash(local, `@${sync.owner} のデータ`);
        replaceLocal(C.createState());
      }
      // この端末で初めてログインし、すでにデータがあるなら「この端末の変更」として扱う（クラウドにあれば競合で選ぶ）。
      sync = { owner: session.username, rev: 0, dirty: !hadOwner && !isEmptyState(store.state), hash: 0, at: 0, error: null };
      saveSync();
    }
    hideGate();
    pull();
  }

  function replaceLocal(next) {
    next.ui = store.state.ui;
    applying = true;
    try { store.replace(next); } finally { applying = false; }
  }

  function expire() {
    session = null;
    write(SESSION_KEY, null);
    showGate('unauthorized');
  }

  async function logout(force = false) {
    if (sync.dirty) await push();
    if (sync.dirty && !force) {
      openSheet({
        title: 'ログアウト',
        html: `<p class="note">クラウドに保存されていない変更があります（${esc(sync.error || '未送信')}）。
          ログアウトすると、その変更はこの端末に「退避データ」として残ります。</p>
          <button class="btn danger" data-force>ログアウトする</button>`,
        onMount(body) { body.querySelector('[data-force]').onclick = () => { closeSheet(); logout(true); }; },
      });
      return;
    }
    if (sync.dirty) stash(payloadText(), `@${session.username} の未同期の変更`);
    const token = session.token;
    rpc('orbit_logout', { p_token: token }).catch(() => {});
    session = null;
    write(SESSION_KEY, null);
    clearTimeout(pushTimer);
    sync = { owner: null, rev: 0, dirty: false, hash: 0, at: 0, error: null };
    saveSync();
    replaceLocal(C.createState());
    ORBIT.nav.back();
    showGate();
  }

  /* ---------- ログイン画面 ---------- */
  let mode = 'login';
  function showGate(errorCode) {
    const el = $('#auth');
    el.hidden = false;
    document.body.classList.add('locked');
    renderGate(errorCode ? message({ code: errorCode }) : '');
  }
  function hideGate() {
    $('#auth').hidden = true;
    document.body.classList.remove('locked');
  }

  function renderGate(error = '') {
    const el = $('#auth');
    const signup = mode === 'signup';
    el.innerHTML = `<div class="auth-card">
      <div class="auth-mark" aria-hidden="true"><i></i><b></b></div>
      <h1 class="auth-title">ORBIT</h1>
      <p class="auth-sub">招待制のタスク・集中管理</p>
      <div class="auth-tabs" role="tablist">
        <button role="tab" data-mode="login" aria-selected="${!signup}" class="${signup ? '' : 'on'}">ログイン</button>
        <button role="tab" data-mode="signup" aria-selected="${signup}" class="${signup ? 'on' : ''}">新規登録</button>
      </div>
      <form id="authForm" novalidate>
        ${signup ? `<label class="field"><span>招待コード</span>
          <input class="inp code" name="invite" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX" required></label>` : ''}
        <label class="field"><span>ユーザー名</span>
          <input class="inp" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
            ${signup ? 'placeholder="英小文字・数字・_ 3〜24 文字"' : ''} required></label>
        <label class="field"><span>パスワード</span>
          <input class="inp" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}"
            ${signup ? 'placeholder="8 文字以上"' : ''} required></label>
        <p class="auth-err" role="alert">${esc(error)}</p>
        <button class="btn primary" type="submit">${signup ? '登録してはじめる' : 'ログイン'}</button>
      </form>
      <p class="note auth-foot">${signup ? '招待コードは管理者から受け取ってください。' : 'アカウントがない場合は、招待コードで新規登録できます。'}<br>
        データはこの端末に保存され、ログイン中はクラウドにも同期されます。</p>
    </div>`;
  }

  function bindGate() {
    const el = $('#auth');
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-mode]');
      if (!t || t.dataset.mode === mode) return;
      const name = el.querySelector('[name=username]').value;
      mode = t.dataset.mode;
      renderGate();
      el.querySelector('[name=username]').value = name;
    });
    el.addEventListener('input', (e) => {
      if (e.target.name !== 'invite') return;
      const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      e.target.value = raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
    });
    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = f.querySelector('.auth-err');
      const btn = f.querySelector('button[type=submit]');
      const username = f.username.value.trim().toLowerCase();
      const password = f.password.value;
      const local = mode === 'signup' ? validate(username, password, f.invite.value) : (!username || !password ? '入力してください' : '');
      if (local) { err.textContent = local; return; }
      btn.disabled = true;
      err.textContent = '';
      try {
        const res = mode === 'signup'
          ? await rpc('orbit_register', { p_username: username, p_password: password, p_invite: f.invite.value })
          : await rpc('orbit_login', { p_username: username, p_password: password });
        begin(res);
        toast(mode === 'signup' ? `ようこそ、${res.username} さん` : `${res.username} でログインしました`);
      } catch (ex) {
        err.textContent = message(ex);
        btn.disabled = false;
      }
    });
  }

  function validate(username, password, invite) {
    if (invite.replace(/[^A-Za-z0-9]/g, '').length !== 10) return '招待コードは 10 文字です';
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return ERR.bad_username;
    if (password.length < 8) return ERR.weak_password;
    return '';
  }

  /* ---------- 設定画面のアカウント欄 ---------- */
  function statusText() {
    if (!session) return '';
    if (sync.error) return `未同期 — ${sync.error}`;
    if (sync.dirty) return '同期待ちの変更があります';
    if (!sync.at) return '同期を確認しています…';
    const t = new Date(sync.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    return `クラウドと同期済み（${t}）`;
  }
  function renderStatus() {
    const el = document.getElementById('syncStatus');
    if (el) { el.textContent = statusText(); el.classList.toggle('warn', !!sync.error || sync.dirty); }
  }

  function settingsHTML() {
    if (!session) return '';
    const backups = backupKeys();
    return `<h4 class="note" style="margin-top:16px">アカウント</h4>
      <div class="acct"><div class="acct-name">@${esc(session.username)}${session.is_admin ? '<span class="tag">管理者</span>' : ''}</div>
        <div id="syncStatus" class="acct-sync">${esc(statusText())}</div></div>
      <button class="menu-item" data-set="acc:sync">${icon('restore')}今すぐ同期</button>
      ${session.is_admin ? `<button class="menu-item" data-set="acc:invites">${icon('plus')}招待コードを発行・管理</button>
        <button class="menu-item" data-set="acc:reset">${icon('edit')}利用者のパスワードを再設定</button>` : ''}
      <button class="menu-item" data-set="acc:password">${icon('edit')}パスワードを変更</button>
      ${backups.length ? `<button class="menu-item" data-set="acc:backups">${icon('archive')}退避データ（${backups.length}）</button>` : ''}
      <button class="menu-item" data-set="acc:logout">${icon('back')}ログアウト</button>
      <button class="menu-item danger" data-set="acc:delete">${icon('trash')}アカウントを削除</button>`;
  }

  function action(name) {
    if (name === 'sync') {
      sync.error = null;
      renderStatus();
      push().then(pull).then(() => toast(sync.error ? sync.error : '同期しました'));
    }
    if (name === 'logout') logout();
    if (name === 'password') passwordSheet();
    if (name === 'invites') invitesSheet();
    if (name === 'reset') resetSheet();
    if (name === 'backups') backupsSheet();
    if (name === 'delete') deleteSheet();
  }

  function formSheet({ title, fields, doneLabel, note = '', submit }) {
    openSheet({
      title, doneLabel,
      html: `${note ? `<p class="note">${note}</p>` : ''}${fields.map(([name, label, type, ac]) => `<label class="field"><span>${label}</span>
        <input class="inp" name="${name}" type="${type}" autocomplete="${ac}" autocapitalize="none" spellcheck="false"></label>`).join('')}
        <p class="auth-err" role="alert"></p>`,
      done(body) {
        const values = Object.fromEntries(fields.map(([name]) => [name, body.querySelector(`[name=${name}]`).value]));
        const err = body.querySelector('.auth-err');
        submit(values).then((msg) => { closeSheet(); if (msg) toast(msg); }).catch((e) => { err.textContent = typeof e === 'string' ? e : message(e); });
        return false;
      },
    });
  }

  function passwordSheet() {
    formSheet({
      title: 'パスワードを変更', doneLabel: '変更',
      fields: [['old', '現在のパスワード', 'password', 'current-password'], ['next', '新しいパスワード（8 文字以上）', 'password', 'new-password']],
      submit: async ({ old, next }) => {
        if (next.length < 8) throw ERR.weak_password;
        await rpc('orbit_change_password', { p_token: session.token, p_old: old, p_new: next });
        return 'パスワードを変更しました（ほかの端末はログアウトされます）';
      },
    });
  }

  function resetSheet() {
    formSheet({
      title: 'パスワードを再設定', doneLabel: '再設定',
      note: 'パスワードを忘れた利用者のために、新しいパスワードを設定します。設定後、本人に伝えてください。',
      fields: [['user', 'ユーザー名', 'text', 'off'], ['next', '新しいパスワード（8 文字以上）', 'text', 'off']],
      submit: async ({ user, next }) => {
        if (next.length < 8) throw ERR.weak_password;
        await rpc('orbit_admin_reset_password', { p_token: session.token, p_username: user, p_new: next });
        return `@${user.trim().toLowerCase()} のパスワードを再設定しました`;
      },
    });
  }

  function deleteSheet() {
    formSheet({
      title: 'アカウントを削除', doneLabel: '削除',
      note: 'クラウド上のアカウントとデータを完全に削除します。この端末のデータも消えます。取り消せません。',
      fields: [['pw', 'パスワード', 'password', 'current-password']],
      submit: async ({ pw }) => {
        await rpc('orbit_delete_account', { p_token: session.token, p_password: pw });
        sync.dirty = false;
        await logout(true);
        return 'アカウントを削除しました';
      },
    });
  }

  const fmtCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
  function invitesSheet() {
    let uses = 1, days = 14;
    const body = openSheet({
      title: '招待コード',
      html: `<div class="field"><span>使える人数</span><div class="seg" data-g="uses">${[1, 5, 10].map((n) => `<button data-v="${n}" class="${n === uses ? 'on' : ''}">${n} 人</button>`).join('')}</div></div>
        <div class="field"><span>有効期限</span><div class="seg" data-g="days">${[7, 14, 30].map((n) => `<button data-v="${n}" class="${n === days ? 'on' : ''}">${n} 日</button>`).join('')}</div></div>
        <button class="btn primary" data-new>${icon('plus')}発行する</button>
        <div class="invite-new" hidden></div>
        <h4 class="note" style="margin-top:20px">発行済み</h4>
        <div class="invite-list"><p class="note">読み込み中…</p></div>`,
      onMount(b) {
        b.addEventListener('click', async (e) => {
          const seg = e.target.closest('[data-g] button');
          if (seg) {
            const g = seg.parentElement.dataset.g;
            if (g === 'uses') uses = Number(seg.dataset.v); else days = Number(seg.dataset.v);
            seg.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === seg));
            return;
          }
          if (e.target.closest('[data-new]')) {
            try {
              const res = await rpc('orbit_create_invite', { p_token: session.token, p_uses: uses, p_days: days });
              const box = b.querySelector('.invite-new');
              box.hidden = false;
              box.innerHTML = `<div class="code-big num">${esc(fmtCode(res.code))}</div>
                <button class="btn" data-share="${esc(res.code)}">共有・コピー</button>`;
              loadList(b);
            } catch (ex) { toast(message(ex)); }
            return;
          }
          const sh = e.target.closest('[data-share]');
          if (sh) { shareCode(sh.dataset.share); return; }
          const rv = e.target.closest('[data-revoke]');
          if (rv) {
            try { await rpc('orbit_revoke_invite', { p_token: session.token, p_code: rv.dataset.revoke }); loadList(b); } catch (ex) { toast(message(ex)); }
          }
        });
        loadList(b);
      },
    });
    return body;
  }

  async function loadList(b) {
    const box = b.querySelector('.invite-list');
    try {
      const list = await rpc('orbit_list_invites', { p_token: session.token });
      const now = Date.now();
      box.innerHTML = list.length ? list.map((i) => {
        const expired = i.expires_at && new Date(i.expires_at).getTime() < now;
        const state = i.revoked ? '無効化' : expired ? '期限切れ' : i.uses >= i.max_uses ? '使用済み' : `残り ${i.max_uses - i.uses} 人`;
        const live = !i.revoked && !expired && i.uses < i.max_uses;
        const until = i.expires_at ? new Date(i.expires_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '';
        return `<div class="invite-row${live ? '' : ' dead'}"><div><div class="num">${esc(fmtCode(i.code))}</div>
          <div class="note" style="margin:2px 0 0">${esc(state)}${until && live ? ` ・ ${esc(until)} まで` : ''}${i.users.length ? ` ・ ${i.users.map((u) => `@${esc(u)}`).join(' ')}` : ''}</div></div>
          ${live ? `<span><button class="txt" data-share="${esc(i.code)}">共有</button><button class="txt danger" data-revoke="${esc(i.code)}">無効化</button></span>` : ''}</div>`;
      }).join('') : '<p class="note">まだありません</p>';
    } catch (ex) { box.innerHTML = `<p class="note">${esc(message(ex))}</p>`; }
  }

  function shareCode(code) {
    const text = `ORBIT の招待コード: ${fmtCode(code)}\n${location.origin}${location.pathname}`;
    if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('コピーしました'), () => toast(fmtCode(code)));
    else toast(fmtCode(code));
  }

  function backupsSheet() {
    const items = backupKeys().reverse().map((k) => ({ k, v: read(k) })).filter((x) => x.v && x.v.data);
    openSheet({
      title: '退避データ',
      html: `<p class="note">同期の競合やアカウント切り替えのときに、選ばれなかったデータをここに残しています（最新 5 件）。</p>
        ${items.map(({ k, v }) => `<div class="invite-row"><div><div>${esc(v.label || '退避データ')}</div>
          <div class="note" style="margin:2px 0 0">${esc(new Date(v.at).toLocaleString('ja-JP'))} ・ タスク ${Object.keys(v.data.tasks || {}).length} 件</div></div>
          <span><button class="txt" data-restore="${esc(k)}">この内容に戻す</button><button class="txt danger" data-drop="${esc(k)}">削除</button></span></div>`).join('')}`,
      onMount(body) {
        body.addEventListener('click', (e) => {
          const r = e.target.closest('[data-restore]');
          const d = e.target.closest('[data-drop]');
          if (d) { write(d.dataset.drop, null); d.closest('.invite-row').remove(); return; }
          if (!r) return;
          let next;
          try { next = C.migrate(read(r.dataset.restore).data); } catch (_) { toast('このデータは読み込めません'); return; }
          const before = payloadText();
          stash(before, '退避データから戻す前の状態');
          next.ui = store.state.ui;
          store.replace(next);
          closeSheet();
          toast('退避データの内容に戻しました');
        });
      },
    });
  }

  /* ---------- 起動 ---------- */
  function init() {
    bindGate();
    store.onSaved(onSaved);
    if (!session) { showGate(); return; }
    // 端末内のデータで即座に使える。クラウドとの照合は裏で行う。
    pull();
  }
  setInterval(() => { if (document.visibilityState === 'visible') pull(); }, PULL_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pull();
    else if (sync.dirty) push({ keepalive: true });
  });
  window.addEventListener('online', () => { sync.error = null; push().then(pull); });

  ORBIT.account = {
    init, settingsHTML, action,
    get user() { return session; },
  };
})();
