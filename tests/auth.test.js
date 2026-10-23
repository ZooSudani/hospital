import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../lib/auth.js';

const h = await hashPassword('كلمة-سر-123');
assert.ok(await verifyPassword('كلمة-سر-123', h));
assert.ok(!(await verifyPassword('خطأ', h)));

const t = await signToken({ sub: 'u1', tid: 't1', role: 'admin' }, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
assert.equal((await verifyToken(t, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).tid, 't1');
assert.equal(await verifyToken(t, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), null, 'سر مختلف يجب أن يُرفض');

const [a, b, c] = t.split('.');
const forged = Buffer.from(JSON.stringify({ sub: 'u1', tid: 'OTHER', role: 'admin', exp: 9999999999 })).toString('base64url');
assert.equal(await verifyToken(`${a}.${forged}.${c}`, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), null, 'تعديل tid يجب أن يُرفض');

const expired = await signToken({ sub: 'u1' }, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', -10);
assert.equal(await verifyToken(expired, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), null, 'توكن منتهٍ يجب أن يُرفض');
await assert.rejects(() => signToken({ sub: 'u1' }, 'short'), /ضعيف/, 'سر قصير يُرفض');

import { passwordProblem, safeEqual } from '../lib/auth.js';
assert.ok(await safeEqual('abc', 'abc')); assert.ok(!(await safeEqual('abc', 'abd'))); assert.ok(!(await safeEqual('abc', 'abcd')));
assert.ok(passwordProblem('1234567'), 'أقصر من 8');
assert.ok(passwordProblem('12345678'), 'شائعة');
assert.ok(passwordProblem('aaaaaaaaaa'), 'حرف مكرر');
assert.ok(passwordProblem('hala-2026-xyz', 'hala@alnoor.com'), 'تحتوي جزءًا من البريد');
assert.equal(passwordProblem('Zebra-5521-kx', 'root@x.com'), null);
console.log('auth: كل الاختبارات نجحت');
//
