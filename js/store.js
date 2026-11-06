// 端末内（localStorage）だけにデータを保存する
const KEY = 'kakeibo-v1';

export const DEFAULT_CATEGORIES = {
  expense: ['食費', '日用品', '外食', '交通', '住居', '水道光熱', '通信', '医療', '娯楽', '衣服', '交際', 'サブスク', '借金返済', 'その他'],
  income: ['給与', '副業', '臨時収入', 'その他'],
};

export const REPAY_CATEGORY = '借金返済';

function emptyState() {
  return {
    version: 1,
    settings: { initialCash: 0, monthlyRepayBudget: 0 },
    transactions: [], // {id,type,amount,category,date,memo,recurringId?,debtId?}
    recurring: [], // {id,type,amount,category,day,memo}
    debts: [], // {id,name,balance,rate,minPayment}
  };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch {
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function validateImport(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    Array.isArray(obj.transactions) &&
    Array.isArray(obj.recurring) &&
    Array.isArray(obj.debts) &&
    obj.settings &&
    typeof obj.settings === 'object'
  );
}
