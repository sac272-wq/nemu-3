import * as calc from './calc.js';
import { load, save, uid, validateImport, DEFAULT_CATEGORIES, REPAY_CATEGORY } from './store.js';

let state = load();
const $ = (id) => document.getElementById(id);
const yen = (n) => `${n < 0 ? '-' : ''}¥${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const thisMonth = () => calc.ym(today());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let txType = 'expense';
let txCategory = DEFAULT_CATEGORIES.expense[0];
let listMonth = thisMonth();
let reportMonth = thisMonth();

function persist() {
  if (!save(state)) toast('保存に失敗したわ…ブラウザの容量かプライベートモードを確認してね');
  render();
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2600);
}

// ---------- タブ ----------
document.querySelectorAll('.tabbar button').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0, 0);
}

// ---------- ホーム ----------
function renderHome() {
  const m = thisMonth();
  $('month-label').textContent = `${m.replace('-', '年')}月`;
  const cash = calc.cashBalance(state);
  const debt = calc.totalDebt(state);
  const nw = cash - debt;
  // 純資産を動かすのは「返済を除いた収支」
  const nonRepay = state.transactions.filter((t) => t.category !== REPAY_CATEGORY);
  const avg = calc.averageMonthlyBalance(nonRepay, m, 3);
  const months = calc.monthsToPositive(nw, avg);

  let forecast;
  if (months === 0) forecast = '🎉 黒字転換達成！この調子で貯めていこ〜！';
  else if (avg == null) forecast = '先月以前の記録がたまると「黒字転換まであと何ヶ月か」を出すわね。';
  else if (months == null) forecast = `直近の平均収支（返済除く）が ${yen(avg)}/月。このままやと黒字にならへんの。まず毎月の収支をプラスにしよ！`;
  else forecast = `直近の平均ペース（${yen(avg)}/月）なら、あと約 <strong>${months}ヶ月</strong> で黒字転換よ！（利息は含まない目安）`;

  $('hero').innerHTML = `
    <div class="muted small">純資産（現金 − 借金）</div>
    <div class="big ${nw < 0 ? 'neg' : 'pos'}">${yen(nw)}</div>
    <div class="row small muted"><span>現金 ${yen(cash)}</span><span>借金 ${yen(debt)}</span></div>
    <p class="forecast">${forecast}</p>`;

  const s = calc.monthSummary(state.transactions, m);
  $('month-card').innerHTML = `
    <h2>今月の収支</h2>
    <div class="grid3">
      <div><div class="muted small">収入</div><div class="pos">${yen(s.income)}</div></div>
      <div><div class="muted small">支出</div><div class="neg">${yen(s.expense)}</div></div>
      <div><div class="muted small">収支</div><div class="${s.balance < 0 ? 'neg' : 'pos'}"><strong>${yen(s.balance)}</strong></div></div>
    </div>
    <p class="muted small">※支出には借金返済も含むわ</p>`;

  const pending = calc.pendingRecurring(state, m);
  const pc = $('pending-card');
  pc.hidden = pending.length === 0;
  if (pending.length) {
    pc.innerHTML = `<h2>今月の固定費、記録する？</h2>
      <ul class="list">${pending.map((r) => `<li><span>${esc(r.memo || r.category)}<br><span class="muted small">${r.day}日・${esc(r.category)}</span></span>
      <span class="${r.type === 'income' ? 'pos' : 'neg'}">${yen(r.amount)}</span></li>`).join('')}</ul>
      <button type="button" class="primary" id="apply-rec">まとめて記録</button>`;
    $('apply-rec').onclick = () => {
      for (const r of pending) {
        state.transactions.push({
          id: uid(), type: r.type, amount: r.amount, category: r.category,
          date: `${m}-${String(r.day).padStart(2, '0')}`, memo: r.memo, recurringId: r.id,
        });
      }
      persist();
      toast(`${pending.length}件記録したわ`);
    };
  }

  const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 5);
  $('recent-list').innerHTML = recent.length ? recent.map(txItem).join('') : '<li class="muted">まだ記録がないわ。「記録」タブから始めよ！</li>';
}

function txItem(t) {
  return `<li data-id="${t.id}">
    <span>${esc(t.memo || t.category)}<br><span class="muted small">${t.date.slice(5).replace('-', '/')}・${esc(t.category)}</span></span>
    <span class="${t.type === 'income' ? 'pos' : 'neg'}">${t.type === 'income' ? '+' : '-'}${yen(t.amount)}</span>
  </li>`;
}

// ---------- 入力 ----------
function renderChips() {
  const cats = DEFAULT_CATEGORIES[txType];
  if (!cats.includes(txCategory)) txCategory = cats[0];
  $('cat-chips').innerHTML = cats
    .map((c) => `<button type="button" class="chip ${c === txCategory ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
    .join('');
}
$('cat-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  txCategory = b.dataset.cat;
  renderChips();
});
document.querySelectorAll('.seg-btn').forEach((b) =>
  b.addEventListener('click', () => setType(b.dataset.type)),
);
function setType(type) {
  txType = type;
  document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.type === type));
  renderChips();
}

