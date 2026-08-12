import { Scalar, CustomScalar } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';
import { ValueNode } from 'graphql';

/**
 * Generic JSON scalar — represents an arbitrary JSON-serializable value
 * (object, array, string, number, boolean, or null) with no fixed shape.
 * Introduced (2026-08-09) for the consumer-facing `platformConfig` query
 * (see `platform-admin/platform-settings/public/platform-config.resolver.ts`)
 * — originally as `PlatformConfigGroup.fields`, a flat `{ fieldName: value
 * }` map per feature group; reshaped the SAME day to `platformConfig`'s own
 * bare return type, a single deeply-nested tree built from every
 * non-encrypted setting's dot-namespaced key. Either way, a fixed
 * `@ObjectType()` shape can't express it — the point of this scalar.
 *
 * Delegates ALL actual serialize/parse behavior to `graphql-type-json`
 * (`GraphQLJSON`) rather than reimplementing scalar coercion — that
 * package is the common, well-established `JSON` scalar for `graphql.js`
 * (used directly in NestJS's own GraphQL docs' custom-scalar examples),
 * and its only peer dependency is `graphql >= 0.8.0`, comfortably
 * satisfied by this codebase's `graphql ^16.14.2`. This wrapper class
 * exists only so the scalar is registered/discovered through this
 * codebase's existing convention for a custom scalar — a NestJS
 * `@Scalar()`-decorated provider class added to the providers of whichever
 * module(s) need it (see `date.scalar.ts` and how `AuthModule` registers
 * it) — rather than referencing the raw `GraphQLScalarType` instance
 * inline, keeping this consistent with the one other custom scalar this
 * codebase already has.
 *
 * `GraphQLJSON` (not `GraphQLJSONObject`, the sibling export in the same
 * package restricted to object/array values) is used deliberately: the
 * schema's scalar is named `JSON`, a fully generic value, matching what
 * was actually confirmed with the human — `platformConfig` itself is
 * always an object in practice today, but the scalar itself stays generic
 * for any future JSON-shaped use.
 *
 * Deliberately `@Scalar('JSON')` with NO second (`typeFunc`) argument —
 * unlike `DateScalar`'s `@Scalar('Date', () => Date)`, which intentionally
 * OVERRIDES `@nestjs/graphql`'s own built-in default mapping of the native
 * `Date` class to its ISO-datetime scalar. There is no equivalent built-in
 * mapping to override here, and mapping a broad native type like `Object`
 * would be actively dangerous: `@nestjs/graphql`'s `TypeMapperService`
 * resolves a field's scalar by looking up its type-reference in the
 * registered scalars map by exact reference equality, and `Object` is also
 * what TypeScript's reflected design-type metadata falls back to for any
 * field whose type isn't a primitive/registered class — mapping `Object`
 * globally to this JSON scalar could silently hijack unrelated fields
 * elsewhere in either schema that never intended to be a JSON blob. Omitting
 * the second argument makes the explorer fall back to `instance.constructor`
 * (i.e. `JsonScalar` itself) as the registered type-reference instead, so
 * this scalar is only ever selected where a field/query explicitly opts in
 * via `@Field(() => JsonScalar)`/`@Query(() => JsonScalar)` (see
 * `PlatformConfigResolver.platformConfig`) — nothing implicit.
 */
@Scalar('JSON')
export class JsonScalar implements CustomScalar<unknown, unknown> {
  description =
    'Arbitrary JSON value (object, array, string, number, boolean, or null) with no fixed schema.';

  /** Value sent from the client -> internal representation (pass-through). */
  parseValue(value: unknown): unknown {
    return GraphQLJSON.parseValue(value);
  }

  /** Internal representation -> value sent to the client (pass-through). */
  serialize(value: unknown): unknown {
    return GraphQLJSON.serialize(value);
  }

  /** Value from a GraphQL query literal (object/list/scalar literal). */
  parseLiteral(
    ast: ValueNode,
    variables?: Record<string, unknown> | null,
  ): unknown {
    return GraphQLJSON.parseLiteral(ast, variables);
  }
}
