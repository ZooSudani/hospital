import { queries } from './catalog.js';
import { directExecutor, guardedExecutor } from './executors.js';

// level: 'l1' | 'l2' | 'l3'
// الفرق بين l1 وl2 في مخطط القاعدة (مفاتيح أجنبية عادية أو مركبة)، والفرق مع l3 في الحارسين.
export function makeData(level, db, tid, faults = {}) {
  const q = queries(tid, faults);
  const exec = level === 'l3' ? guardedExecutor(db, tid) : directExecutor(db);
  return Object.fromEntries(Object.keys(q).map((name) => [name, (...args) => exec(q[name](...args))]));
}

export { IsolationError } from './executors.js';
