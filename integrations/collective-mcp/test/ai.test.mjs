import{test}from'node:test';import assert from'node:assert/strict';import{registerHooks}from'node:module';
import{generateKeyPairSync}from'node:crypto';
registerHooks({resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class WorkerEntrypoint {constructor(ctx,env){this.env=env;this.ctx=ctx;}}',shortCircuit:true};return n(s,c);}});
import{Client}from'@modelcontextprotocol/sdk/client/index.js';
import{InMemoryTransport}from'@modelcontextprotocol/sdk/inMemory.js';
import{validateEvaluation,nextHistory,MAX_HISTORY}from'../../../server/collective/mcp-ai-policy.mjs';
import{createProposals}from'../src/ai-channel.mjs';
import{createAiTools}from'../src/ai-tools.mjs';
import{createMcpServer}from'../src/server.mjs';
import{dataFixture}from'./helpers.mjs';
import{createPrivateAiHandler,createAiFirestoreStore,validAiOperation}from'../../../worker/src/mcp-private-ai.mjs';
import{__resetTokenCacheForTests}from'../../../worker/src/firestore.mjs';

const SECRET='s'.repeat(43),UID='synthetic_founder_0001',APP='synthetic-ai-01';
const principal={uid:UID,role:'admin',version:1,scopes:['collective:read','collective:evaluate']};
const good={score:72,summary:'Profilo coerente con il brand, metriche solide ma base ridotta.',rubricVersion:'rubric-test-0'};

test('evaluation content: strict shape, bounded text, known TEST rubric only',()=>{
 assert.deepEqual(validateEvaluation(good),good);
 assert.deepEqual(validateEvaluation({...good,criteria:[{name:'Brand fit',score:80,note:'Coerente'}]}).criteria,[{name:'Brand fit',score:80,note:'Coerente'}]);
 for(const bad of [{...good,score:101},{...good,score:-1},{...good,score:7.5},{...good,score:'70'},{...good,summary:'troppo breve'},{...good,summary:'x'.repeat(4001)},
  {...good,summary:'Testo con carattere di controllo \u0007 dentro'},{...good,rubricVersion:'rubric-prod-1'},{...good,status:'approved'},{...good,socialScore:99},
  {...good,criteria:Array.from({length:13},(_,i)=>({name:'c'+i,score:1}))},{...good,criteria:[{name:'A',score:1},{name:'a',score:2}]},{...good,criteria:[{name:'A',score:1,extra:1}]}])
  assert.throws(()=>validateEvaluation(bad),undefined,JSON.stringify(bad).slice(0,60));
});
test('history: previous evaluation appended, at most twenty kept',()=>{
 assert.deepEqual(nextHistory(null,[]),[]);
 const many=Array.from({length:MAX_HISTORY},(_,i)=>({score:i}));
 const next=nextHistory({score:99},many);assert.equal(next.length,MAX_HISTORY);assert.deepEqual(next.at(-1),{score:99});assert.deepEqual(next[0],{score:1});
});
test('proposals bind Founder, application, exact content and expiry; tampering is detected',async()=>{
 let clock=Date.parse('2026-11-05T10:00:00Z');const p=createProposals({secret:SECRET,now:()=>clock});
 const content=validateEvaluation(good),issued=await p.issue({uid:UID,applicationId:APP,content,basedOnVersion:'2026-11-05T09:00:00.123456Z'});
 const claims=await p.verify(issued.token,{uid:UID,applicationId:APP,content});assert.equal(claims.base,'2026-11-05T09:00:00.123456Z');assert.equal(claims.n,issued.proposalId);
 await assert.rejects(()=>p.verify(issued.token,{uid:UID,applicationId:'synthetic-ai-02',content}),{code:'PROPOSAL_OTHER_APPLICATION'});
 await assert.rejects(()=>p.verify(issued.token,{uid:'synthetic_other_000001',applicationId:APP,content}),{code:'PROPOSAL_INVALID'});
 await assert.rejects(()=>p.verify(issued.token,{uid:UID,applicationId:APP,content:{...content,score:73}}),{code:'PROPOSAL_CONTENT_CHANGED'});
 const [body,mac]=issued.token.split('.');const forged=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(body,'base64url')),app:'other'})).toString('base64url')+'.'+mac;
 await assert.rejects(()=>p.verify(forged,{uid:UID,applicationId:'other',content}),{code:'PROPOSAL_INVALID'});
 await assert.rejects(()=>createProposals({secret:'t'.repeat(43)}).verify(issued.token,{uid:UID,applicationId:APP,content}),{code:'PROPOSAL_INVALID'});
 clock+=10*60_000+1;await assert.rejects(()=>p.verify(issued.token,{uid:UID,applicationId:APP,content}),{code:'PROPOSAL_EXPIRED'});
});

