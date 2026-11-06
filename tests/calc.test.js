import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as calc from '../js/calc.js';

const tx = (type, amount, date, category = 'その他') => ({ id: Math.random().toString(), type, amount, date, category });

test('純資産 = 初期残高 + 収入 - 支出 - 借金', () => {
  const state = {
    settings: { initialCash: -20000 },
    transactions: [tx('income', 200000, '2026-10-25'), tx('expense', 150000, '2026-10-30')],
    debts: [{ balance: 300000 }, { balance: 0 }],
    recurring: [],
  };
  assert.equal(calc.cashBalance(state), 30000);
  assert.equal(calc.netWorth(state), -270000);
});

test('月の収支と平均', () => {
  const t = [
    tx('income', 200000, '2026-09-25'), tx('expense', 180000, '2026-09-10'),
    tx('income', 200000, '2026-10-25'), tx('expense', 160000, '2026-10-10'),
    tx('expense', 999999, '2026-11-01'), // 今月は平均に含めない
  ];
  assert.deepEqual(calc.monthSummary(t, '2026-10'), { income: 200000, expense: 160000, balance: 40000 });
  assert.equal(calc.averageMonthlyBalance(t, '2026-11', 3), 30000);
  assert.equal(calc.averageMonthlyBalance([], '2026-11', 3), null);
});

test('黒字転換までの月数', () => {
  assert.equal(calc.monthsToPositive(100, 10), 0);
  assert.equal(calc.monthsToPositive(-100000, 30000), 4);
  assert.equal(calc.monthsToPositive(-100000, -5000), null);
  assert.equal(calc.monthsToPositive(-100000, null), null);
});

test('addMonths は年またぎも正しい', () => {
  assert.equal(calc.addMonths('2026-11', 3), '2027-02');
  assert.equal(calc.addMonths('2026-01', -1), '2025-12');
});

test('返済シミュレーション：金利0なら単純割り算', () => {
  const r = calc.simulateDebts([{ id: 'a', name: 'A', balance: 100000, rate: 0, minPayment: 10000 }], 20000, 'avalanche');
  assert.equal(r.ok, true);
  assert.equal(r.months, 5);
  assert.equal(r.totalInterest, 0);
});

test('返済シミュレーション：アバランチは利息が少なく、スノーボールは小さい借金を先に完済', () => {
  const debts = [
    { id: 'big', name: '高金利大', balance: 500000, rate: 18, minPayment: 10000 },
    { id: 'small', name: '低金利小', balance: 50000, rate: 3, minPayment: 5000 },
  ];
  const a = calc.simulateDebts(debts, 40000, 'avalanche');
  const s = calc.simulateDebts(debts, 40000, 'snowball');
  assert.ok(a.ok && s.ok);
  assert.ok(a.totalInterest < s.totalInterest);
  assert.equal(s.payoffOrder[0].id, 'small');
  assert.ok(s.payoffOrder[0].month < a.payoffOrder.find((p) => p.id === 'small').month);
});

test('返済シミュレーション：予算不足・利息に負ける場合はNG', () => {
  const d = [{ id: 'a', name: 'A', balance: 100000, rate: 15, minPayment: 5000 }];
  assert.equal(calc.simulateDebts(d, 3000, 'avalanche').ok, false);
  const huge = [{ id: 'a', name: 'A', balance: 10000000, rate: 18, minPayment: 1000 }];
  assert.equal(calc.simulateDebts(huge, 1000, 'avalanche').ok, false);
});

test('固定費の未記録判定', () => {
  const state = {
    recurring: [{ id: 'r1' }, { id: 'r2' }],
    transactions: [{ ...tx('expense', 1, '2026-11-01'), recurringId: 'r1' }, { ...tx('expense', 1, '2026-10-01'), recurringId: 'r2' }],
  };
  assert.deepEqual(calc.pendingRecurring(state, '2026-11').map((r) => r.id), ['r2']);
});

test('レシート解析：合計行を優先し、小計や単品は拾わない', () => {
  const text = `スーパーなにわ 本町店
2026年11月03日 18:22
たまご 228
牛乳 ¥198
小計 ¥426
合計 ￥４６０
お預り ¥1,000`;
  const r = calc.parseReceipt(text);
  assert.equal(r.amount, 460);
  assert.equal(r.date, '2026-11-03');
  assert.equal(r.store, 'スーパーなにわ 本町店');
});

test('レシート解析：合計が無ければ¥付き最大値、日付は/区切り', () => {
  const r = calc.parseReceipt('コンビニ\n2026/10/5\nおにぎり ¥150\nお茶 ¥120');
  assert.equal(r.amount, 150);
  assert.equal(r.date, '2026-10-05');
});
