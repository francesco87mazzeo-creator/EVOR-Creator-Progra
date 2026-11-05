// Narrow, audited projection for the candidate search and detail MCP tools.
// Firestore field masks enforce it at the source: excluded fields never leave the read facade.
// Never requested: email, age, city, country, TikTok, screenshots and their names, OCR images, notes,
// creator code, privacy consent, raw Instagram URL.
import {METRICS} from './mcp-read-policy.mjs';

const SCORES=['scoringVersion','socialScore','engagementRate','engagementScore','visibilityScore','reachEngagementRate','lowBase','erRate','reachRate','growthRate'];
/** Search index: only what is needed to tell candidates apart. */
export const INDEX_FIELDS=Object.freeze(['fullName','instagramHandle','status','date']);
export const MAX_INDEX=500;

const CHOICES={
 yesNoMaybe:{yes:'Sì',no:'No',maybe:'Da valutare'},
 hasBrandCollabs:{yes:'Sì',no:'No, sarebbe la prima'},
 buildWithoutEarnings:{yes:'Sì',yes_conditions:'Sì, entro condizioni definite',depends:'Dipende dal progetto',paid_only:'Preferisco compenso garantito'},
 contentPerMonth:{lt1:'Meno di 1 al mese','1-2':'1–2 al mese','3-4':'3–4 al mese','5+':'5 o più',depends:'Dipende dal progetto'},
 hasRoutine:{yes:'Sì, costante',building:'La sto costruendo',no:'No, irregolare'},
 followsGuidelines:{yes:'Sì',mostly:'Sì, con margine creativo',no:'No'}
};
const text=(key,question,section)=>Object.freeze({key,question,section,type:'text'});
const choice=(key,question,section,options)=>Object.freeze({key,question,section,type:'choice',options:Object.freeze(options)});
/** Questions exactly as shown to candidates and in the Admin detail, in form order. */
export const QUESTIONNAIRE=Object.freeze([
 text('threeWords','Tre parole che ti descrivono come creator','Contenuti e pubblico'),
 text('contentType','Che tipo di contenuti pubblichi principalmente?','Contenuti e pubblico'),
 text('whatToTransmit','Cosa vuoi trasmettere al tuo pubblico?','Contenuti e pubblico'),
 text('whyFollow','Per quale motivo le persone scelgono di seguirti e continuano a farlo?','Contenuti e pubblico'),
 choice('hasBrandCollabs','Hai già collaborato con brand del settore fitness?','Contenuti e pubblico',CHOICES.hasBrandCollabs),
 text('brandCollabDetails','Con quali brand e in che forma?','Contenuti e pubblico'),
 text('motivation','Perché ritieni che possa esistere una collaborazione credibile tra il tuo percorso ed EVORΛ?','Rapporto con EVORΛ'),
 text('brandLike','Cosa apprezzi di EVORΛ?','Rapporto con EVORΛ'),
 text('contentIntegration','Come integreresti EVORΛ nei tuoi contenuti senza renderli una pubblicità forzata?','Rapporto con EVORΛ'),
 text('athleteImage','Quale immagine dovrebbe trasmettere una persona che rappresenta EVORΛ?','Rapporto con EVORΛ'),
 text('valueBeyondContent','Quale valore potresti portare a EVORΛ oltre alla semplice pubblicazione di contenuti?','Rapporto con EVORΛ'),
 text('howWouldTell','Come racconteresti EVORΛ al tuo pubblico senza realizzare una pubblicità diretta?','Rapporto con EVORΛ'),
 text('scenarioBrandContent','EVORΛ ti propone un contenuto molto coerente con il brand, ma probabilmente meno performante di una promozione diretta. Come lo gestiresti?','Scenari'),
 choice('buildWithoutEarnings','Saresti disponibile a iniziare con un periodo in cui entrambe le parti valutano la qualità della collaborazione, senza una garanzia di risultati economici immediati?','Scenari',CHOICES.buildWithoutEarnings),
 text('badContentReaction','Come reagisci quando un contenuto non raggiunge i risultati attesi?','Scenari'),
 text('analysisElements','Quali elementi analizzeresti prima di decidere cosa cambiare?','Scenari'),
 text('brandMeaning','Che cosa significa per te rappresentare un brand?','Scenari'),
 choice('contentPerMonth','Quanti contenuti dedicati o integrati a EVORΛ riusciresti realisticamente a produrre ogni mese mantenendo il tuo standard qualitativo?','Disponibilità',CHOICES.contentPerMonth),
 choice('hasRoutine','Hai una costanza di pubblicazione?','Disponibilità',CHOICES.hasRoutine),
 choice('followsGuidelines','Sei disponibile a seguire linee guida creative concordate?','Disponibilità',CHOICES.followsGuidelines),
 choice('availEvents','Disponibilità a partecipare a eventi','Disponibilità',CHOICES.yesNoMaybe),
 choice('availShooting','Disponibilità a partecipare a shooting','Disponibilità',CHOICES.yesNoMaybe),
 choice('availUgc','Disponibilità a creare contenuti utilizzabili anche sui canali EVORΛ','Disponibilità',CHOICES.yesNoMaybe),
 choice('availRawFiles','Possibilità di fornire i file originali quando concordato','Disponibilità',CHOICES.yesNoMaybe),
 text('boughtProducts','Hai già acquistato prodotti EVORΛ?','Altro'),
 text('improvements',"C'è qualcosa che miglioreresti del brand?",'Altro'),
 text('extra','Vuoi aggiungere qualcosa?','Altro')
]);
export const CATEGORY_LABELS=Object.freeze({creator:'Creator fitness',coach:'Coach / Personal trainer',agonista:'Atleta agonista',non_agonista:'Atleta non agonista',
 lifestyle:'Lifestyle creator',palestra:'Titolare o collaboratore di palestra',professionista:'Professionista del settore',altro:'Altro'});
