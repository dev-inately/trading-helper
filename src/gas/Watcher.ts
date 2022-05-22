import { V2Trader } from './Trader'
import { Exchange } from './Exchange'
import { Statistics } from './Statistics'
import { DefaultStore } from './Store'
import { Survivors } from './Survivors'
import { Log } from './Common'

class Watcher {
  static start() {
    try {
      ScriptApp.newTrigger(global.Ticker.name).timeBased().everyMinutes(1).create()
      Log.info(`Started ${global.Ticker.name}`)
    } catch (e) {
      Log.error(e)
    }
  }

  static stop() {
    const trigger = ScriptApp.getProjectTriggers().find(t => t.getHandlerFunction() == global.Ticker.name)
    if (trigger) {
      try {
        ScriptApp.deleteTrigger(trigger)
        Log.info(`Stopped ${global.Ticker.name}`)
      } catch (e) {
        Log.error(e)
      }
    }
  }
}

global.Ticker = function Ticker() {
  const store = DefaultStore
  let exchange: Exchange
  let trader: V2Trader

  try {
    exchange = new Exchange(store.getConfig())
    trader = new V2Trader(store, exchange, new Statistics(store))
  } catch (e) {
    Log.error(e)
    Log.ifUsefulDumpAsEmail()
    throw e;
  }

  store.getTradesList().forEach(tm => {
    try {
      DefaultStore.changeTrade(tm.getCoinName(), tm => trader.tickerCheck(tm))
    } catch (e) {
      Log.error(e)
    }
  })

  try {
    trader.updateStableCoinsBalance();
  } catch (e) {
    Log.error(new Error(`Failed to read stable coins balance: ${e.message}`))
  }

  store.dumpChanges();

  try {
    new Survivors(store, exchange).updateScores();
  } catch (e) {
    Log.info(e)
  }

  Log.ifUsefulDumpAsEmail()
}

global.Start = function Start() {
  global.Stop()
  Watcher.start()
  Log.ifUsefulDumpAsEmail()
}

global.Stop = function Stop() {
  Watcher.stop()
  Log.ifUsefulDumpAsEmail()
}
