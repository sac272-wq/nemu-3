// 純粋な計算ロジック（DOMに依存しない。node でテスト可能）

export const ym = (dateStr) => dateStr.slice(0, 7); // "2026-11-06" -> "2026-11"

export function addMonths(ymStr, n) {
  const [y, m] = ymStr.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 現金残高 = 初期残高 + 収入合計 - 支出合計 */
export function cashBalance(state) {
  return state.transactions.reduce(
    (sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount),
    state.settings.initialCash || 0,
  );
}

export function totalDebt(state) {
  return state.debts.reduce((s, d) => s + Math.max(0, d.balance), 0);
}

/** 純資産 = 現金 - 借金。これがプラスになったら「黒字転換」 */
export function netWorth(state) {
  return cashBalance(state) - totalDebt(state);
}

/** 指定月の収入・支出・収支（返済も支出に含むキャッシュフロー） */
export function monthSummary(transactions, month) {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (ym(t.date) !== month) continue;
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, balance: income - expense };
}

export function categoryBreakdown(transactions, month) {
  const map = {};
  for (const t of transactions) {
    if (t.type !== 'expense' || ym(t.date) !== month) continue;
    map[t.category] = (map[t.category] || 0) + t.amount;
  }
  return Object.entries(map)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * 直近 n ヶ月（今月を除く完了月）の平均収支。データがある月だけで平均する。
 */
export function averageMonthlyBalance(transactions, currentMonth, n = 3) {
  const results = [];
  for (let i = 1; i <= n; i++) {
    const m = addMonths(currentMonth, -i);
    if (!transactions.some((t) => ym(t.date) === m)) continue;
    results.push(monthSummary(transactions, m).balance);
  }
  if (results.length === 0) return null;
  return Math.round(results.reduce((a, b) => a + b, 0) / results.length);
}

/**
 * 黒字転換（純資産 >= 0）までの月数の目安。
 * 返済は「現金↓借金↓」で純資産を変えないので、純資産を動かすのは
 * 「返済を除いた収支」になる。ただし借金の利息はここでは考慮しない（概算）。
 * @returns {number|null} 0=達成済み, null=今のペースでは到達しない/データ不足
 */
export function monthsToPositive(currentNetWorth, monthlyGain) {
  if (currentNetWorth >= 0) return 0;
  if (monthlyGain == null || monthlyGain <= 0) return null;
  return Math.ceil(-currentNetWorth / monthlyGain);
}

/**
 * 借金返済シミュレーション
 * @param debts [{id,name,balance,rate(年利%),minPayment}]
 * @param monthlyBudget 毎月の返済総額
 * @param strategy 'avalanche'(金利高い順) | 'snowball'(残高少ない順)
 * @returns {ok, months, totalInterest, payoffOrder:[{id,name,month}], reason?}
 */
export function simulateDebts(debts, monthlyBudget, strategy, maxMonths = 600) {
  const list = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ ...d, bal: d.balance }));
  if (list.length === 0) return { ok: true, months: 0, totalInterest: 0, payoffOrder: [] };

  const minSum = list.reduce((s, d) => s + d.minPayment, 0);
  if (monthlyBudget < minSum) {
    return { ok: false, reason: `返済予算が最低返済額の合計（${minSum}円）より少ないわ` };
  }

  const order = [...list].sort((a, b) =>
    strategy === 'avalanche' ? b.rate - a.rate || a.bal - b.bal : a.bal - b.bal || b.rate - a.rate,
  );

  let totalInterest = 0;
  const payoffOrder = [];
  for (let month = 1; month <= maxMonths; month++) {
    // 利息発生
    for (const d of order) {
      if (d.bal <= 0) continue;
      const interest = Math.round((d.bal * d.rate) / 100 / 12);
      d.bal += interest;
      totalInterest += interest;
    }
    // 最低返済
    let pool = monthlyBudget;
    for (const d of order) {
      if (d.bal <= 0) continue;
      const pay = Math.min(d.minPayment, d.bal);
      d.bal -= pay;
      pool -= pay;
    }
    // 余りを優先順に投入（完済した分の枠も自動で次に回る）
    for (const d of order) {
      if (pool <= 0) break;
      if (d.bal <= 0) continue;
      const pay = Math.min(pool, d.bal);
      d.bal -= pay;
      pool -= pay;
    }
    for (const d of order) {
      if (d.bal <= 0 && !payoffOrder.some((p) => p.id === d.id)) {
        payoffOrder.push({ id: d.id, name: d.name, month });
      }
    }
    if (order.every((d) => d.bal <= 0)) {
      return { ok: true, months: month, totalInterest, payoffOrder };
    }
  }
  return { ok: false, reason: `${maxMonths / 12}年以内に完済できへん計算よ。返済予算を見直してね` };
}

/** 固定費のうち、指定月にまだ記録されていないものを返す */
export function pendingRecurring(state, month) {
  return state.recurring.filter(
    (r) => !state.transactions.some((t) => t.recurringId === r.id && ym(t.date) === month),
  );
}

/**
 * OCR テキストからレシート情報を推測する。完璧ではないので必ず確認画面で直す前提。
 */
export function parseReceipt(text) {
  const normalized = text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，,]/g, '')
    .replace(/[￥]/g, '¥');
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);

  const nums = (line) => (line.match(/\d+/g) || []).map(Number).filter((n) => n > 0 && n < 10_000_000);

  let amount = null;
  // 1) 「合計」「お支払」「総計」などの行の数値を優先（「小計」は後回し）
  const keywords = [/(合\s*計|総\s*計|お?支\s*払|ご請求|お会計)/, /小\s*計/];
  for (const kw of keywords) {
    for (const line of lines) {
      if (!kw.test(line)) continue;
      const n = nums(line);
      if (n.length) {
        amount = n[n.length - 1];
        break;
      }
    }
    if (amount != null) break;
  }
  // 2) 見つからなければ ¥ 付きの最大値
  if (amount == null) {
    const yen = lines.flatMap((l) => [...l.matchAll(/¥\s*(\d+)/g)].map((m) => Number(m[1])));
    if (yen.length) amount = Math.max(...yen);
  }

  let date = null;
  const dm = normalized.match(/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/);
  if (dm) {
    const [, y, m, d] = dm;
    const mm = Number(m);
    const dd = Number(d);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      date = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }

  const store = lines.find((l) => /[\p{L}]{2,}/u.test(l) && !/\d{3,}/.test(l)) || '';
  return { amount, date, store };
}
