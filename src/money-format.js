export function money2(value){
 const raw=String(value),m=/^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
 if(!m||!(m[2]+(m[3]??''))||raw.length>100||Math.abs(Number(m[4]??0))>100)throw Error('金额格式无效');
 const scale=(m[3]?.length??0)-Number(m[4]??0),n=BigInt((m[2]||'0')+(m[3]??''));
 const cents=scale<=2?n*10n**BigInt(2-scale):(n+10n**BigInt(scale-2)/2n)/10n**BigInt(scale-2);
 return (m[1]&&cents?'-':'')+String(cents/100n)+'.'+String(cents%100n).padStart(2,'0');
}