export const STATUS_LABELS=Object.freeze({new:'Nuova',review:'In valutazione',shortlist:'Shortlist',watchlist:'Da monitorare',more_info:'Info richieste',approved:'Approvata',rejected:'Rifiutata',archived:'Archiviata'});
export const STAFF_CRITERIA=Object.freeze([['brandFit','Brand Fit'],['contentQuality','Qualità dei contenuti'],['credibility','Credibilità'],['reliability','Affidabilità'],['potential','Potenziale'],['strategicValue','Valore strategico']]);
export const CONTENT_LINKS=Object.freeze(['contentUrl1','contentUrl2','contentUrl3']);
export const CANDIDATE_FIELDS=Object.freeze(['fullName','instagramHandle','status','date','updatedAt','schemaVersion','isAdult','profileCategories','otherProfileCategory',
 ...QUESTIONNAIRE.map(q=>q.key),...CONTENT_LINKS,...METRICS,...SCORES,'evaluation']);
/** Fields that must never be requested by any candidate tool (checked by tests). */
export const NEVER_REQUESTED=Object.freeze(['email','age','city','country','tiktok','tiktokFollowers','instagram','instagramUrl','tiktokHandle','tiktokUrl','screenshotData','screenshotData2',
 'profileScreenshotData','screenshotName','screenshotName2','ocrInsights','ocrProfile','notes','creatorCode','privacyConsent','insightsHistory','insightsCorrection']);

// Free answers may contain personal data typed spontaneously: contacts, links and identifiers are masked.
const REDACTIONS=[
 [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'[email rimossa]','email'],
 [/\bhttps?:\/\/\S+|\bwww\.\S+/gi,'[link rimosso]','link'],
 [/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi,'[codice fiscale rimosso]','taxCode'],
 [/\bIT\d{2}[A-Z]\d{10}[0-9A-Z]{12}\b/gi,'[IBAN rimosso]','iban'],
 // Phone numbers: at least nine digits, so counts like "1.200.000" or dates stay readable.
 [/(?:\+|00)?\d[\d\s./-]{7,}\d/g,'[telefono rimosso]','phone',match=>match.replace(/\D/g,'').length>=9]
];
export function minimizeText(value,counts){
 if(typeof value!=='string')return null;
 let out=value;
 for(const [pattern,replacement,kind,accept] of REDACTIONS)out=out.replace(pattern,match=>{
  if(accept&&!accept(match))return match;
  counts[kind]=(counts[kind]||0)+1;return replacement;
 });
 return out.trim()===''?null:out;
}
/** Content links: only https, credentials and query strings dropped; anything else is omitted. */
export function contentLink(value){
 if(typeof value!=='string'||!value)return null;
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;return u.origin+u.pathname;}catch{return null;}
}
export const normalizeSearch=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/^@+/,'').replace(/\s+/g,' ').trim();

/**
 * Independent AI evaluation input: original candidate data only. Never requested here: status, every site score
 * (socialScore and components, legacy rates, lowBase, scoringVersion), staff evaluation, notes, previous AI
 * evaluations. OCR and staff-correction values are read only to state where each metric comes from.
 */
export const EVALUATION_FIELDS=Object.freeze(['fullName','instagramHandle','date','isAdult','profileCategories','otherProfileCategory',
 ...QUESTIONNAIRE.map(q=>q.key),...CONTENT_LINKS,...METRICS,'ocrInsights.merged','ocrProfile.result.followers','insightsCorrection.newValues']);
/** Judgements and scores that the evaluation input must never contain (checked by tests). */
export const NOT_FOR_EVALUATION=Object.freeze(['status','evaluation','socialScore','engagementRate','engagementScore','visibilityScore','reachEngagementRate',
 'lowBase','scoringVersion','perfLevel','bandLabel','erRate','reachRate','growthRate','aiEvaluation','aiEvaluationHistory','notes','creatorCode']);
