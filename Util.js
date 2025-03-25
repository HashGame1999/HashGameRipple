import crypto from 'crypto'
import xrpl, { xrpToDrops, convertStringToHex } from 'xrpl'
import { CoinCode, XRP2DropRate, TxType, RippleEpoch } from './Const.js'

async function dbAll(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, items) => {
      if (err) {
        console.log(sql)
        console.log(err)
        reject(err)
      } else {
        resolve(items)
      }
    })
  })
}

async function dbGet(db, sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, (err, item) => {
      if (err) {
        console.log(sql)
        console.log(err)
        reject(err)
      } else {
        resolve(item)
      }
    })
  })
}

async function dbRun(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, err => {
      if (err) {
        console.log(sql)
        console.log(err)
        reject(err)
      } else {
        resolve(true)
      }
    })
  })
}

function SHA512(str) {
  let hash = crypto.createHash("sha512")
  hash.update(str)
  return hash.digest('hex').toUpperCase()
}

function genUnixTimestamp(ripple_time) {
  let unixTimestamp = ripple_time + RippleEpoch
  unixTimestamp = new Date(unixTimestamp * 1000)
  return unixTimestamp
}

// #3 -> #2 -> #1
function genFixedPrizeAmount(jackpot_code_length, ticket_price, prize_rank, prize_rank_weight) {
  let lowest_match = jackpot_code_length - prize_rank
  let lowest_prize = ticket_price * prize_rank_weight ** (lowest_match - 1)
  let prize_amount_list = [lowest_prize]
  for (let i = 1; i < prize_rank; i++) {
    prize_amount_list.push(prize_amount_list[prize_amount_list.length - 1] * prize_rank_weight)
  }
  return prize_amount_list
}

function genFixedPrizeSetting(jackpot_code_length, fixed_prize_amount) {
  let json = {}
  let fixed_prize_amount_length = fixed_prize_amount.length
  for (let i = fixed_prize_amount_length; i > 0; i--) {
    const prize = fixed_prize_amount[i - 1]
    const prize_rank = fixed_prize_amount_length - i + 1
    json[`Rank#${prize_rank}`] = {
      MatchCodeLength: jackpot_code_length - prize_rank,
      Amount: `${prize}${CoinCode}`
    }
  }
  return json
}

function genTicketCode(tx_hash, payment_amount, ticket_price, jackpot_code_length) {
  payment_amount = payment_amount / XRP2DropRate
  let ticket_code_count = Math.floor(payment_amount / ticket_price)
  let ticket_codes = []
  if (ticket_code_count > 0) {
    ticket_codes.push(tx_hash.substring(0, jackpot_code_length))
    let prev_hash = tx_hash
    for (let i = 1; i < ticket_code_count; i++) {
      let current_hash = SHA512(prev_hash)
      ticket_codes.push(current_hash.substring(0, jackpot_code_length))
      prev_hash = current_hash
    }
  }
  return [ticket_code_count, ticket_codes]
}

function Drop2FloorXRP(drop) {
  return Math.floor(drop / XRP2DropRate)
}

async function PayXRP(client, wallet, sour, dest, amount, memo_json) {
  try {
    let transaction
    if (memo_json != null) {
      transaction = await client.autofill({
        TransactionType: TxType.Payment,
        Account: sour,
        Destination: dest,
        Amount: xrpToDrops(amount),
        Fee: '12',
        Memos: [
          {
            Memo: {
              // MemoType: convertStringToHex('no use'),
              MemoData: convertStringToHex(JSON.stringify(memo_json)),
              MemoFormat: convertStringToHex('application/json')
            }
          }
        ]
      })
    } else {
      transaction = await client.autofill({
        TransactionType: TxType.Payment,
        Account: sour,
        Destination: dest,
        Amount: xrpToDrops(amount),
        Fee: '12'
      })
    }
    const signed = wallet.sign(transaction)
    const tx_blob = signed.tx_blob

    const submitRequest = {
      api_version: xrpl.RIPPLED_API_V2,
      command: 'submit',
      tx_blob: tx_blob,
      ledger_index: 'current'
    }
    const response = await client.request(submitRequest)
    // console.log(response)
    return response
  } catch (error) {
    console.error('send xrp failure:', error)
  }
}

async function fetchRecentClosedLedgerIndex(client) {
  const response = await client.request({
    command: 'ledger_closed'
  })
  let ledger_index = response.result.ledger_index
  return ledger_index
}

export {
  dbGet,
  dbAll,
  dbRun,
  SHA512,
  genUnixTimestamp,
  genFixedPrizeAmount,
  genFixedPrizeSetting,
  genTicketCode,
  Drop2FloorXRP,
  fetchRecentClosedLedgerIndex,
  PayXRP
}