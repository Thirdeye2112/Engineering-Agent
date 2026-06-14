import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capitalize, truncate, camelCase, isNonEmptyString } from './utils.js';

describe('capitalize', () => {
  it('capitalizes first letter', () => {
    assert.equal(capitalize('hello'), 'Hello');
  });
  it('leaves already-capitalized strings unchanged', () => {
    assert.equal(capitalize('World'), 'World');
  });
  it('handles empty string', () => {
    assert.equal(capitalize(''), '');
  });
});

describe('truncate', () => {
  it('returns string unchanged if within limit', () => {
    assert.equal(truncate('hello', 10), 'hello');
  });
  it('truncates and appends ellipsis', () => {
    assert.equal(truncate('hello world', 5), 'hello...');
  });
  it('truncates at exact limit boundary', () => {
    assert.equal(truncate('hello', 5), 'hello');
  });
});

describe('camelCase', () => {
  it('converts hyphenated string', () => {
    assert.equal(camelCase('hello-world'), 'helloWorld');
  });
  it('converts space-separated string', () => {
    assert.equal(camelCase('foo bar baz'), 'fooBarBaz');
  });
  it('handles single word', () => {
    assert.equal(camelCase('Hello'), 'hello');
  });
});

describe('isNonEmptyString', () => {
  it('returns true for a non-empty string', () => {
    assert.equal(isNonEmptyString('hello'), true);
  });
  it('returns false for an empty string', () => {
    assert.equal(isNonEmptyString(''), false);
  });
  it('returns false for a whitespace-only string', () => {
    assert.equal(isNonEmptyString('   '), false);
  });
  it('returns false for a non-string value', () => {
    assert.equal(isNonEmptyString(42), false);
  });
});
