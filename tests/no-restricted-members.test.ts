// Tests for no-restricted-members, with full type information.
//
// The type under test is ApiClient from the fixture package `example-sdk`
// (tests/fixtures/node_modules). Other fixture packages declare lookalikes and
// a re-export. Each test case is linted as tests/fixtures/file.ts.
import { RuleTester, type InvalidTestCase, type ValidTestCase } from '@typescript-eslint/rule-tester';
import { fileURLToPath } from 'node:url';
import * as vitest from 'vitest';
import {
  noRestrictedMembers,
  type MessageIds,
  type Options,
  type RestrictedMembersEntry,
} from '../src/rules/no-restricted-members.js';

RuleTester.afterAll = vitest.afterAll;
RuleTester.describe = vitest.describe;
RuleTester.it = vitest.it;
RuleTester.itOnly = vitest.it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: fileURLToPath(new URL('./fixtures', import.meta.url)),
    },
  },
});

const CLIENT = { from: 'package', package: 'example-sdk', name: 'ApiClient' } as const;

const IMPORT = "import { ApiClient, Box } from 'example-sdk';\n";

// One entry that restricts ApiClient.logout, with any extra options.
function options(extra: Partial<RestrictedMembersEntry> = {}): Options {
  return [{ type: CLIENT, members: ['logout'], ...extra }];
}

function valid(name: string, code: string, extra?: Partial<RestrictedMembersEntry>): ValidTestCase<Options> {
  return { name, code: IMPORT + code, options: options(extra) };
}

// `reports` is how many reports to expect. Each one is on ApiClient.logout,
// unless `typeName` or `member` says otherwise.
function invalid(
  name: string,
  code: string,
  {
    reports = 1,
    typeName = 'ApiClient',
    member = 'logout',
    ...extra
  }: Partial<RestrictedMembersEntry> & {
    reports?: number;
    typeName?: string;
    member?: string;
  } = {},
): InvalidTestCase<MessageIds, Options> {
  return {
    name,
    code: IMPORT + code,
    options: options(extra),
    errors: Array.from({ length: reports }, () => ({
      messageId: 'restricted' as const,
      data: { typeName, member },
    })),
  };
}

const SUBCLASSES = `
class Sub extends ApiClient {}
class SubSub extends Sub {}
class Override extends ApiClient {
  override async logout(): Promise<void> {}
}
class BelowOverride extends Override {}
interface ClientLike extends ApiClient {}
declare const sub: Sub;
declare const subSub: SubSub;
declare const override: Override;
declare const belowOverride: BelowOverride;
declare const clientLike: ClientLike;
`;

