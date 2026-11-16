import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {clockText,idleText,sqliteUtcToMs,timeContext} from '../src/time-context.js';
import {memoryLine,memoryTier,episodeLine,summaryLine} from '../src/memory-tiers.js';

const at=Date.parse('2026-11-10T02:36:27Z');
test('time context renders real local time, last turn and idle duration',()=>{
  assert.equal(clockText(at),'2026-11-10 10:36:27');
  assert.equal(clockText(at,{seconds:false}),'2026-11-10 10:36');
  assert.equal(idleText(30000),'不到1分钟');assert.equal(idleText(720000),'12分钟');
  assert.equal(idleText(3*3600000+5*60000),'3小时5分钟');assert.equal(idleText(2*86400000+3*3600000),'2天3小时');
  const text=timeContext({now:at,lastTurnAt:at-720000,timeZone:'Asia/Shanghai'});
  assert.match(text,/^### 当前时间/);assert.match(text,/现在是 2026-11-10 10:36:27（周二，Asia\/Shanghai，UTC\+08:00）/);
  assert.match(text,/上一轮对话结束于 2026-11-10 10:24:27，中间空闲了 12分钟（约 720 秒）/);
  assert.match(timeContext({now:at}),/还没有可用的上一轮对话记录/);
  assert.equal(sqliteUtcToMs('2026-11-10 02:36:27'),at);
});
test('long term memories carry a tier label and first-seen timestamp',()=>{
  const s=new Store(':memory:');s.meta('platform','qq');
  try{
    const saved=s.remember('qq:9:private:7','饮料','喜欢乌龙茶',{type:'preference'});
    assert.equal(saved.status,'saved');
    const m=s.memory(saved.id);
    assert.ok(m?.firstSeen);assert.equal(memoryTier(m),'长期偏好');
    const line=memoryLine(m);
    assert.match(line,/^\[长期偏好 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}\] 记忆#\d+ 饮料: 喜欢乌龙茶\n$/);
    assert.match(memoryLine(m,{member:'7'}),/\] 成员 7 · 记忆#/);
    assert.match(episodeLine({id:4,created:'2026-11-09 16:20:00',text:'今天吃了面'},{speaker:'7'}),/^\[近期原文 · 2026-11-10 00:20\] 旧事#4 · 发言者 7：今天吃了面\n$/);
    assert.match(summaryLine('之前聊过晚饭',{updated:'2026-11-09 16:20:00'}),/^\[阶段摘要 · 2026-11-10\] 之前聊过晚饭$/);
  }finally{s.close();}
});
