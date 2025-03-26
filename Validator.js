import fs from 'fs'
import sqlite3 from 'sqlite3'
import xrpl, { dropsToXrp, convertHexToString } from 'xrpl'
import { CoinCode, ServerURL, TxType, TxResult, XRP2DropRate, DBPath, HashGame } from './Const.js'
import { dbGet, dbAll, dbRun, SHA512, genFixedPrizeAmount, genFixedPrizeSetting, fetchRecentClosedLedgerIndex, genTicketCode, Drop2FloorXRP, genDrawID } from './Util.js'

const DrawLogDir = '/log'
const client = new xrpl.Client(ServerURL)

const FixedPrizeAmout = genFixedPrizeAmount(HashGame.JackpotCodeLength, HashGame.TicketPrice, HashGame.PrizeRank, HashGame.PrizeRankWeight)
const FixedPrizeSetting = genFixedPrizeSetting(HashGame.JackpotCodeLength, FixedPrizeAmout)

async function initDB(db) {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS GAME_TXS(
        ledger_index INTEGER,
        ledger_hash VARCHAR(64),
        tx_index INTEGER,
        tx_type TEXT,
        tx_result TEXT,
        tx_sequence INTEGER,
        tx_hash VARCHAR(64) PRIMARY KEY,
        sour VARCHAR(35),
        dest VARCHAR(35),
        delivered_amount INTEGER,
        fee INTEGER,
        ticket_code_count INTEGER,
        ticket_codes TEXT,
        close_time_iso TEXT,
        memos TEXT,
        json TEXT
      )`,
      err => {
        if (err) {
          console.log(err)
        }
      }
    )

    db.run(`CREATE TABLE IF NOT EXISTS OPERATOR_TXS(
        ledger_index INTEGER,
        ledger_hash VARCHAR(64),
        tx_index INTEGER,
        tx_type TEXT,
        tx_result TEXT,
        tx_sequence INTEGER,
        tx_hash VARCHAR(64) PRIMARY KEY,
        sour VARCHAR(35),
        dest VARCHAR(35),
        delivered_amount INTEGER,
        fee INTEGER,
        close_time_iso TEXT,
        memos TEXT,
        json TEXT
      )`,
      err => {
        if (err) {
          console.log(err)
        }
      }
    )

    db.run(`CREATE TABLE IF NOT EXISTS DRAWS(
        draw_id TEXT PRIMARY KEY,
        open_ledger_index INTEGER,
        close_ledger_index INTEGER,
        init_pool_in_drop INTEGER,
        income_in_drop INTEGER,
        operating_fee INTEGER,
        ticket_code_count INTEGER,
        jackpot_code TEXT,
        prize_total INTEGER,
        jackpot_total INTEGER,
        pay_amount INTEGER,
        residual_pool_in_drop INTEGER,
        is_paid BOOLEAN,
        pay_tx_hash TEXT DEFAULT '',
        pay_fee_in_drop INTEGER
      )`,
      err => {
        if (err) {
          console.log(err)
        }
      }
    )

    db.run(`CREATE TABLE IF NOT EXISTS BREAKDOWNS(
        draw_id TEXT,
        ticket_ledger_index INTEGER,
        ticket_tx_index INTEGER,
        ticket_tx_hash VARCHAR(64) PRIMARY KEY,
        address VARCHAR(35),
        jackpot_breakdown TEXT,
        prize_breakdown TEXT,
        amount_total INTEGER,
        is_paid BOOLEAN,
        pay_tx_hash TEXT DEFAULT '',
        pay_fee_in_drop INTEGER
      )`,
      err => {
        if (err) {
          console.log(err)
        }
      }
    )
  })
}

async function calEpochPool(db) {
  let amount = 0
  let sql = `SELECT sour, dest, delivered_amount, fee FROM GAME_TXS WHERE tx_type = '${TxType.Payment}' AND tx_result = '${TxResult.Success}' AND ledger_index < ${HashGame.EpochLedgerIndex} ORDER BY ledger_index ASC`
  let payments = await dbAll(db, sql)
  for (let i = 0; i < payments.length; i++) {
    const payment = payments[i]
    if (payment.dest == HashGame.GameAccount) {
      // get
      amount = amount + payment.delivered_amount
    } else if (payment.sour == HashGame.GameAccount) {
      // pay
      amount = amount - payment.delivered_amount - payment.fee
    }
  }
  return amount
}

async function fetchGameAccountTx(client, db, game_account, epoch_ledger_index, ticket_price, jackpot_code_length) {
  try {
    let page_size = 100
    let done = false
    let marker = undefined
    while (!done) {
      const response = await client.request({
        command: 'account_tx',
        account: game_account,
        limit: page_size,
        marker: marker
      })
      let txs = response.result.transactions
      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i]
        let sql = `SELECT * FROM GAME_TXS WHERE tx_hash == '${tx.hash}' LIMIT 1`
        let item = await dbGet(db, sql)
        if (item != null) {
          done = true
          return
        } else if (tx.validated == true && tx.tx_json.TransactionType == TxType.Payment && tx.meta.TransactionResult == TxResult.Success) {
          // !!! validated+payment+success
          let tmp_memos = []
          if (tx.tx_json.Memos) {
            let memo_length = tx.tx_json.Memos.length
            for (let i = 0; i < memo_length; i++) {
              const memo = tx.tx_json.Memos[i].Memo
              let tmp_memo = {}
              for (const key in memo) {
                tmp_memo[key] = convertHexToString(memo[key])
              }
              tmp_memos.push(tmp_memo)
            }
          }

          let amount = parseInt(tx.meta.delivered_amount)
          let fee = parseInt(tx.tx_json.Fee)
          let ticket_code_count = 0
          let ticket_codes = []
          if (tx.tx_json.Destination == game_account && tx.ledger_index > epoch_ledger_index) {
            [ticket_code_count, ticket_codes] = genTicketCode(tx.hash, amount, ticket_price, jackpot_code_length)
          }

          sql = `INSERT INTO GAME_TXS (ledger_index, ledger_hash, tx_index, tx_type, tx_result, tx_sequence, tx_hash, sour, dest, delivered_amount, fee, close_time_iso, json, ticket_code_count, ticket_codes, memos)
              VALUES (${tx.ledger_index}, '${tx.ledger_hash}', ${tx.meta.TransactionIndex} , '${tx.tx_json.TransactionType}', '${tx.meta.TransactionResult}', ${tx.tx_json.Sequence}, '${tx.hash}', '${tx.tx_json.Account}', '${tx.tx_json.Destination}', ${amount}, ${fee}, '${tx.close_time_iso}', '${JSON.stringify(tx)}', ${ticket_code_count}, '${JSON.stringify(ticket_codes)}', '${JSON.stringify(tmp_memos)}')`
          await dbRun(db, sql)
        }
      }
      if (response.result.marker) {
        marker = response.result.marker
      } else {
        done = true
      }
    }
  } catch (error) {
    console.error(error)
  }
}

async function fetchOperatorAccountTx(client, db, operator_account) {
  try {
    let page_size = 100
    let done = false
    let marker = undefined
    while (!done) {
      const response = await client.request({
        command: 'account_tx',
        account: operator_account,
        limit: page_size,
        marker: marker
      })
      let txs = response.result.transactions
      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i]
        let sql = `SELECT * FROM OPERATOR_TXS WHERE tx_hash == '${tx.hash}' LIMIT 1`
        let item = await dbGet(db, sql)
        if (item != null) {
          done = true
          return
        } else if (tx.validated == true && tx.tx_json.TransactionType == TxType.Payment && tx.meta.TransactionResult == TxResult.Success) {
          // !!! validated+payment+success
          let tmp_memos = []
          if (tx.tx_json.Memos) {
            let memo_length = tx.tx_json.Memos.length
            for (let i = 0; i < memo_length; i++) {
              const memo = tx.tx_json.Memos[i].Memo
              let tmp_memo = {}
              for (const key in memo) {
                tmp_memo[key] = convertHexToString(memo[key])
              }
              tmp_memos.push(tmp_memo)
            }
          }

          let amount = parseInt(tx.meta.delivered_amount)
          let fee = parseInt(tx.tx_json.Fee)

          sql = `INSERT INTO OPERATOR_TXS (ledger_index, ledger_hash, tx_index, tx_type, tx_result, tx_sequence, tx_hash, sour, dest, delivered_amount, fee, close_time_iso, json, memos)
              VALUES (${tx.ledger_index}, '${tx.ledger_hash}', ${tx.meta.TransactionIndex} , '${tx.tx_json.TransactionType}', '${tx.meta.TransactionResult}', ${tx.tx_json.Sequence}, '${tx.hash}', '${tx.tx_json.Account}', '${tx.tx_json.Destination}', ${amount}, ${fee}, '${tx.close_time_iso}', '${JSON.stringify(tx)}', '${JSON.stringify(tmp_memos)}')`
          await dbRun(db, sql)
        }
      }
      if (response.result.marker) {
        marker = response.result.marker
      } else {
        done = true
      }
    }
  } catch (error) {
    console.error(error)
  }
}

async function checkGamePayment(db, game_account, operator_account, draw_interval) {
  let sql = `SELECT * FROM DRAWS WHERE is_paid = false ORDER BY open_ledger_index ASC`
  let draws = await dbAll(db, sql)
  for (let i = 0; i < draws.length; i++) {
    const draw = draws[i]
    if (draw.pay_amount == 0) {
      sql = `UPDATE DRAWS SET is_paid = true, pay_tx_hash = '', pay_fee_in_drop = 0 WHERE draw_id = '${draw.draw_id}'`
      await dbRun(db, sql)
    } else if (draw.pay_tx_hash != '') {
      sql = `SELECT * FROM GAME_TXS WHERE tx_hash = '${draw.pay_tx_hash}' LIMIT 1`
      let game_pay_tx = await dbGet(db, sql)
      if (game_pay_tx != null) {
        if (draw.pay_amount == dropsToXrp(game_pay_tx.delivered_amount) && game_pay_tx.sour == game_account) {
          let residual_pool_in_drop = draw.residual_pool_in_drop - game_pay_tx.fee
          sql = `UPDATE DRAWS SET is_paid = true, pay_tx_hash = '${game_pay_tx.tx_hash}', pay_fee_in_drop = ${game_pay_tx.fee}, residual_pool_in_drop = ${residual_pool_in_drop} WHERE draw_id = '${draw.draw_id}'`
          await dbRun(db, sql)
          console.log(`GamePaymentDone1(link through hash): Draw(${draw.draw_id}) TxHash(${game_pay_tx.tx_hash})    Amount(${draw.pay_amount}${CoinCode})`)
        } else {
          console.log(`GamePaymentError1: ${draw.draw_id}(${draw.pay_tx_hash}) invalid...`)
        }
      } else {
        console.log(`GamePaymentError2: ${draw.draw_id}(${draw.pay_tx_hash}) not exist...`)
      }
    } else {
      // try to link pay_tx and draw
      let close_ledger_index = parseInt(draw.draw_id.split('#')[1]) + draw_interval
      sql = `SELECT * FROM GAME_TXS WHERE ledger_index >= ${close_ledger_index} AND tx_type = '${TxType.Payment}' AND tx_result = '${TxResult.Success}' AND sour = '${game_account}' ORDER BY ledger_index ASC, tx_index ASC`
      let payments = await dbAll(db, sql)
      let match_flag = false
      for (let j = 0; j < payments.length; j++) {
        const payment = payments[j]
        let payment_memo = JSON.parse(payment.memos)
        let memo_data = payment_memo[0].MemoData
        memo_data = JSON.parse(memo_data)
        if (memo_data.DrawId == draw.draw_id) {
          if (payment.dest == operator_account && dropsToXrp(payment.delivered_amount) == draw.pay_amount) {
            let residual_pool_in_drop = draw.residual_pool_in_drop - payment.fee
            sql = `UPDATE DRAWS SET is_paid = true, pay_tx_hash = '${payment.tx_hash}', pay_fee_in_drop = ${payment.fee}, residual_pool_in_drop = ${residual_pool_in_drop} WHERE draw_id = '${draw.draw_id}'`
            await dbRun(db, sql)
            console.log(`GamePaymentDone2(link through memo): Draw(${draw.draw_id}) TxHash(${payment.tx_hash})    Amount(${draw.pay_amount}${CoinCode})`)
            match_flag = true
            break
          } else {
            console.log(`BreakdownPayment: failure -- someting wrong`)
            console.log(draw)
            console.log(payment)
          }
        }
      }

      if (!match_flag) {
        console.log(`GamePaymentError3: no match Payment to Draw(${draw.draw_id}) Amount(${draw.pay_amount}${CoinCode})`)
      }
    }
  }
}

async function checkOperatorPayment(db, operator_account, draw_interval) {
  let sql = `SELECT * FROM BREAKDOWNS WHERE is_paid = false ORDER BY draw_id ASC, ticket_ledger_index ASC, ticket_tx_index ASC`
  let breakdowns = await dbAll(db, sql)
  for (let i = 0; i < breakdowns.length; i++) {
    const breakdown = breakdowns[i]
    if (breakdown.pay_tx_hash != '') {
      // verify pay_tx_hash exist? valid?
      sql = `SELECT * FROM OPERATOR_TXS WHERE tx_hash = '${breakdown.pay_tx_hash}' LIMIT 1`
      let breakdown_pay_tx = await dbGet(db, sql)
      if (breakdown_pay_tx != null) {
        if (breakdown_pay_tx.tx_type == TxType.Payment && breakdown_pay_tx.tx_result == TxResult.Success && breakdown_pay_tx.sour == operator_account && breakdown_pay_tx.dest == breakdown.address && dropsToXrp(breakdown_pay_tx.delivered_amount) == breakdown.amount_total) {
          sql = `UPDATE BREAKDOWNS SET is_paid = true, pay_fee_in_drop = ${breakdown_pay_tx.fee} WHERE ticket_tx_hash = '${breakdown.ticket_tx_hash}'`
          await dbRun(db, sql)
        } else {
          console.log(`BreakdownPayment: ${breakdown.pay_tx_hash} invalid...`)
        }
      } else {
        console.log(`BreakdownPayment: ${breakdown.pay_tx_hash} not exist...`)
      }
    } else {
      // try to link pay_tx and breakdown
      let close_ledger_index = parseInt(breakdown.draw_id.split('#')[1]) + draw_interval
      sql = `SELECT * FROM OPERATOR_TXS WHERE ledger_index >= ${close_ledger_index} AND tx_type = '${TxType.Payment}' AND tx_result = '${TxResult.Success}' AND sour = '${operator_account}' ORDER BY ledger_index ASC, tx_index ASC`
      let payments = await dbAll(db, sql)
      let match_flag = false

      for (let j = 0; j < payments.length; j++) {
        const payment = payments[j]
        let payment_memo = JSON.parse(payment.memos)
        let memo_data = payment_memo[0].MemoData
        memo_data = JSON.parse(memo_data)
        if (memo_data.TicketTxHash == breakdown.ticket_tx_hash) {
          if (payment.dest == breakdown.address && dropsToXrp(payment.delivered_amount) == breakdown.amount_total) {
            sql = `UPDATE BREAKDOWNS SET is_paid = true, pay_tx_hash = '${payment.tx_hash}', pay_fee_in_drop = ${payment.fee} WHERE ticket_tx_hash = '${breakdown.ticket_tx_hash}'`
            await dbRun(db, sql)
            console.log(`BreakdownPayment: Done Draw(${breakdown.draw_id}) Address(${breakdown.address}) TicketTxHash(${breakdown.ticket_tx_hash}) Amount(${breakdown.amount_total}${CoinCode})`)
            match_flag = true
            break
          } else {
            console.log(`BreakdownPayment: failure -- someting wrong`)
            console.log(breakdown)
            console.log(payment)
          }
        }
      }

      if (!match_flag) {
        console.log(`BreakdownPayment: no match Draw(${breakdown.draw_id}) Address(${breakdown.address}) TicketTxHash(${breakdown.ticket_tx_hash}) Amount(${breakdown.amount_total}${CoinCode})`)
      }
    }
  }
}

async function genDrawResult(db, open_ledger_index, close_ledger_index, init_pool_in_drop) {
  let draw_id = genDrawID(open_ledger_index)
  // get all valid payment in this draw
  let sql = `SELECT * FROM GAME_TXS WHERE tx_type = '${TxType.Payment}' AND tx_result = '${TxResult.Success}' AND dest = '${HashGame.GameAccount}' AND ledger_index >= ${open_ledger_index} AND ledger_index <= ${close_ledger_index} ORDER BY ledger_index ASC, tx_index ASC`
  let current_draw_payments = await dbAll(db, sql)

  // count: tickets, ticket_codes, income
  let tickets = []
  let ticket_codes = []
  let income_in_drop = 0
  for (let i = 0; i < current_draw_payments.length; i++) {
    const payment = current_draw_payments[i]
    let codes = JSON.parse(payment.ticket_codes)
    if (payment.ticket_code_count > 0) {
      tickets.push({
        Address: payment.sour,
        LedgerIndex: payment.ledger_index,
        TxIndex: payment.tx_index,
        TxHash: payment.tx_hash,
        DeliveredAmount: dropsToXrp(payment.delivered_amount),
        CodeCount: codes.length,
        Codes: codes
      })
      ticket_codes = ticket_codes.concat(codes)
    }
    income_in_drop = income_in_drop + payment.delivered_amount
  }

  // save tickets to file
  let draw_ticket_path = `.${DrawLogDir}/${HashGame.Name}-v${HashGame.Version}-${draw_id}-ticket.json`
  fs.writeFileSync(draw_ticket_path, JSON.stringify({
    DrawId: draw_id,
    OpenLedgerIndex: open_ledger_index,
    CloseLedgerIndex: close_ledger_index,
    Tickets: tickets
  }))

  // gen jackpot code
  let strDrawCodes = `${HashGame.Name}-v${HashGame.Version}-${draw_id}:${ticket_codes.join(',')}`
  let hashDrawCodes = SHA512(strDrawCodes)
  let jackpot_code = hashDrawCodes.substring(0, HashGame.JackpotCodeLength)

  // gen pool
  let income = Drop2FloorXRP(income_in_drop)

  let operating_fee = 0
  let ticket_code_count = ticket_codes.length
  if (ticket_code_count != 0) {
    let tmp_operating_fee = Math.floor(income * HashGame.OperatingFeeRateMax)
    operating_fee = tmp_operating_fee > HashGame.OperatingFeeMin ? tmp_operating_fee : HashGame.OperatingFeeMin
  }

  let pool_in_drop = init_pool_in_drop + income_in_drop - operating_fee * XRP2DropRate

  // breakdown: prize, jackpot
  let prize_count = 0
  let prize_total = 0
  let prize_breakdown = {}
  for (let i = 1; i <= HashGame.PrizeRank; i++) {
    prize_breakdown[`Rank#${i}`] = []
  }

  let jackpot_breakdown = []
  let pay_memos = []

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i]
    let pay_memo_json = {
      Address: ticket.Address,
      LedgerIndex: ticket.LedgerIndex,
      TxIndex: ticket.TxIndex,
      TxHash: ticket.TxHash,
      AmountTotal: 0,
      JackpotCount: 0,
      JackpotTotal: 0,
      JackpotBreakdown: [],
      PrizeCount: 0,
      PrizeTotal: 0,
      PrizeBreakdown: {}
    }
    for (let j = 0; j < ticket.CodeCount; j++) {
      const code = ticket.Codes[j]
      let match_count = 0
      for (let k = 1; k <= HashGame.JackpotCodeLength; k++) {
        if (code.substring(0, k) == jackpot_code.substring(0, k)) {
          match_count = match_count + 1
        } else {
          break
        }
      }
      if (match_count == HashGame.JackpotCodeLength) {
        jackpot_breakdown.push({
          Address: ticket.Address,
          TxHash: ticket.TxHash,
          CodeIndex: j
        })

        pay_memo_json.JackpotBreakdown.push({
          CodeIndex: j,
          Code: code
        })
        pay_memo_json.JackpotCount = pay_memo_json.JackpotCount + 1
      } else if (match_count >= HashGame.JackpotCodeLength - HashGame.PrizeRank) {
        let prize_rank = HashGame.JackpotCodeLength - match_count
        let prize_amount = FixedPrizeAmout[HashGame.PrizeRank - prize_rank]

        prize_count = prize_count + 1
        prize_total = prize_total + prize_amount
        prize_breakdown[`Rank#${prize_rank}`].push({
          Address: ticket.Address,
          TxHash: ticket.TxHash,
          CodeIndex: j,
          Code: code
        })

        pay_memo_json.PrizeCount = pay_memo_json.PrizeCount + 1
        pay_memo_json.PrizeTotal = pay_memo_json.PrizeTotal + prize_amount
        if (!pay_memo_json.PrizeBreakdown[`Rank#${prize_rank}`]) {
          pay_memo_json.PrizeBreakdown[`Rank#${prize_rank}`] = []
        }
        pay_memo_json.PrizeBreakdown[`Rank#${prize_rank}`].push({
          CodeIndex: j,
          Code: code
        })
      }
    }
    if (pay_memo_json.JackpotCount > 0 || pay_memo_json.PrizeCount > 0) {
      pay_memo_json.AmountTotal = pay_memo_json.PrizeTotal
      pay_memos.push(pay_memo_json)
    }
  }

  // gen draw result
  let jackpot_breakdown_length = jackpot_breakdown.length
  let jackpot_pool = Drop2FloorXRP(pool_in_drop - prize_total * XRP2DropRate)

  let jackpot_total
  let jackpot
  let pay_amount
  let residual_pool_in_drop
  if (jackpot_breakdown_length == 0) {
    jackpot = 0
    jackpot_total = 0
    pay_amount = operating_fee + prize_total
  } else {
    jackpot_total = Math.floor(jackpot_pool * HashGame.JackpotProportion)
    jackpot = Math.floor(jackpot_total / jackpot_breakdown_length)
    pay_amount = operating_fee + prize_total + jackpot_total

    for (let i = 0; i < pay_memos.length; i++) {
      const pay_memo = pay_memos[i]
      pay_memo.JackpotTotal = pay_memo.JackpotCount * jackpot
      pay_memo.AmountTotal = pay_memo.AmountTotal + pay_memo.JackpotTotal
      pay_memos[i] = pay_memo
    }
  }
  residual_pool_in_drop = pool_in_drop - (prize_total + jackpot_total) * XRP2DropRate

  let draw_result = {
    GameSetting: HashGame,
    PrizeSetting: FixedPrizeSetting,
    DrawInfo: {
      DrawId: draw_id,
      OpenLedgerIndex: open_ledger_index,
      CloseLedgerIndex: close_ledger_index,
      InitPool: Drop2FloorXRP(init_pool_in_drop),
      Income: income,
      OperatingFee: operating_fee,
      Pool: Drop2FloorXRP(pool_in_drop),
      TicketCodeCount: ticket_code_count,
      DrawTicketCodes: strDrawCodes,
      JackpotCode: jackpot_code,
      PrizeCount: prize_count,
      PrizeTotal: prize_total,
      JackpotCount: jackpot_breakdown_length,
      JackpotPool: jackpot_pool,
      JackpotTotal: jackpot_total,
      Jackpot: jackpot,
      PayAmount: pay_amount,
      ResidualPool: Drop2FloorXRP(residual_pool_in_drop),
    },
    JackpotBreakdown: jackpot_breakdown,
    PrizeBreakdown: prize_breakdown
  }

  // save pay_memos to file
  let pay_memos_path = `.${DrawLogDir}/${HashGame.Name}-v${HashGame.Version}-${draw_id}-pay_memo.json`
  fs.writeFileSync(pay_memos_path, JSON.stringify({
    DrawId: draw_id,
    OpenLedgerIndex: open_ledger_index,
    CloseLedgerIndex: close_ledger_index,
    JackpotCode: jackpot_code,
    Jackpot: jackpot,
    PayMemos: pay_memos
  }))

  // save pay_memos to db
  for (let i = 0; i < pay_memos.length; i++) {
    const pay_memo = pay_memos[i]
    sql = `INSERT INTO BREAKDOWNS (draw_id, ticket_ledger_index, ticket_tx_index, ticket_tx_hash, address, jackpot_breakdown, prize_breakdown, amount_total, is_paid, pay_tx_hash, pay_fee_in_drop)
      VALUES ('${draw_id}', ${pay_memo.LedgerIndex}, ${pay_memo.TxIndex}, '${pay_memo.TxHash}', '${pay_memo.Address}', '${JSON.stringify(pay_memo.JackpotBreakdown)}', '${JSON.stringify(pay_memo.PrizeBreakdown)}', ${pay_memo.AmountTotal}, false, '', 0)`
    await dbRun(db, sql)
  }

  // save draw result to file
  let draw_result_path = `.${DrawLogDir}/${HashGame.Name}-v${HashGame.Version}-${draw_id}.json`
  fs.writeFileSync(draw_result_path, JSON.stringify(draw_result))

  // save draw to db
  // residual_pool_in_drop will - pay_fee_in_drop(when the tx is done)
  sql = `INSERT INTO DRAWS (draw_id, open_ledger_index, close_ledger_index, init_pool_in_drop, income_in_drop, operating_fee, ticket_code_count, jackpot_code, prize_total, jackpot_total, pay_amount, residual_pool_in_drop, is_paid, pay_fee_in_drop, pay_tx_hash)
    VALUES ('${draw_result.DrawInfo.DrawId}', ${open_ledger_index}, ${close_ledger_index} , ${init_pool_in_drop}, ${income_in_drop}, ${draw_result.DrawInfo.OperatingFee}, ${draw_result.DrawInfo.TicketCodeCount}, '${draw_result.DrawInfo.JackpotCode}', ${draw_result.DrawInfo.PrizeTotal}, ${draw_result.DrawInfo.JackpotTotal}, ${draw_result.DrawInfo.PayAmount}, ${residual_pool_in_drop}, false, 0, '')`
  await dbRun(db, sql)
  return [draw_result, residual_pool_in_drop]
}

