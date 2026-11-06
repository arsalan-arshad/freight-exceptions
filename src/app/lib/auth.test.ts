import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized, passwordFromBasic, safeEqual } from './auth';

const basic = (u: string, p: string) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('', 'abc'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

test('passwordFromBasic parses, ignores username, keeps colons in password', () => {
  assert.equal(passwordFromBasic(basic('anyone', 'pw')), 'pw');
  assert.equal(passwordFromBasic(basic('', 'a:b:c')), 'a:b:c');
  assert.equal(passwordFromBasic(null), null);
  assert.equal(passwordFromBasic('Bearer abc'), null);
  assert.equal(passwordFromBasic('Basic !!!'), null);
  assert.equal(passwordFromBasic('Basic ' + Buffer.from('nocolon').toString('base64')), null);
});

test('isAuthorized', () => {
  assert.equal(isAuthorized(null, null), true);
  assert.equal(isAuthorized(null, 'secret'), false);
  assert.equal(isAuthorized(basic('u', 'wrong'), 'secret'), false);
  assert.equal(isAuthorized(basic('u', 'secret'), 'secret'), true);
  assert.equal(isAuthorized(basic('u', ''), 'secret'), false);
  assert.equal(isAuthorized('Basic', 'secret'), false);
});
