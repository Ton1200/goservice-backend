import { Injectable } from '@nestjs/common';
import {
  PaymentAttemptType,
  PaymentMethod,
  PaymentProviderCustomer,
  Prisma,
  SavedPaymentCard,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProviderSavedCard } from './ports/payment-provider.port';

/**
 * Persistence of the provider-side customer link and the saved cards (GOS-146).
 * Only NON-sensitive facts are ever stored: the provider's customer id, the
 * provider's card token id and brand / last four / type / expiry. Never a card
 * number, CVV or holder name (they never reach GoService at all).
 *
 * Both tables are keyed by the provider ENVIRONMENT as well: a sandbox `cus_…`
 * or `card_…` does not exist in production, so a switch of
 * `payments.payment-methods.rapyd.environment` must never make GoService present a sandbox
 * card as chargeable in production (or vice-versa).
 */
@Injectable()
export class SavedCardRepository {
  constructor(private readonly prisma: PrismaService) {}

  findProviderCustomer(
    customerProfileId: string,
    method: PaymentMethod,
    environment: string,
  ): Promise<PaymentProviderCustomer | null> {
    return this.prisma.paymentProviderCustomer.findUnique({
      where: {
        customerProfileId_method_environment: {
          customerProfileId,
          method,
          environment,
        },
      },
    });
  }

  /**
   * Records the provider customer id. Two concurrent first-time saves race on
   * the unique key: the loser gets the winner's row back (its own provider
   * customer is then an unused orphan on the provider's side — harmless, no
   * card is ever attached to it).
   */
  async createProviderCustomer(data: {
    customerProfileId: string;
    method: PaymentMethod;
    environment: string;
    providerCustomerId: string;
  }): Promise<PaymentProviderCustomer> {
    try {
      return await this.prisma.paymentProviderCustomer.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findProviderCustomer(
          data.customerProfileId,
          data.method,
          data.environment,
        );
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  listCards(
    customerProfileId: string,
    method: PaymentMethod,
    environment: string,
  ): Promise<SavedPaymentCard[]> {
    return this.prisma.savedPaymentCard.findMany({
      where: { customerProfileId, method, environment },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The card, only if it belongs to `customerProfileId` (else `null`). */
  findCardOfCustomer(
    id: string,
    customerProfileId: string,
  ): Promise<SavedPaymentCard | null> {
    return this.prisma.savedPaymentCard.findFirst({
      where: { id, customerProfileId },
    });
  }

  /**
   * Makes the local table mirror the provider's vault (the source of truth):
   * cards the provider lists are inserted/updated (their non-sensitive facts
   * refreshed), local cards the provider no longer lists are removed. One
   * transaction, so a reader never sees a half-synced list.
   */
  async syncCards(
    customerProfileId: string,
    method: PaymentMethod,
    environment: string,
    cards: ProviderSavedCard[],
  ): Promise<SavedPaymentCard[]> {
    return this.prisma.$transaction(async (tx) => {
      for (const card of cards) {
        const facts = {
          brand: card.brand,
          lastFour: card.lastFour,
          type: toAttemptType(card.type),
          expirationMonth: card.expirationMonth,
          expirationYear: card.expirationYear,
        };
        await tx.savedPaymentCard.upsert({
          where: {
            method_environment_providerCardId: {
              method,
              environment,
              providerCardId: card.providerCardId,
            },
          },
          create: {
            customerProfileId,
            method,
            environment,
            providerCardId: card.providerCardId,
            ...facts,
          },
          // `customerProfileId` is never rewritten: a token belongs to the
          // Customer it was first synced for.
          update: facts,
        });
      }
      await tx.savedPaymentCard.deleteMany({
        where: {
          customerProfileId,
          method,
          environment,
          providerCardId: { notIn: cards.map((card) => card.providerCardId) },
        },
      });
      return tx.savedPaymentCard.findMany({
        where: { customerProfileId, method, environment },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  async deleteCard(id: string): Promise<void> {
    await this.prisma.savedPaymentCard.deleteMany({ where: { id } });
  }
}

function toAttemptType(
  type: ProviderSavedCard['type'],
): PaymentAttemptType | null {
  if (type === 'credit_card') {
    return PaymentAttemptType.CREDIT_CARD;
  }
  if (type === 'debit_card') {
    return PaymentAttemptType.DEBIT_CARD;
  }
  return null;
}