async function tryCloseOldDraw(db, RippledClosedLedgerIndex) {
  await checkGamePayment(db, HashGame.GameAccount, HashGame.OperatorAccount, HashGame.DrawLedgerInterval)
  await checkOperatorPayment(db, HashGame.OperatorAccount, HashGame.DrawLedgerInterval)
  let sql = `SELECT * FROM DRAWS ORDER BY open_ledger_index DESC LIMIT 1`
  let lastDraw = await dbGet(db, sql)
  if (lastDraw != null && lastDraw.is_paid == true) {
    // last draw is breakdown and paid, run next draw
    console.log(`DrawClosing22: XRP#${lastDraw.close_ledger_index} ...`)
    await closeDraw(db, lastDraw.close_ledger_index + 1, lastDraw.residual_pool_in_drop, RippledClosedLedgerIndex)
  }
}

async function closeDraw(db, open_ledger_index, init_pool_in_drop, RippledClosedLedgerIndex) {
  if (open_ledger_index > HashGame.CloseLedgerIndex) {
    console.log(`all draw in GameSetting is done...`)
    return
  }

  let close_ledger_index = open_ledger_index + HashGame.DrawLedgerInterval - 1

  if (RippledClosedLedgerIndex < close_ledger_index) {
    console.log(`current draw will close at ${close_ledger_index}, by now(${RippledClosedLedgerIndex}), need another ${close_ledger_index - RippledClosedLedgerIndex} ledger to close...`)
    return
  } else {
    let [draw_result, residual_pool_in_drop] = await genDrawResult(db, open_ledger_index, close_ledger_index, init_pool_in_drop)

    if (draw_result.DrawInfo.PayAmount == 0) {
      // save closed_draw
      let sql = `UPDATE DRAWS SET is_paid = true, pay_tx_hash = '', pay_fee_in_drop = 0 WHERE draw_id = '${draw_result.DrawInfo.DrawId}'`
      await dbRun(db, sql)
      console.log(`DrawClosed: ${draw_result.DrawInfo.DrawId} PayAmount: ${draw_result.DrawInfo.PayAmount}`)

      // next
      open_ledger_index = close_ledger_index + 1
      console.log(`DrawClosing3: XRP#${open_ledger_index} ...`)
      await closeDraw(db, open_ledger_index, residual_pool_in_drop, RippledClosedLedgerIndex)
    } else {
      console.log(`GamePaymentInfo2: Waiting2 Draw(XRP#${open_ledger_index}) ...`)
      await tryCloseOldDraw(db, RippledClosedLedgerIndex)
    }
  }
}

