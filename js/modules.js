/* ORBIT — Review / Reading / Habits / Analytics / Settings */
(function () {
  'use strict';
  const ORBIT = window.ORBIT;
  const C = window.OrbitCore;
  const { $, esc, icon, today, fmtDue, fmtDuration, toast, openSheet, closeSheet } = ORBIT.ui;
  const store = ORBIT.store;
  const routes = (ORBIT.routes = ORBIT.routes || {});
  const WD = ['日', '月', '火', '水', '木', '金', '土'];

  const tabs = (items, current) => `<div class="tabs" role="tablist">${items.map(([k, label]) =>
    `<button role="tab" data-tab="${k}" class="${k === current ? 'on' : ''}" aria-selected="${k === current}">${label}</button>`).join('')}</div>`;
  const plusHeader = (label) => `<button class="ib" data-hdr="add" aria-label="${label}">${icon('plus')}</button>`;
  const emptyBox = (text) => `<div class="empty"><div class="orb"></div>${text}</div>`;
  const md = (key) => { const [, m, d] = key.split('-').map(Number); return `${m}/${d}`; };

  function bindTabs(el, view, rerender) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      view.tab = b.dataset.tab;
      rerender();
    });
  }

  /* ======================= Review ======================= */
  const rv = { tab: 'today' };
  routes.review = {
    title: '復習',
    header: () => plusHeader('復習項目を追加'),
    onHeader(act) { if (act === 'add') reviewForm(null); },
    mount(el) {
      bindTabs(el, rv, () => ORBIT.nav.render());
      el.addEventListener('click', (e) => {
        const done = e.target.closest('[data-act="rvDone"]');
        const row = e.target.closest('[data-id]');
        if (done && row) {
          const r = store.state.reviews[row.dataset.id];
          store.commit((s, now) => C.Review.complete(s, row.dataset.id, today(), now),
            { undo: (x) => (x && x.mastered ? `「${r.title}」をすべて復習しました` : `次回は ${fmtDue(x.nextDue)}`) });
          return;
        }
        if (row && e.target.closest('[data-act="rvOpen"]')) reviewForm(row.dataset.id);
      });
    },
    render(state, el) {
      const t = today();
      const iv = state.settings.reviewIntervals;
      const list = rv.tab === 'today' ? C.Review.due(state, t) : rv.tab === 'upcoming' ? C.Review.upcoming(state, t) : C.Review.mastered(state);
      const dueCount = C.Review.due(state, t).length;
      const row = (r) => {
        const late = r.nextDue && r.nextDue < t;
        const step = `${Math.min(r.step + 1, iv.length)}/${iv.length}`;
        return `<li class="row" data-id="${esc(r.id)}" style="align-items:center">
          <div class="body" data-act="rvOpen"><div class="title">${esc(r.title)}</div>
          <div class="meta"><span>${r.mastered ? '完了' : `${step} 回目`}</span>${r.nextDue ? `<span class="${late ? 'late' : ''}">${icon('cal', 'sm')}${fmtDue(r.nextDue)}</span>` : ''}
          <span>学習 ${md(r.createdOn)}</span></div></div>
          ${rv.tab === 'today' ? `<button class="pill" data-act="rvDone" style="min-width:0;height:40px;padding:0 16px">${icon('check', 'sm')}復習した</button>` : ''}</li>`;
      };
      el.innerHTML = tabs([['today', `今日${dueCount ? ` ${dueCount}` : ''}`], ['upcoming', '予定']], rv.tab)
        + (list.length ? `<ul class="list">${list.map(row).join('')}</ul>`
          : emptyBox(rv.tab === 'today' ? '今日の復習はありません' : rv.tab === 'upcoming' ? '予定はありません<br><small>右上の ＋ から学習内容を登録できます</small>' : 'まだありません'))
        + `<p class="note" style="margin:16px 20px 140px">復習日は学習日から ${iv.join('・')} 日後を目安に自動で決まります。最後の間隔に達したあとも、同じ間隔で繰り返し続けます。</p>`;
    },
  };

  ORBIT.reviewForm = (id) => reviewForm(id);
  function reviewForm(id) {
    const s = store.state;
    const r = id ? s.reviews[id] : null;
    openSheet({
      title: r ? '復習項目' : '学習内容を登録',
      doneLabel: r ? '保存' : '登録',
      html: `<label class="field"><span>内容</span><input class="inp" name="title" value="${esc(r ? r.title : '')}" placeholder="例: 金のフレーズ 1〜100"></label>
        <label class="field"><span>メモ</span><textarea class="inp" name="notes">${esc(r ? r.notes : '')}</textarea></label>
        ${r ? `<div class="field"><span>履歴</span>${r.history.length ? r.history.map((h) => `<div class="setting" style="padding:10px 4px"><span>${md(h.on)}</span><span class="num" style="color:var(--fg-2)">${h.step + 1} 回目</span></div>`).join('') : '<p class="note">まだ復習していません</p>'}</div>
          <button type="button" class="btn" data-x="reset">${icon('reset')}今日からやり直す</button>
          <button type="button" class="btn danger" data-x="delete">${icon('trash')}削除</button>` : ''}`,
      onMount(body) {
        if (!r) setTimeout(() => body.querySelector('[name="title"]').focus(), 320);
        body.addEventListener('click', (e) => {
          const x = e.target.closest('[data-x]'); if (!x) return;
          closeSheet();
          if (x.dataset.x === 'reset') store.commit((st, now) => C.Review.reset(st, id, today(), now), { undo: 'やり直しにしました' });
          if (x.dataset.x === 'delete') store.commit((st, now) => C.Review.remove(st, id, now), { undo: '削除しました' });
        });
      },
      done(body) {
        const title = body.querySelector('[name="title"]').value;
        const notes = body.querySelector('[name="notes"]').value;
        if (!title.trim()) return false;
        if (r) store.commit((st, now) => C.Review.update(st, id, { title, notes }, now));
        else {
          const item = store.commit((st, now) => C.Review.create(st, { title, notes }, today(), now));
          if (item) toast(`初回の復習は ${fmtDue(item.nextDue)}`);
        }
        return true;
      },
    });
  }

  /* ======================= Reading ======================= */
  const rd = { tab: 'reading' };
  const STATUS = { want: '読みたい', reading: '読書中', done: '読了' };
  /* ---------- 読書ノート（重要な文章・ページ・自分の考え） ---------- */
  function notesSheet(bookId) {
    const b = store.state.books[bookId];
    if (!b) return;
    const paint = (body) => {
      const st = store.state;
      const list = C.Books.highlights(st, bookId);
      body.innerHTML = `<button type="button" class="btn primary" data-hl="new" style="margin-top:0">${icon('plus')}ノートを追加</button>
        ${list.length ? list.map((h) => {
          const rv = h.reviewId && st.reviews[h.reviewId] && !st.reviews[h.reviewId].deletedAt;
          return `<div class="hl" data-hid="${esc(h.id)}">
            ${h.quote ? `<blockquote>${esc(h.quote)}</blockquote>` : ''}
            <div class="d">${h.page != null ? `p.${h.page} ・ ` : ''}${esc(md(C.Dates.dayKey(h.createdAt)))}${rv ? ' ・ <span class="badge">復習中</span>' : ''}</div>
            ${h.thought ? `<div class="th">${esc(h.thought)}</div>` : ''}
            <div class="acts">${rv ? '' : '<button data-hl="review">復習に追加</button>'}<button data-hl="edit">編集</button><button class="danger" data-hl="del">削除</button></div></div>`;
        }).join('') : '<p class="note">印象に残った文章や、そこで考えたことを記録できます。</p>'}`;
    };
    openSheet({
      title: `『${b.title}』のノート`, cancelLabel: '閉じる',
      html: '',
      onMount(body) {
        paint(body);
        body.addEventListener('click', (e) => {
          const a = e.target.closest('[data-hl]'); if (!a) return;
          const hid = a.closest('[data-hid]') && a.closest('[data-hid]').dataset.hid;
          if (a.dataset.hl === 'new') { closeSheet(); highlightForm(bookId, null); }
          else if (a.dataset.hl === 'edit') { closeSheet(); highlightForm(bookId, hid); }
          else if (a.dataset.hl === 'review') {
            const r = store.commit((st, now) => C.Books.highlightToReview(st, bookId, hid, today(), now), { silent: true });
            if (r) toast(`復習に追加しました。初回は ${fmtDue(r.nextDue)}`);
            paint(body);
          } else if (a.dataset.hl === 'del') {
            store.commit((st, now) => C.Books.removeHighlight(st, bookId, hid, now), { undo: 'ノートを削除しました', silent: true });
            paint(body);
          }
        });
      },
    });
  }

  function highlightForm(bookId, hid) {
    const b = store.state.books[bookId];
    const h = hid ? C.Books.highlights(store.state, bookId).find((x) => x.id === hid) : null;
    openSheet({
      title: h ? 'ノートを編集' : 'ノートを追加', doneLabel: '保存', cancelLabel: 'キャンセル',
      html: `<label class="field"><span>重要な文章</span><textarea class="inp" name="quote" rows="4" placeholder="印象に残った一節をそのまま書き写す">${esc(h ? h.quote : '')}</textarea></label>
        <label class="field"><span>ページ</span><input class="inp" name="page" type="number" inputmode="numeric" min="0" value="${h ? (h.page == null ? '' : h.page) : (b.currentPage || '')}"></label>
        <label class="field"><span>自分の考え</span><textarea class="inp" name="thought" rows="3" placeholder="どう感じた？どう使える？"></textarea></label>
        ${h && h.reviewId ? '' : `<label class="setting" style="border:0"><span>復習項目にも追加する</span><input type="checkbox" name="rv" ${h ? '' : 'checked'} style="width:22px;height:22px;accent-color:var(--hi)"></label>`}`,
      onMount(body) {
        body.querySelector('[name="thought"]').value = h ? h.thought : '';
        setTimeout(() => body.querySelector('[name="quote"]').focus(), 320);
      },
      done(body) {
        const v = (n) => body.querySelector(`[name="${n}"]`).value;
        if (!v('quote').trim() && !v('thought').trim()) { body.querySelector('[name="quote"]').focus(); return false; }
        const rv = body.querySelector('[name="rv"]');
        const wantReview = !!(rv && rv.checked);
        let r = null;
        store.commit((st, now) => {
          const note = h ? C.Books.updateHighlight(st, bookId, hid, { quote: v('quote'), page: v('page') || null, thought: v('thought') }, now)
            : C.Books.addHighlight(st, bookId, { quote: v('quote'), page: v('page') || null, thought: v('thought') }, now);
          if (note && wantReview) r = C.Books.highlightToReview(st, bookId, note.id, today(), now);
        });
        if (r) toast(`復習に追加しました。初回は ${fmtDue(r.nextDue)}`);
        return true;
      },
      onClose() { notesSheet(bookId); },
    });
  }

  routes.reading = {
    title: '読書',
    fab: '本を追加',
    onHeader(act) { if (act === 'add') bookForm(null); },
    mount(el) {
      bindTabs(el, rd, () => ORBIT.nav.render());
      el.addEventListener('click', (e) => {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        if (e.target.closest('[data-notes]')) notesSheet(row.dataset.id);
        else bookForm(row.dataset.id);
      });
    },
    render(state, el) {
      const list = C.Books.list(state, rd.tab);
      const card = (b) => {
        const pct = b.totalPages ? Math.round((b.currentPage / b.totalPages) * 100) : null;
        const sub = rd.tab === 'done' ? `読了 ${b.finishedOn ? b.finishedOn.replace(/-/g, '/') : ''}`
          : rd.tab === 'reading' ? (b.totalPages ? `<span class="num">${b.currentPage} / ${b.totalPages}</span> ページ・${pct}%` : `<span class="num">${b.currentPage}</span> ページ`)
            : (b.totalPages ? `${b.totalPages} ページ` : '');
        return `<div class="card2" data-id="${esc(b.id)}" role="button" tabindex="0">
          <h4>${esc(b.title)}</h4>${b.author ? `<div class="note" style="margin:0">${esc(b.author)}</div>` : ''}
          <div class="meta" style="margin-top:6px">${sub}</div>
          ${rd.tab === 'reading' && pct != null ? `<div class="bar-prog" aria-hidden="true"><i style="width:${pct}%"></i></div>` : ''}
          <button class="pill" data-notes style="margin-top:10px;min-width:0;height:36px;padding:0 14px">${icon('note', 'sm')}ノート${(b.highlights || []).length ? ` ${b.highlights.length}` : ''}</button></div>`;
      };
      el.innerHTML = tabs([['reading', '読書中'], ['want', '読みたい'], ['done', '読了']], rd.tab)
        + `<div class="pad">${list.length ? list.map(card).join('') : emptyBox(rd.tab === 'want' ? '読みたい本を ＋ から追加' : rd.tab === 'reading' ? '読書中の本はありません' : '読了した本はまだありません')}</div>`;
    },
  };

  function bookForm(id) {
    const s = store.state;
    const b = id ? s.books[id] : null;
    let status = b ? b.status : 'want';
    openSheet({
      title: b ? '本' : '本を追加',
      doneLabel: b ? '保存' : '追加',
      html: `<label class="field"><span>タイトル</span><input class="inp" name="title" value="${esc(b ? b.title : '')}"></label>
        <label class="field"><span>著者</span><input class="inp" name="author" value="${esc(b ? b.author : '')}"></label>
        <div class="btn-row"><label class="field" style="flex:1"><span>現在のページ</span><input class="inp" name="page" type="number" inputmode="numeric" min="0" value="${b ? b.currentPage : 0}"></label>
          <label class="field" style="flex:1"><span>総ページ数</span><input class="inp" name="total" type="number" inputmode="numeric" min="1" value="${b && b.totalPages ? b.totalPages : ''}"></label></div>
        <div class="field"><span>状態</span><div class="seg" data-seg>${Object.entries(STATUS).map(([k, v]) => `<button type="button" data-v="${k}" class="${k === status ? 'on' : ''}">${v}</button>`).join('')}</div></div>
        ${b ? `<p class="note">${b.startedOn ? `開始 ${b.startedOn.replace(/-/g, '/')}` : '未開始'}${b.finishedOn ? `・読了 ${b.finishedOn.replace(/-/g, '/')}` : ''}</p>` : ''}
        <label class="field"><span>メモ</span><textarea class="inp" name="notes">${esc(b ? b.notes : '')}</textarea></label>
        ${b ? `<button type="button" class="btn danger" data-x="delete">${icon('trash')}削除</button>` : ''}`,
      onMount(body) {
        if (!b) setTimeout(() => body.querySelector('[name="title"]').focus(), 320);
        body.querySelector('[data-seg]').addEventListener('click', (e) => {
          const x = e.target.closest('[data-v]'); if (!x) return;
          status = x.dataset.v;
          body.querySelectorAll('[data-seg] button').forEach((y) => y.classList.toggle('on', y === x));
        });
        const del = body.querySelector('[data-x="delete"]');
        if (del) del.onclick = () => { closeSheet(); store.commit((st, now) => C.Books.remove(st, id, now), { undo: '削除しました' }); };
      },
      done(body) {
        const v = (n) => body.querySelector(`[name="${n}"]`).value;
        if (!v('title').trim()) return false;
        const t = today();
        store.commit((st, now) => {
          let book = b ? C.Books.update(st, id, { title: v('title'), author: v('author'), totalPages: v('total') || null, notes: v('notes') }, now)
            : C.Books.create(st, { title: v('title'), author: v('author'), totalPages: v('total') || null }, now);
          if (!b) C.Books.update(st, book.id, { notes: v('notes') }, now);
          if (book.status !== status) C.Books.setStatus(st, book.id, status, t, now);
          if (status !== 'done') C.Books.setProgress(st, book.id, Number(v('page')) || 0, t, now);
          book = st.books[book.id];
          rd.tab = book.status;
          return book;
        });
        return true;
      },
    });
  }

  /* ======================= Habits ======================= */
  const hb = { month: null };
  routes.habits = {
    title: '習慣',
    fab: '習慣を追加',
    onHeader(act) { if (act === 'add') habitForm(null); },
    mount(el) {
      el.addEventListener('click', (e) => {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        if (e.target.closest('[data-act="hbToggle"]')) {
          store.commit((s, now) => C.Habits.toggle(s, row.dataset.id, today(), now));
          ORBIT.ui.haptic();
          return;
        }
        habitForm(row.dataset.id);
      });
    },
    render(state, el) {
      const t = today();
      const list = C.Habits.forDay(state, t);
      const weekStart = C.Dates.dayKey(C.Dates.startOfWeek(Date.now(), state.settings.firstWeekday));
      const week = Array.from({ length: 7 }, (_, i) => C.Dates.addDays(weekStart, i));
      const row = ({ habit, done, scheduled }) => `<li class="row" data-id="${esc(habit.id)}" style="align-items:center">
        <button class="chk ${done ? 'done' : ''}" data-act="hbToggle" aria-label="${done ? '今日の記録を取り消す' : '今日実行した'}"><span class="ring">${done ? icon('check') : ''}</span></button>
        <div class="body"><div class="title" style="${scheduled ? '' : 'color:var(--fg-2)'}">${esc(habit.name)}</div>
          <div class="meta"><span>${habit.days ? habit.days.map((d) => WD[d]).join('・') : '毎日'}${scheduled ? '' : '（今日は予定なし）'}</span></div>
          <div class="week-dots" aria-hidden="true">${week.map((d) => `<i class="${habit.completions[d] ? 'd' : C.Habits.isScheduled(habit, d) ? 's' : ''}"></i>`).join('')}</div></div>
        ${icon('chev', 'sm')}</li>`;
      const doneToday = list.filter((x) => x.scheduled && x.done).length;
      const scheduledToday = list.filter((x) => x.scheduled).length;
      el.innerHTML = list.length
        ? `<p class="note" style="margin:14px 20px 4px">今日 <span class="num">${doneToday} / ${scheduledToday}</span></p><ul class="list">${list.map(row).join('')}</ul><div style="height:140px"></div>`
        : emptyBox('続けたい習慣を ＋ から追加');
    },
  };

  function habitForm(id) {
    const s = store.state;
    const h = id ? s.habits[id] : null;
    let days = h && h.days ? h.days.slice() : null;
    const now = new Date();
    hb.month = [now.getFullYear(), now.getMonth()];
    const calendar = () => {
      if (!h) return '';
      const [y, m] = hb.month;
      const cells = C.Habits.month(store.state, id, y, m);
      const fw = s.settings.firstWeekday;
      const lead = (new Date(y, m, 1).getDay() - fw + 7) % 7;
      const t = today();
      const doneN = cells.filter((c) => c.done).length;
      return `<div class="setting" style="border:0;padding-bottom:0"><button type="button" class="ib" data-cal="-1" aria-label="前の月">${icon('back')}</button>
          <b class="num">${y}年${m + 1}月</b><button type="button" class="ib" data-cal="1" aria-label="次の月" style="transform:scaleX(-1)">${icon('back')}</button></div>
        <p class="note" style="text-align:center;margin:0">実行 <span class="num">${doneN}</span> 日</p>
        <div class="cal">${Array.from({ length: 7 }, (_, i) => `<div class="wd">${WD[(i + fw) % 7]}</div>`).join('')}
          ${'<div></div>'.repeat(lead)}${cells.map((c) => `<div class="${c.done ? 'd' : c.scheduled ? 's' : ''} ${c.day === t ? 'today' : ''}" title="${c.day}">${Number(c.day.slice(8))}</div>`).join('')}</div>`;
    };
    openSheet({
      title: h ? h.name : '習慣を追加',
      doneLabel: h ? '保存' : '追加',
      html: `${h ? `<div data-calwrap>${calendar()}</div>` : ''}
        <label class="field"><span>名前</span><input class="inp" name="name" value="${esc(h ? h.name : '')}" placeholder="例: 英単語 20 個"></label>
        <div class="field"><span>繰り返し</span><div class="seg" data-days>
          <button type="button" data-d="all" class="${days ? '' : 'on'}">毎日</button>
          ${WD.map((w, i) => `<button type="button" data-d="${i}" class="${days && days.includes(i) ? 'on' : ''}">${w}</button>`).join('')}</div></div>
        ${h ? `<button type="button" class="btn danger" data-x="delete">${icon('trash')}削除</button>` : ''}`,
      onMount(body) {
        if (!h) setTimeout(() => body.querySelector('[name="name"]').focus(), 320);
        body.addEventListener('click', (e) => {
          const cal = e.target.closest('[data-cal]');
          if (cal) {
            const d = new Date(hb.month[0], hb.month[1] + Number(cal.dataset.cal), 1);
            hb.month = [d.getFullYear(), d.getMonth()];
            body.querySelector('[data-calwrap]').innerHTML = calendar();
            return;
          }
          const d = e.target.closest('[data-d]');
          if (d) {
            if (d.dataset.d === 'all') days = null;
            else {
              const n = Number(d.dataset.d);
              days = days ? (days.includes(n) ? days.filter((x) => x !== n) : [...days, n]) : [n];
              if (!days.length || days.length === 7) days = null;
            }
            body.querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('on', b.dataset.d === 'all' ? !days : !!days && days.includes(Number(b.dataset.d))));
            return;
          }
          if (e.target.closest('[data-x="delete"]')) { closeSheet(); store.commit((st, n) => C.Habits.remove(st, id, n), { undo: '削除しました' }); }
        });
      },
      done(body) {
        const name = body.querySelector('[name="name"]').value;
        if (!name.trim()) return false;
        if (h) store.commit((st, n) => C.Habits.update(st, id, { name, days }, n));
        else store.commit((st, n) => C.Habits.create(st, { name, days }, n));
        return true;
      },
    });
  }

  /* ======================= Analytics ======================= */
  const an = { tab: 'day', sel: null };
  function barChart(buckets, value, fmt, labelOf, title) {
    const W = 340, H = 168, padL = 6, padR = 6, top = 22, bottom = 26;
    const max = Math.max(1, ...buckets.map(value));
    const n = buckets.length;
    const slot = (W - padL - padR) / n;
    const bw = Math.min(28, slot - 2);       // 隣接バーの間に最低 2px の地を残す
    const bars = buckets.map((b, i) => {
      const v = value(b);
      const h = v ? Math.max(3, (v / max) * (H - top - bottom)) : 0;
      const x = padL + i * slot + (slot - bw) / 2;
      const y = H - bottom - h;
      const r = Math.min(4, h, bw / 2);
      const sel = an.sel === i;
      const path = h ? `M${x},${H - bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${H - bottom}Z` : '';
      return `<g data-i="${i}" style="cursor:pointer"><rect x="${padL + i * slot}" y="${top - 18}" width="${slot}" height="${H - top + 18}" fill="transparent"/>
        ${path ? `<path d="${path}" fill="${sel ? '#93C5FD' : '#60A5FA'}"/>` : ''}
        <text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="rgba(243,246,252,.55)">${labelOf(b, i)}</text>
        ${sel || (an.sel == null && v === max && v > 0) ? `<text x="${x + bw / 2}" y="${Math.max(12, y - 6)}" text-anchor="middle" font-size="11" fill="#F3F6FC" font-weight="600">${fmt(v)}</text>` : ''}</g>`;
    }).join('');
    return `<div class="card2"><h4>${title}</h4>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}の棒グラフ">
        <line x1="${padL}" x2="${W - padR}" y1="${H - bottom + 0.5}" y2="${H - bottom + 0.5}" stroke="rgba(96,165,250,.25)"/>${bars}</svg></div>`;
  }

  routes.analytics = {
    title: '統計',
    mount(el) {
      el.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) { an.tab = tab.dataset.tab; an.sel = null; ORBIT.nav.render(); return; }
        const g = e.target.closest('[data-i]');
        if (g) { const i = Number(g.dataset.i); an.sel = an.sel === i ? null : i; ORBIT.nav.render(); }
      });
    },
    render(state, el) {
      const fw = state.settings.firstWeekday;
      const range = C.Stats.defaultRange(an.tab, Date.now(), fw);
      const buckets = C.Stats.buckets(state, an.tab, range.start, range.end);
      const totals = C.Stats.totals(state, range.start, range.end);
      const label = (b) => {
        const d = new Date(b.start);
        if (an.tab === 'month') return `${d.getMonth() + 1}月`;
        if (an.tab === 'week') return `${d.getMonth() + 1}/${d.getDate()}`;
        // 日表示は、先頭と 1 日だけ月を付けて月またぎを読み取れるようにする。
        return b === buckets[0] || d.getDate() === 1 ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getDate()}`;
      };
      const longLabel = (b) => {
        const d = new Date(b.start);
        if (an.tab === 'month') return `${d.getFullYear()}年${d.getMonth() + 1}月`;
        if (an.tab === 'week') return `${d.getMonth() + 1}/${d.getDate()} の週`;
        return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`;
      };
      const rangeText = an.tab === 'day' ? '直近 7 日' : an.tab === 'week' ? '直近 8 週' : '直近 6 か月';
      const sel = an.sel != null && buckets[an.sel];
      el.innerHTML = tabs([['day', '日'], ['week', '週'], ['month', '月']], an.tab)
        + `<div class="pad"><div class="kpi"><div><small>集中時間（${rangeText}）</small><b class="num">${fmtDuration(totals.focusMs)}</b></div>
            <div><small>完了ポモドーロ</small><b class="num">${totals.pomodoros}<em>回</em></b></div></div>
          ${sel ? `<p class="note" style="text-align:center"><b>${longLabel(sel)}</b>　集中 ${fmtDuration(sel.focusMs)}・${sel.pomodoros} 回</p>` : '<p class="note" style="text-align:center">棒をタップすると値を表示します</p>'}
          ${barChart(buckets, (b) => b.focusMs / 60000, (v) => fmtDuration(v * 60000), label, '集中時間')}
          ${barChart(buckets, (b) => b.pomodoros, (v) => `${v}回`, label, '完了ポモドーロ')}
          <details class="card2"><summary style="cursor:pointer">数値の一覧</summary>
            ${buckets.slice().reverse().map((b) => `<div class="setting" style="padding:10px 2px"><span>${longLabel(b)}</span><span class="num" style="color:var(--fg-2)">${fmtDuration(b.focusMs)}・${b.pomodoros} 回</span></div>`).join('')}</details>
          <p class="note">一時停止・休憩・待機中の時間は含みません。日付をまたいだ集中は日ごとに分けて集計します。</p></div>`;
    },
  };

  /* ======================= Settings ======================= */
  const STEPS = [
    ['focusMin', '集中', '分', 1, 180, 5], ['shortMin', '短い休憩', '分', 1, 60, 1], ['longMin', '長い休憩', '分', 1, 90, 5],
    ['cycles', '長い休憩までの回数', '回', 1, 12, 1], ['trashDays', 'ごみ箱の保持期間', '日', 1, 365, 5],
  ];
  routes.settings = {
    title: '設定',
    mount(el) {
      el.addEventListener('click', async (e) => {
        const st = e.target.closest('[data-step]');
        if (st) {
          const [key, , , lo, hi, step] = STEPS.find((x) => x[0] === st.dataset.key);
          const cur = store.state.settings[key];
          const dir = Number(st.dataset.step);
          // 小さい値の付近では 1 刻みにして、1〜4 分のような短い設定も選べるようにする
          const unit = cur + dir * step < step || (dir < 0 && cur <= step) ? 1 : step;
          const next = Math.max(lo, Math.min(hi, cur + dir * unit));
          store.commit((s) => C.updateSettings(s, { [key]: next }));
          return;
        }
        const act = e.target.closest('[data-set]');
        if (!act) return;
        if (act.dataset.set.startsWith('acc:')) { ORBIT.account.action(act.dataset.set.slice(4)); return; }
        if (act.dataset.set.startsWith('push:')) { ORBIT.push.action(act.dataset.set.slice(5)); return; }
        if (act.dataset.set === 'export') exportData();
        if (act.dataset.set === 'import') importDialog();
        if (act.dataset.set === 'trash') ORBIT.nav.open('trash');
        if (act.dataset.set === 'archive') ORBIT.nav.open('archive');
      });
    },
    render(state, el) {
      const s = state.settings;
      const persisted = ORBIT.persisted;
      el.innerHTML = `<div class="pad">${ORBIT.account.settingsHTML()}${ORBIT.push ? ORBIT.push.settingsHTML() : ''}
        <h4 class="note" style="margin-top:${ORBIT.account.user ? 22 : 16}px">ポモドーロ</h4>
        ${STEPS.map(([key, label, unit]) => `<div class="setting"><span>${label}</span><div class="stepper">
          <button data-step="-1" data-key="${key}" aria-label="${label}を減らす">−</button><span class="v num">${s[key]}${unit}</span>
          <button data-step="1" data-key="${key}" aria-label="${label}を増やす">＋</button></div></div>`).join('')}
        <h4 class="note" style="margin-top:22px">データ</h4>
        <button class="menu-item" data-set="archive">${icon('archive')}アーカイブ</button>
        <button class="menu-item" data-set="trash">${icon('trash')}ごみ箱</button>
        <button class="menu-item" data-set="export">${icon('download')}バックアップを書き出す</button>
        <button class="menu-item" data-set="import">${icon('upload')}バックアップから復元</button>
        <p class="note">データはこの端末のブラウザ内に保存されます${persisted === true ? '（消去されにくい永続ストレージ）' : ''}${ORBIT.account.user ? '。ログイン中はクラウドにも同期されます' : ''}。iPhone では「ホーム画面に追加」して使うと、しばらく開かなくてもデータが消されません。定期的なバックアップを推奨します。</p>
        <p class="note" style="color:var(--fg-3)">ORBIT v1.0.0</p></div>`;
    },
  };

  function exportData() {
    const json = store.exportJSON();
    const name = `orbit-backup-${today()}.json`;
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'ORBIT バックアップ' }).catch(() => {});
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function importDialog() {
    let parsed = null;
    openSheet({
      title: 'バックアップから復元',
      cancelLabel: 'キャンセル',
      html: `<p class="note">復元すると現在のデータは置き換わります。念のため先に書き出しておいてください。</p>
        <label class="btn">${icon('upload')}ファイルを選ぶ<input type="file" accept="application/json,.json" hidden></label>
        <p class="note" data-info></p>
        <button class="btn primary" data-apply disabled>このデータで置き換える</button>`,
      onMount(body) {
        const info = body.querySelector('[data-info]');
        const apply = body.querySelector('[data-apply]');
        body.querySelector('input[type=file]').addEventListener('change', async (e) => {
          const f = e.target.files[0]; if (!f) return;
          try {
            parsed = C.importData(await f.text());
            const n = (o) => Object.values(o).filter((x) => !x.deletedAt).length;
            info.textContent = `タスク ${n(parsed.tasks)} 件・プロジェクト ${n(parsed.projects)} 件・復習 ${n(parsed.reviews)} 件・本 ${n(parsed.books)} 冊・習慣 ${n(parsed.habits)} 件`;
            apply.disabled = false;
          } catch (err) {
            parsed = null;
            info.textContent = `読み込めませんでした: ${err.message}`;
            apply.disabled = true;
          }
        });
        apply.addEventListener('click', () => {
          if (!parsed) return;
          const backup = store.exportJSON();
          store.replace(parsed);
          closeSheet();
          toast('復元しました', () => store.replace(C.importData(backup)));
        });
      },
    });
  }

  if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then((v) => { ORBIT.persisted = v; }).catch(() => {});
})();
