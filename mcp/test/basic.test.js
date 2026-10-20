import test from 'node:test';
import assert from 'node:assert/strict';
import {iso,paid,publicShoot,visibleShoot} from '../src/index.js';

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
