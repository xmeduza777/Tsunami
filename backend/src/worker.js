const allowedTemplates = new Set(["romance","hero","space","cyber","premiere","magic"]);
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers}});
function cors(origin,env){const permitted=origin===env.FRONTEND_ORIGIN;return permitted?{"Access-Control-Allow-Origin":origin,"Vary":"Origin","Access-Control-Allow-Headers":"Authorization,Content-Type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"}:{};}
const bytes=s=>new TextEncoder().encode(s);
function safeEqual(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;}
function hexToBytes(hex){if(!/^[0-9a-f]+$/i.test(hex)||hex.length%2)return new Uint8Array();return Uint8Array.from(hex.match(/../g).map(h=>parseInt(h,16)));}
async function hmac(key,data){const k=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",k,bytes(data)));}
async function authorized(request,env){
 const value=request.headers.get("Authorization")||"";
 if(!value.startsWith("tma "))throw {code:401,message:"TELEGRAM_AUTH_REQUIRED"};
 if(!env.BOT_TOKEN)throw {code:503,message:"BOT_TOKEN_NOT_CONFIGURED"};
 const params=new URLSearchParams(value.slice(4));
 const received=params.get("hash")||"";
 const authDate=Number(params.get("auth_date"));
 if(!authDate||Math.abs(Date.now()/1000-authDate)>3600)throw {code:401,message:"AUTH_EXPIRED"};
 const entries=[...params.entries()].filter(([k])=>k!=="hash"&&k!=="signature").sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const secret=await hmac(bytes("WebAppData"),env.BOT_TOKEN);
 const signature=await hmac(secret,entries);
 if(!safeEqual(signature,hexToBytes(received)))throw {code:401,message:"INVALID_TELEGRAM_SIGNATURE"};
 let user;try{user=JSON.parse(params.get("user")||"{}")}catch{}
 if(!Number.isSafeInteger(user?.id)||user.id<=0)throw {code:401,message:"INVALID_USER"};
 await env.DB.prepare("INSERT OR IGNORE INTO users(id,first_name,credits) VALUES(?,?,0)").bind(user.id,String(user.first_name||"").slice(0,100)).run();
 return user;
}
export default {async fetch(request,env){
 const origin=request.headers.get("Origin")||"";
 const headers=cors(origin,env);
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(origin&&origin!==env.FRONTEND_ORIGIN)return json({error:"ORIGIN_NOT_ALLOWED"},403,headers);
 try{
 const url=new URL(request.url);
 if(url.pathname==="/health"&&request.method==="GET")return json({status:"ok",generation:"disabled",payments:"disabled"},200,headers);
 if(!env.DB)throw {code:503,message:"DATABASE_NOT_CONFIGURED"};
 const user=await authorized(request,env);
 if(url.pathname==="/me"&&request.method==="GET"){
 const row=await env.DB.prepare("SELECT id,first_name,credits,created_at FROM users WHERE id=?").bind(user.id).first();
 return json({user:row},200,headers);
 }
 if(url.pathname==="/jobs"&&request.method==="GET"){
 const rows=await env.DB.prepare("SELECT id,template_id,cost,status,created_at,updated_at FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(user.id).all();
 return json({jobs:rows.results},200,headers);
 }
 if(url.pathname==="/demo/orders"&&request.method==="POST"){
 if(env.DEMO_MODE!=="true")throw {code:404,message:"NOT_FOUND"};
 const body=await request.json().catch(()=>null);
 if(!allowedTemplates.has(body?.template_id))throw {code:400,message:"INVALID_TEMPLATE"};
 const id=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO jobs(id,user_id,template_id,cost,status) VALUES(?,?,?,0,'completed')").bind(id,user.id,body.template_id).run();
 return json({id,status:"completed",demo:true,no_video:true},201,headers);
 }
 if(url.pathname==="/jobs"&&request.method==="POST"){
 return json({error:"GENERATION_NOT_CONFIGURED",message:"No real uploads or credit deductions are enabled yet."},503,headers);
 }
 return json({error:"NOT_FOUND"},404,headers);
 }catch(e){return json({error:e.message||"INTERNAL_ERROR"},e.code||500,headers)}
}};
