import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const code = ts.transpileModule(await readFile(new URL('../lib/payment-followups.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { paymentFollowups } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const booking = (fields = {}) => ({ id:'booking', roomTotalPaisa:1000000, extras:[], status:'checked_out', dueDate:'2026-10-30', payer:'guest', ...fields });
const state = (reservation, transactions = []) => ({ reservations:[reservation], transactions });
test('checkout balance triggers an alert immediately even when payment due date is later', () => {
  const rows=paymentFollowups(state(booking()), '2026-10-15');
  assert.equal(rows.length,1);assert.equal(rows[0].missed,true);assert.deepEqual(rows[0].reasons,['Unpaid checkout']);
});
test('corporate amounts join missed payments and a booking is not counted twice', () => {
  const rows=paymentFollowups(state(booking({payer:'company',dueDate:'2026-10-14'})), '2026-10-15');
  assert.equal(rows.length,1);assert.equal(rows[0].due,1000000);assert.equal(rows[0].companyDue,1000000);assert.equal(rows[0].reasons.length,3);
  assert.equal(paymentFollowups(state(booking({payer:'company',status:'reserved'})), '2026-10-15')[0].missed,true);
});
test('partial receipts reduce the alarm and full settlement clears it, refunds restore the balance', () => {
  const receipt={reservationId:'booking',kind:'payment',amountPaisa:400000,payer:'company'};
  const full={...receipt,amountPaisa:1000000};
  assert.equal(paymentFollowups(state(booking({payer:'company'}),[receipt]),'2026-10-15')[0].companyDue,600000);
  assert.deepEqual(paymentFollowups(state(booking({payer:'company'}),[full]),'2026-10-15'),[]);
  assert.equal(paymentFollowups(state(booking({payer:'company'}),[full,{...receipt,kind:'refund',amountPaisa:100000}]),'2026-10-15')[0].due,100000);
});
test('ordinary future guest balances and cancellations are not mislabeled as missed', () => {
  assert.equal(paymentFollowups(state(booking({status:'reserved'})),'2026-10-15')[0].missed,false);
  const row=paymentFollowups(state(booking({status:'cancelled',payer:'company',dueDate:'2026-10-01'})),'2026-10-15')[0];
  assert.equal(row.missed,false);assert.equal(row.review,true);
});

test('a company credit does not mask unpaid guest extras at checkout', () => {
  const r=booking({payer:'company',roomTotalPaisa:500000,extras:[{amountPaisa:200000}]});
  const rows=paymentFollowups(state(r,[{reservationId:'booking',kind:'payment',payer:'company',amountPaisa:1000000}]),'2026-10-15');
  assert.equal(rows[0].due,200000);assert.equal(rows[0].companyDue,-500000);assert.equal(rows[0].missed,true);
  assert.deepEqual(rows[0].reasons,['Unpaid checkout']);
});