function resetForm() {
  $('tx-form').reset();
  $('tx-id').value = '';
  $('tx-date').value = today();
  $('tx-submit').textContent = '記録する';
  $('tx-cancel').hidden = true;
}

$('tx-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Math.round(Number($('tx-amount').value));
  if (!(amount > 0)) return toast('金額を入れてね');
  const id = $('tx-id').value;
  const data = { type: txType, amount, category: txCategory, date: $('tx-date').value, memo: $('tx-memo').value.trim() };
  if (id) {
    const t = state.transactions.find((x) => x.id === id);
    if (t.debtId) {
      // 返済記録の金額変更は借金残高にも反映
      const d = state.debts.find((x) => x.id === t.debtId);
      if (d) d.balance += t.amount - amount;
    }
    Object.assign(t, data);
    toast('更新したわ');
  } else {
    state.transactions.push({ id: uid(), ...data });
    toast(txType === 'income' ? '収入ゲット〜！' : '記録したわ、えらい！');
  }
  listMonth = calc.ym(data.date);
  resetForm();
  persist();
});
$('tx-cancel').addEventListener('click', resetForm);

function renderTxList() {
  $('list-month').textContent = `${listMonth.replace('-', '年')}月`;
  const items = state.transactions
    .filter((t) => calc.ym(t.date) === listMonth)
    .sort((a, b) => b.date.localeCompare(a.date));
  $('tx-list').innerHTML = items.length
    ? items.map((t) => txItem(t).replace('</li>', `<span class="actions"><button type="button" class="link" data-edit="${t.id}">編集</button><button type="button" class="link danger" data-del="${t.id}">削除</button></span></li>`)).join('')
    : '<li class="muted">この月の記録はないわ</li>';
}
$('tx-list').addEventListener('click', (e) => {
  const edit = e.target.dataset.edit;
  const del = e.target.dataset.del;
  if (edit) {
    const t = state.transactions.find((x) => x.id === edit);
    setType(t.type);
    txCategory = t.category;
    renderChips();
    $('tx-id').value = t.id;
    $('tx-amount').value = t.amount;
    $('tx-date').value = t.date;
    $('tx-memo').value = t.memo || '';
    $('tx-submit').textContent = '更新する';
    $('tx-cancel').hidden = false;
    window.scrollTo(0, 0);
  } else if (del) {
    if (!confirm('この記録を削除する？')) return;
    const t = state.transactions.find((x) => x.id === del);
    if (t.debtId) {
      const d = state.debts.find((x) => x.id === t.debtId);
      if (d) d.balance += t.amount; // 返済を取り消したら残高を戻す
    }
    state.transactions = state.transactions.filter((x) => x.id !== del);
    persist();
  }
});
$('prev-month').onclick = () => { listMonth = calc.addMonths(listMonth, -1); renderTxList(); };
$('next-month').onclick = () => { listMonth = calc.addMonths(listMonth, 1); renderTxList(); };

