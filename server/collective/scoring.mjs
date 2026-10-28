// Scoring v2 (Modello A), configurazione versione 3. Stesse formule di app/admin.jsx, sezione 5:
// i test di parità confrontano i due calcoli. La versione 2 apparteneva al modello precedente
// (ER/Reach/Growth per fascia follower) e non viene più applicata né convertita.
import {exact, number, fail, freeze} from './validation.mjs';

export const SCORING_VERSION = 3;   // incrementare quando cambiano formule o riferimenti predefiniti

export const DEFAULT_SCORING = freeze({
  version: SCORING_VERSION,
  // 65% coinvolgimento (interazioni / visualizzazioni), 35% visibilità (volume delle visualizzazioni).
  weights: { engagement:65, visibility:35 },
  // Riferimenti iniziali sperimentali: il valore di riferimento vale 50/100.
  references: { engagementRate:2, views:30000 },
  // Basi di osservazione estremamente ridotte: solo segnalate, il punteggio non viene corretto.
  lowBase: { views:1000, interactions:10 }
});

/* scoring-core:start — testo identico in app/admin.jsx (verificato dai test) */
// Normalizzazione continua e crescente, senza soglie né fasce: 0 → 0, riferimento → 50, verso 100 senza raggiungerlo.
const saturate = (value, reference) => value > 0 ? 100 * value / (value + reference) : 0;

// Valori osservati: interi non negativi (numero o stringa di sole cifre nelle candidature storiche).
// Un valore mancante o non valido resta null: non diventa mai zero.
const count = v => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};
const signedCount = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^[+-]?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};
const round2 = v => v === null ? null : Math.round(v * 100) / 100;

const computeWithConfig = (data, cfg) => {
  const followers    = count(data.followers);
  const views        = count(data.views);
  const interactions = count(data.interactions);
  const reached      = count(data.accountsReached);
  const net          = signedCount(data.netFollowers);

  // Indicatore B: secondario, mai nel punteggio, solo con account raggiunti indicati e maggiori di zero.
  const reachEngagementRate = interactions !== null && reached !== null && reached > 0 ? interactions / reached * 100 : null;
  const missing = [];
  if (views === null) missing.push("views");
  if (interactions === null) missing.push("interactions");
  const lowBaseReasons = [];
  if (views !== null && views < cfg.lowBase.views) lowBaseReasons.push("views");
  if (interactions !== null && interactions < cfg.lowBase.interactions) lowBaseReasons.push("interactions");

  const observed = { followers, views, interactions, netFollowers:net, accountsReached:reached };
  if (missing.length) return {
    scoringVersion:SCORING_VERSION, available:false, missing, socialScore:null,
    engagementRate:null, engagementScore:null, visibilityScore:null, reachEngagementRate,
    lowBase:lowBaseReasons.length > 0, lowBaseReasons, ...observed
  };

  // Senza visualizzazioni il coinvolgimento non è definito: componente 0 e base segnalata come ridotta.
  const engagementRate  = views > 0 ? interactions / views * 100 : null;
  const engagementScore = engagementRate === null ? 0 : saturate(engagementRate, cfg.references.engagementRate);
  const visibilityScore = saturate(views, cfg.references.views);
  const w  = cfg.weights;
  const tw = w.engagement + w.visibility;
  const socialScore = Math.round((engagementScore * w.engagement + visibilityScore * w.visibility) / tw);

  return {
    scoringVersion:SCORING_VERSION, available:true, missing, socialScore,
    engagementRate, engagementScore, visibilityScore, reachEngagementRate,
    lowBase:lowBaseReasons.length > 0, lowBaseReasons, ...observed
  };
};

/** Campi salvati sulla candidatura: stessi arrotondamenti nel Worker e nell'Admin. */
const scoreDocumentFields = s => ({
  scoringVersion: s.scoringVersion,
  socialScore: s.socialScore,
  engagementRate: round2(s.engagementRate),
  engagementScore: s.engagementScore === null ? null : Math.round(s.engagementScore),
  visibilityScore: s.visibilityScore === null ? null : Math.round(s.visibilityScore),
  reachEngagementRate: round2(s.reachEngagementRate),
  lowBase: s.lowBase
});
/* scoring-core:end */
export {scoreDocumentFields};

// Strict validation of the stored v3 config, not an authorization check.
export function validateScoringConfig(input) {
  exact(input, ['version','weights','references','lowBase'], '$scoring');
  if (input.version !== SCORING_VERSION) fail('VERSION', '$scoring.version');
  exact(input.weights, ['engagement','visibility'], '$scoring.weights');
  for (const key of ['engagement','visibility']) number(input.weights[key], 0, 100, `$scoring.weights.${key}`);
  if (input.weights.engagement + input.weights.visibility <= 0) fail('RANGE', '$scoring.weights');
  exact(input.references, ['engagementRate','views'], '$scoring.references');
  number(input.references.engagementRate, 0, 100, '$scoring.references.engagementRate');
  number(input.references.views, 1, 1e12, '$scoring.references.views');
  if (input.references.engagementRate <= 0) fail('RANGE', '$scoring.references.engagementRate');
  exact(input.lowBase, ['views','interactions'], '$scoring.lowBase');
  for (const key of ['views','interactions']) number(input.lowBase[key], 0, 1e12, `$scoring.lowBase.${key}`, true);
  return structuredClone(input);
}

// Trusted stored configs only. Missing or previous-model configs (version 1/2) → defaults:
// they are never converted, so the old thresholds are not reused. Invalid v3 fails closed.
export function resolveScoringConfig(stored) {
  if (stored == null) return validateScoringConfig(DEFAULT_SCORING);
  if (typeof stored !== 'object' || Array.isArray(stored)) fail('TYPE','$scoring');
  if (stored.version !== SCORING_VERSION) return validateScoringConfig(DEFAULT_SCORING);
  return validateScoringConfig(stored);
}

export function computeScore(data, storedConfig = null) {
  return computeWithConfig(data, resolveScoringConfig(storedConfig));
}
