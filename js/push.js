/* ORBIT — バックグラウンド通知（Web Push）。
   集中・休憩の終わりを、アプリを閉じていても知らせる。サーバー側は supabase/push.sql と supabase/functions/orbit-push。
   サーバーが未適用なら通知の設定欄を出さない（ORBIT.push.available が false のまま）。 */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const C = window.OrbitCore;
  const { icon, toast } = ORBIT.ui;
  const store = ORBIT.store;
  const P = C.Pomodoro;

  const VAPID_PUBLIC = 'BF-DNb64hxmdIRzlqKS7T08RoypR_HVrh-VWCtypwjfg9OhOiIKb6QP3jYNHRbbzDargRRX0mWUnc2uG9ruyr88';
  const PREF_KEY = 'orbit.push.v1';   // { on, digest } 端末ごとの設定
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  let pref = { on: false, digest: true };
  try { Object.assign(pref, JSON.parse(localStorage.getItem(PREF_KEY)) || {}); } catch (_) { /* 既定値 */ }
  const savePref = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch (_) { /* 保存できなくても動く */ } };

  const api = { available: false };

  const acct = () => ORBIT.account;
  const token = () => (acct().user ? acct().user.token : null);
  const call = (name, args) => acct().rpc(name, Object.assign({ p_token: token() }, args));

  function keyBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function registration() {
    return navigator.serviceWorker.ready;
  }

  async function currentSub(create) {
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
    return sub;
  }

  async function register(sub) {
    const j = sub.toJSON();
    await call('orbit_push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_digest: pref.digest });
  }

  /** 設定画面から。通知の許可ダイアログはユーザー操作の中で出す必要がある。 */
  async function enable() {
    if (!token()) { toast('ログインしてから有効にしてください'); return; }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('通知が許可されませんでした（端末の設定から許可できます）'); return; }
      await register(await currentSub(true));
      pref.on = true;
      savePref();
      toast('通知を有効にしました');
    } catch (e) {
      console.error(e);
      toast('通知を有効にできませんでした');
    }
    ORBIT.nav.render();
  }

  async function disable() {
    pref.on = false;
    savePref();
    try {
      const sub = await currentSub(false);
      if (sub) {
        if (token()) await call('orbit_push_unsubscribe', { p_endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      if (token()) await call('orbit_push_cancel', { p_tag: 'timer' }).catch(() => {});
    } catch (e) { console.error(e); }
    scheduled = null;
    toast('通知を止めました');
    ORBIT.nav.render();
  }

  async function setDigest(on) {
    pref.digest = on;
    savePref();
    try { const sub = await currentSub(false); if (sub && token()) await register(sub); } catch (e) { console.error(e); toast('設定を保存できませんでした'); }
    ORBIT.nav.render();
  }

  function action(name) {
    if (name === 'enable') enable();
    if (name === 'disable') disable();
    if (name === 'digest') setDigest(!pref.digest);
  }

  function settingsHTML() {
    if (!api.available || !supported || !acct().user) return '';
    const head = '<h4 class="note" style="margin-top:22px">通知</h4>';
    if (isIOS && !standalone) {
      return `${head}<p class="note">iPhone では「ホーム画面に追加」して、そのアイコンから開くと通知を使えます。</p>`;
    }
    if (Notification.permission === 'denied') {
      return `${head}<p class="note">通知がブロックされています。端末の設定から ORBIT の通知を許可してください。</p>`;
    }
    const on = pref.on && Notification.permission === 'granted';
    return `${head}${on
      ? `<button class="menu-item" data-set="push:digest">${icon('cal')}毎朝 8:00 に期限のタスクを知らせる：${pref.digest ? 'オン' : 'オフ'}</button>
         <button class="menu-item" data-set="push:disable">${icon('close')}通知を止める</button>
         <p class="note">集中・休憩が終わる時刻に、アプリを閉じていても通知します。</p>`
      : `<button class="menu-item" data-set="push:enable">${icon('review')}通知を有効にする</button>
         <p class="note">集中・休憩の終わりを、アプリを閉じていてもお知らせします。</p>`}`;
  }

  /* ---------- 集中・休憩の終了を予約する ---------- */
  // 実行中のエンジンから「次に終わる時刻」を求め、変わったときだけサーバーに送る。
  // 前面で終わった場合は、次のフェーズの予約で上書きされるので古い通知は出ない。
  let scheduled = null;   // 送信済みの { at, phase } 。null なら予約なし
  let busy = false;

  function desired() {
    const f = store.state.focus;
    if (!f || P.status(f.engine) !== 'running') return null;
    const left = P.remaining(f.engine, Date.now());
    if (left <= 0) return null;
    return { at: Math.round((Date.now() + left) / 1000) * 1000, phase: P.phase(f.engine) };
  }

  async function reconcile() {
    if (busy || !api.available || !pref.on || !token() || Notification.permission !== 'granted') return;
    const want = desired();
    if (!want && !scheduled) return;
    if (want && scheduled && scheduled.phase === want.phase && Math.abs(scheduled.at - want.at) < 3000) return;
    busy = true;
    try {
      if (want) {
        const focusEnd = want.phase === 'focus';
        await call('orbit_push_set', {
          p_tag: 'timer', p_fire_at: new Date(want.at).toISOString(),
          p_title: focusEnd ? '集中が終わりました' : '休憩が終わりました',
          p_body: focusEnd ? '少し休みましょう' : '次の集中を始められます',
        });
        scheduled = want;
      } else {
        await call('orbit_push_cancel', { p_tag: 'timer' });
        scheduled = null;
      }
    } catch (e) {
      if (e && e.code !== 'network') console.error(e);
    } finally { busy = false; }
  }

  /** サーバー側が適用済みかを確かめる（未適用なら関数が無く unavailable になる）。 */
  async function probe() {
    if (!supported || !acct().user) return;
    try {
      await acct().rpc('orbit_push_verify', { p_secret: '' });
      api.available = true;
      // 以前に有効にした端末は、この起動でも購読を最新に保つ。
      if (pref.on && Notification.permission === 'granted') {
        const sub = await currentSub(false);
        if (sub) await register(sub);
      }
      ORBIT.nav.render();
    } catch (_) { api.available = false; }
  }

  /** ログアウト時: この端末への通知が別のアカウントに紐づいたままにならないよう、サーバー側の購読を外す。 */
  async function detach() {
    if (!supported || !api.available || !token()) return;
    try {
      const sub = await currentSub(false);
      if (sub) await call('orbit_push_unsubscribe', { p_endpoint: sub.endpoint });
      await call('orbit_push_cancel', { p_tag: 'timer' });
    } catch (_) { /* 失敗しても購読は期限切れで自然に消える */ }
    pref.on = false;
    savePref();
    scheduled = null;
  }

  store.onSaved(reconcile);
  store.subscribe(reconcile);
  setInterval(reconcile, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') reconcile(); });

  Object.assign(api, { settingsHTML, action, probe, detach, supported });
  ORBIT.push = api;
  window.addEventListener('load', () => setTimeout(probe, 1500));
})();