// ---------- レシートOCR（端末内） ----------
let tesseractLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tesseractLoading) {
    tesseractLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = resolve;
      s.onerror = () => { tesseractLoading = null; reject(new Error('OCRの読み込みに失敗')); };
      document.head.appendChild(s);
    });
  }
  return tesseractLoading;
}

$('receipt-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('ocr-status');
  status.hidden = false;
  status.textContent = '読み取り準備中…（初回は日本語データのダウンロードで少し時間かかるわ）';
  try {
    await loadTesseract();
    const worker = await window.Tesseract.createWorker('jpn', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') status.textContent = `読み取り中… ${Math.round(m.progress * 100)}%`;
      },
    });
    const { data } = await worker.recognize(file);
    await worker.terminate();
    const r = calc.parseReceipt(data.text);
    setType('expense');
    if (r.amount) $('tx-amount').value = r.amount;
    if (r.date) $('tx-date').value = r.date;
    if (r.store) $('tx-memo').value = r.store.slice(0, 60);
    status.textContent = r.amount
      ? '読み取ったわ！金額・日付・カテゴリが合ってるか確認してから記録してね。'
      : '合計金額が見つからへんかったわ…手入力でお願い！（明るい場所でまっすぐ撮ると精度上がるで）';
  } catch (err) {
    status.textContent = `読み取りに失敗したわ：${err.message || err}。ネット接続を確認するか手入力してね。`;
  }
});

// ---------- 借金 ----------
function renderDebts() {
  $('debt-list').innerHTML = state.debts.length
    ? state.debts.map((d) => `<li>
        <span>${esc(d.name)}<br><span class="muted small">年利${d.rate}%・最低${yen(d.minPayment)}/月</span></span>
        <span class="right"><span class="${d.balance > 0 ? 'neg' : 'pos'}">${d.balance > 0 ? yen(d.balance) : '完済🎉'}</span>
        <span class="actions">
          <button type="button" class="link" data-repay="${d.id}">返済を記録</button>
          <button type="button" class="link" data-dedit="${d.id}">編集</button>
          <button type="button" class="link danger" data-ddel="${d.id}">削除</button>
        </span></span>
      </li>`).join('')
    : '<li class="muted">登録された借金はないわ。あれば追加してね。</li>';

  const minSum = state.debts.filter((d) => d.balance > 0).reduce((s, d) => s + d.minPayment, 0);
  const budgetEl = $('repay-budget');
  if (document.activeElement !== budgetEl) budgetEl.value = state.settings.monthlyRepayBudget || minSum || '';
  renderPlan();
}

