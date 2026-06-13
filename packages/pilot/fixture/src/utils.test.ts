import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capitalize, truncate, camelCase } from './utils.js';

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
  it('returns unchanged when maxLen equals string length', () => {
    assert.equal(truncate('abcde', 5), 'abcde');
  });
  it('returns only ellipsis when maxLen is 0', () => {
    assert.equal(truncate('hello', 0), '...');
  });
  it('truncates string containing only spaces', () => {
    assert.equal(truncate('   ', 1), ' ...');
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
