import { z } from 'zod';
export const iso=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,'Use a real YYYY-MM-DD calendar date');
const number=v=>Number(v)||0;
export function paid(s){const amount=number(s.amount);return s.pay_status==='done'?amount:s.pay_status==='part'?Math.min(amount,Math.max(0,number(s.part_paid))):0}
export function publicShoot(s){return {id:s.id,name:s.name,date:s.date,event:s.event,session:s.session,location:s.location,company:s.company,notes:s.notes,amount:number(s.amount),paid:paid(s),pending:Math.max(0,number(s.amount)-paid(s)),payment_status:s.pay_status,booking_status:s.booking_status}}
export function visibleShoot(s,scopes=[]){const item=publicShoot(s);if(!scopes.includes('payments:read')){delete item.amount;delete item.paid;delete item.pending;delete item.payment_status;}return item;}
export function indiaDate(now=Date.now()){return new Date(now+330*60000).toISOString().slice(0,10)}
