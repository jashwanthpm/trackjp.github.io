import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

// The supplied bearer is a real Supabase Auth access token, never an API key.
// Production public multi-user AI connections additionally need an OAuth authorization server.
const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
const err = (message) => ({content:[{type:'text',text:message}],isError:true});
const result = (data) => ({content:[{type:'text',text:JSON.stringify(data,null,2)}]});
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const max = (v,n=100) => String(v??'').slice(0,n);
const number = v => Number(v)||0;
function paid(s){const amount=number(s.amount);return s.pay_status==='done'?amount:s.pay_status==='part'?Math.min(amount,Math.max(0,number(s.part_paid))):0}
function publicShoot(s){return {id:s.id,name:s.name,date:s.date,event:s.event,session:s.session,location:s.location,company:s.company,notes:s.notes,amount:number(s.amount),paid:paid(s),pending:Math.max(0,number(s.amount)-paid(s)),payment_status:s.pay_status,booking_status:s.booking_status}}
async function authenticate(request,env){
 const header=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(header))throw new Error('A Sakkhi Supabase access token is required.');
 const token=header.replace(/^Bearer\s+/i,'').trim();
 const res=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+token},cache:'no-store'});
 if(!res.ok)throw new Error('Invalid or expired Sakkhi session. Reconnect your account.');
 const user=await res.json();if(!user.id || user.is_anonymous)throw new Error('A signed-in Sakkhi account is required.');
 return {token,userId:user.id};
}
async function db(env,auth,path,options={}){
 const response=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{...options,headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+auth.token,'Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});
 const body=await response.text();
 if(!response.ok)throw new Error('Sakkhi request failed ('+response.status+'): '+body.slice(0,300));
 return body?JSON.parse(body):null;
}
const owner = auth => 'user_id=eq.'+encodeURIComponent(auth.userId);
async function shoots(env,auth){return await db(env,auth,'shoots?'+owner(auth)+'&select=*&order=date.asc&limit=5000')}
function serverFor(env,auth){
 const server=new McpServer({name:'sakkhi-solo',version:'0.1.0'});
 server.registerTool('get_shoots',{description:'List this signed-in Sakkhi Solo user’s shoots, optionally within a date range.',inputSchema:{from:iso.optional(),to:iso.optional(),limit:z.number().int().min(1).max(200).default(50)}},async({from,to,limit})=>{try{let rows=await shoots(env,auth);if(from)rows=rows.filter(s=>s.date>=from);if(to)rows=rows.filter(s=>s.date<=to);return result({total:rows.length,shoots:rows.slice(0,limit).map(publicShoot)})}catch(e){return err(e.message)}});
 server.registerTool('get_next_shoot',{description:'Find the next upcoming shoot in the signed-in Solo account.',inputSchema:{}},async()=>{try{const today=new Date().toISOString().slice(0,10);const next=(await shoots(env,auth)).find(s=>s.date>=today&&s.booking_status!=='cancelled');return result({as_of:today,shoot:next?publicShoot(next):null})}catch(e){return err(e.message)}});
 server.registerTool('get_shoot_details',{description:'Get a single shoot by its Sakkhi ID, restricted to the authenticated user.',inputSchema:{id:z.string().min(1).max(120)}},async({id})=>{try{const rows=await db(env,auth,'shoots?'+owner(auth)+'&id=eq.'+encodeURIComponent(id)+'&select=*&limit=1');return result({shoot:rows[0]?publicShoot(rows[0]):null})}catch(e){return err(e.message)}});
 server.registerTool('get_pending_payments',{description:'List outstanding shoot payments and total due for this Solo user.',inputSchema:{limit:z.number().int().min(1).max(200).default(100)}},async({limit})=>{try{const rows=(await shoots(env,auth)).map(publicShoot).filter(s=>s.pending>0);return result({currency:'INR',total_pending:rows.reduce((n,s)=>n+s.pending,0),count:rows.length,shoots:rows.slice(0,limit)})}catch(e){return err(e.message)}});
 server.registerTool('get_year_summary',{description:'Summarise a calendar year of shoots, invoiced amounts, received payments, and outstanding dues.',inputSchema:{year:z.number().int().min(2000).max(2200)}},async({year})=>{try{const rows=(await shoots(env,auth)).filter(s=>String(s.date||'').startsWith(String(year))).map(publicShoot);return result({year,currency:'INR',shoot_count:rows.length,booked_amount:rows.reduce((n,s)=>n+s.amount,0),received:rows.reduce((n,s)=>n+s.paid,0),pending:rows.reduce((n,s)=>n+s.pending,0),by_event:Object.entries(rows.reduce((a,s)=>(a[s.event||'Other']=(a[s.event||'Other']||0)+1,a),{})).map(([event,count])=>({event,count}))})}catch(e){return err(e.message)}});
 server.registerTool('create_shoot',{description:'Create a shoot in this user’s Sakkhi Solo account. This changes real data: obtain the user’s explicit confirmation before calling.',inputSchema:{name:z.string().min(1).max(160),date:iso,event:z.string().min(1).max(100),session:z.string().max(100).default('Full Day'),location:z.string().max(200).default(''),company:z.string().max(160).default(''),notes:z.string().max(1500).default(''),amount:z.number().min(0).max(100000000).default(0)}},async(input)=>{try{const record={id:'mcp_'+crypto.randomUUID(),user_id:auth.userId,name:input.name,date:input.date,event:input.event,session:input.session,location:input.location,company:input.company,notes:input.notes,amount:input.amount,expense:0,expense_status:'pending',pay_status:'pending',part_paid:0,booking_status:'confirmed',created:new Date().toISOString()};const saved=await db(env,auth,'shoots',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(record)});return result({created:true,shoot:publicShoot(saved[0])})}catch(e){return err(e.message)}});
 return server;
}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/health'&&request.method==='GET')return json({service:'sakkhi-solo-mcp',status:'ready',note:'Authentication required for MCP.'});
  if(url.pathname!=='/mcp')return json({error:'Not found'},404);
  if(request.method==='OPTIONS')return new Response(null,{status:405,headers:{Allow:'POST, GET, DELETE'}});
  if(!['POST','GET','DELETE'].includes(request.method))return json({error:'Method not allowed'},405,{Allow:'POST, GET, DELETE'});
  const origin=request.headers.get('origin');
  if(origin && new URL(origin).host!==url.host && !(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).includes(origin))return json({error:'Origin not allowed'},403);
  if(!env.SUPABASE_ANON_KEY||!env.SUPABASE_URL)return json({error:'Server configuration incomplete'},503);
  let auth;try{auth=await authenticate(request,env)}catch(e){return json({error:e.message},401,{'WWW-Authenticate':'Bearer realm="Sakkhi MCP"'})}
  const server=serverFor(env,auth);
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try{await server.connect(transport);return await transport.handleRequest(request)}catch(e){return json({jsonrpc:'2.0',error:{code:-32603,message:'Internal MCP error'},id:null},500)}finally{ctx.waitUntil(server.close())}
 }
};
