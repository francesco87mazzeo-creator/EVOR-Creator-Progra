// Servizi solo locali per test Worker/browser: le chiavi sono generate, non credenziali reali.
import {generateKeyPairSync} from 'node:crypto';
import {fromFirestoreValue} from '../rollback/compat/worker/src/firestore.mjs';
const PROJECT='demo-evora-security';
const ROOT=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
export function rollbackServices(){
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const env={ALLOWED_ORIGIN:'https://synthetic.collective.test',FIRESTORE_PROJECT_ID:PROJECT,
    FIREBASE_SERVICE_ACCOUNT:JSON.stringify({project_id:PROJECT,client_email:`synthetic-rollback@${PROJECT}.iam.gserviceaccount.com`,private_key:privateKey.export({type:'pkcs8',format:'pem'})})};
  const store=new Map(),calls=[];
  return {env,store,calls,fetch:async(url,init={})=>{
    const address=String(url);calls.push(address);
    if(address==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-rollback-token-not-real',expires_in:3600});
    if(address===`${ROOT}/settings/scoring`)return Response.json({}, {status:404});
    if(address.startsWith(`${ROOT}/candidature?documentId=`)){
      const id=new URL(address).searchParams.get('documentId');
      if(store.has(id))return Response.json({error:{status:'ALREADY_EXISTS'}},{status:409});
      store.set(id,fromFirestoreValue({mapValue:JSON.parse(init.body)}));
      return Response.json({name:id});
    }
    // Telegram non è configurato; nessuna chiamata, neppure simulata, è attesa.
    throw new Error(`Rete vietata nel test rollback: ${address}`);
  }};
}
