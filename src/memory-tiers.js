import {oldMemoryNotice} from './memory-salience.js';
import {clockText,dayText,sqliteUtcToMs} from './time-context.js';
export const memoryTierLabels={fact:'长期事实',preference:'长期偏好',event:'长期事件',commitment:'长期约定'};
export function memoryTier(memory){return memoryTierLabels[memory?.type]??'长期事实';}
export function memoryTime(memory){return memory?.firstSeen??memory?.confirmedAt??memory?.updated??null;}
export function memoryStamp(memory,{timeZone='Asia/Shanghai'}={}){
  const at=sqliteUtcToMs(memoryTime(memory));return at?clockText(at,{timeZone,seconds:false}):'时间未知';
}
export function memoryLine(memory,{member='',timeZone='Asia/Shanghai'}={}){
  const uncertainty=oldMemoryNotice(memory);return `[${memoryTier(memory)} · ${memoryStamp(memory,{timeZone})}]${member?` 成员 ${member} · `:' '}记忆#${memory.id} ${memory.key}: ${memory.value}${uncertainty?'（'+uncertainty+'）':''}\n`;
}
export function episodeLine(row,{speaker='',timeZone='Asia/Shanghai'}={}){
  const at=sqliteUtcToMs(row?.created);
  return `[近期原文 · ${at?clockText(at,{timeZone,seconds:false}):'时间未知'}] 旧事#${row.id} · 发言者 ${speaker}：${row.text}\n`;
}
export function summaryLine(line,{updated=null,timeZone='Asia/Shanghai'}={}){
  const at=sqliteUtcToMs(updated);return `[阶段摘要${at?' · '+dayText(at,{timeZone}):''}] ${line}`;
}
