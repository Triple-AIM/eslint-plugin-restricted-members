// The plugin object for an ESLint flat config.
import type { TSESLint } from '@typescript-eslint/utils';
import packageJson from '../package.json' with { type: 'json' };
import { noRestrictedMembers } from './rules/no-restricted-members.js';

export type {
  AnyMode,
  Options,
  RestrictedMembersEntry,
  SubclassMode,
  UnionMode,
} from './rules/no-restricted-members.js';

const plugin = {
  meta: {
    name: packageJson.name,
    version: packageJson.version,
  },
  rules: {
    'no-restricted-members': noRestrictedMembers,
  },
} satisfies TSESLint.FlatConfig.Plugin;

export default plugin;
