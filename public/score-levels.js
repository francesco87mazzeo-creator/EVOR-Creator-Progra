/* Shared display configuration: no scoring formulas, network, storage or HTML rendering. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CollectiveScoreLevels=api;
})(globalThis,function(){
  'use strict';
  // Integer endpoints and positive-width intervals on 0–100 imply at most 100 levels.
  const HARD_MAX_LEVELS=100,DEFAULT_MAX_LEVELS=20;
  class ScoreLevelsError extends Error{
    constructor(code,path){super(`${code} at ${path}`);this.name='ScoreLevelsError';this.code=code;this.path=path;}
  }
  const fail=(code,path)=>{throw new ScoreLevelsError(code,path);};
  const exact=(v,keys,path,required=keys)=>{
    if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('TYPE',path);
    const descriptors=Object.getOwnPropertyDescriptors(v);
    if(Reflect.ownKeys(descriptors).some(k=>typeof k!=='string'||!keys.includes(k)||!descriptors[k].enumerable||!Object.hasOwn(descriptors[k],'value')))fail('UNKNOWN_FIELD',path);
    if(required.some(k=>!Object.hasOwn(descriptors,k)))fail('MISSING_FIELD',path);
  };
  function validateGroup(input,path,limit){
    if(!Array.isArray(input)||input.length<1||input.length>limit)fail('LEVEL_COUNT',path);
    const ids=new Set();
    const levels=Array.from(input,(v,index)=>{
      const p=`${path}[${index}]`;exact(v,['id','label','color','min','max'],p);
      if(typeof v.id!=='string'||! /^[A-Za-z0-9_-]{1,40}$/.test(v.id)||ids.has(v.id))fail('ID',p+'.id');
      ids.add(v.id);
      if(typeof v.label!=='string'||!v.label.trim()||v.label.length>80||/[\u0000-\u001f\u007f]/.test(v.label))fail('LABEL',p+'.label');
      if(typeof v.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(v.color))fail('COLOR',p+'.color');
      for(const k of ['min','max'])if(!Number.isInteger(v[k])||v[k]<0||v[k]>100)fail('BOUNDARY',p+'.'+k);
      if(v.min>=v.max)fail('EMPTY_INTERVAL',p);
      return{id:v.id,label:v.label.trim(),color:v.color.toUpperCase(),min:v.min,max:v.max};
    }).sort((a,b)=>a.min-b.min);
    if(levels[0].min!==0||levels.at(-1).max!==100)fail('COVERAGE',path);
    for(let i=1;i<levels.length;i++)if(levels[i].min!==levels[i-1].max)fail(levels[i].min<levels[i-1].max?'OVERLAP':'GAP',path);
    return levels;
  }
  function validateConfig(value){
    exact(value,['version','social','metrics','maxLevels'],'$scoreLevels',['version','social','metrics']);
    if(value.version!==1)fail('VERSION','$scoreLevels.version');
    const limits=Object.hasOwn(value,'maxLevels')?value.maxLevels:{social:DEFAULT_MAX_LEVELS,metrics:DEFAULT_MAX_LEVELS};
    exact(limits,['social','metrics'],'$scoreLevels.maxLevels');
    for(const group of ['social','metrics'])if(!Number.isInteger(limits[group])||limits[group]<1||limits[group]>HARD_MAX_LEVELS)fail('MAX_LEVELS','$scoreLevels.maxLevels.'+group);
    const maxLevels={social:limits.social,metrics:limits.metrics};
    return{version:1,maxLevels,social:validateGroup(value.social,'$scoreLevels.social',maxLevels.social),metrics:validateGroup(value.metrics,'$scoreLevels.metrics',maxLevels.metrics)};
  }
  const freeze=v=>{Object.values(v).forEach(x=>{if(x&&typeof x==='object')freeze(x);});return Object.freeze(v);};
  const level=(id,label,color,min,max)=>({id,label,color,min,max});
  const DEFAULT_CONFIG=freeze(validateConfig({version:1,
    social:[level('low','Performance bassa','#C0392B',0,35),level('average','Performance media','#E67E22',35,55),level('good','Performance buona','#27AE60',55,75),level('high','Performance alta','#3A7BD5',75,100)],
    metrics:[level('poor','Scarso','#C0392B',0,25),level('average','Medio','#E67E22',25,50),level('good','Buono','#27AE60',50,75),level('excellent','Eccellente','#3A7BD5',75,100)]}));
  const defaults=()=>JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  // Configs are validated on load/save. Missing/invalid numeric observations have no class.
  function classify(value,levels){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100||!Array.isArray(levels))return null;
    return levels.find(l=>value>=l.min&&(value<l.max||(l.max===100&&value===100)))||null;
  }
  // Observed benchmarks only: never used by the numerical scoring core.
  const benchmarkFollowers=Object.freeze([1000,5000,20000,100000,500000]);
  const benchmarkMetrics=['engagement','reach','growth'];
  const benchmarkDefaults=()=>({version:1,interpolation:'log-pchip-ordered-v2',followers:[...benchmarkFollowers],
    // Soglie EVORΛ approvate il 30 ottobre 2026: calibrazione iniziale, non percentili validati.
    engagement:[[12,24,45],[9,18,34],[7,14,26],[5,10,20],[4,8,16]],
    reach:[[60,120,250],[40,80,160],[30,60,120],[20,40,80],[15,30,60]],
    growth:[[0.5,1.5,3.5],[0.45,1.3,3],[0.35,1.1,2.7],[0.25,0.9,2.2],[0.2,0.7,1.8]]});
  function benchmarkArray(v,length,path){
    if(!Array.isArray(v)||v.length!==length)fail('ROWS',path);
    const d=Object.getOwnPropertyDescriptors(v);
    const keys=[...Array(length).keys()].map(String);
    if(Reflect.ownKeys(d).some(k=>k!=='length'&&!keys.includes(k))||keys.some(k=>!d[k]||!Object.hasOwn(d[k],'value')))fail('ROWS',path);
  }
  function validateBenchmarks(v){
    exact(v,['version','interpolation','followers',...benchmarkMetrics],'$benchmarks');
    if(v.version!==1||!['log-smoothstep-v1','log-pchip-ordered-v2'].includes(v.interpolation))fail('VERSION','$benchmarks');
    benchmarkArray(v.followers,5,'$benchmarks.followers');
    if(v.followers.some((n,i)=>n!==benchmarkFollowers[i]))fail('FOLLOWERS','$benchmarks.followers');
    const out={version:1,interpolation:v.interpolation,followers:[...benchmarkFollowers]};
    for(const metric of benchmarkMetrics){
      benchmarkArray(v[metric],5,metric);
      out[metric]=v[metric].map((row,i)=>{
        benchmarkArray(row,3,metric+'.'+i);
        if(row.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>100000))fail('VALUE',metric+'.'+i);
        if(!(row[0]<row[1]&&row[1]<row[2]))fail('ORDER',metric+'.'+i);
        return [...row];
      });
    }
    return out;
  }
  function legacyThresholds(config,metric,followers){
    if(!benchmarkMetrics.includes(metric)||typeof followers!=='number'||!Number.isFinite(followers)||followers<0)return null;
    const rows=config[metric],xs=config.followers;
    if(followers<=xs[0])return [...rows[0]];
    if(followers>=xs[4])return [...rows[4]];
    const i=xs.findIndex(x=>x>=followers)-1;
    const t=Math.log(followers/xs[i])/Math.log(xs[i+1]/xs[i]);
    const w=t*t*(3-2*t); // convex, C1: no overshoot, crossings or boundary jumps
    return rows[i].map((v,j)=>v+(rows[i+1][j]-v)*w);
  }
  const CURRENT_INTERPOLATION='log-pchip-ordered-v2';
  function pchipSlopes(xs,ys){
    const n=xs.length,h=xs.slice(1).map((x,i)=>x-xs[i]),d=h.map((v,i)=>(ys[i+1]-ys[i])/v),m=Array(n).fill(0);
    for(let i=1;i<n-1;i++)if(d[i-1]*d[i]>0){const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);}
    const end=(a,b,ha,hb)=>{let v=((2*ha+hb)*a-ha*b)/(ha+hb);if(v*a<=0)return 0;if(a*b<0&&Math.abs(v)>3*Math.abs(a))v=3*a;return v;};
    m[0]=end(d[0],d[1],h[0],h[1]);m[n-1]=end(d[n-2],d[n-3],h[n-2],h[n-3]);
    // Ordered Bézier control polygons are a sufficient monotonicity guarantee.
    for(let i=0;i<n-1;i++){const sum=Math.abs(m[i])+Math.abs(m[i+1]),limit=3*Math.abs(d[i]);if(sum>limit){const factor=limit/sum;m[i]*=factor;m[i+1]*=factor;}}
    return m;
  }
  function hermite(xs,ys,m,x){
    if(x<=xs[0])return ys[0];if(x>=xs.at(-1))return ys.at(-1);
    const i=xs.findIndex(v=>v>=x)-1,h=xs[i+1]-xs[i],t=(x-xs[i])/h;
    return(2*t*t*t-3*t*t+1)*ys[i]+(t*t*t-2*t*t+t)*h*m[i]+(-2*t*t*t+3*t*t)*ys[i+1]+(t*t*t-t*t)*h*m[i+1];
  }
  function orderedSlopes(xs,rows){
    const slopes=[0,1,2].map(j=>pchipSlopes(xs,rows.map(row=>row[j])));
    // Reduce a node's three tangents together when an ordered gap control point
    // would be negative. Shared node tangents preserve C1 continuity.
    for(let i=0;i<rows.length;i++){
      let factor=1;
      for(let j=0;j<2;j++){
        const gap=rows[i][j+1]-rows[i][j],delta=slopes[j+1][i]-slopes[j][i];
        if(i<rows.length-1&&delta<0)factor=Math.min(factor,3*gap/((xs[i+1]-xs[i])*-delta));
        if(i>0&&delta>0)factor=Math.min(factor,3*gap/((xs[i]-xs[i-1])*delta));
      }
      for(let j=0;j<3;j++)slopes[j][i]*=Math.max(0,factor);
    }
    return slopes;
  }
  function thresholds(config,metric,followers){
    if(!benchmarkMetrics.includes(metric)||typeof followers!=='number'||!Number.isFinite(followers)||followers<0)return null;
    if(config.interpolation==='log-smoothstep-v1')return legacyThresholds(config,metric,followers);
    const rows=config[metric],xs=config.followers.map(Math.log),m=orderedSlopes(xs,rows),x=Math.log(Math.max(1,followers));
    return[0,1,2].map(j=>hermite(xs,rows.map(row=>row[j]),m[j],x));
  }
  const axisKnots=benchmarkFollowers.map(Math.log),axisTicks=[0,0.24,0.60,0.80,1],axisSlopes=pchipSlopes(axisKnots,axisTicks);
  function axisPosition(followers){
    if(typeof followers!=='number'||!Number.isFinite(followers)||followers<0)return null;
    return hermite(axisKnots,axisTicks,axisSlopes,Math.log(Math.max(1,followers)));
  }
  const upgrade=config=>({...validateBenchmarks(config),interpolation:CURRENT_INTERPOLATION});
  const same=(a,b)=>JSON.stringify(validateBenchmarks(a))===JSON.stringify(validateBenchmarks(b));
  const axisDefaults=Object.freeze({engagement:50,reach:300,growth:10});
  function fitY(rows){const value=Math.max(...rows.flat())*1.1,power=10**Math.floor(Math.log10(Math.max(value,0.01))),ratio=value/power;return Math.min(1000000,(ratio<=1?1:ratio<=2?2:ratio<=5?5:10)*power);}
  function editBenchmark(config,metric,index,level,value,linked){
    const out=validateBenchmarks(config);
    if(!benchmarkMetrics.includes(metric)||!Number.isInteger(index)||index<0||index>4||!Number.isInteger(level)||level<0||level>2||!Number.isFinite(value))fail('VALUE','$edit');
    const row=out[metric][index],delta=value-row[level];
    out[metric][index]=row.map((n,j)=>linked?n+delta:(j===level?value:n));
    return validateBenchmarks(out);
  }
  // Firestore forbids arrays directly containing arrays. Keep the UI/API matrix,
  // but persist named threshold maps; decode only this explicit strict format.
  function benchmarksToDocument(config){
    const out=validateBenchmarks(config);out.storageFormat='named-thresholds-v1';
    for(const metric of benchmarkMetrics)out[metric]=out[metric].map(([medium,good,excellent])=>({medium,good,excellent}));
    return out;
  }
  function benchmarksFromDocument(value){
    exact(value,['version','interpolation','followers','storageFormat',...benchmarkMetrics],'$benchmarkDocument');
    if(value.storageFormat!=='named-thresholds-v1')fail('STORAGE_FORMAT','$benchmarkDocument');
    const out={version:value.version,interpolation:value.interpolation,followers:value.followers};
    for(const metric of benchmarkMetrics){
      benchmarkArray(value[metric],5,metric);
      out[metric]=value[metric].map((row,i)=>{exact(row,['medium','good','excellent'],metric+'.'+i);return[row.medium,row.good,row.excellent];});
    }
    return validateBenchmarks(out);
  }
  const benchmarks=Object.freeze({defaults:benchmarkDefaults,validateConfig:validateBenchmarks,thresholds,axisPosition,axisDefaults,fitY,upgrade,same,CURRENT_INTERPOLATION,edit:editBenchmark,toDocument:benchmarksToDocument,fromDocument:benchmarksFromDocument,metrics:Object.freeze(benchmarkMetrics)});
  return Object.freeze({HARD_MAX_LEVELS,DEFAULT_MAX_LEVELS,ScoreLevelsError,DEFAULT_CONFIG,defaults,validateConfig,classify,benchmarks});
});
