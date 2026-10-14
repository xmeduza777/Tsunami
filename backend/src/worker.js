const allowedTemplates = new Set(["romance","hero","space","cyber","premiere","magic"]);
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers}});
function cors(origin,env){const permitted=origin===env.FRONTEND_ORIGIN;return permitted?{"Access-Control-Allow-Origin":origin,"Vary":"Origin","Access-Control-Allow-Headers":"Authorization,Content-Type","Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS"}:{};}
const bytes=s=>new TextEncoder().encode(s);
function safeEqual(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;}
function hexToBytes(hex){if(!/^[0-9a-f]+$/i.test(hex)||hex.length%2)return new Uint8Array();return Uint8Array.from(hex.match(/../g).map(h=>parseInt(h,16)));}
async function hmac(key,data){const k=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",k,bytes(data)));}
async function authorized(request,env){
 const value=request.headers.get("Authorization")||"";
 if(!value.startsWith("tma "))throw {code:401,message:"TELEGRAM_AUTH_REQUIRED"};
 if(!env.BOT_TOKEN)throw {code:503,message:"BOT_TOKEN_NOT_CONFIGURED"};
 if(value.length>8192)throw {code:401,message:"AUTH_TOO_LARGE"};
 const params=new URLSearchParams(value.slice(4));
 const received=params.get("hash")||"";
 const authDate=Number(params.get("auth_date"));
 if(!Number.isInteger(authDate)||authDate>Date.now()/1000+60||Date.now()/1000-authDate>3600)throw {code:401,message:"AUTH_EXPIRED"};
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
 if(url.pathname==="/health"&&request.method==="GET")return json({status:"ok",generation:"disabled",payments:"disabled",version:"0.4-dev"},200,headers);
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
 if(Number(request.headers.get("Content-Length")||0)>2048)throw {code:413,message:"BODY_TOO_LARGE"};
 const body=await request.json().catch(()=>null);
 if(!allowedTemplates.has(body?.template_id))throw {code:400,message:"INVALID_TEMPLATE"};
 const daily=await env.DB.prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id=? AND created_at>=datetime('now','-1 day')").bind(user.id).first();
 if(Number(daily?.count||0)>=20)throw {code:429,message:"DEMO_LIMIT_REACHED"};
 const id=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO jobs(id,user_id,template_id,cost,status) VALUES(?,?,?,0,'completed')").bind(id,user.id,body.template_id).run();
 return json({id,status:"completed",demo:true,no_video:true},201,headers);
 }
 
 if(url.pathname==="/drafts"&&request.method==="POST"){
  if(env.DEMO_MODE!=="true")throw {code:404,message:"NOT_FOUND"};
  if(!env.PHOTOS)throw {code:503,message:"STORAGE_NOT_CONFIGURED"};
  const size=Number(request.headers.get("Content-Length")||0);
  if(size>9*1024*1024)throw {code:413,message:"BODY_TOO_LARGE"};
  const form=await request.formData().catch(()=>null);
  const template=form?.get("template_id");
  const consent=form?.get("consent");
  const file=form?.get("photo");
  if(!allowedTemplates.has(template))throw {code:400,message:"INVALID_TEMPLATE"};
  if(consent!=="true")throw {code:400,message:"CONSENT_REQUIRED"};
  if(!file||typeof file.arrayBuffer!=="function"||typeof file.size!=="number")throw {code:400,message:"PHOTO_REQUIRED"};
  if(file.size<100||file.size>8*1024*1024)throw {code:413,message:"INVALID_PHOTO_SIZE"};
  const types={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
  const ext=types[file.type];
  if(!ext)throw {code:415,message:"INVALID_PHOTO_TYPE"};
  const buf=await file.arrayBuffer();
  const arr=new Uint8Array(buf);
  const jpg=arr[0]===255&&arr[1]===216&&arr[2]===255;
  const png=arr[0]===137&&arr[1]===80&&arr[2]===78&&arr[3]===71&&arr[4]===13&&arr[5]===10&&arr[6]===26&&arr[7]===10;
  const webp=String.fromCharCode(...arr.slice(0,4))==="RIFF"&&String.fromCharCode(...arr.slice(8,12))==="WEBP";
  if(!({jpg,png,webp}[ext]))throw {code:415,message:"INVALID_PHOTO_CONTENT"};
  const daily=await env.DB.prepare("SELECT COUNT(*) AS count FROM jobs WHERE user_id=? AND created_at>=datetime('now','-1 day')").bind(user.id).first();
  if(Number(daily?.count||0)>=20)throw {code:429,message:"DAILY_LIMIT_REACHED"};
  const id=crypto.randomUUID();
  const key="drafts/"+user.id+"/"+id+"."+ext;
  await env.PHOTOS.put(key,buf,{httpMetadata:{contentType:file.type},customMetadata:{purpose:"unprocessed-draft"}});
  try{
   await env.DB.prepare("INSERT INTO jobs(id,user_id,template_id,cost,status,image_key) VALUES(?,?,?,0,'draft',?)").bind(id,user.id,template,key).run();
  }catch(e){await env.PHOTOS.delete(key);throw e;}
  return json({id,status:"draft",video_generated:false,charged:false},201,headers);
 }
 const draftId=url.pathname.match(/^\/drafts\/([0-9a-f-]{36})$/)?.[1];
 if(draftId&&request.method==="DELETE"){
  const existing=await env.DB.prepare("SELECT id,image_key,status FROM jobs WHERE id=? AND user_id=?").bind(draftId,user.id).first();
  if(!existing||existing.status!=="draft")throw {code:404,message:"DRAFT_NOT_FOUND"};
  await env.DB.prepare("DELETE FROM jobs WHERE id=? AND user_id=? AND status='draft'").bind(draftId,user.id).run();
  if(existing.image_key&&env.PHOTOS)await env.PHOTOS.delete(existing.image_key);
  return json({deleted:true},200,headers);
 }
 if(url.pathname==="/jobs"&&request.method==="POST"){
 return json({error:"GENERATION_NOT_CONFIGURED",message:"No real uploads or credit deductions are enabled yet."},503,headers);
 }
 return json({error:"NOT_FOUND"},404,headers);
 }catch(e){const code=Number.isInteger(e?.code)&&e.code>=400&&e.code<600?e.code:500;return json({error:code===500?"INTERNAL_ERROR":e.message},code,headers)}
}};
