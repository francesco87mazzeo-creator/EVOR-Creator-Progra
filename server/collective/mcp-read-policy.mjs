// One narrow, audited projection policy for the private MCP service and its client.
// Identity, contacts, screenshots, notes, full history and creator codes are never requested.
export const METRICS = Object.freeze(['followers','views','interactions','accountsReached','netFollowers']);
const SCORES = ['scoringVersion','socialScore','engagementRate','engagementScore','visibilityScore','reachEngagementRate','lowBase','erRate','reachRate','growthRate'];
export const RECENT_FIELDS = Object.freeze(['date','status','schemaVersion',...METRICS,...SCORES]);
export const DETAIL_FIELDS = Object.freeze([...RECENT_FIELDS,'updatedAt','ocrInsights.merged','ocrInsights.readAt','ocrInsights.conflicts',
  ...['screenshot1','screenshot2'].flatMap(screen=>['screenType',...METRICS.filter(k=>k!=='followers')].map(key=>`ocrInsights.${screen}.${key}`)),
  'ocrProfile.result.followers','ocrProfile.readAt','insightsCorrection.correctedAt','insightsCorrection.previousValues','insightsCorrection.newValues']);
export const SETTING_FIELDS = Object.freeze({
  scoring:Object.freeze(['version','weights','references','lowBase']),
  instagramBenchmarks:Object.freeze(['version','interpolation','followers','storageFormat','engagement','reach','growth']),
  scoreLevels:Object.freeze(['version','social','metrics','maxLevels'])
});
export const validMcpDocumentId = id => typeof id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