function fakeAi(state={exists:true,version:'2026-11-05T09:00:00.123456Z',fullName:'Giulia Prova',instagramHandle:'giulia.prova.sintetica',current:null,historyCount:0},result={status:'saved',evaluatedAt:'2026-11-05T10:00:01Z',historyCount:0}){
 const calls=[];return {calls,ai:{state:async id=>{calls.push(['state',id]);return state;},save:async a=>{calls.push(['save',a]);return typeof result==='function'?result(a):result;}}};
}
test('propose never writes and returns a signed proposal with the candidate identity for confirmation',async()=>{
 const {ai,calls}=fakeAi(),tools=createAiTools({ai,proposals:createProposals({secret:SECRET}),principal});
 const p=await tools.propose_ai_evaluation({applicationId:APP,...good});
 assert.equal(p.status,'proposta_pronta_non_salvata');assert.equal(p.candidate.fullName,'Giulia Prova');assert.equal(p.rubric.test,true);
 assert.match(p.nextStep,/conferma esplicita/);assert.deepEqual(calls.map(c=>c[0]),['state']);
});
test('save requires confirmation, the same content and the same application',async()=>{
 const {ai,calls}=fakeAi(),tools=createAiTools({ai,proposals:createProposals({secret:SECRET}),principal});
 const p=await tools.propose_ai_evaluation({applicationId:APP,...good});
 await assert.rejects(()=>tools.save_ai_evaluation({applicationId:APP,...good,proposalToken:p.proposalToken,confirmed:false}),{code:'CONFIRMATION_REQUIRED'});
 await assert.rejects(()=>tools.save_ai_evaluation({applicationId:APP,...good,summary:good.summary+' Modificata.',proposalToken:p.proposalToken,confirmed:true}),{code:'PROPOSAL_CONTENT_CHANGED'});
 await assert.rejects(()=>tools.save_ai_evaluation({applicationId:'synthetic-ai-02',...good,proposalToken:p.proposalToken,confirmed:true}),{code:'PROPOSAL_OTHER_APPLICATION'});
 assert.equal(calls.filter(c=>c[0]==='save').length,0);
 const saved=await tools.save_ai_evaluation({applicationId:APP,...good,proposalToken:p.proposalToken,confirmed:true});
 assert.equal(saved.saved,true);const sent=calls.find(c=>c[0]==='save')[1];
 assert.deepEqual(Object.keys(sent).sort(),['basedOnVersion','evaluation','id','proposalId']);assert.equal(sent.basedOnVersion,'2026-11-05T09:00:00.123456Z');
});
test('save reports duplicates as already saved and conflicts as an error, never as success',async()=>{
 for(const [result,check] of [[{status:'already_saved',evaluatedAt:'x'},async r=>assert.equal((await r).duplicate,true)],
  [{status:'conflict'},r=>assert.rejects(r,{code:'APPLICATION_CHANGED_SINCE_PROPOSAL'})],[{status:'denied'},r=>assert.rejects(r,{code:'WRITE_DENIED'})],[{status:'weird'},r=>assert.rejects(r,{code:'AI_UNAVAILABLE'})]]){
  const {ai}=fakeAi(undefined,result),tools=createAiTools({ai,proposals:createProposals({secret:SECRET}),principal});
  const p=await tools.propose_ai_evaluation({applicationId:APP,...good});
  await check(tools.save_ai_evaluation({applicationId:APP,...good,proposalToken:p.proposalToken,confirmed:true}));
 }
});

