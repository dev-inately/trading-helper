import { Statistics } from "./Statistics"
import { Config, DefaultStore, IStore } from "./Store"
import { IExchange } from "./Exchange"
import { PriceAnomaly, PriceAnomalyChecker } from "./PriceAnomalyChecker"
import { Log } from "./Common"
import { f2 } from "../shared-lib/functions"
import { Coin, ExchangeSymbol, PriceMap, StableUSDCoin, TradeState } from "../shared-lib/types"
import { TradeMemo } from "../shared-lib/TradeMemo"
import { TradeResult } from "../shared-lib/TradeResult"

export class V2Trader {
  private readonly store: IStore
  private readonly config: Config
  private readonly exchange: IExchange
  private readonly stats: Statistics
  private readonly prices: PriceMap

  /**
   * Used when {@link Config.ProfitBasedStopLimit} is enabled.
   */
  private readonly totalProfit: number
  /**
   * Used when {@link Config.ProfitBasedStopLimit} is enabled.
   */
  private readonly numberOfBoughtAssets: number

  constructor(store: IStore, exchange: IExchange, stats: Statistics) {
    this.store = store
    this.config = store.getConfig()
    this.exchange = exchange
    this.stats = stats
    this.prices = exchange.getPrices()

    if (this.config.ProfitBasedStopLimit) {
      this.totalProfit = stats.getAll().TotalProfit
      this.numberOfBoughtAssets = store.getTradesList(TradeState.BOUGHT).length
    }
  }

  tickerCheck(tm: TradeMemo): TradeMemo {
    if (!Coin.isStable(tm.getCoinName())) {
      this.pushNewPrice(tm)

      const result = PriceAnomalyChecker.check(tm, this.config.PriceAnomalyAlert)
      if (result === PriceAnomaly.DUMP && tm.stateIs(TradeState.BOUGHT) && this.config.BuyDumps) {
        Log.alert(`Buying price dumps is enabled: more ${tm.getCoinName()} will be bought.`)
        tm.setState(TradeState.BUY)
      }
    }

    if (tm.stateIs(TradeState.BOUGHT)) {
      this.processBoughtState(tm)
    } else if (tm.stateIs(TradeState.SOLD)) {
      this.processSoldState(tm)
    }

    const priceGoesUp = tm.priceGoesUp()
    priceGoesUp && Log.info(`${tm.tradeResult.symbol} price goes up`)

    // take action after processing
    if (tm.stateIs(TradeState.SELL) && !priceGoesUp) {
      // sell if price not goes up anymore
      // this allows to wait if price continues to go up
      this.sell(tm)
    } else if (tm.stateIs(TradeState.BUY)) {
      // buy only if price started to go up
      // this allows to wait if price continues to fall
      // or buy if it is a stable coin
      if (priceGoesUp || Coin.isStable(tm.getCoinName())) {
        this.buy(tm, this.config.BuyQuantity)
      }
    }
    return tm
  }

  private processSoldState(tm: TradeMemo): void {
    if (!this.config.SwingTradeEnabled) {
      return
    }
    // Swing trade enabled.
    // Checking if price dropped below max observed price minus profit limit percentage,
    // and we can buy again
    const symbol = tm.tradeResult.symbol
    const priceDropped = tm.currentPrice < tm.maxObservedPrice * (1 - this.config.ProfitLimit)
    if (priceDropped) {
      Log.alert(`${symbol} will be bought again as price dropped sufficiently`)
      tm.setState(TradeState.BUY)
    } else {
      Log.info(`${symbol} price has not dropped sufficiently, skipping swing trade`)
    }
  }

  private processBoughtState(tm: TradeMemo): void {
    this.sendLevelsCrossingAlerts(tm)

    if (tm.currentPrice < tm.stopLimitPrice) {
      const canSell = !tm.hodl && this.store.getConfig().SellAtStopLimit
      canSell && tm.setState(TradeState.SELL)
    }

    const profitLimitPrice = tm.tradeResult.price * (1 + this.config.ProfitLimit)
    if (tm.currentPrice > profitLimitPrice) {
      const canSell = !tm.hodl && this.store.getConfig().SellAtProfitLimit
      canSell && tm.setState(TradeState.SELL)
    }

    if (this.config.ProfitBasedStopLimit) {
      const allowedLossPerAsset = this.totalProfit / this.numberOfBoughtAssets
      tm.stopLimitPrice = (tm.tradeResult.cost - allowedLossPerAsset) / tm.tradeResult.quantity
    } else if (!tm.stopLimitPrice || tm.priceGoesUp()) {
      // Using the previous price a few measures back to calculate new stop limit
      const newStopLimit = tm.prices[tm.prices.length - 3] * (1 - this.config.StopLimit)
      tm.stopLimitPrice = Math.max(tm.stopLimitPrice, newStopLimit)
    }
  }

  private sendLevelsCrossingAlerts(tm: TradeMemo) {
    const symbol = tm.tradeResult.symbol
    if (!tm.hodl) {
      if (tm.profitLimitCrossedUp(this.config.ProfitLimit)) {
        Log.alert(`${symbol} profit limit crossed up at ${tm.currentPrice}`)
      } else if (tm.lossLimitCrossedDown()) {
        Log.alert(`${symbol} stop limit crossed down at ${tm.currentPrice}`)
      } else if (tm.entryPriceCrossedUp()) {
        Log.alert(`${symbol} entry price crossed up at ${tm.currentPrice}`)
      }
    }
  }

