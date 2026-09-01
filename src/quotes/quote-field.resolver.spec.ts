import { QuoteModel } from './models/quote.model';
import { QuoteFieldResolver } from './quote-field.resolver';

describe('QuoteFieldResolver (finalPrice)', () => {
  function makeQuote(overrides?: Partial<QuoteModel>): QuoteModel {
    const quote = new QuoteModel();
    quote.id = 'quote-1';
    quote.price = 15000;
    quote.negotiatedPrice = undefined;
    Object.assign(quote, overrides);
    return quote;
  }

  it('returns price when there is no negotiatedPrice', () => {
    const resolver = new QuoteFieldResolver();
    const quote = makeQuote({ price: 15000, negotiatedPrice: null });

    expect(resolver.finalPrice(quote)).toBe(15000);
  });

  it('returns price when negotiatedPrice is undefined', () => {
    const resolver = new QuoteFieldResolver();
    const quote = makeQuote({ price: 15000, negotiatedPrice: undefined });

    expect(resolver.finalPrice(quote)).toBe(15000);
  });

  it('returns negotiatedPrice when one is set, never the original price', () => {
    const resolver = new QuoteFieldResolver();
    const quote = makeQuote({ price: 15000, negotiatedPrice: 19000 });

    expect(resolver.finalPrice(quote)).toBe(19000);
  });
});