function renderPlan() {
  const active = state.debts.filter((d) => d.balance > 0);
  const out = $('plan-result');
  if (!active.length) { out.innerHTML = '<p class="muted small">借金を登録するとプランを比較できるわ。</p>'; return; }
  const budget = Number($('repay-budget').value) || 0;
  const minSum = active.reduce((s, d) => s + d.minPayment, 0);
  const a = calc.simulateDebts(active, budget, 'avalanche');
  const s = calc.simulateDebts(active, budget, 'snowball');
  const base = calc.simulateDebts(active, minSum, 'avalanche');
  const card = (title, sub, r) => r.ok
    ? `<div class="plan"><h3>${title}</h3><p class="muted small">${sub}</p>
        <p>完済まで <strong>${r.months}ヶ月</strong>（${completion(r.months)}）<br>利息の合計 <strong class="neg">${yen(r.totalInterest)}</strong></p>
        <ol class="small">${r.payoffOrder.map((p) => `<li>${esc(p.name)}：${p.month}ヶ月目に完済</li>`).join('')}</ol></div>`
    : `<div class="plan"><h3>${title}</h3><p class="neg small">${esc(r.reason)}</p></div>`;
  let tip = '';
  if (a.ok && s.ok) {
    const diff = s.totalInterest - a.totalInterest;
    tip = diff > 0
      ? `<p class="tip">💡 金利高い順のほうが利息 <strong>${yen(diff)}</strong> おトク。途中で挫折しそうなら、早く1件完済できる残高少ない順もアリよ！</p>`
      : '<p class="tip">💡 今回はどっちの順でも利息は同じくらいね。早く1件消せる残高少ない順でモチベ上げてこ！</p>';
    if (base.ok && budget > minSum && base.totalInterest > a.totalInterest) {
      tip += `<p class="tip">最低額だけ払うより、利息 <strong>${yen(base.totalInterest - a.totalInterest)}</strong> 減って ${base.months - a.months}ヶ月早く終わるわ！</p>`;
    }
  }
  out.innerHTML = `<p class="muted small">最低返済額の合計：${yen(minSum)}/月。月利は「年利÷12」の概算やから、実際の明細とはズレることがあるわ。</p>
    ${tip}
    <div class="plans">${card('金利が高い順', 'アバランチ方式：利息が一番少ない', a)}${card('残高が少ない順', 'スノーボール方式：完済の達成感が早い', s)}</div>`;
}

function completion(months) {
  const m = calc.addMonths(thisMonth(), months);
  return `${m.replace('-', '年')}月ごろ`;
}

$('repay-budget').addEventListener('input', () => {
  state.settings.monthlyRepayBudget = Number($('repay-budget').value) || 0;
  save(state);
  renderPlan();
});

$('debt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('debt-id').value;
  const data = {
    name: $('debt-name').value.trim(),
    balance: Math.round(Number($('debt-balance').value)),
    rate: Number($('debt-rate').value),
    minPayment: Math.round(Number($('debt-min').value)),
  };
  if (id) Object.assign(state.debts.find((d) => d.id === id), data);
  else state.debts.push({ id: uid(), ...data });
  $('debt-form').reset();
  $('debt-id').value = '';
  $('debt-form-wrap').open = false;
  persist();
  toast('保存したわ');
});

$('debt-list').addEventListener('click', (e) => {
  const { repay, dedit, ddel } = e.target.dataset;
  if (repay) {
    const d = state.debts.find((x) => x.id === repay);
    const input = prompt(`「${d.name}」に返済した金額は？（円）`, d.minPayment);
    const amount = Math.round(Number(input));
    if (!input || !(amount > 0)) return;
    d.balance = Math.max(0, d.balance - amount);
    state.transactions.push({ id: uid(), type: 'expense', amount, category: REPAY_CATEGORY, date: today(), memo: `${d.name} 返済`, debtId: d.id });
    persist();
    toast(d.balance === 0 ? '完済おめでとう〜！！🎉' : `残り ${yen(d.balance)}、一歩前進よ！（利息分は明細を見て「編集」で合わせてね）`);
  } else if (dedit) {
    const d = state.debts.find((x) => x.id === dedit);
    $('debt-id').value = d.id;
    $('debt-name').value = d.name;
    $('debt-balance').value = d.balance;
    $('debt-rate').value = d.rate;
    $('debt-min').value = d.minPayment;
    $('debt-form-wrap').open = true;
  } else if (ddel) {
    if (!confirm('この借金を削除する？（返済の記録は残るわ）')) return;
    state.debts = state.debts.filter((x) => x.id !== ddel);
    persist();
  }
});

