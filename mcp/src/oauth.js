import { OAuthProvider, AuthorizationError, CimdFetchError, OAuthError } from '@cloudflare/workers-oauth-provider';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#'+c.charCodeAt(0)+';');
const html = (body, status=200, headers={}) => new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sakkhi Connect</title><style>body{font:15px system-ui;background:#0c0c0c;color:#eee;max-width:440px;margin:7vh auto;padding:20px}main{border:1px solid #695634;border-radius:15px;padding:24px}h1{color:#d1ad70}input{box-sizing:border-box;width:100%;padding:12px;margin:8px 0 15px;background:#202020;color:#fff;border:1px solid #777;border-radius:7px}button{padding:12px;border:0;border-radius:6px;background:#d1ad70;cursor:pointer}button[value=deny]{background:#555;color:#fff}p{line-height:1.5}</style><main>'+body+'</main>',{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'x-frame-options':'DENY',...headers}});
const errorPage=(message,status=400)=>html('<h1>Connection not completed</h1><p>'+esc(message)+'</p><p>Restart the connection from your AI application.</p>',status);
export async function authorize(request,env) {
 if(env.ENABLE_MCP_SERVER!=='true') return errorPage('Sakkhi Connect is not enabled.',503);
 const oauth=env.OAUTH_PROVIDER;
 try {
  if(request.method==='GET'){
   const parsed=await oauth.parseAuthRequest(request);
   const details=await oauth.describeConsent(parsed);
   const started=await oauth.beginConsent(parsed);
   const scopes=details.scope.map(scope=>'<label><input type="checkbox" name="scope" value="'+esc(scope)+'" checked> '+esc(scope)+'</label>').join('');
   return html('<h1>Connect Sakkhi Solo</h1><p><strong>'+esc(details.clientName)+'</strong> wants access to your account.</p><p>Publisher: '+esc(details.clientDomain||'Unverified app registration')+'</p><p>Redirect destination: <strong>'+esc(details.redirectHost)+'</strong></p>'+(details.redirectIsLoopback?'<p>Warning: access will be returned to an application on this computer.</p>':'')+'<form method="post"><input type="hidden" name="handle" value="'+esc(started.handle)+'"><p>Choose permissions:</p>'+scopes+'<p>Sign in with your existing Sakkhi account to approve. Do not approve unexpected requests.</p><label>Email<input type="email" name="email" autocomplete="username" required maxlength="254"></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button name="decision" value="approve">Sign in and allow</button> <button name="decision" value="deny" formnovalidate>Cancel</button></form>',200,Object.fromEntries(started.headers));
  }
  if(request.method!=='POST')return errorPage('Method not allowed.',405);
  const form=await request.formData();const handle=String(form.get('handle')||'');
  if(form.get('decision')!=='approve'){
   const denied=await oauth.denyConsent(request,handle);
   return new Response(null,{status:302,headers:denied.headers});
  }
  const email=String(form.get('email')||'').trim(),password=String(form.get('password')||'');
  if(!email||!password||!env.SUPABASE_ANON_KEY)return errorPage('Sign-in information is missing.');
  const login=await fetch(env.SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password}),cache:'no-store'});
  if(!login.ok)return errorPage('Sakkhi sign-in failed. Check your credentials. Accounts requiring additional verification are not supported by this connection flow yet.',401);
  const session=await login.json();
  if(!session.user?.id||session.user.is_anonymous||!session.access_token||!session.refresh_token||!session.expires_in)return errorPage('Incomplete Sakkhi session.',401);
  const approved=await oauth.approveConsent(request,handle,{scope:form.getAll('scope').map(String)});
  const completed=await oauth.completeAuthorization({request:approved.request,userId:session.user.id,metadata:{},scope:approved.request.scope,props:{userId:session.user.id,supabaseAccessToken:session.access_token,supabaseRefreshToken:session.refresh_token,supabaseExpiresAt:Date.now()+session.expires_in*1000}});
  approved.headers.set('Location',completed.redirectTo);
  return new Response(null,{status:302,headers:approved.headers});
 }catch(e){
  if(e instanceof AuthorizationError&&e.redirectTo)return Response.redirect(e.redirectTo,302);
  if(e instanceof AuthorizationError)return errorPage(e.description||'Authorization request expired.');
  if(e instanceof CimdFetchError)return errorPage('The connecting application could not be verified.');
  throw e;
 }
}
export function createProvider(apiHandler,defaultHandler){
 return new OAuthProvider({
  apiRoute:'/mcp',apiHandler,defaultHandler,
  authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',
  scopesSupported:['shoots:read','payments:read','summary:read','offline_access'],
  resourceMetadata:{resource:'https://mcp.sakkhi.co.in/mcp',authorization_servers:['https://mcp.sakkhi.co.in']},
  requiredScopes:['shoots:read'],clientIdMetadataDocumentEnabled:true,
  tokenExchangeCallback:async options=>{
   const p=options.props;
   if(!p?.userId||!p.supabaseRefreshToken)throw new OAuthError('invalid_grant',{description:'Reconnect your Sakkhi account.'});
   if(options.grantType==='authorization_code' && Date.now()<p.supabaseExpiresAt-60000)return {accessTokenTTL:Math.min(3000,Math.floor((p.supabaseExpiresAt-Date.now())/1000))};
   const refreshed=await fetch(options.env.SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:options.env.SUPABASE_ANON_KEY,'content-type':'application/json'},body:JSON.stringify({refresh_token:p.supabaseRefreshToken}),cache:'no-store'});
   if(!refreshed.ok)throw new OAuthError('invalid_grant',{description:'Sakkhi session expired. Reconnect your account.'});
   const s=await refreshed.json();
   if(s.user?.id!==p.userId||!s.access_token||!s.refresh_token||!s.expires_in)throw new OAuthError('invalid_grant',{description:'Sakkhi identity validation failed.'});
   const updated={userId:p.userId,supabaseAccessToken:s.access_token,supabaseRefreshToken:s.refresh_token,supabaseExpiresAt:Date.now()+s.expires_in*1000};
   return {newProps:updated,accessTokenProps:updated,accessTokenTTL:Math.min(3000,Math.max(60,s.expires_in-60))};
  }
 });
}
