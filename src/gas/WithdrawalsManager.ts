import { type IExchange } from "./IExchange";
import { type Statistics } from "./Statistics";
import { type ConfigDao } from "./dao/Config";

export class WithdrawalsManager {
  constructor(
    private readonly configDao: ConfigDao,
    private readonly exchange: IExchange,
    private readonly statistics: Statistics
  ) {}

  addWithdrawal(amount: number): { amount: number; balance: number } {
    const config = this.configDao.get();

    // Check internal balance
    if (amount > config.StableBalance) {
      throw new Error(`Withdrawal amount is greater than the current balance.`);
    }

    const balance = this.exchange.getBalance(config.StableCoin);

    // Check external balance
    if (amount > balance) {
      throw new Error(
        `Withdrawal amount is greater than the factual ${config.StableCoin} balance on the exchange: $${balance}.`
      );
    }

    // We can proceed adding withdraw.
    const latestConfig = this.configDao.get();
    latestConfig.StableBalance -= amount;
    this.statistics.addWithdrawal(amount);
    this.configDao.set(latestConfig);
    return {
      amount,
      balance: latestConfig.StableBalance,
    };
  }
}