// ---------- 分析 ----------
function renderReport() {
  $('r-month').textContent = `${reportMonth.replace('-', '年')}月`;
  const rows = calc.categoryBreakdown(state.transactions, reportMonth);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  $('breakdown').innerHTML = rows.length
    ? `<p class="muted small">支出合計 ${yen(total)}</p>` + rows.map((r) => `
      <div class="bar-row"><span class="bar-label">${esc(r.category)}</span>
        <span class="bar"><span style="width:${(r.amount / rows[0].amount) * 100}%"></span></span>
        <span class="bar-val">${yen(r.amount)}<span class="muted small"> ${Math.round((r.amount / total) * 100)}%</span></span></div>`).join('')
    : '<p class="muted">この月の支出はないわ</p>';

  const months = Array.from({ length: 6 }, (_, i) => calc.addMonths(thisMonth(), i - 5));
  const sums = months.map((m) => ({ m, ...calc.monthSummary(state.transactions, m) }));
  const maxAbs = Math.max(1, ...sums.map((x) => Math.abs(x.balance)));
  $('trend').innerHTML = sums.map((x) => `
    <div class="bar-row"><span class="bar-label">${Number(x.m.slice(5))}月</span>
      <span class="bar ${x.balance < 0 ? 'minus' : ''}"><span style="width:${(Math.abs(x.balance) / maxAbs) * 100}%"></span></span>
      <span class="bar-val ${x.balance < 0 ? 'neg' : 'pos'}">${yen(x.balance)}</span></div>`).join('')
    + '<p class="muted small">緑が黒字、赤が赤字の月よ。緑を増やしていこ！</p>';
}
$('r-prev').onclick = () => { reportMonth = calc.addMonths(reportMonth, -1); renderReport(); };
$('r-next').onclick = () => { reportMonth = calc.addMonths(reportMonth, 1); renderReport(); };

// ---------- 設定 ----------
function renderSettings() {
  if (document.activeElement !== $('initial-cash')) $('initial-cash').value = state.settings.initialCash || 0;
  $('rec-list').innerHTML = state.recurring.length
    ? state.recurring.map((r) => `<li><span>${esc(r.memo || r.category)}<br><span class="muted small">毎月${r.day}日・${esc(r.category)}</span></span>
        <span class="right"><span class="${r.type === 'income' ? 'pos' : 'neg'}">${yen(r.amount)}</span>
        <span class="actions"><button type="button" class="link danger" data-rdel="${r.id}">削除</button></span></span></li>`).join('')
    : '<li class="muted">まだないわ。家賃・スマホ代・給料などを登録しとくとラクよ。</li>';
}
function renderRecCategories() {
  const type = $('rec-type').value;
  $('rec-category').innerHTML = DEFAULT_CATEGORIES[type].map((c) => `<option>${esc(c)}</option>`).join('');
}
$('rec-type').addEventListener('change', renderRecCategories);
$('save-initial').onclick = () => {
  state.settings.initialCash = Math.round(Number($('initial-cash').value) || 0);
  persist();
  toast('スタート地点を保存したわ');
};
$('rec-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.recurring.push({
    id: uid(), type: $('rec-type').value, category: $('rec-category').value,
    amount: Math.round(Number($('rec-amount').value)), day: Math.min(28, Math.max(1, Number($('rec-day').value) || 1)),
    memo: $('rec-memo').value.trim(),
  });
  $('rec-form').reset();
  renderRecCategories();
  persist();
  toast('固定費を追加したわ');
});
$('rec-list').addEventListener('click', (e) => {
  const id = e.target.dataset.rdel;
  if (!id || !confirm('この固定費を削除する？（過去の記録は残るわ）')) return;
  state.recurring = state.recurring.filter((r) => r.id !== id);
  persist();
});
$('export-btn').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kakeibo-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (!validateImport(obj)) throw new Error('形式が違う');
    if (!confirm('今のデータを上書きして読み込む？')) return;
    state = obj;
    persist();
    toast('読み込んだわ！');
  } catch {
    toast('このファイルは読み込めへんかったわ');
  }
});

// ---------- 起動 ----------
function render() {
  renderHome();
  renderTxList();
  renderDebts();
  renderReport();
  renderSettings();
}

resetForm();
renderChips();
renderRecCategories();
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
