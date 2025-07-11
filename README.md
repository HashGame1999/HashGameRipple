## HashGame XRP@5  Introduction:
HashGame XRP@5 is a online blockchain-based game that's transparent, fair, and verifiable, offering the following advantages:
- Open & Verifiable: all game operations are running on xrpl, could be validated.
- High payout rate: 92% of all income will be used to payout, only 8% for operating.
- Massive jackpot: the jackpot cuts almost 50% of the prize pool.
- Big winnings: 4096 XRP, 256 XRP, 16 XRP for 1st, 2nd, 3rd prize respectively.
- High-Frequency breakdown: a draw consist of 10 thousand ledgers, less than half-day.
- In time payouts: the jackpot and other prize will be paid before next draw.

### Draw ID format: HashGame-XRP@5-v1.0#98000001
- XRP denotes all transactions shall be settled exclusively in XRP through xrpl.
- 5 denotes the JackpotCode length.
- 1.0 defines the version of game rules, more game rules detail at [Const.js](https://github.com/HashGame1999/HashGameRipple/blob/main/Const.js).
- 98000001 denotes this draw begins at xrp ledger#98000001.

## HashGame XRP@5  Rules:
- 1 XRP gets you a HashGame code, N XRP gets you N codes.
- Code generation is tied to payment transaction hash and is unpredictable.
- Jackpot code's generation is tied to entire codes of a draw, which means ever code will affect the final jackpot code, and is totally unpredictable.

## How to play:
### Buy game code:
-  **GameAccount**(**rXRP75idnwWTuukPeSkpbeeKGkhyysVW8**)
- Draw#98000001 is composed of xrp ledger from 98000001 to ~TODO,
- During those ledger, payment to the **GameAccount** will get a ticket.
- A ticket of N code will be generated for a payment larger than N XRP , for example: 
	- Payment of 1 XRP gets 1 code: first 5 character of payment tx_hash
	- Payment of 3 XRP gets 3 code:
		- First code: first 5 character of payment tx_hash
		- Second code:  first 5 character of hash(payment tx_hash)
		- Third code:  first 5 character of hash(hash(payment tx_hash))
	- ...

### Win prize:
- 3rd prize: frist 2 characters your code are the same with **JakepotCode**.
- 2nd prize: frist 3 characters.
- 1st prize: frist 4 characters.
- Jackpot: your code is the same with **JakepotCode**.

### Invite friend: 
Just tell your friend to set source_tag of first payment transaction to your referral-number.

## Promotional Plans
### Shareholder Plan: 
Any XRP holder who send 10000 XRP to **rBoy4AAAAA9qxv7WANSdP5j5y59NP6soJS** before XRP Ledger#98000000 becomes our shareholder, participate in annual dividends.

### Early bird Plan:
- First player buys 10 code get 160 XRP(from operating fee) award.
- First player buys 100 codes get 800 XRP(from operating fee) award.
- First player buys 1,000 codes get 4000 XRP(from operating fee) award.
- First player buys 10,000 codes get 20,000 XRP(from operating fee) award.
- First player buys 100,000 codes get 100,000 XRP(from operating fee) award.
### Invitation Plan:
- Player who buys 10 codes unlocks H1(short for HashOne) partnership with a unique referral-number; 100 codes unlocks H2 partnership ; 1,000 codes unlocks H3 partnership.
- You and your referral players buy 10,000 codes unlocks H4 partnership; 100,000 codes unlocks H5 partnership.
- Hx partner: earn x XRP(from operating fee) commission for every 100 codes your referral players buy.

## Validate
just run validator.js :
1. Codes: get all the codes of a draw.
2. **JakepotCode**: generate first 5 character of hash(draw_id + codes)
3. Breakdown: calculate total prize amount of every ticket, because one ticket may win several prizes.
4. **GameAccount** to **OperatingAccount**: send operating fee and prize of the draw in one transaction.
5. **OperatingAccount** pay players: distribute prize to ticket account in chronological order.

more details and validator programm at https://github.com/HashGame1999/HashGameRipple
