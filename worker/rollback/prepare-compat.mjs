// Snapshot deterministico e offline del runtime approvato come base di compatibilità.
// Nessun accesso a Cloudflare/Firebase. --write prepara file locali, --check non scrive.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const target=new URL('./compat/',import.meta.url);
const sourceCommit='c29d05b5d75f176906288c5bc16be0b7fe9f7bbc';
const files=[
  'worker/src/worker.js','worker/src/firebase-id-token.mjs','worker/src/firestore.mjs','worker/src/google-auth.mjs',
  'server/collective/application.mjs','server/collective/ocr.mjs','server/collective/scoring.mjs','server/collective/validation.mjs'
];
const mode=process.argv[2]||'--check';
if(!['--write','--check'].includes(mode))throw new Error('Usa --check oppure --write');
const hashes={};
for(const file of files){
  const bytes=execFileSync('git',['show',`${sourceCommit}:${file}`],{cwd:root});
  hashes[file]=createHash('sha256').update(bytes).digest('hex');
  const path=fileURLToPath(new URL(file,target));
  if(mode==='--write'){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}
  else if(!readFileSync(path).equals(bytes))throw new Error(`Snapshot diverso dalla base: ${file}`);
}
const manifest=JSON.stringify({sourceCommit,entry:'worker/src/worker.js',files:hashes},null,2)+'\n';
const manifestPath=new URL('./manifest.json',import.meta.url);
if(mode==='--write')writeFileSync(manifestPath,manifest);
else if(readFileSync(manifestPath,'utf8')!==manifest)throw new Error('Manifest non allineato');
console.log(`${mode==='--write'?'Preparati':'Verificati'} ${files.length} moduli: copia esatta di ${sourceCommit}. Nessun deploy.`);
