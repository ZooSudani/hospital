import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../lib/auth.js';

const h = await hashPassword('كلمة-سر-123');
assert.ok(await verifyPassword('كلمة-سر-123', h));
assert.ok(!(await verifyPassword('خطأ', h)));

const t = await signToken({ sub: 'u1', tid: 't1', role: 'admin' }, 'secret-a');
assert.equal((await verifyToken(t, 'secret-a')).tid, 't1');
assert.equal(await verifyToken(t, 'secret-b'), null, 'سر مختلف يجب أن يُرفض');

const [a, b, c] = t.split('.');
const forged = Buffer.from(JSON.stringify({ sub: 'u1', tid: 'OTHER', role: 'admin', exp: 9999999999 })).toString('base64url');
assert.equal(await verifyToken(`${a}.${forged}.${c}`, 'secret-a'), null, 'تعديل tid يجب أن يُرفض');

const expired = await signToken({ sub: 'u1' }, 'secret-a', -10);
assert.equal(await verifyToken(expired, 'secret-a'), null, 'توكن منتهٍ يجب أن يُرفض');
console.log('auth: كل الاختبارات نجحت');
