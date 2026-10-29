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
  return Object.freeze({HARD_MAX_LEVELS,DEFAULT_MAX_LEVELS,ScoreLevelsError,DEFAULT_CONFIG,defaults,validateConfig,classify});
});
