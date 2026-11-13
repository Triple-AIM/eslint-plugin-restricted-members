// Reports uses of chosen members on values of chosen TypeScript types.
//
// Each option entry names one or more types and a list of member names. A use
// is reported when both match: the member name, and the type of the object the
// member is read from. Types are named in typescript-eslint's
// TypeOrValueSpecifier format. They are matched with its typeMatchesSpecifier().
import {
  getConstrainedTypeAtLocation,
  isTypeAnyType,
  typeMatchesSpecifier,
  typeOrValueSpecifiersSchema,
  type TypeOrValueSpecifier,
} from '@typescript-eslint/type-utils';
import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';
import * as tsutils from 'ts-api-utils';
import ts from 'typescript';

/** How an entry treats a type that extends the named type. */
export type SubclassMode = 'inherited' | 'all' | 'none';

/** How an entry treats a union type. */
export type UnionMode = 'any' | 'all';

/** How an entry treats a value whose type is `any`. */
export type AnyMode = 'ignore' | 'report';

export interface RestrictedMembersEntry {
  /** The type or types whose members are restricted. */
  type: TypeOrValueSpecifier | TypeOrValueSpecifier[];
  /** The member names to report. */
  members: string[];
  /** Extra text added to the report, such as what to use instead. */
  message?: string;
  /** Default `'inherited'`. */
  subclasses?: SubclassMode;
  /** Default `'any'`. */
  unions?: UnionMode;
  /** Default `'ignore'`. */
  anyType?: AnyMode;
}

export type Options = RestrictedMembersEntry[];
export type MessageIds = 'restricted' | 'restrictedWithMessage';

interface ResolvedEntry {
  specifiers: TypeOrValueSpecifier[];
  members: ReadonlySet<string>;
  message: string | undefined;
  subclasses: SubclassMode;
  unions: UnionMode;
  anyType: AnyMode;
}

interface Match {
  entry: ResolvedEntry;
  typeName: string;
}

const specifierSchema = typeOrValueSpecifiersSchema.items as JSONSchema4;

const EMPTY_FLAGS = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;

const entrySchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'members'],
  properties: {
    type: {
      description: 'The type or types whose members are restricted, in TypeOrValueSpecifier format.',
      oneOf: [specifierSchema, { type: 'array', items: specifierSchema, minItems: 1 }],
    },
    members: {
      description: 'The member names to report.',
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      uniqueItems: true,
    },
    message: {
      description: 'Extra text added to the report.',
      type: 'string',
    },
    subclasses: {
      description: 'How to treat types that extend a named type.',
      type: 'string',
      enum: ['inherited', 'all', 'none'],
    },
    unions: {
      description: 'Report a union when any of its members matches, or only when all of them do.',
      type: 'string',
      enum: ['any', 'all'],
    },
    anyType: {
      description: 'Whether to report the member on a value of type any.',
      type: 'string',
      enum: ['ignore', 'report'],
    },
  },
};

