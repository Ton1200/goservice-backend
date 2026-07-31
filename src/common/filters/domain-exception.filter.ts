import { Catch } from '@nestjs/common';
import { GqlExceptionFilter } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import { DomainException } from '../errors/domain-exception';

/**
 * Maps any `DomainException` thrown by an application service into a
 * `GraphQLError` with `extensions.code` set to the domain error code (e.g.
 * `REGISTRATION_FAILED`, `INVALID_PHONE_NUMBER`, `SOCIAL_LOGIN_FAILED`).
 * Registered globally as `APP_FILTER` in `AppModule` — see
 * `src/common/errors/domain-exception.ts` for why this exists instead of
 * populating the `errors` field some payload types still declare.
 */
@Catch(DomainException)
export class DomainExceptionFilter implements GqlExceptionFilter {
  catch(exception: DomainException): GraphQLError {
    return new GraphQLError(exception.message, {
      extensions: { code: exception.code },
    });
  }
}
