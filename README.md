# eslint-plugin-restricted-members

An ESLint plugin with one rule, `no-restricted-members`. The rule bans chosen
members (methods or properties) on chosen TypeScript types.

The rule uses the TypeScript type checker. A ban on `logout` for one type does
not report `logout` on other types.

## Why

ESLint's `no-restricted-properties` and `no-restricted-syntax` match by name
only. A ban on `logout` for one class reports `logout` on every object.

Sometimes one type's member is unsafe, but the same name is fine elsewhere. For
example, a library's client may have a `logout()` method that skips cleanup
your app needs. You want every logout to go through your own wrapper instead.

A type-aware version of `no-restricted-syntax` was requested in
[typescript-eslint#8650](https://github.com/typescript-eslint/typescript-eslint/issues/8650).
It was closed as not planned. The maintainers gave three reasons:

- A type restriction can't be written as a simple query. Subclasses,
  intersections, unions and structural typing make the meaning unclear.
- Projects should write their own rules, with tests.
- They would look again if there were a standard way to name types.

This rule takes those points into account:

- It names types in typescript-eslint's `TypeOrValueSpecifier` format.
- It matches types with typescript-eslint's `typeMatchesSpecifier` function.
- Each unclear case is an option or a documented default. See
  [Edge cases](#edge-cases).

## Installation

The package is not published to npm yet. Once it is:

```bash
npm install --save-dev eslint-plugin-restricted-members
```

Peer dependencies:

| Package             | Version          |
| ------------------- | ---------------- |
| `eslint`            | `^10.0.0`        |
| `typescript`        | `>=4.8.4 <6.1.0` |
| `typescript-eslint` | `^8.66.0`        |

It needs Node 24 or later.

## Setup

The rule needs typed linting. Use typescript-eslint's parser, with
`projectService` or `project` set.

```js
// eslint.config.mjs
import restrictedMembers from 'eslint-plugin-restricted-members';
import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  plugins: { 'restricted-members': restrictedMembers },
  rules: {
    'restricted-members/no-restricted-members': [
      'error',
      {
        type: { from: 'package', package: 'example-sdk', name: 'ApiClient' },
        members: ['logout'],
        message: 'Use logout(client) from src/auth instead.',
      },
    ],
  },
});
```

The plugin has no preset config. Every ban has to name a type.

## What it reports

The rule reports a restricted member when the object's type matches an entry.
It reports these forms:

| Form                           | Example                                  |
| ------------------------------ | ---------------------------------------- |
| Dot access                     | `client.logout()`, `client.logout`       |
| Optional chaining              | `client?.logout()`, `client.logout?.()`  |
| Bracket access with a literal  | `client['logout']`, ``client[`logout`]`` |
| Bracket access with a constant | `const key = 'logout'; client[key]`      |
| Destructuring                  | `const { logout } = client`              |
| Destructuring a parameter      | `function f({ logout }: ApiClient) {}`   |
| Destructuring in an assignment | `({ logout } = client)`                  |
| Nested destructuring           | `const { inner: { logout } } = holder`   |
| `this` and `super`             | `this.logout()`, `super.logout()`        |

A bracket key counts when its type is a string literal type, or a union of
them. For example, `client[key]` is reported when `key` has the type
`'logout' | 'clear'`.

`const fn = client.logout; fn();` is reported once, at `client.logout`. The rule
does not follow the value into `fn`.

The rule does not report:

- type-only references, such as `ApiClient['logout']` or `typeof client.logout`;
- `'logout' in client`, which does not read the member;
- a bracket key of type `string`, which could name any member;
- reads without member syntax, such as `Reflect.get(client, 'logout')`.

## Options

The rule takes a list of entries. Each entry has these fields:

| Field        | Type                                             | Default       |
| ------------ | ------------------------------------------------ | ------------- |
| `type`       | `TypeOrValueSpecifier \| TypeOrValueSpecifier[]` | required      |
| `members`    | `string[]`                                       | required      |
| `message`    | `string`                                         | none          |
| `subclasses` | `'inherited' \| 'all' \| 'none'`                 | `'inherited'` |
| `unions`     | `'any' \| 'all'`                                 | `'any'`       |
| `anyType`    | `'ignore' \| 'report'`                           | `'ignore'`    |

If more than one entry matches, the rule uses the first one. It reports each use
once.

### `type`

The type or types to restrict, in typescript-eslint's `TypeOrValueSpecifier`
format. Other typescript-eslint options use the same format. Examples are
`allow` in `prefer-readonly-parameter-types` and `allowForKnownSafePromises` in
`no-floating-promises`. See the
[TypeOrValueSpecifier docs](https://typescript-eslint.io/packages/type-utils/type-or-value-specifier)
for details.

A type from an npm package:

```js
{ type: { from: 'package', package: 'example-sdk', name: 'ApiClient' }, members: ['logout'] }
```

A type from TypeScript's built-in library:

```js
{ type: { from: 'lib', name: 'Array' }, members: ['forEach'] }
```

A type from a file in your project. The path is relative to the TypeScript
project's folder.

```js
{ type: { from: 'file', name: 'LegacyStore', path: 'src/store.ts' }, members: ['reset'] }
```

Several types that share the same members and message:

```js
{
  type: [
    { from: 'package', package: 'example-sdk', name: 'ApiClient' },
    { from: 'package', package: 'example-sdk-mock', name: 'MockClient' },
  ],
  members: ['logout'],
}
```

A plain string, such as `'ApiClient'`, matches any type with that name. That is
close to a name-only ban. Use an object specifier instead.

### `members`

The member names to report.

An entry also matches the class itself (`typeof ApiClient`). So you can list
static members too:

```js
{ type: { from: 'package', package: 'example-sdk', name: 'ApiClient' }, members: ['create'] }
// Reports ApiClient.create().
```

### `message`

Text added after the standard report. Use it to say what to do instead.

```js
{ type: ..., members: ['logout'], message: 'Use logout(client) from src/auth instead.' }
// 'ApiClient.logout' is restricted from being used. Use logout(client) from src/auth instead.
```

### `subclasses`

How to treat a class or interface that extends a named type.

- `'inherited'` (default): report the member when the subclass inherits it. Skip
  it when the subclass, or a class in between, declares its own version.
- `'all'`: report the member on every subclass.
- `'none'`: report the member only on the named type.

```ts
class Sub extends ApiClient {}
class Safe extends ApiClient {
  override async logout() {
    cleanUp();
    await super.logout(); // Reported, because super is an ApiClient.
  }
}
declare const sub: Sub;
declare const safe: Safe;

sub.logout(); // Reported with 'inherited' and 'all'.
safe.logout(); // Reported with 'all' only.
```

### `unions`

How to treat a union type.

- `'any'` (default): report the member when any part of the union matches.
- `'all'`: report the member only when every part matches.

`null` and `undefined` are ignored in both modes. `ApiClient | undefined` counts
as `ApiClient`.

```ts
interface Session {
  logout(): void;
}
declare const value: ApiClient | Session;

value.logout(); // Reported with 'any' only.
```

### `anyType`

Whether to report the member on a value of type `any`.

- `'ignore'` (default): don't report it.
- `'report'`: report it. For `any` values, this works like a name-only ban.

```ts
declare const value: any;

value.logout(); // Reported with 'report' only.
```

## Edge cases

Each case below states the behavior and the reason. The tests in
`tests/no-restricted-members.test.ts` cover each case.

### Subclasses

**Default: reported, unless the subclass overrides the member.**

A subclass that inherits the member runs the same code. Without this, a ban
would be easy to get around.

An override is different code, so it is not reported by default. A
`super.logout()` call inside the override is still reported. Set
`subclasses: 'all'` to report overrides too.

Interfaces that extend a named type work the same way. So do generic
subclasses, such as `class StringBox extends Box<string>`.

A class that `implements` a named type is not a subclass. It is not reported.

### Unions

**Default: reported when any part matches.**

A value of type `ApiClient | Session` may be an `ApiClient` at run time. A wider
type should not be a way around the ban. Set `unions: 'all'` to report only
when every part matches.

`typeMatchesSpecifier` on its own needs every part of a union to match. The rule
splits unions itself, so the `unions` option decides.

### Intersections

**Always reported when any part matches.**

A value of type `ApiClient & { extra: 1 }` is an `ApiClient`. Its `logout` is
the restricted one, even if another part also declares `logout`.
`typeMatchesSpecifier` treats intersections the same way.

### `any`

**Default: not reported.**

The rule can't know what an `any` value holds. Reporting it would turn the rule
into a name-only ban. typescript-eslint's `no-unsafe-member-access` and
`no-unsafe-call` already report member access on `any`.

Set `anyType: 'report'` to report it anyway.

A type the checker can't resolve, such as a missing import, counts as `any`.

### `unknown`

**Never reported.**

TypeScript does not allow reading a member of an `unknown` value. Code has to
narrow it first. The rule then checks the narrowed type.

### Type parameters

**Checked through their constraint.**

In `function f<T extends ApiClient>(client: T)`, `client.logout()` is reported.
A type parameter with no constraint matches nothing.

Inside a class, `this` is a type parameter too. So `this.logout()` in a subclass
is reported.

### Structurally identical types

**Never reported.**

The rule matches a type by where it is declared, not by its shape. A lookalike
interface is not reported. Neither is a class with the same name from another
package. Matching by shape would report too much, like a name-only ban.

This leaves a gap. Code can assign the value to a lookalike type and call the
member there:

```ts
declare const client: ApiClient;
const session: { logout(): Promise<void> } = client;

session.logout(); // Not reported.
```

A lint rule can't close this gap without reporting every lookalike type.

### Aliases and re-exports

**Reported.**

These all refer to the same type, so they are all reported:

- a type alias, such as `type Client = ApiClient`;
- a renamed import, such as `import { ApiClient as Client }`;
- a re-export from another package, under any name.

`typeMatchesSpecifier` checks the type's original name and declaration file.
Aliases and re-exports don't change either one.

Name the type's own package in the specifier. A specifier that names a package
that only re-exports the type matches nothing. typescript-eslint tracks this in
[#10053](https://github.com/typescript-eslint/typescript-eslint/issues/10053)
and [#11817](https://github.com/typescript-eslint/typescript-eslint/issues/11817).

### Package name matching

For a `from: 'package'` specifier, `typeMatchesSpecifier` uses the package name
as a regular expression, with no anchors. So `package: 'example-sdk'` also
matches a type with the same name from `example-sdk-extra`. A `.` in a package
name matches any character.

This behavior comes from typescript-eslint. It affects every rule that uses the
specifier format. A maintainer said in
[#11817](https://github.com/typescript-eslint/typescript-eslint/issues/11817)
that it is not intended.

Tests record this behavior and the re-export behavior. If typescript-eslint
changes either one, those tests will fail.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

The tests use `@typescript-eslint/rule-tester` with full type information. Each
test case is linted as `tests/fixtures/file.ts`.

The type under test is `ApiClient`, from a fixture package in
`tests/fixtures/node_modules/example-sdk`. The other fixture packages there hold
lookalike types and a re-export.

## License

Not licensed yet (`UNLICENSED`).
