import { iso, publicShoot, visibleShoot, indiaDate, ownedShoot, ownerFilter } from './shoot-utils.js';
import { authorize, createProvider } from './oauth.js';
import { insufficientScope } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
const READ_ONLY={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};

// MCP access is authenticated by the OAuth resource handler; Supabase JWTs never come from AI clients.
const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
const err = (message) => ({content:[{type:'text',text:message}],isError:true});
// Structured output lets capable MCP clients render cards, while text remains compatible with every client.
const result = (data) => ({content:[{type:'text',text:JSON.stringify(data,null,2)}],structuredContent:data});
async function db(env,auth,path,options={}){
 const response=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{...options,headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+auth.token,'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});
 const body=await response.text();
 if(!response.ok)throw new Error('Sakkhi request failed (HTTP '+response.status+').');
 return body?JSON.parse(body):null;
}
const owner = auth => ownerFilter(auth.userId);
async function shoots(env,auth){
 const all=[];
 const pageSize=500;
 for(let offset=0;offset<50000;offset+=pageSize){
  const rows=await db(env,auth,'shoots?'+owner(auth)+'&select=*&order=date.asc,id.asc&limit='+pageSize+'&offset='+offset);
  if(!Array.isArray(rows))throw new Error('Unexpected shoot response');
  if(rows.some(row=>!ownedShoot(row,auth.userId)))throw new Error('Ownership validation failed');
  all.push(...rows);
  if(rows.length<pageSize)return all;
 }
 throw new Error('Shoot collection exceeds the supported limit; no partial summary returned');
}
async function ownedEdits(env,auth){
 const all=[];const size=500;
 for(let offset=0;offset<50000;offset+=size){
  const rows=await db(env,auth,'edits?'+owner(auth)+'&select=*&order=date.desc,id.asc&limit='+size+'&offset='+offset);
  if(!Array.isArray(rows)||rows.some(r=>r.user_id!==auth.userId))throw new Error('Editing ownership validation failed');
  all.push(...rows);if(rows.length<size)return all;
 }
 throw new Error('Editing collection exceeds supported limit');
}
async function companySettings(env,auth){
 const rows=await db(env,auth,'settings?'+owner(auth)+'&select=key,value&limit=1000');
 if(!Array.isArray(rows))throw new Error('Unexpected settings response');
 return rows;
}
function companyNames(rows,auth){
 const row=rows.find(r=>r.key===auth.userId+'_companies'||r.key==='companies');
 const list=Array.isArray(row?.value)?row.value:[];
 return list.map(c=>typeof c==='string'?c:c?.name).filter(n=>typeof n==='string'&&n.trim());
}
function portalCode(userId,name,ledger=false){
 let hash=0;const str=userId+name+(ledger?'_ledger':'');
 for(let i=0;i<str.length;i++){hash=((hash<<5)-hash)+str.charCodeAt(i);hash|=0}
 return Math.abs(hash).toString(36);
}
function serverFor(env,auth,scopes=[]){
 const visible = s => visibleShoot(s,scopes);
 const server=new McpServer({name:'sakkhi-solo',version:'0.1.0'});
 server.registerTool('get_shoots',{description:'List signed-in Sakkhi shoots with dates, sessions and locations. Includes amounts, received and pending payment ONLY when payments:read was approved. For revenue and totals use get_financial_overview when available.',annotations:READ_ONLY,inputSchema:{from:iso.optional(),to:iso.optional(),limit:z.number().int().min(1).max(200).default(50)}},async({from,to,limit})=>{try{let rows=await shoots(env,auth);if(from)rows=rows.filter(s=>s.date>=from);if(to)rows=rows.filter(s=>s.date<=to);return result({view:'shoot_list',title:'Your shoots',total:rows.length,timezone:'Asia/Kolkata',shoots:rows.slice(0,limit).map(visible)})}catch(e){return err(e.message)}});
 server.registerTool('get_next_shoot',{description:'Find the next upcoming shoot in the signed-in Solo account.',annotations:READ_ONLY,inputSchema:{}},async()=>{try{const today=indiaDate();const next=(await shoots(env,auth)).find(s=>s.date>=today&&s.booking_status!=='cancelled');return result({view:'shoot_card',title:'Your next shoot',timezone:'Asia/Kolkata',as_of:today,shoot:next?visible(next):null})}catch(e){return err(e.message)}});
 server.registerTool('get_shoot_details',{description:'Get a single shoot by its Sakkhi ID, restricted to the authenticated user.',annotations:READ_ONLY,inputSchema:{id:z.string().min(1).max(120)}},async({id})=>{try{const rows=await db(env,auth,'shoots?'+owner(auth)+'&id=eq.'+encodeURIComponent(id)+'&select=*&limit=1');if(!Array.isArray(rows)||rows.some(row=>!ownedShoot(row,auth.userId)))throw new Error('Ownership validation failed');return result({view:'shoot_card',title:'Shoot details',timezone:'Asia/Kolkata',shoot:rows[0]?visible(rows[0]):null})}catch(e){return err(e.message)}});
 function editingView(e){
  const amount=Number(e.amount||0),paid=e.pay_status==='done'?amount:e.pay_status==='part'?Number(e.part_paid||0):0;
  const job={id:e.id,client_name:e.client_name,company_name:e.company_name,date:e.date,job_type:e.job_type,event_name:e.event_name,work_status:e.work_status??null,work_status_label:e.work_status==='completed'?'Completed':e.work_status==='pending'?'Pending':e.work_status==='inprogress'?'In progress':e.work_status??'Not set',created:e.created};
  if(scopes.includes('payments:read'))Object.assign(job,{currency:'INR',amount,paid,pending:Math.max(0,amount-paid),pay_status:e.pay_status,part_paid:Number(e.part_paid||0)});
  return job;
 }
 server.registerTool('get_editing_jobs',{description:'READ ONLY: List Editing & Albums jobs (not just shoots). ALWAYS show work_status and work_status_label. When payments:read is approved, ALWAYS show amount, paid, pending and pay_status for every job. Use get_connection_permissions if payment amounts are absent. Never modify data.',annotations:READ_ONLY,inputSchema:{limit:z.number().int().min(1).max(200).default(100),status:z.string().max(80).optional()}},async({limit,status})=>{try{let rows=await ownedEdits(env,auth);if(status)rows=rows.filter(e=>e.work_status===status);const jobs=rows.slice(0,limit).map(editingView);return result({view:'editing_jobs',title:'Editing & Albums',total:rows.length,payment_access:scopes.includes('payments:read'),currency:scopes.includes('payments:read')?'INR':undefined,summary:{completed:rows.filter(e=>e.work_status==='completed').length,in_progress:rows.filter(e=>e.work_status!=='completed').length,...(scopes.includes('payments:read')?{total_amount:rows.reduce((n,e)=>n+Number(e.amount||0),0),received:rows.reduce((n,e)=>n+(e.pay_status==='done'?Number(e.amount||0):e.pay_status==='part'?Number(e.part_paid||0):0),0)}:{})},jobs})}catch(e){return err(e.message)}});
 server.registerTool('get_editing_job_details',{description:'READ ONLY: Show the work status and, when payments:read is approved, the amount, received and pending payment for one owned Editing & Albums job.',annotations:READ_ONLY,inputSchema:{id:z.string().min(1).max(120)}},async({id})=>{try{const rows=await db(env,auth,'edits?'+owner(auth)+'&id=eq.'+encodeURIComponent(id)+'&select=*&limit=1');if(!Array.isArray(rows)||rows.some(e=>e.user_id!==auth.userId))throw new Error('Editing ownership validation failed');return result({view:'editing_job',title:'Editing job details',payment_access:scopes.includes('payments:read'),job:rows[0]?editingView(rows[0]):null})}catch(e){return err(e.message)}});
 server.registerTool('get_company_portal_links',{description:'READ ONLY: Find the exact Booking Link and Ledger Link for a company in Accounts Management → Company Studios. "Lecture link" means Ledger Link. Return the saved URL only if its corresponding portal record exists; do not invent or create links. Company matching is case-insensitive.',annotations:READ_ONLY,inputSchema:{company:z.string().min(1).max(200)}},async({company})=>{try{
 const rows=await companySettings(env,auth),names=companyNames(rows,auth),matches=names.filter(n=>n.trim().toLowerCase()===company.trim().toLowerCase());
 if(matches.length!==1)return result({company:company,found:false,message:'No exact matching company in this account; check its name in Company Studios.'});
 const name=matches[0],booking=portalCode(auth.userId,name),ledger=portalCode(auth.userId,name,true);
 const saved=(prefix,code)=>rows.some(r=>(r.key===prefix+code||r.key===auth.userId+'_'+prefix+code)&&r.value?.u===auth.userId&&(r.value?.s===name||r.value?.c===name));
 return result({company:name,booking_link:saved('link_',booking)?'https://sakkhi.co.in/booking?ref='+booking:null,ledger_link:saved('ledger_',ledger)?'https://sakkhi.co.in/ledger?ref='+ledger:null,note:'Only already-saved portal links are returned. Open Company Studios to generate or sync a missing link.'});
 }catch(e){return err(e.message)}});
 server.registerTool('get_connection_permissions',{description:'Check which Sakkhi permissions this AI connection has. Call this when revenue or payment amounts appear unavailable. This never returns secrets.',annotations:READ_ONLY,inputSchema:{}},async()=>result({shoots_read:scopes.includes('shoots:read'),payments_read:scopes.includes('payments:read'),summary_read:scopes.includes('summary:read'),editing_read:scopes.includes('shoots:read'),company_portal_links_read:scopes.includes('shoots:read'),writes:false,help:scopes.includes('payments:read')?'Payment access is enabled. Use get_monthly_finances or get_financial_overview.':'Payment access was not approved for this connection. Disconnect and reconnect Sakkhi, and approve View payment amounts if offered. Deployment alone cannot change previously granted permissions.'}));
 if(scopes.includes('payments:read')) server.registerTool('get_monthly_finances',{description:'READ ONLY: Answer how much I made last month or in a given calendar month. Returns booked shoot value, payments recorded on those shoots, outstanding balance, and shoot details. Note: payments are attributed to shoot month, NOT transaction receipt date; Sakkhi shoots records do not provide a payment transaction ledger here.',annotations:READ_ONLY,inputSchema:{year:z.number().int().min(2000).max(2200),month:z.number().int().min(1).max(12)}},async({year,month})=>{try{const prefix=String(year)+'-'+String(month).padStart(2,'0')+'-';const rows=(await shoots(env,auth)).filter(s=>String(s.date||'').startsWith(prefix)).map(publicShoot);return result({view:'monthly_finances',title:'Shoot finances for '+prefix.slice(0,7),period:prefix.slice(0,7),currency:'INR',accounting_basis:'Shoot date, not payment receipt date',shoot_count:rows.length,booked_amount:rows.reduce((n,s)=>n+s.amount,0),received_against_these_shoots:rows.reduce((n,s)=>n+s.paid,0),remaining_balance:rows.reduce((n,s)=>n+s.pending,0),shoots:rows})}catch(e){return err(e.message)}});
 if(scopes.includes('payments:read')) server.registerTool('get_financial_overview',{description:'READ ONLY: Show my revenue, total booked shoot amounts, money received, outstanding payments and upcoming balances for a selected year or all shoots. Use this when the user asks how much they earned, revenue, income, total amount, payments or balances. Never changes records.',annotations:READ_ONLY,inputSchema:{year:z.number().int().min(2000).max(2200).optional()}},async({year})=>{try{const today=indiaDate();let rows=(await shoots(env,auth)).map(publicShoot);if(year!==undefined)rows=rows.filter(s=>String(s.date||'').startsWith(String(year)));return result({view:'financial_overview',title:year?'Financial overview '+year:'Financial overview',year:year??null,currency:'INR',timezone:'Asia/Kolkata',as_of:today,shoot_count:rows.length,booked_amount:rows.reduce((n,s)=>n+s.amount,0),received:rows.reduce((n,s)=>n+s.paid,0),pending_completed_shoots:rows.filter(s=>s.date<today).reduce((n,s)=>n+s.pending,0),upcoming_balance_not_yet_due:rows.filter(s=>s.date>=today).reduce((n,s)=>n+s.pending,0)})}catch(e){return err(e.message)}});
 if(scopes.includes('payments:read')) server.registerTool('get_pending_payments',{description:'List payments still due on COMPLETED shoots (date before today) and the total due, matching the Due figure in the Sakkhi dashboard. Balances on upcoming shoots are reported separately because clients pay after the shoot.',annotations:READ_ONLY,inputSchema:{limit:z.number().int().min(1).max(200).default(100)}},async({limit})=>{try{const today=indiaDate();const owing=(await shoots(env,auth)).map(publicShoot).filter(s=>s.pending>0);const rows=owing.filter(s=>s.date<today);const upcoming=owing.filter(s=>s.date>=today);return result({view:'payment_summary',title:'Pending payments',currency:'INR',timezone:'Asia/Kolkata',as_of:today,total_pending:rows.reduce((n,s)=>n+s.pending,0),count:rows.length,upcoming_balance_not_yet_due:upcoming.reduce((n,s)=>n+s.pending,0),shoots:rows.slice(0,limit)})}catch(e){return err(e.message)}});
 if(scopes.includes('summary:read') && scopes.includes('payments:read')) server.registerTool('get_year_summary',{description:'Summarise a calendar year of shoots, booked amounts, received payments and outstanding dues. Dues count completed shoots only (same as the Sakkhi dashboard); balances on upcoming shoots are reported separately.',annotations:READ_ONLY,inputSchema:{year:z.number().int().min(2000).max(2200)}},async({year})=>{try{const today=indiaDate();const rows=(await shoots(env,auth)).filter(s=>String(s.date||'').startsWith(String(year))).map(publicShoot);return result({view:'year_summary',title:'Year summary',year,currency:'INR',timezone:'Asia/Kolkata',shoot_count:rows.length,booked_amount:rows.reduce((n,s)=>n+s.amount,0),received:rows.reduce((n,s)=>n+s.paid,0),pending:rows.filter(s=>s.date<today).reduce((n,s)=>n+s.pending,0),upcoming_balance_not_yet_due:rows.filter(s=>s.date>=today).reduce((n,s)=>n+s.pending,0),by_event:Object.entries(rows.reduce((a,s)=>(a[s.event||'Other']=(a[s.event||'Other']||0)+1,a),{})).map(([event,count])=>({event,count}))})}catch(e){return err(e.message)}});

 return server;
}
const apiHandler={
 async fetch(request,env,ctx){
  if(env.ENABLE_MCP_SERVER!=='true')return json({error:'Sakkhi MCP not enabled'},503);
  if(!Array.isArray(ctx.auth?.scope))return json({error:'Invalid authorization'},403);
  if(!ctx.auth.scope.includes('shoots:read'))return insufficientScope(ctx.auth,['shoots:read']);
  const p=ctx.props;
  if(!p?.userId||!p.supabaseAccessToken||!Number.isFinite(p.supabaseExpiresAt)||Date.now()>p.supabaseExpiresAt-10000)return json({error:'Sakkhi session expired. Reconnect your account.'},401);
  if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY)return json({error:'MCP configuration incomplete'},503);
  const verified=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+p.supabaseAccessToken},cache:'no-store'});
  if(!verified.ok)return json({error:'Sakkhi session expired. Reconnect your account.'},401);
  const user=await verified.json();if(!user.id||user.is_anonymous||user.id!==p.userId)return json({error:'Identity mismatch'},403);
  const auth={userId:p.userId,token:p.supabaseAccessToken};
  const server=serverFor(env,auth,ctx.auth.scope);
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try{await server.connect(transport);return await transport.handleRequest(request)}catch(e){return json({jsonrpc:'2.0',error:{code:-32603,message:'Internal MCP error'},id:null},500)}finally{ctx.waitUntil(server.close())}
 }
};
const defaultHandler={
 fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/authorize')return authorize(request,env);
  if(path==='/health')return json({service:'sakkhi-solo-mcp',enabled:env.ENABLE_MCP_SERVER==='true',oauth:true,signIn:'google',writes:false});
  if(path==='/')return json({service:'sakkhi-solo-mcp',mcp:'/mcp',docs:'https://sakkhi.co.in'});
  return json({error:'Not found'},404);
 }
};
export default createProvider(apiHandler,defaultHandler);
