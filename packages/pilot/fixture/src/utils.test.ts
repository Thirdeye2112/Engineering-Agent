import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capitalize, truncate, camelCase, slugify } from './utils.js';

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

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    assert.equal(slugify('Hello World'), 'hello-world');
  });
  it('removes special characters', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world');
  });
  it('collapses consecutive hyphens', () => {
    assert.equal(slugify('foo--bar'), 'foo-bar');
  });
  it('trims leading and trailing hyphens', () => {
    assert.equal(slugify('  -hello-  '), 'hello');
  });
  it('replaces underscores with hyphens', () => {
    assert.equal(slugify('foo_bar'), 'foo-bar');
  });
});