  private pushNewPrice(tm: TradeMemo): void {
    const symbol = tm.tradeResult.symbol
    const price = this.prices[symbol.toString()]
    if (price) {
      tm.pushPrice(price)
    } else if (tm.tradeResult.quantity) {
      // no price available, but we have quantity, which means we bought something earlier
      throw Error(`Exchange does not have price for ${symbol}`)
    } else {
      // no price available, and no quantity, which means we haven't bought anything yet
      // could be a non-existing symbol, or not yet published in the exchange
      Log.info(`Exchange does not have price for ${symbol}`)
    }
  }

  private buy(tm: TradeMemo, cost: number): void {
    const symbol = tm.tradeResult.symbol
    const tradeResult = this.exchange.marketBuy(symbol, cost)
    if (tradeResult.fromExchange) {
      this.processBuyFee(tradeResult)
      tm.joinWithNewTrade(tradeResult)
      Log.alert(`${tm.getCoinName()} asset average price: ${tm.tradeResult.price}`)
      Log.debug(tm)
    } else {
      Log.alert(`${symbol.quantityAsset} could not be bought: ${tradeResult}`)
      Log.debug(tm)
      tm.resetState()
    }
  }

  private sell(memo: TradeMemo): void {
    const symbol = new ExchangeSymbol(memo.tradeResult.symbol.quantityAsset, this.config.StableCoin)
    const tradeResult = this.exchange.marketSell(symbol, memo.tradeResult.quantity)
    if (tradeResult.fromExchange) {
      const fee = this.processSellFee(memo, tradeResult)
      const profit = f2(tradeResult.gained - memo.tradeResult.paid - fee)
      const profitPercentage = f2(100 * (profit / memo.tradeResult.paid))

      Log.alert(`${profit >= 0 ? `Profit` : `Loss`}: ${profit} (${profitPercentage}%)`)

      tradeResult.profit = profit
      memo.tradeResult = tradeResult
      Log.debug(memo)
      memo.setState(TradeState.SOLD)
      this.updatePLStatistics(symbol.priceAsset, profit)
    } else {
      Log.debug(memo)
      memo.hodl = true
      memo.setState(TradeState.BOUGHT)
      Log.alert(
        `An issue happened while selling ${symbol}. The asset is marked HODL. Please, resolve it manually.`,
      )
      Log.alert(tradeResult.toString())
    }

    if (memo.stateIs(TradeState.SOLD) && this.config.AveragingDown) {
      // all gains are reinvested to most unprofitable asset
      // find a trade with the lowest profit percentage
      const byProfitPercentDesc = (t1, t2) => (t1.profitPercent() < t2.profitPercent() ? -1 : 1)
      const lowestProfitTrade = this.store
        .getTradesList()
        .filter((t) => t.stateIs(TradeState.BOUGHT))
        .sort(byProfitPercentDesc)[0]
      if (lowestProfitTrade) {
        Log.alert(`Averaging down is enabled`)
        Log.alert(
          `All gains from selling ${symbol} are being invested to ${lowestProfitTrade.tradeResult.symbol}`,
        )
        DefaultStore.changeTrade(lowestProfitTrade.getCoinName(), (tm) => {
          this.buy(tm, tradeResult.gained)
          return tm
        })
      }
    }
  }

  private updatePLStatistics(gainedCoin: string, profit: number): void {
    if (Coin.isStable(gainedCoin)) {
      this.stats.addProfit(profit)
      Log.info(`P/L added to statistics: ` + profit)
    }
  }

  private processBuyFee(buyResult: TradeResult): void {
    if (this.updateBNBBalance(-buyResult.commission)) {
      // if fee paid by existing BNB asset balance, commission can be zeroed in the trade result
      buyResult.commission = 0
    }
  }

  private processSellFee(tm: TradeMemo, sellResult: TradeResult): number {
    if (this.updateBNBBalance(-sellResult.commission)) {
      // if fee paid by existing BNB asset balance, commission can be zeroed in the trade result
      sellResult.commission = 0
    }
    const buyFee = this.getBNBCommissionCost(tm.tradeResult.commission)
    const sellFee = this.getBNBCommissionCost(sellResult.commission)
    return buyFee + sellFee
  }

  private getBNBCommissionCost(commission: number): number {
    const bnbPrice = this.prices[`BNB` + this.config.StableCoin]
    return bnbPrice ? commission * bnbPrice : 0
  }

  private updateBNBBalance(quantity: number): boolean {
    let updated = false
    DefaultStore.changeTrade(`BNB`, (tm) => {
      if (tm.tradeResult.fromExchange) {
        // Changing only quantity, but not cost. This way the BNB amount is reduced, but the paid amount is not.
        // As a result, the BNB profit/loss correctly reflects losses due to paid fees.
        tm.tradeResult.addQuantity(quantity, 0)
        Log.alert(`BNB balance updated by ${quantity}`)
        updated = true
        return tm
      }
    })
    return updated
  }

  updateStableCoinsBalance() {
    Object.keys(StableUSDCoin).forEach((coin) =>
      DefaultStore.changeTrade(coin, (tm) => {
        const balance = this.exchange.getFreeAsset(tm.getCoinName())
        if (balance) {
          tm.setState(tm.getState() || TradeState.BOUGHT)
          tm.tradeResult = new TradeResult(tm.tradeResult.symbol, `Stable coin`)
          tm.tradeResult.quantity = balance
          tm.tradeResult.fromExchange = true
          tm.hodl = true
        } else {
          tm.deleted = true
        }
        return tm
      }),
    )
  }
}