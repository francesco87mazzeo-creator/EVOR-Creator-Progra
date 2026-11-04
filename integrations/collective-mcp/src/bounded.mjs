export class BodyLimitError extends Error {}
// Bound streamed bodies before JSON parsing; never put upstream content in errors/logs.
export async function boundedText(message, maxBytes, timeoutMs=5000) {
  const length=message.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length)>maxBytes) throw new BodyLimitError('BODY_LIMIT');
  if (!message.body) return '';
  const reader=message.body.getReader(),chunks=[];let total=0,timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new BodyLimitError('BODY_TIMEOUT')),timeoutMs);});
  try {
    while(true){
      const {value,done}=await Promise.race([reader.read(),timeout]);if(done)break;
      total+=value.byteLength;if(total>maxBytes)throw new BodyLimitError('BODY_LIMIT');chunks.push(value);
    }
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  } finally { clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock(); }
}
