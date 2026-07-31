import { GraphQLError } from 'graphql';
import { DomainException } from '../errors/domain-exception';
import { DomainExceptionFilter } from './domain-exception.filter';

describe('DomainExceptionFilter', () => {
  it('maps a DomainException to a GraphQLError with extensions.code set', () => {
    const filter = new DomainExceptionFilter();
    const exception = new DomainException('SOCIAL_LOGIN_FAILED', 'nope');

    const result = filter.catch(exception);

    expect(result).toBeInstanceOf(GraphQLError);
    expect(result.message).toBe('nope');
    expect(result.extensions.code).toBe('SOCIAL_LOGIN_FAILED');
  });
});
