import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCallCoreCommand = vi.fn();

vi.mock('../../coreCommandClient', () => ({
  callCoreCommand: (...args: unknown[]) => mockCallCoreCommand(...args),
}));

const { creditsApi } = await import('../creditsApi');

describe('creditsApi', () => {
  beforeEach(() => {
    mockCallCoreCommand.mockReset();
  });

  describe('getBalance', () => {
    it('calls openhuman.billing_get_balance and returns data', async () => {
      const balance = { balanceUsd: 10, topUpBalanceUsd: 5, topUpBaselineUsd: null };
      mockCallCoreCommand.mockResolvedValue(balance);
      const result = await creditsApi.getBalance();
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_get_balance');
      expect(result).toEqual(balance);
    });

    it('propagates errors', async () => {
      mockCallCoreCommand.mockRejectedValue(new Error('RPC error'));
      await expect(creditsApi.getBalance()).rejects.toThrow('RPC error');
    });
  });

  describe('getTeamUsage', () => {
    it('calls openhuman.team_get_usage', async () => {
      const usage = {
        remainingUsd: 5,
        cycleBudgetUsd: 10,
        dailyUsage: 1,
        totalInputTokensThisCycle: 1000,
        totalOutputTokensThisCycle: 500,
        fiveHourSpendUsd: 0.5,
        fiveHourCapUsd: 3,
        fiveHourResetsAt: null,
        cycleStartDate: '2026-01-01T00:00:00.000Z',
        cycleEndsAt: '2026-01-08T00:00:00.000Z',
      };
      mockCallCoreCommand.mockResolvedValue(usage);
      const result = await creditsApi.getTeamUsage();
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.team_get_usage');
      expect(result.cycleBudgetUsd).toBe(10);
    });
  });

  describe('topUp', () => {
    it('calls with stripe by default', async () => {
      const topUpResult = {
        url: 'https://stripe.com/pay',
        gatewayTransactionId: 'pi_1',
        amountUsd: 20,
        gateway: 'stripe',
      };
      mockCallCoreCommand.mockResolvedValue(topUpResult);
      const result = await creditsApi.topUp(20);
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_top_up', {
        amountUsd: 20,
        gateway: 'stripe',
      });
      expect(result.gateway).toBe('stripe');
    });

    it('calls with coinbase when specified', async () => {
      mockCallCoreCommand.mockResolvedValue({
        url: 'https://commerce.coinbase.com/pay',
        gatewayTransactionId: 'cb_1',
        amountUsd: 10,
        gateway: 'coinbase',
      });
      await creditsApi.topUp(10, 'coinbase');
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_top_up', {
        amountUsd: 10,
        gateway: 'coinbase',
      });
    });
  });

  describe('getTransactions', () => {
    it('calls with default limit/offset', async () => {
      mockCallCoreCommand.mockResolvedValue({ transactions: [], total: 0 });
      await creditsApi.getTransactions();
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_get_transactions', {
        limit: 20,
        offset: 0,
      });
    });

    it('calls with custom limit/offset', async () => {
      mockCallCoreCommand.mockResolvedValue({ transactions: [], total: 5 });
      await creditsApi.getTransactions(50, 10);
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_get_transactions', {
        limit: 50,
        offset: 10,
      });
    });
  });

  describe('getAutoRecharge', () => {
    it('calls openhuman.billing_get_auto_recharge', async () => {
      const settings = {
        enabled: false,
        thresholdUsd: 5,
        rechargeAmountUsd: 10,
        weeklyLimitUsd: 50,
        spentThisWeekUsd: 0,
        weekStartDate: '2026-01-01T00:00:00.000Z',
        inFlight: false,
        hasSavedPaymentMethod: false,
        lastTriggeredAt: null,
        lastRechargeAt: null,
        lastPaymentIntentId: null,
        lastError: null,
      };
      mockCallCoreCommand.mockResolvedValue(settings);
      const result = await creditsApi.getAutoRecharge();
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_get_auto_recharge');
      expect(result.enabled).toBe(false);
    });
  });

  describe('updateAutoRecharge', () => {
    it('calls with payload', async () => {
      const updated = {
        enabled: true,
        thresholdUsd: 2,
        rechargeAmountUsd: 10,
        weeklyLimitUsd: 40,
        spentThisWeekUsd: 0,
        weekStartDate: '',
        inFlight: false,
        hasSavedPaymentMethod: true,
        lastTriggeredAt: null,
        lastRechargeAt: null,
        lastPaymentIntentId: null,
        lastError: null,
      };
      mockCallCoreCommand.mockResolvedValue(updated);
      const payload = { enabled: true, thresholdUsd: 2 };
      await creditsApi.updateAutoRecharge(payload);
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_update_auto_recharge', {
        payload,
      });
    });
  });

  describe('getCards', () => {
    it('calls openhuman.billing_get_cards', async () => {
      mockCallCoreCommand.mockResolvedValue({
        customerId: 'cus_1',
        defaultPaymentMethodId: '',
        cards: [],
      });
      const result = await creditsApi.getCards();
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_get_cards');
      expect(result.cards).toEqual([]);
    });
  });

  describe('createSetupIntent', () => {
    it('calls openhuman.billing_create_setup_intent', async () => {
      mockCallCoreCommand.mockResolvedValue({
        clientSecret: 'seti_secret',
        customerId: 'cus_1',
        setupIntentId: 'seti_1',
      });
      const result = await creditsApi.createSetupIntent();
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_create_setup_intent');
      expect(result.clientSecret).toBe('seti_secret');
    });
  });

  describe('updateCard', () => {
    it('calls with paymentMethodId and payload', async () => {
      mockCallCoreCommand.mockResolvedValue({
        customerId: 'cus_1',
        defaultPaymentMethodId: 'pm_1',
        cards: [],
      });
      await creditsApi.updateCard('pm_1', { isDefault: true });
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_update_card', {
        paymentMethodId: 'pm_1',
        payload: { isDefault: true },
      });
    });
  });

  describe('deleteCard', () => {
    it('calls with paymentMethodId', async () => {
      mockCallCoreCommand.mockResolvedValue({
        customerId: 'cus_1',
        defaultPaymentMethodId: '',
        cards: [],
      });
      await creditsApi.deleteCard('pm_old');
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_delete_card', {
        paymentMethodId: 'pm_old',
      });
    });
  });

  describe('redeemCoupon', () => {
    it('calls with code', async () => {
      mockCallCoreCommand.mockResolvedValue({
        success: true,
        data: { code: 'PROMO', amountUsd: 5 },
      });
      const result = await creditsApi.redeemCoupon('PROMO');
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_redeem_coupon', {
        code: 'PROMO',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('getUserCoupons', () => {
    it('calls openhuman.billing_get_coupons and returns list', async () => {
      const coupons = [
        { code: 'PROMO', amountUsd: 5, redeemedAt: '', activationType: 'manual', fulfilled: true },
      ];
      mockCallCoreCommand.mockResolvedValue(coupons);
      const result = await creditsApi.getUserCoupons();
      expect(mockCallCoreCommand).toHaveBeenCalledWith('openhuman.billing_get_coupons');
      expect(result).toEqual(coupons);
    });
  });
});