export const noRestrictedMembers = ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow chosen members on chosen TypeScript types.',
    },
    messages: {
      restricted: "'{{typeName}}.{{member}}' is restricted from being used.",
      restrictedWithMessage: "'{{typeName}}.{{member}}' is restricted from being used. {{message}}",
    },
    schema: { type: 'array', items: entrySchema },
  },
  defaultOptions: [],
  create(context) {
    const entries = context.options.map(resolveEntry);
    if (entries.length === 0) {
      return {};
    }
    // All restricted names. Most nodes are skipped by name, before any type lookup.
    const allMembers = new Set(entries.flatMap((entry) => [...entry.members]));

    const services = ESLintUtils.getParserServices(context);
    const program = services.program;
    const checker = program.getTypeChecker();

    // The member names a key can have. A plain identifier or a string literal
    // has one name. Any other computed key is resolved through its type. A
    // `const` that holds a name gives that name. A union of literal types gives
    // each of them.
    function keyNames(key: TSESTree.Node, computed: boolean): string[] {
      if (!computed) {
        if (key.type === AST_NODE_TYPES.Identifier) {
          return [key.name];
        }
        if (key.type === AST_NODE_TYPES.Literal) {
          return [String(key.value)];
        }
        return [];
      }
      if (key.type === AST_NODE_TYPES.Literal) {
        return [String(key.value)];
      }
      const keyType = services.getTypeAtLocation(key);
      return tsutils.unionConstituents(keyType).flatMap((part) => {
        if (part.isStringLiteral() || part.isNumberLiteral()) {
          return [String(part.value)];
        }
        return [];
      });
    }

    function report(node: TSESTree.Node, objectType: ts.Type, names: string[]): void {
      for (const member of names) {
        if (!allMembers.has(member)) {
          continue;
        }
        const match = findMatch(objectType, member);
        if (match) {
          context.report({
            node,
            messageId: match.entry.message === undefined ? 'restricted' : 'restrictedWithMessage',
            data: { typeName: match.typeName, member, message: match.entry.message },
          });
          return;
        }
      }
    }

    function findMatch(objectType: ts.Type, member: string): Match | undefined {
      for (const entry of entries) {
        if (!entry.members.has(member)) {
          continue;
        }
        const typeName = matchType(objectType, entry, member);
        if (typeName !== undefined) {
          return { entry, typeName };
        }
      }
      return undefined;
    }

    // Returns the name of the matched type, or undefined if nothing matches.
    function matchType(type: ts.Type, entry: ResolvedEntry, member: string): string | undefined {
      if (isTypeAnyType(type)) {
        return entry.anyType === 'report' ? 'any' : undefined;
      }
      if (type.isUnion()) {
        // null, undefined and void have no members. They never decide a union.
        const parts = type.types.filter((part) => !(part.flags & EMPTY_FLAGS));
        const names = parts.map((part) => matchType(part, entry, member));
        if (entry.unions === 'all') {
          return names.length > 0 && names.every((name) => name !== undefined) ? names[0] : undefined;
        }
        return names.find((name) => name !== undefined);
      }
      if (type.isIntersection()) {
        for (const part of type.types) {
          const name = matchType(part, entry, member);
          if (name !== undefined) {
            return name;
          }
        }
        return undefined;
      }
      if (type.flags & ts.TypeFlags.TypeParameter) {
        // getConstrainedTypeAtLocation has already replaced a constrained type
        // parameter with its constraint. One that is left has no constraint.
        return undefined;
      }
      return matchNamedOrBase(type, entry, member, new Set());
    }

    function matchNamedOrBase(
      type: ts.Type,
      entry: ResolvedEntry,
      member: string,
      seen: Set<ts.Type>,
    ): string | undefined {
      if (seen.has(type)) {
        return undefined;
      }
      seen.add(type);
      if (entry.specifiers.some((specifier) => typeMatchesSpecifier(type, specifier, program))) {
        return typeName(type);
      }
      if (entry.subclasses === 'none') {
        return undefined;
      }
      const declared = declaredType(type);
      if (!declared) {
        return undefined;
      }
      if (entry.subclasses === 'inherited' && declaresMember(declared, member)) {
        // The type declares its own version of the member. A use reaches that
        // version, not the restricted one.
        return undefined;
      }
      for (const base of checker.getBaseTypes(declared)) {
        for (const part of base.isIntersection() ? base.types : [base]) {
          const name = matchNamedOrBase(part, entry, member, seen);
          if (name !== undefined) {
            return name;
          }
        }
      }
      return undefined;
    }

    function check(objectNode: TSESTree.Node, reportNode: TSESTree.Node, names: string[]): void {
      if (!names.some((name) => allMembers.has(name))) {
        return;
      }
      report(reportNode, getConstrainedTypeAtLocation(services, objectNode), names);
    }

    function checkPattern(pattern: TSESTree.ObjectPattern, objectNode: TSESTree.Node): void {
      for (const property of pattern.properties) {
        if (property.type === AST_NODE_TYPES.Property) {
          check(objectNode, property.key, keyNames(property.key, property.computed));
        }
      }
    }

    return {
      MemberExpression(node) {
        if (node.property.type === AST_NODE_TYPES.PrivateIdentifier) {
          return;
        }
        // A plain identifier is the common case. Check its name before any type
        // lookup.
        if (!node.computed && !allMembers.has(node.property.name)) {
          return;
        }
        check(node.object, node.property, keyNames(node.property, node.computed));
      },
      ObjectPattern(node) {
        // In `({ a } = value)`, the pattern is the left side of an assignment.
        // TypeScript gives that side the type of its own shape. Use the value's
        // type instead.
        const parent = node.parent;
        if (parent.type === AST_NODE_TYPES.AssignmentExpression && parent.left === node) {
          checkPattern(node, parent.right);
          return;
        }
        checkPattern(node, node);
      },
    };
  },
});

function resolveEntry(entry: RestrictedMembersEntry): ResolvedEntry {
  return {
    specifiers: Array.isArray(entry.type) ? entry.type : [entry.type],
    members: new Set(entry.members),
    message: entry.message,
    subclasses: entry.subclasses ?? 'inherited',
    unions: entry.unions ?? 'any',
    anyType: entry.anyType ?? 'ignore',
  };
}

// The class or interface that declares a type. For a generic instance such as
// `Box<string>`, that is `Box<T>`.
function declaredType(type: ts.Type): ts.InterfaceType | undefined {
  const target = tsutils.isTypeReference(type) ? type.target : type;
  return target.isClassOrInterface() ? target : undefined;
}

// Whether the class or interface declares the member itself, rather than
// inheriting it.
function declaresMember(type: ts.InterfaceType, member: string): boolean {
  return type.getSymbol()?.members?.has(ts.escapeLeadingUnderscores(member)) ?? false;
}

function typeName(type: ts.Type): string {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  return symbol?.getName() ?? 'unknown';
}
