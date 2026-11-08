// Diagnose public identifier shapes without exposing any credential bytes.
export function validateBreezeKey(value){
  if(typeof value!=='string'||!/^[\x21-\x7e]{8,512}$/.test(value))throw Error('Breeze API Key格式无效');
  if(/^key_/i.test(value))throw Error('这里填入的是密钥ID（key_开头），不是API Key。请复制创建或轮换时显示的完整api_key（通常brz_开头），不要复制列表中的ID。');
  if(/^voc_/i.test(value))throw Error('这里填入的是音色ID，请将它填入人格音色绑定；API Key需使用官网开发者密钥。');
  if(/[*…•]/u.test(value)||/^\$|YOUR_|xxxx|your.api.key/i.test(value))throw Error('请填写完整Breeze API Key，不能使用掩码或文档占位符。');
  return value;
}