async function main() {
  await client.connect()

  if (!fs.existsSync(`.${DrawLogDir}`)) {
    fs.mkdirSync(`.${DrawLogDir}`)
  }

  let DB = new sqlite3.Database(DBPath)
  await initDB(DB)

  // fetch the most recently closed ledger
  let RippledClosedLedgerIndex = await fetchRecentClosedLedgerIndex(client)
  console.log(`RippldClosedLedgerIndex:`, RippledClosedLedgerIndex)
  // fetch all tx by now, and save to db
  // generate ticket codes
  await fetchGameAccountTx(client, DB, HashGame.GameAccount, HashGame.EpochLedgerIndex, HashGame.TicketPrice, HashGame.JackpotCodeLength)
  await fetchOperatorAccountTx(client, DB, HashGame.OperatorAccount)

  await checkGamePayment(DB, HashGame.GameAccount, HashGame.OperatorAccount, HashGame.DrawLedgerInterval)
  await checkOperatorPayment(DB, HashGame.OperatorAccount, HashGame.DrawLedgerInterval)

  let sql = `SELECT * FROM DRAWS WHERE is_paid = false ORDER BY open_ledger_index ASC LIMIT 1`
  let unPaidDraw = await dbGet(DB, sql)
  if (unPaidDraw == null) {
    sql = `SELECT * FROM DRAWS WHERE is_paid = true ORDER BY open_ledger_index DESC LIMIT 1`
    let lastPaidDraw = await dbGet(DB, sql)
    if (lastPaidDraw == null) {
      // draw in db is null, run draw from epoch
      let init_pool_in_drop = await calEpochPool(DB)
      console.log(`DrawClosing1: XRP#${HashGame.EpochLedgerIndex} ...`)
      await closeDraw(DB, HashGame.EpochLedgerIndex, init_pool_in_drop, RippledClosedLedgerIndex)
    } else {
      // all draw in db is breakdown and paid, run next draw
      console.log(`DrawClosing21: XRP#${lastPaidDraw.close_ledger_index} ...`)
      await closeDraw(DB, lastPaidDraw.close_ledger_index + 1, lastPaidDraw.residual_pool_in_drop, RippledClosedLedgerIndex)
    }
  } else {
    console.log(`GamePaymentInfo1: Waiting Draw(XRP#${unPaidDraw.open_ledger_index}) ...`)
  }

  DB.close()
  await client.disconnect()
}

main()