ruleTester.run('no-restricted-members', noRestrictedMembers, {
  valid: [
    // Basics.
    { name: 'no options reports nothing', code: IMPORT + 'declare const c: ApiClient; c.logout();' },
    valid('another member of the type', 'declare const c: ApiClient; c.clear();'),
    valid('the same member on another type', 'declare const s: { logout(): void }; s.logout();'),
    valid('a plain function with the same name', 'function logout() {} logout();'),

    // Structurally identical types that are not the named type.
    valid(
      'an interface with the same shape',
      'interface Same { logout(): Promise<void>; clear(): void } declare const s: Same; s.logout();',
    ),
    valid(
      'a class with the same name and shape from another package',
      "import { ApiClient as Other } from 'other-sdk'; declare const o: Other; o.logout();",
    ),
    valid('a local class with the same name', 'class Local { logout() {} } declare const l: Local; l.logout();'),
    valid(
      'a class that implements the type, rather than extending it',
      'class Impl implements ApiClient { async logout() {} clear() {} } declare const i: Impl; i.logout();',
    ),
    valid(
      'the named type assigned to a structurally typed variable',
      'declare const c: ApiClient; const s: { logout(): Promise<void> } = c; s.logout();',
    ),

    // Subclasses.
    valid('subclasses "inherited": a subclass that overrides the member', SUBCLASSES + 'override.logout();'),
    valid('subclasses "inherited": a class below an override', SUBCLASSES + 'belowOverride.logout();'),
    valid(
      'subclasses "inherited": `this` inside the override',
      `class Own extends ApiClient {
        override async logout(): Promise<void> {}
        run() { return this.logout(); }
      }`,
    ),
    valid('subclasses "none": a subclass', SUBCLASSES + 'sub.logout();', { subclasses: 'none' }),
    valid('subclasses "none": an interface that extends it', SUBCLASSES + 'clientLike.logout();', {
      subclasses: 'none',
    }),

    // Unions.
    valid('unions "all": a union with another type', 'declare const u: ApiClient | { logout(): void }; u.logout();', {
      unions: 'all',
    }),

    // any and unknown.
    valid('anyType "ignore" (default): a value of type any', 'declare const a: any; a.logout();'),
    valid(
      'a value of type unknown',
      'declare const u: unknown;\n// @ts-expect-error -- members of unknown cannot be read.\nu.logout();',
    ),
    valid(
      'anyType "ignore": a type the checker cannot resolve',
      "// @ts-expect-error -- the package does not exist.\nimport type { Missing } from 'missing-package';\ndeclare const m: Missing; m.logout();",
    ),
    valid('a type parameter with no constraint', 'function f<T>(t: T & { logout(): void }) { t.logout(); }'),

    // Keys and syntax that are not a use of the member.
    valid('a computed key of type string', 'declare const c: ApiClient; declare const k: string; c[k as "clear"];'),
    valid('the `in` operator', "declare const c: ApiClient; 'logout' in c;"),
    valid('an indexed access type', "type F = ApiClient['logout'];"),
    valid('a `typeof` type query', 'declare const c: ApiClient; let f: typeof c.logout;'),
    valid('an object literal with the same key', 'declare const logout: () => void; const o = { logout }; o.logout();'),
    valid('destructuring another member', 'declare const c: ApiClient; const { clear } = c;'),
    valid('a rest element in destructuring', 'declare const c: ApiClient; const { clear, ...rest } = c;'),
  ],
  invalid: [
    // Access forms.
    invalid('a call', 'declare const c: ApiClient; c.logout();'),
    invalid('reading the member without calling it', 'declare const c: ApiClient; const f = c.logout; f();'),
    invalid('bind', 'declare const c: ApiClient; c.logout.bind(c);'),
    invalid('optional chaining', 'declare const c: ApiClient | undefined; c?.logout();'),
    invalid('an optional call', 'declare const c: ApiClient; c.logout?.();'),
    invalid('bracket access with a string literal', "declare const c: ApiClient; c['logout']();"),
    invalid('bracket access with a template literal', 'declare const c: ApiClient; c[`logout`]();'),
    invalid('bracket access with a const', "declare const c: ApiClient; const k = 'logout'; c[k]();"),
    invalid(
      'bracket access with a union of literal keys',
      "declare const c: ApiClient; declare const k: 'logout' | 'clear'; c[k];",
    ),
    invalid('an expression that has the type', 'declare function get(): ApiClient; get().logout();'),
    invalid('a parenthesized object', 'declare const c: ApiClient; (c).logout();'),

    // Destructuring.
    invalid('a variable declaration', 'declare const c: ApiClient; const { logout } = c;'),
    invalid('a renamed binding', 'declare const c: ApiClient; const { logout: s } = c;'),
    invalid('a string literal key', "declare const c: ApiClient; const { 'logout': s } = c;"),
    invalid('a computed key', "declare const c: ApiClient; const { ['logout']: s } = c;"),
    invalid('a default value', 'declare const c: ApiClient; const { logout = async () => {} } = c;'),
    invalid('a function parameter', 'export function f({ logout }: ApiClient) { return logout; }'),
    invalid('an assignment', 'declare const c: ApiClient; let logout: ApiClient["logout"]; ({ logout } = c);'),
    invalid('a nested pattern', 'declare const c: ApiClient; const { inner: { logout } } = { inner: c };'),
    invalid('a for-of loop', 'declare const cs: ApiClient[]; for (const { logout } of cs) { logout(); }'),

    // Subclasses.
    invalid('subclasses "inherited" (default): a subclass', SUBCLASSES + 'sub.logout();'),
    invalid('subclasses "inherited": two levels down', SUBCLASSES + 'subSub.logout();'),
    invalid('subclasses "inherited": an interface that extends it', SUBCLASSES + 'clientLike.logout();'),
    invalid(
      'subclasses "inherited": `this` in a subclass',
      'class Sub extends ApiClient { run() { return this.logout(); } }',
    ),
    invalid(
      'subclasses "inherited": `super` inside an override',
      'class Own extends ApiClient { override async logout() { await super.logout(); } }',
    ),
    invalid('subclasses "all": a subclass that overrides the member', SUBCLASSES + 'override.logout();', {
      subclasses: 'all',
    }),
    invalid('subclasses "all": a class below an override', SUBCLASSES + 'belowOverride.logout();', {
      subclasses: 'all',
    }),
    invalid('subclasses "none": the named type itself', 'declare const c: ApiClient; c.logout();', {
      subclasses: 'none',
    }),
    {
      name: 'a subclass of a generic instance',
      code: IMPORT + 'class StringBox extends Box<string> {} declare const b: StringBox; b.logout();',
      options: [{ type: { ...CLIENT, name: 'Box' }, members: ['logout'] }],
      errors: [{ messageId: 'restricted', data: { typeName: 'Box', member: 'logout' } }],
    },
    {
      name: 'a generic instance of the named type',
      code: IMPORT + 'declare const b: Box<number>; b.logout();',
      options: [{ type: { ...CLIENT, name: 'Box' }, members: ['logout'] }],
      errors: [{ messageId: 'restricted', data: { typeName: 'Box', member: 'logout' } }],
    },

    // Unions.
    invalid(
      'unions "any" (default): a union with another type',
      'declare const u: ApiClient | { logout(): void }; u.logout();',
    ),
    invalid(
      'unions "all": a union of the type and a subclass',
      'class Sub extends ApiClient {} declare const u: ApiClient | Sub; u.logout();',
      { unions: 'all' },
    ),
    invalid(
      'unions "all": null and undefined do not count',
      'declare const u: ApiClient | null | undefined; u?.logout();',
      { unions: 'all' },
    ),

    // Intersections.
    invalid('an intersection', 'declare const i: ApiClient & { extra: 1 }; i.logout();'),
    invalid(
      'an intersection whose other part also declares the member',
      'declare const i: ApiClient & { logout(): Promise<void> }; i.logout();',
    ),

    // Type parameters.
    invalid('a type parameter constrained to the type', 'function f<T extends ApiClient>(t: T) { return t.logout(); }'),
    invalid(
      'a constrained type parameter in a union',
      'function f<T extends ApiClient>(t: T | undefined) { return t?.logout(); }',
    ),

    // Aliases and re-exports.
    invalid('a type alias', 'type Alias = ApiClient; declare const c: Alias; c.logout();'),
    invalid(
      'an import renamed locally',
      "import { ApiClient as C } from 'example-sdk'; declare const c: C; c.logout();",
    ),
    invalid(
      "a re-export from another package, under the type's own name",
      "import { ApiClient as R } from 'sdk-reexport'; declare const c: R; c.logout();",
    ),
    invalid(
      'a re-export from another package, under another name',
      "import { RenamedClient } from 'sdk-reexport'; declare const c: RenamedClient; c.logout();",
    ),
    invalid(
      'an alias of an intersection',
      'type Extended = ApiClient & { extra: 1 }; declare const c: Extended; c.logout();',
    ),

    // any.
    invalid('anyType "report": a value of type any', 'declare const a: any; a.logout();', {
      anyType: 'report',
      typeName: 'any',
    }),

    invalid(
      'anyType "report": a type the checker cannot resolve',
      "// @ts-expect-error -- the package does not exist.\nimport type { Missing } from 'missing-package';\ndeclare const m: Missing; m.logout();",
      { anyType: 'report', typeName: 'any' },
    ),

    // Static members. The specifier also matches `typeof ApiClient`.
    invalid('a static member', 'ApiClient.create();', { members: ['create'], member: 'create' }),

    // Options.
    {
      name: 'message',
      code: IMPORT + 'declare const c: ApiClient; c.logout();',
      options: options({ message: 'Use logout(client) instead.' }),
      errors: [
        {
          messageId: 'restrictedWithMessage',
          data: { typeName: 'ApiClient', member: 'logout', message: 'Use logout(client) instead.' },
        },
      ],
    },
    {
      name: 'a list of types in one entry',
      code:
        IMPORT +
        "import { ApiClient as Other } from 'other-sdk';\n" +
        'declare const c: ApiClient; declare const o: Other; c.logout(); o.logout();',
      options: [{ type: [CLIENT, { from: 'package', package: 'other-sdk', name: 'ApiClient' }], members: ['logout'] }],
      errors: [
        { messageId: 'restricted', line: 3 },
        { messageId: 'restricted', line: 3 },
      ],
    },
    {
      name: 'several members in one entry',
      code: IMPORT + 'declare const c: ApiClient; c.logout(); c.clear();',
      options: [{ type: CLIENT, members: ['logout', 'clear'] }],
      errors: [
        { messageId: 'restricted', data: { typeName: 'ApiClient', member: 'logout' } },
        { messageId: 'restricted', data: { typeName: 'ApiClient', member: 'clear' } },
      ],
    },
    {
      name: 'the first matching entry gives the message, and the use is reported once',
      code: IMPORT + 'declare const c: ApiClient; c.logout();',
      options: [
        { type: CLIENT, members: ['logout'], message: 'first' },
        { type: CLIENT, members: ['logout'], message: 'second' },
      ],
      errors: [
        { messageId: 'restrictedWithMessage', data: { typeName: 'ApiClient', member: 'logout', message: 'first' } },
      ],
    },
    {
      name: 'a later entry matches when an earlier one does not',
      code: IMPORT + 'class Sub extends ApiClient {} declare const s: Sub; s.logout();',
      options: [
        { type: CLIENT, members: ['logout'], subclasses: 'none', message: 'first' },
        { type: CLIENT, members: ['logout'], message: 'second' },
      ],
      errors: [
        { messageId: 'restrictedWithMessage', data: { typeName: 'ApiClient', member: 'logout', message: 'second' } },
      ],
    },
    {
      name: 'a "lib" specifier',
      code: 'declare const a: number[]; a.forEach(() => {}); declare const o: { forEach(): void }; o.forEach();',
      options: [{ type: { from: 'lib', name: 'Array' }, members: ['forEach'] }],
      errors: [{ messageId: 'restricted', data: { typeName: 'Array', member: 'forEach' }, column: 30 }],
    },
    {
      name: 'a "file" specifier',
      code: 'class Local { logout() {} } declare const l: Local; l.logout();',
      options: [{ type: { from: 'file', name: 'Local', path: 'file.ts' }, members: ['logout'] }],
      errors: [{ messageId: 'restricted', data: { typeName: 'Local', member: 'logout' } }],
    },
    {
      name: 'a plain string specifier matches the name from anywhere',
      code:
        "import { ApiClient as Other } from 'other-sdk';\n" +
        'class ApiClient { logout() {} } declare const c: ApiClient; declare const o: Other; c.logout(); o.logout();',
      options: [{ type: 'ApiClient', members: ['logout'] }],
      errors: [{ messageId: 'restricted' }, { messageId: 'restricted' }],
    },
  ],
});

// This rule inherits two behaviors of typescript-eslint's package check. These
// tests record them, so that a change in typescript-eslint shows up here.
// - It uses the package name as a regular expression, with no anchors.
//   `example-sdk` also matches `example-sdk-extra`.
// - It looks at the package that declares the type. A package that only
//   re-exports the type matches nothing (typescript-eslint#10053, #11817).
ruleTester.run('no-restricted-members: inherited package matching', noRestrictedMembers, {
  valid: [
    {
      name: 'a specifier that names the re-exporting package',
      code: "import { ApiClient, RenamedClient } from 'sdk-reexport'; declare const c: ApiClient; declare const r: RenamedClient; c.logout(); r.logout();",
      options: [
        {
          type: [
            { from: 'package', package: 'sdk-reexport', name: 'ApiClient' },
            { from: 'package', package: 'sdk-reexport', name: 'RenamedClient' },
          ],
          members: ['logout'],
        },
      ],
    },
  ],
  invalid: [
    invalid(
      'a package whose name starts with the named package',
      "import { ApiClient as Extra } from 'example-sdk-extra'; declare const e: Extra; e.logout();",
    ),
  ],
});
