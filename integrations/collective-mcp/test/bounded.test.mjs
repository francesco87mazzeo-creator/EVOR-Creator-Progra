import{test}from'node:test';import assert from'node:assert/strict';
import{boundedText,BodyLimitError}from'../src/bounded.mjs';
import{dataFixture}from'./helpers.mjs';import{createReader}from'../src/reader.mjs';
test('bounded bodies count bytes, not characters, and reject declared or streamed excess',async()=>{
 assert.equal(await boundedText(new Response('é'),2),'é');
 await assert.rejects(()=>boundedText(new Response('é'),1),BodyLimitError);
 await assert.rejects(()=>boundedText(new Response('x',{headers:{'content-length':'100'}}),2),BodyLimitError);
 const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('123'));controller.enqueue(new TextEncoder().encode('456'));controller.close();}});
 await assert.rejects(()=>boundedText(new Response(stream),5),BodyLimitError);
});
test('bounded body timeout cancels a stalled upstream',async()=>{
 let cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true;}});
 await assert.rejects(()=>boundedText(new Response(stream),100,10),BodyLimitError);assert.equal(cancelled,true);
});
test('reader rejects huge JSON and unsafe integer conversion',async()=>{
 const channel={fetch:async()=>Response.json({name:'projects/demo-evora-mcp/databases/(default)/documents/settings/scoring',fields:{secret:{stringValue:'x'.repeat(262145)}}})};
 const reader=createReader({channel,projectId:'demo-evora-mcp'});await assert.rejects(()=>reader.setting('scoring'));
 const fixture=dataFixture();const original=fixture.channel.fetch;fixture.channel.fetch=async request=>{const response=await original(request),body=await response.json();body.fields.followers={integerValue:'9007199254740992'};return Response.json(body);};
 await assert.rejects(()=>fixture.reader.application('application_b'));
});
