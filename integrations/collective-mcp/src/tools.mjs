import {computeScore, resolveScoringConfig, SCORING_VERSION} from '../../../server/collective/scoring.mjs';
import scoreLevels from '../../../public/score-levels.js';
import {METRICS, isoDate, DataError} from './reader.mjs';

const number = value => typeof value==='number' && Number.isFinite(value) ? value : null;
const timestamp = value => isoDate(value) ? value : null;
const states = new Set(['new','review','approved','rejected','shortlist','watchlist','more_info','archived']);
const scoreKeys = ['socialScore','engagementRate','engagementScore','visibilityScore','reachEngagementRate'];
const metricKeys = [...METRICS];
function calculate(data,config=null) {
  const result=computeScore(data,config);
  if (Object.values(result).some(value=>typeof value==='number'&&!Number.isFinite(value))) throw new DataError('UNSUPPORTED_NUMERIC_DATA');
  return result;
}
function saved(data) {
  return {version:Number.isInteger(data.scoringVersion)?data.scoringVersion:null,
    ...Object.fromEntries(scoreKeys.map(key=>[key,number(data[key])])),
    lowBase:typeof data.lowBase==='boolean'?data.lowBase:null,
    legacy:{erRate:number(data.erRate),reachRate:number(data.reachRate),growthRate:number(data.growthRate)}};
}
const observed = result => Object.fromEntries(metricKeys.map(key=>[key,result[key]]));
export async function loadConfiguration(reader,{includeBenchmarks=true}={}) {
  const [stored, benchmarks, levels] = await Promise.all([reader.setting('scoring'),includeBenchmarks?reader.setting('instagramBenchmarks'):Promise.resolve(null),reader.setting('scoreLevels')]);
  const scoring=resolveScoringConfig(stored);
  return {
    scoring:{source:stored===null?'default_missing_document':stored.version!==SCORING_VERSION?'default_non_current_version':'stored_document',storedVersion:Number.isInteger(stored?.version)?stored.version:null,value:scoring},
    ...(includeBenchmarks?{benchmarks:{source:benchmarks===null?'provisional_defaults_missing_document':'stored_document',contributesToV2:false,value:benchmarks===null?scoreLevels.benchmarks.defaults():scoreLevels.benchmarks.fromDocument(benchmarks)}}:{}),
    levels:{source:levels===null?'historical_defaults_missing_document':'stored_document',changesNumericScore:false,value:levels===null?scoreLevels.defaults():scoreLevels.validateConfig(levels)},
    behavior:{scoreVersion:SCORING_VERSION,components:['interactions / views','views'],weightsAreNormalized:true,indicatorB:'interactions / accountsReached; informational only',benchmarkRates:'Engagement / Reach / Growth are informational; not V2 score components',lowBase:'warning only; no numerical penalty',configurationAtSubmissionAvailable:false,consistentSnapshot:false,workerCacheMayLagDatabase:true}
  };
}
function evidence(data, key, current) {
  const ocr=key==='followers'?data.ocrProfile?.result?.followers:data.ocrInsights?.screenshot1?.[key];
  const merged=key==='followers'?data.ocrProfile?.result?.followers?.value:data.ocrInsights?.merged?.[key];
  const normalize = v => computeScore({[key]:v})[key];
  const recorded=normalize(merged), correction=data.insightsCorrection;
  const correctionRecorded=!!correction && Object.hasOwn(correction.newValues || {},key);
  const corrected=correctionRecorded?normalize(correction.newValues[key]):null;
  const matchesOcr=current!==null&&recorded!==null?current===recorded:null;
  const prior=normalize(correction?.previousValues?.[key]);
  const rawCorrection=correction?.newValues?.[key],rawPrior=correction?.previousValues?.[key];
  const validCorrection=correctionRecorded&&(rawCorrection===null||corrected!==null);
  const changed=correctionRecorded&&Object.hasOwn(correction.previousValues || {},key)&&(rawPrior===null||prior!==null)?prior!==corrected:null;
  const matchesCorrection=validCorrection?current===corrected:null;
  const visibility = item => ['complete','partial','not_visible'].includes(item?.visibility)?item.visibility:null;
  return {
    source:matchesCorrection===true&&changed===true?'matches_latest_staff_correction':matchesOcr===true?'matches_ocr_record':recorded!==null?'differs_from_ocr_record':'no_evidence',
    ocrRecordedValue:Number.isFinite(recorded)?recorded:null,matchesOcr,conflictRecorded:Array.isArray(data.ocrInsights?.conflicts)?data.ocrInsights.conflicts.some(conflict=>conflict?.key===key):null,visibility1:visibility(ocr),visibility2:key==='followers'?null:visibility(data.ocrInsights?.screenshot2?.[key]),
    ocrReadAt:timestamp(key==='followers'?data.ocrProfile?.readAt:data.ocrInsights?.readAt),
    latestCorrection:correctionRecorded?{at:timestamp(correction.correctedAt),previousValue:prior,newValue:corrected,matchesCurrentValue:matchesCorrection,changedInThisRecord:changed}:null
  };
}
export function createTools(reader) {
  return {
    async list_recent_applications({limit=5}) {
      const documents=await reader.recent(limit);
      return {applications:documents.map(({id,data})=>({id,date:data.date,status:states.has(data.status)?data.status:'unknown',metrics:observed(calculate(data)),saved:saved(data)})),
        ordering:['date DESC','document ID DESC'],limit,maxLimit:20,missingDateDocumentsExcluded:true,identityAndScreenshotsOmitted:true};
    },
    async get_application_metrics({applicationId}) {
      const document=await reader.application(applicationId);
      if (!document) throw new DataError('APPLICATION_NOT_FOUND');
      const config=await loadConfiguration(reader,{includeBenchmarks:false}),data=document.data,result=calculate(data,config.scoring.value),stored=saved(data);
      const comparable=stored.version===SCORING_VERSION&&stored.socialScore!==null&&result.socialScore!==null;
      return {
        id:document.id,schemaVersion:Number.isInteger(data.schemaVersion)?data.schemaVersion:null,date:timestamp(data.date),updatedAt:timestamp(data.updatedAt),
        metrics:observed(result),saved:stored,
        recalculated:{...result,classification:scoreLevels.classify(result.socialScore,config.levels.value.social),engagementClassification:scoreLevels.classify(result.engagementScore,config.levels.value.metrics),visibilityClassification:scoreLevels.classify(result.visibilityScore,config.levels.value.metrics)},
        comparison:{sameScoringVersion:stored.version===SCORING_VERSION,numericDifference:comparable?result.socialScore-stored.socialScore:null,submissionConfigUnavailable:true,differenceDoesNotProveError:true},
        provenance:Object.fromEntries(metricKeys.map(key=>[key,evidence(data,key,result[key])])),
        configurationSources:{scoring:config.scoring.source,levels:config.levels.source},
        limitations:{ocrRecordsAreNotIndependentVerification:true,fullHistoryNotRead:true,identityAndScreenshotsOmitted:true,consistentSnapshot:false}
      };
    },
    async get_scoring_configuration() { return loadConfiguration(reader); }
  };
}
