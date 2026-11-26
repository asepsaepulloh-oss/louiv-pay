import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./shopee_login.py',import.meta.url));
export function pythonLogin(action,input){
  return new Promise((resolve,reject)=>{
    const child=execFile(process.env.PYTHON_BIN||'python3',[script],{timeout:45000,maxBuffer:1024*1024,windowsHide:true},(error,stdout)=>{
      if(error)return reject(new Error('Python login unavailable'));
      try{
        const response=JSON.parse(stdout);
        if(!response.result)throw Object.assign(new Error('Provider login failed'),{code:response.error});
        resolve(response.result);
      }catch(e){reject(e);}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({...input,action}));
  });
}
