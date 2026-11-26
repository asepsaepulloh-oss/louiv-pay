import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
export const mode=process.env.PAY_MODE||'sandbox';
export const digest=s=>createHash('sha256').update(s).digest('hex');
export const equal=(a,b)=>timingSafeEqual(Buffer.from(digest(a),'hex'),Buffer.from(digest(b),'hex'));
export function bad(status,message){throw Object.assign(new Error(message),{status,expose:true});}
export function seal(value){
 const key=Buffer.from(process.env.DATA_KEY||'','hex');if(key.length!==32)bad(503,'DATA_KEY belum valid.');
 const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
 const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return [iv,cipher.getAuthTag(),bytes].map(b=>b.toString('base64')).join('.');
}
export function unseal(value){const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64'));const c=createDecipheriv('aes-256-gcm',Buffer.from(process.env.DATA_KEY,'hex'),iv);c.setAuthTag(tag);return JSON.parse(Buffer.concat([c.update(data),c.final()]));}
const tables=[
 'CREATE TABLE IF NOT EXISTS lp_orders(id text PRIMARY KEY, mode text NOT NULL, channel text NOT NULL, total integer NOT NULL,status text NOT NULL,created bigint NOT NULL,expires bigint NOT NULL, tx text, data text NOT NULL, UNIQUE(channel,tx))',
 "CREATE UNIQUE INDEX IF NOT EXISTS lp_amount ON lp_orders(channel,total) WHERE status='pending'",
 'CREATE TABLE IF NOT EXISTS lp_settings(id text PRIMARY KEY,value text NOT NULL)',
 'CREATE TABLE IF NOT EXISTS lp_keys(id text PRIMARY KEY,mode text NOT NULL,name text NOT NULL,digest text UNIQUE NOT NULL,prefix text NOT NULL,created bigint NOT NULL,revoked integer NOT NULL DEFAULT 0)',
 'CREATE TABLE IF NOT EXISTS lp_events(id text PRIMARY KEY,mode text NOT NULL,url text NOT NULL,secret text NOT NULL,body text NOT NULL,state text NOT NULL,attempts integer NOT NULL,next bigint NOT NULL,code integer,lease text)',
 'CREATE TABLE IF NOT EXISTS lp_sessions(token text PRIMARY KEY,expires bigint NOT NULL)'
];
let pool,sqlite,queue=Promise.resolve(),ready=false;
export async function transaction(fn){
 if(!['sandbox','live'].includes(mode))bad(503,'PAY_MODE salah.');
 if(process.env.DATABASE_URL){
   const {Pool}=await import('pg');pool||=new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:6000}); const c=await pool.connect();
   try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='12s'");await c.query('SELECT pg_advisory_xact_lock(18263541)');
     const q=async(s,p=[])=>(await c.query(s,p)).rows;if(!ready)for(const s of tables)await q(s);
     const result=await fn(q);await c.query('COMMIT');ready=true;return result;
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 if(mode!=='sandbox'||process.env.VERCEL||process.env.RAILWAY_ENVIRONMENT_ID)bad(503,'Isi DATABASE_URL pada hosting.');
 const task=queue.then(async()=>{
   if(!sqlite){const {DatabaseSync}=await import('node:sqlite');sqlite=new DatabaseSync(process.env.LOCAL_DB||'louiv-sandbox.sqlite');for(const s of tables)sqlite.exec(s);}
   const q=async(s,p=[])=>{const args=[];const stmt=sqlite.prepare(s.replace(/\$(\d+)/g,(_,n)=>{args.push(p[Number(n)-1]);return '?';}));return stmt.all(...args);};
   sqlite.exec('BEGIN IMMEDIATE');try{const result=await fn(q);sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}
 });queue=task.catch(()=>{});return task;
}
export const setting=async(q,id)=> (await q('SELECT value FROM lp_settings WHERE id=$1',[id]))[0]?.value;
export const save=(q,id,value)=>q('INSERT INTO lp_settings(id,value) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET value=excluded.value',[id,value]);
