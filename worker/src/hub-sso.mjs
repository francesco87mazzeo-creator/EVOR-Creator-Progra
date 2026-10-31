// Optional private HUB bindings. No HTTP fallback, credentials or Firebase signer here.
// Existing /auth remains available until a separately approved cutover.
const response=(status,code)=>new Response(JSON.stringify({error:code}),{status,headers:{'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer'}});
export async function authorizeHubToken(env,token){
 if(!env.HUB_IDENTITY?.fetch)throw Object.assign(new Error('HUB not configured'),{status:503});
 const r=await env.HUB_IDENTITY.fetch(new Request('https://hub.internal/internal/authorize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(5000)}));
 if(!r.ok)throw Object.assign(new Error('HUB access denied'),{status:r.status===401||r.status===403?r.status:503});
 const d=await r.json();
 if(!d?.user||typeof d.user.uid!=='string'||!['admin','manager'].includes(d.user.role)||d.user.enabled!==true||!Number.isInteger(d.user.version))throw Object.assign(new Error('Invalid HUB response'),{status:503});
 return d;
}
export async function proxyHubSso(request,env){
 const url=new URL(request.url);
 const paths=new Set(['/admin/hub-sso/start','/admin/hub-sso/callback','/admin/hub-sso/complete','/admin/hub-sso/status','/admin/hub-sso/logout']);
 if(url.origin!=='https://collective.evorafitness.it'||!paths.has(url.pathname))return response(403,'HUB_ORIGIN_DENIED');
 if(!env.HUB_COLLECTIVE?.fetch)return response(503,'HUB_NOT_CONFIGURED');
 try{return await env.HUB_COLLECTIVE.fetch(request);}catch{return response(503,'HUB_UNAVAILABLE');}
}
