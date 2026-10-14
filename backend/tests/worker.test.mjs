import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import worker from "../src/worker.js";
globalThis.crypto ??= webcrypto;
const origin="https://xmeduza777.github.io";
const env=()=>({FRONTEND_ORIGIN:origin,DEMO_MODE:"true",BOT_TOKEN:"test-token",DB:{
 prepare(sql){return {bind(...values){return {async run(){return {success:true}},async first(){if(sql.includes("COUNT(*)"))return {count:0};return {id:values[0],credits:0}},async all(){return {results:[]}}}}}}
}});
const request=(url,options={})=>new Request("https://worker.example"+url,{headers:{Origin:origin,...(options.headers||{})},method:options.method||"GET",body:options.body});
async function auth(user={id:1234,first_name:"Тест"}){
 const pairs=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify(user)});
 const data=[...pairs.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const mac=async(key,txt)=>{const k=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(txt)))};
 const secret=await mac(new TextEncoder().encode("WebAppData"),"test-token");
 const signature=await mac(secret,data);
 pairs.set("hash",[...signature].map(x=>x.toString(16).padStart(2,"0")).join(""));
 return "tma "+pairs.toString();
}
test("health is public and generation stays disabled",async()=>{
 const r=await worker.fetch(request("/health"),env());assert.equal(r.status,200);
 const data=await r.json();assert.equal(data.generation,"disabled");assert.equal(data.payments,"disabled");
});
test("rejects untrusted origins",async()=>{
 const r=await worker.fetch(new Request("https://worker.example/health",{headers:{Origin:"https://evil.example"}}),env());
 assert.equal(r.status,403);
});
test("requires Telegram authentication",async()=>{
 const r=await worker.fetch(request("/me"),env());
 assert.equal(r.status,401);assert.equal((await r.json()).error,"TELEGRAM_AUTH_REQUIRED");
});
test("valid Telegram login can read profile",async()=>{
 const r=await worker.fetch(request("/me",{headers:{Authorization:await auth()}}),env());
 assert.equal(r.status,200);assert.equal((await r.json()).user.id,1234);
});
test("rejects forged signature",async()=>{
 const signed=await auth();const forged=signed.replace(/hash=[a-f0-9]{64}/,"hash="+"f".repeat(64));
 const r=await worker.fetch(request("/me",{headers:{Authorization:forged}}),env());
 assert.equal(r.status,401);
});
test("real generation fails closed without billing",async()=>{
 const r=await worker.fetch(request("/jobs",{method:"POST",headers:{Authorization:await auth()}}),env());
 assert.equal(r.status,503);assert.equal((await r.json()).error,"GENERATION_NOT_CONFIGURED");
});
test("demo order accepts allowlisted template",async()=>{
 const r=await worker.fetch(request("/demo/orders",{method:"POST",headers:{Authorization:await auth(),"Content-Type":"application/json"},body:JSON.stringify({template_id:"space"})}),env());
 assert.equal(r.status,201);const data=await r.json();assert.equal(data.demo,true);assert.equal(data.no_video,true);
});
test("demo order rejects unknown template",async()=>{
 const r=await worker.fetch(request("/demo/orders",{method:"POST",headers:{Authorization:await auth(),"Content-Type":"application/json"},body:JSON.stringify({template_id:"unknown"})}),env());
 assert.equal(r.status,400);
});

function photoRequest({type="image/png",bytes=[137,80,78,71,13,10,26,10],consent="true",template="space"}={}){
 const form=new FormData();const data=new Uint8Array([...bytes,...new Array(110).fill(7)]);
 form.append("photo",new Blob([data],{type}),"portrait.png");
 form.append("template_id",template);if(consent!==null)form.append("consent",consent);
 return form;
}
function storageEnv(){
 const e=env();const objects=new Map();
 e.PHOTOS={async put(key,buf){objects.set(key,buf)},async delete(key){objects.delete(key)}};
 const previous=e.DB.prepare;
 e.DB.prepare=(sql)=>{if(sql.startsWith("SELECT id,image_key,status FROM jobs"))return {bind(){return {async first(){return {id:"11111111-1111-4111-8111-111111111111",image_key:"drafts/1234/file.png",status:"draft"}}}}};return previous(sql)};
 return {env:e,objects};
}
test("valid image produces private unpaid draft",async()=>{
 const {env:e,objects}=storageEnv();
 const r=await worker.fetch(request("/drafts",{method:"POST",headers:{Authorization:await auth()},body:photoRequest()}),e);
 assert.equal(r.status,201);const d=await r.json();
 assert.equal(d.status,"draft");assert.equal(d.charged,false);assert.equal(d.video_generated,false);
 assert.equal(objects.size,1);
});
test("draft rejects consent missing",async()=>{
 const {env:e,objects}=storageEnv();
 const r=await worker.fetch(request("/drafts",{method:"POST",headers:{Authorization:await auth()},body:photoRequest({consent:null})}),e);
 assert.equal(r.status,400);assert.equal(objects.size,0);
});
test("draft rejects forged image bytes",async()=>{
 const {env:e,objects}=storageEnv();
 const r=await worker.fetch(request("/drafts",{method:"POST",headers:{Authorization:await auth()},body:photoRequest({bytes:[4,5,6,7,8,9,10,11]})}),e);
 assert.equal(r.status,415);assert.equal(objects.size,0);
});
test("draft deletion checks authenticated user scope",async()=>{
 const {env:e}=storageEnv();
 const r=await worker.fetch(request("/drafts/11111111-1111-4111-8111-111111111111",{method:"DELETE",headers:{Authorization:await auth()}}),e);
 assert.equal(r.status,200);assert.equal((await r.json()).deleted,true);
});