test('MCP: without collective:evaluate the AI tools ask ChatGPT to re-authorize; read tools keep working',async()=>{
 const {reader}=dataFixture(),{ai,calls}=fakeAi();
 for(const scopes of [['collective:read'],['collective:read','collective:evaluate']]){
  const server=createMcpServer(reader,{principal:{...principal,scopes},ai,proposals:createProposals({secret:SECRET}),metadataUrl:'https://mcp.synthetic.test/.well-known/oauth-protected-resource/mcp'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);const client=new Client({name:'t',version:'1'});await client.connect(b);
  const proposal=await client.callTool({name:'propose_ai_evaluation',arguments:{applicationId:APP,...good}});
  if(scopes.length===1){
   assert.equal(proposal.isError,true);const header=proposal._meta['mcp/www_authenticate'][0];
   assert.match(header,/error="insufficient_scope"/);assert.match(header,/scope="collective:read collective:evaluate"/);assert.match(header,/resource_metadata="https:\/\/mcp\.synthetic\.test/);
   assert.equal(calls.length,0);
   const read=await client.callTool({name:'list_recent_applications',arguments:{limit:1}});assert.notEqual(read.isError,true);
  }else{assert.notEqual(proposal.isError,true);assert.equal(proposal.structuredContent.status,'proposta_pronta_non_salvata');}
  const unconfirmed=await client.callTool({name:'save_ai_evaluation',arguments:{applicationId:APP,...good,proposalToken:'x'.repeat(40),confirmed:false}});
  assert.equal(unconfirmed.isError,true);
  await client.close();await server.close();
 }
});

// --- Facade: Firestore access with a simulated backend that applies preconditions like Firestore ---
function backend(){
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const sa={project_id:'demo-evora-mcp',client_email:'reader@demo-evora-mcp.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})};
 const name='projects/demo-evora-mcp/databases/(default)/documents/candidature/'+APP;
 let version=1,doc={fullName:{stringValue:'Giulia Prova'},instagramHandle:{stringValue:'giulia.prova.sintetica'},status:{stringValue:'review'},socialScore:{integerValue:'53'}};
 const updateTime=()=>`2026-11-05T09:00:00.${String(version).padStart(6,'0')}Z`;
 const log=[];let signIns=0,commitError=null;
 globalThis.fetch=async(input,init)=>{const r=new Request(input,init);if(r.url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'reader_token_synthetic_0001',expires_in:3600});throw Error('UNEXPECTED_NETWORK');};
 const transport=async request=>{
  const url=new URL(request.url);log.push({method:request.method,path:url.pathname,auth:request.headers.get('authorization')});
  if(url.hostname==='identitytoolkit.googleapis.com'){signIns++;const b=await request.json();assert.equal(b.email,'ai-writer@example.invalid');return Response.json({idToken:'aiwriter_id_token_synthetic',expiresIn:'3600'});}
  if(request.method==='GET'){assert.equal(request.headers.get('authorization'),'Bearer reader_token_synthetic_0001');
   const mask=url.searchParams.getAll('mask.fieldPaths');return Response.json({name,updateTime:updateTime(),fields:Object.fromEntries(Object.entries(doc).filter(([k])=>mask.includes(k)))});}
  assert.equal(request.headers.get('authorization'),'Bearer aiwriter_id_token_synthetic');
  if(commitError)return Response.json({error:{status:commitError}},{status:400});
  const w=(await request.json()).writes[0];log.at(-1).write=w;
  if(w.currentDocument.updateTime!==updateTime())return Response.json({error:{status:'FAILED_PRECONDITION'}},{status:400});
  for(const path of w.updateMask.fieldPaths)doc[path]=structuredClone(w.update.fields[path]);
  doc.aiEvaluation.mapValue.fields.evaluatedAt={timestampValue:'2026-11-05T10:00:0'+version+'Z'};version++;
  return Response.json({commitTime:'2026-11-05T10:00:00Z'});
 };
 __resetTokenCacheForTests();
 const store=createAiFirestoreStore({serviceAccount:sa,projectId:'demo-evora-mcp',writer:{email:'ai-writer@example.invalid',password:'synthetic-password',apiKey:'AIza'+'x'.repeat(35)},transport});
 return {store,log,doc:()=>doc,updateTime,signIns:()=>signIns,failCommit:e=>{commitError=e;}};
}
const ev=(score,proposalId)=>({id:APP,evaluation:validateEvaluation({...good,score}),proposalId});
test('facade writes ONLY the AI fields, with the aiwriter ID token, a server timestamp and a version precondition',async()=>{
 const b=backend(),s=await b.store.state(APP);assert.equal(s.exists,true);assert.equal(s.current,null);
 const r=await b.store.save({...ev(72,'p'.repeat(24)),basedOnVersion:s.version});assert.equal(r.status,'saved');
 const w=b.log.find(e=>e.write).write;
 assert.deepEqual(w.updateMask.fieldPaths,['aiEvaluation']);assert.deepEqual(Object.keys(w.update.fields),['aiEvaluation']);
 assert.deepEqual(w.updateTransforms,[{fieldPath:'aiEvaluation.evaluatedAt',setToServerValue:'REQUEST_TIME'}]);assert.equal(w.currentDocument.updateTime,s.version);
 assert.equal(b.doc().status.stringValue,'review');assert.equal(b.doc().socialScore.integerValue,'53');
 assert.ok(b.log.filter(e=>e.method==='GET').every(e=>e.auth==='Bearer reader_token_synthetic_0001'));
});
test('re-evaluation moves the previous evaluation to history with its original Firestore types',async()=>{
 const b=backend();await b.store.save({...ev(72,'p'.repeat(24)),basedOnVersion:b.updateTime()});
 const first=structuredClone(b.doc().aiEvaluation);
 const r=await b.store.save({...ev(65,'q'.repeat(24)),basedOnVersion:b.updateTime()});assert.equal(r.status,'saved');assert.equal(r.historyCount,1);
 assert.deepEqual(b.doc().aiEvaluationHistory.arrayValue.values,[first]);assert.ok('timestampValue' in first.mapValue.fields.evaluatedAt);
 assert.equal(b.doc().aiEvaluation.mapValue.fields.score.integerValue,'65');
});
test('the same proposal is never written twice; a stale or concurrent proposal is a conflict',async()=>{
 const b=backend(),base=b.updateTime();await b.store.save({...ev(72,'p'.repeat(24)),basedOnVersion:base});
 const writes=()=>b.log.filter(e=>e.write).length;
 assert.equal((await b.store.save({...ev(72,'p'.repeat(24)),basedOnVersion:base})).status,'already_saved');assert.equal(writes(),1);
 assert.equal((await b.store.save({...ev(70,'r'.repeat(24)),basedOnVersion:base})).status,'conflict');assert.equal(writes(),1);
 b.failCommit('FAILED_PRECONDITION');assert.equal((await b.store.save({...ev(70,'s'.repeat(24)),basedOnVersion:b.updateTime()})).status,'conflict');
 // A response for a different document than the one requested is refused, never used.
 await assert.rejects(()=>b.store.state('other-doc'),/AI_STATE_UNAVAILABLE/);
});
test('facade handler: private key, Founder and operation shape are all required',async()=>{
 let verified=0;const store={state:async()=>({exists:true}),save:async()=>({status:'saved'})};
 const handler=createPrivateAiHandler({secret:SECRET,founderUid:UID,verifyFounder:async()=>{verified++;return true;},store});
 const call=(body,key=SECRET)=>handler(new Request('https://collective-mcp.internal/internal/mcp/ai',{method:'POST',headers:{'content-type':'application/json','x-evora-mcp-private-key':key},body:JSON.stringify(body)}));
 const p={uid:UID,role:'admin',version:1};
 assert.equal((await call({operation:'state',argument:{id:APP},principal:p})).status,200);
 assert.equal((await call({operation:'state',argument:{id:APP},principal:p},'t'.repeat(43))).status,403);
 assert.equal((await call({operation:'state',argument:{id:APP},principal:{...p,uid:'synthetic_other_000001'}})).status,403);
 assert.equal((await call({operation:'delete',argument:{id:APP},principal:p})).status,403);
 assert.equal((await call({operation:'save',argument:{id:APP,evaluation:{...good,status:'approved'},basedOnVersion:'2026-11-05T09:00:00Z',proposalId:'p'.repeat(24)},principal:p})).status,403);
 assert.equal(validAiOperation({operation:'save',argument:{id:APP,evaluation:good,basedOnVersion:'2026-11-05T09:00:00.1Z',proposalId:'p'.repeat(24)},principal:p}),true);
 const denied=createPrivateAiHandler({secret:SECRET,founderUid:UID,verifyFounder:async()=>false,store});
 assert.equal((await denied(new Request('https://collective-mcp.internal/internal/mcp/ai',{method:'POST',headers:{'x-evora-mcp-private-key':SECRET},body:JSON.stringify({operation:'state',argument:{id:APP},principal:p})}))).status,403);
});
test('facade entrypoint keeps AI writing disabled where no aiwriter identity is configured (production today)',async()=>{
 const {CollectiveMcpReadService}=await import('../../../worker/src/mcp-private-entrypoint.mjs');
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const env={MCP_PRIVATE_SHARED_KEY:SECRET,MCP_FOUNDER_UID:UID,FIRESTORE_PROJECT_ID:'evora-athletes',MCP_DEPLOYMENT_PROFILE:'production',HUB_IDENTITY:{fetch:async()=>Response.json({})},
  FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:'evora-athletes',client_email:'r@evora-athletes.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})})};
 const r=await new CollectiveMcpReadService({},env).fetch(new Request('https://collective-mcp.internal/internal/mcp/ai',{method:'POST',headers:{'x-evora-mcp-private-key':SECRET},body:'{}'}));
 assert.equal(r.status,503);
});
