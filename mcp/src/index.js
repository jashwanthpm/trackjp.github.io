import { iso, publicShoot, visibleShoot, indiaDate, ownedShoot, ownedShoots, ownerFilter } from './shoot-utils.js';
import { authorize, createProvider } from './oauth.js';
import { insufficientScope } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

// MCP access is authenticated by the OAuth resource handler; Supabase JWTs never come from AI clients.
const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
const err = (message) => ({content:[{type:'text',text:message}],isError:true});
const result = (data) => ({content:[{type:'text',text:JSON.stringify(data,null,2)}]});
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
function serverFor(env,auth,scopes=[]){
 const visible = s => visibleShoot(s,scopes);
 const server=new McpServer({name:'sakkhi-solo',version:'0.1.0'});
 server.registerTool('get_shoots',{description:'List this signed-in Sakkhi Solo user’s shoots, optionally within a date range.',inputSchema:{from:iso.optional(),to:iso.optional(),limit:z.number().int().min(1).max(200).default(50)}},async({from,to,limit})=>{try{let rows=await shoots(env,auth);if(from)rows=rows.filter(s=>s.date>=from);if(to)rows=rows.filter(s=>s.date<=to);return result({total:rows.length,shoots:rows.slice(0,limit).map(visible)})}catch(e){return err(e.message)}});
 server.registerTool('get_next_shoot',{description:'Find the next upcoming shoot in the signed-in Solo account.',inputSchema:{}},async()=>{try{const today=indiaDate();const next=(await shoots(env,auth)).find(s=>s.date>=today&&s.booking_status!=='cancelled');return result({as_of:today,shoot:next?visible(next):null})}catch(e){return err(e.message)}});
 server.registerTool('get_shoot_details',{description:'Get a single shoot by its Sakkhi ID, restricted to the authenticated user.',inputSchema:{id:z.string().min(1).max(120)}},async({id})=>{try{const rows=await db(env,auth,'shoots?'+owner(auth)+'&id=eq.'+encodeURIComponent(id)+'&select=*&limit=1');if(rows.some(row=>!ownedShoot(row,auth.userId)))throw new Error('Ownership validation failed');return result({shoot:rows[0]?visible(rows[0]):null})}catch(e){return err(e.message)}});
 if(scopes.includes('payments:read')) server.registerTool('get_pending_payments',{description:'List outstanding shoot payments and total due for this Solo user.',inputSchema:{limit:z.number().int().min(1).max(200).default(100)}},async({limit})=>{try{const rows=(await shoots(env,auth)).map(publicShoot).filter(s=>s.pending>0);return result({currency:'INR',total_pending:rows.reduce((n,s)=>n+s.pending,0),count:rows.length,shoots:rows.slice(0,limit)})}catch(e){return err(e.message)}});
 if(scopes.includes('summary:read') && scopes.includes('payments:read')) server.registerTool('get_year_summary',{description:'Summarise a calendar year of shoots, invoiced amounts, received payments, and outstanding dues.',inputSchema:{year:z.number().int().min(2000).max(2200)}},async({year})=>{try{const rows=(await shoots(env,auth)).filter(s=>String(s.date||'').startsWith(String(year))).map(publicShoot);return result({year,currency:'INR',shoot_count:rows.length,booked_amount:rows.reduce((n,s)=>n+s.amount,0),received:rows.reduce((n,s)=>n+s.paid,0),pending:rows.reduce((n,s)=>n+s.pending,0),by_event:Object.entries(rows.reduce((a,s)=>(a[s.event||'Other']=(a[s.event||'Other']||0)+1,a),{})).map(([event,count])=>({event,count}))})}catch(e){return err(e.message)}});
 if(env.ENABLE_MCP_WRITES === 'true' && scopes.includes('shoots:write')) server.registerTool('create_shoot',{description:'Create a shoot in this user’s Sakkhi Solo account. This changes real data: obtain the user’s explicit confirmation before calling.',inputSchema:{name:z.string().min(1).max(160),date:iso,event:z.string().min(1).max(100),session:z.string().max(100).default('Full Day'),location:z.string().max(200).default(''),company:z.string().max(160).default(''),notes:z.string().max(1500).default(''),amount:z.number().min(0).max(100000000).default(0)}},async(input)=>{try{const record={id:'mcp_'+crypto.randomUUID(),user_id:auth.userId,name:input.name,date:input.date,event:input.event,session:input.session,location:input.location,company:input.company,notes:input.notes,amount:input.amount,expense:0,expense_status:'pending',pay_status:'pending',part_paid:0,booking_status:'confirmed',created:new Date().toISOString()};const saved=await db(env,auth,'shoots',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(record)});if(!Array.isArray(saved)||!ownedShoot(saved[0],auth.userId))throw new Error('Ownership validation failed');return result({created:true,shoot:publicShoot(saved[0])})}catch(e){return err(e.message)}});
 return server;
}
const apiHandler={
 async fetch(request,env,ctx){
  if(env.ENABLE_MCP_SERVER!=='true')return json({error:'Sakkhi MCP not enabled'},503);
  if(!ctx.auth.scope.includes('shoots:read'))return insufficientScope(ctx.auth,['shoots:read']);
  const p=ctx.props;
  if(!p?.userId||!p.supabaseAccessToken||!p.supabaseExpiresAt||Date.now()>p.supabaseExpiresAt-10000)return json({error:'Sakkhi session expired. Reconnect your account.'},401);
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
  if(path==='/health')return json({service:'sakkhi-solo-mcp',enabled:env.ENABLE_MCP_SERVER==='true',oauth:true,writes:env.ENABLE_MCP_WRITES==='true'});
  return json({error:'Not found'},404);
 }
};
export default createProvider(apiHandler,defaultHandler);
