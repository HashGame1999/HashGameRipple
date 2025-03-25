const CoinCode = 'XRP'
const XRP2DropRate = 1000 * 1000
const RippleEpoch = 946684800
const ServerURL = 'wss://xrplcluster.com'

const TxType = {
  Payment: 'Payment'
}

const TxResult = {
  Success: 'tesSUCCESS'
}

const DBPath = `./HashGame.db`

const HashGame = {
  Name: 'HashGame',
  Version: '1.0',
  EpochLedgerIndex: 95680001,
  CloseLedgerIndex: 96680000,
  DrawLedgerInterval: 10000,
  TicketPrice: 1,
  OperatingFeeMin: 1,
  OperatingFeeRateMax: 0.08,
  JackpotCodeLength: 5,
  PrizeRank: 3,
  PrizeRankWeight: 16,
  JackpotProportion: 0.5,
  GameAccount: 'rXRP75idnwWTuukPeSkpbeeKGkhyysVW8',
  OperatorAccount: 'rXRP25Pq6tYC5HSL3P2HAe1p5i8oxwatq'
}

export {
  CoinCode,
  XRP2DropRate,
  RippleEpoch,
  ServerURL,
  TxType,
  TxResult,
  DBPath,
  HashGame
}