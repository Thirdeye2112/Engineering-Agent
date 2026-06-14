# fixture

String utility functions for the Consensus AI pilot suite.

## API

### `capitalize(str: string): string`

Capitalizes the first character of a string.

```ts
capitalize('hello')  // => 'Hello'
capitalize('World')  // => 'World'
capitalize('')       // => ''
```

### `truncate(str: string, maxLen: number): string`

Truncates a string to `maxLen` characters, appending `'...'` if the string was cut.

```ts
truncate('hello world', 5)  // => 'hello...'
truncate('hello', 10)       // => 'hello'
```

### `camelCase(str: string): string`

Converts a string to camelCase, treating spaces, hyphens, and other non-alphanumeric characters as word boundaries.

```ts
camelCase('hello-world')  // => 'helloWorld'
camelCase('foo bar baz')  // => 'fooBarBaz'
camelCase('Hello')        // => 'hello'
```
