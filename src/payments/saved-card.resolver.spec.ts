import { PaymentMethod } from '@prisma/client';
import { SavedCardResolver } from './saved-card.resolver';
import { AddSavedCardService } from './services/add-saved-card.service';
import { DeleteSavedCardService } from './services/delete-saved-card.service';
import { ListMySavedCardsService } from './services/list-my-saved-cards.service';
import { PayEngagementWithSavedCardService } from './services/pay-engagement-with-saved-card.service';

describe('SavedCardResolver.mySavedCards — providerCardId (GOS-150 follow-up)', () => {
  const baseCard = {
    customerProfileId: 'profile-1',
    environment: 'sandbox',
    brand: 'visa',
    lastFour: '1111',
    type: null,
    expirationMonth: 12,
    expirationYear: 2030,
    createdAt: new Date('2026-09-25T00:00:00Z'),
    updatedAt: new Date('2026-09-25T00:00:00Z'),
  };

  function makeResolver(cards: unknown[]) {
    const listMySavedCards = jest.fn().mockResolvedValue(cards);
    const resolver = new SavedCardResolver(
      { listMySavedCards } as unknown as ListMySavedCardsService,
      {} as PayEngagementWithSavedCardService,
      {} as DeleteSavedCardService,
      {} as AddSavedCardService,
    );
    return { resolver, listMySavedCards };
  }

  it("exposes a Mercado Pago card's own provider id — the card_id the client re-tokenizes with the CVV", async () => {
    const { resolver, listMySavedCards } = makeResolver([
      {
        ...baseCard,
        id: 'saved-mp',
        method: PaymentMethod.MERCADOPAGO,
        providerCardId: '1234567890',
      },
    ]);

    const cards = await resolver.mySavedCards('user-1');

    // Ownership is the session's: the service is only ever asked for the caller's own cards.
    expect(listMySavedCards).toHaveBeenCalledWith('user-1');
    expect(cards[0].providerCardId).toBe('1234567890');
  });

  it("never exposes a Rapyd card's token (a one-tap, server-side chargeable reference) — null instead", async () => {
    const { resolver } = makeResolver([
      {
        ...baseCard,
        id: 'saved-rapyd',
        method: PaymentMethod.RAPYD,
        providerCardId: 'card_rapyd_secret_ref',
      },
    ]);

    const cards = await resolver.mySavedCards('user-1');

    expect(cards[0].providerCardId).toBeNull();
    expect(JSON.stringify(cards)).not.toContain('card_rapyd_secret_ref');
  });
});
