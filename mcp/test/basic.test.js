import test from 'node:test';
import assert from 'node:assert/strict';
import {iso,paid,publicShoot,visibleShoot,indiaDate,ownedShoot,ownedShoots,ownerFilter} from '../src/shoot-utils.js';

test('rejects impossible dates',()=>{
 assert.equal(iso.safeParse('2026-02-30').success,false);
 assert.equal(iso.safeParse('2026-02-28').success,true);
 assert.equal(iso.safeParse('2026-2-8').success,false);
});
test('payment calculations never exceed invoice',()=>{
 assert.equal(paid({amount:10000,pay_status:'part',part_paid:20000}),10000);
 assert.equal(paid({amount:10000,pay_status:'part',part_paid:-500}),0);
 assert.equal(paid({amount:10000,pay_status:'done'}),10000);
});
test('shoots read scope does not expose financial fields',()=>{
 const s={id:'1',name:'Wedding',amount:10000,pay_status:'part',part_paid:2000};
 const item=visibleShoot(s,['shoots:read']);
 for(const field of ['amount','paid','pending','payment_status'])assert.equal(Object.hasOwn(item,field),false);
 const financial=visibleShoot(s,['shoots:read','payments:read']);
 assert.equal(financial.pending,8000);
 assert.equal(publicShoot(s).paid,2000);
});

test('India local date is stable across UTC midnight',()=>{
 assert.equal(indiaDate(Date.parse('2026-10-19T19:00:00Z')),'2026-10-20');
 assert.equal(indiaDate(Date.parse('2026-10-19T18:00:00Z')),'2026-10-19');
});

test('account isolation rejects another user even with a broader admin database policy',()=>{
 const rows=[{id:'a',user_id:'user-a',name:'A'},{id:'b',user_id:'user-b',name:'B'}];
 assert.deepEqual(ownedShoots(rows,'user-a').map(x=>x.id),['a']);
 assert.equal(ownedShoot(rows[1],'user-a'),false);
 assert.equal(ownedShoot(rows[0],'user-a'),true);
 assert.equal(ownedShoot(rows[0],''),false);
 assert.equal(ownerFilter('user-a'),'user_id=eq.user-a');
 assert.throws(()=>ownerFilter(''));
});

test('malformed financial values cannot generate negative or non-finite totals',()=>{
 for(const amount of ['Infinity','not-a-number',-200]){
  const item=publicShoot({amount,pay_status:'part',part_paid:'Infinity'});
  for(const key of ['amount','paid','pending'])assert.ok(Number.isFinite(item[key])&&item[key]>=0);
 }
});
