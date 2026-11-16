"""Restore the reviewed WeChat voice component after the client restarted.

Checks the exact 4.2.0.13 build and the recorded human acceptance first, then runs
the reviewed loader twice: finite trial load, then validated rearm. Refuses to act
when anything does not match. No synthesis, no message sending.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'data' / 'wechat-native-research'
LOADER = ROOT / 'scripts' / 'load-wechat-voice.py'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def health(port, token):
    request = urllib.request.Request('http://127.0.0.1:%d/health' % port,
                                     headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)


def fail(message):
    print('[停止] ' + message)
    raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='only verify preconditions')
    args = parser.parse_args()

    manifest = read(BASE / 'build-voice' / 'manifest.json')
    dll = BASE / 'build-voice' / 'XiaoyuWechatVoice.dll'
    if manifest.get('offlineTest') is not False or manifest.get('voiceExperimental') is not True:
        fail('语音组件不是已评审的实验构建，拒绝加载')
    sha = manifest.get('dllSha256', '')
    if not dll.is_file() or len(sha) != 64:
        fail('缺少语音组件文件，请先完成构建')

    hook = read(BASE / 'session.json')
    try:
        status = health(hook['port'], hook['token'])
    except Exception:
        fail('微信原生组件未连接，请先在小鱼里连接微信再试')
    if status.get('pid') != hook['pid'] or status.get('verified') is not True or status.get('version') != '4.2.0.13':
        fail('当前微信进程与已核验的 4.2.0.13 构建不一致，请重新连接微信')
    if status.get('accountDirectory') != hook.get('accountDirectory'):
        fail('微信账号与记录不一致，请重新连接微信')

    validation = read(BASE / 'voice-validation.json')
    if validation.get('confirmed') is not True or validation.get('voiceBubbleVerified') is not True or validation.get('dllSha256') != sha:
        fail('缺少与当前语音组件一致的人工播放验收记录')

    def live_limit():
        try:
            previous = read(BASE / 'voice-session.json')
            live = health(previous['port'], previous['token'])
        except Exception:
            return 0
        if (live.get('integration') != 'XiaoyuVoice-1' or live.get('pid') != status['pid']
                or live.get('verified') is not True or previous.get('dllSha256') != sha):
            return 0
        return int(live.get('limit') or 0)

    def armed():
        return live_limit() > 1

    if armed():
        print('[已就绪] 微信语音组件已在当前微信进程中可用，无需重复加载')
        return
    print('[检查] 微信 %d，账号 %s，语音组件 %s' % (status['pid'], status['accountDirectory'], sha[:12]))
    if args.check:
        print('[试运行] 条件满足；实际执行会加载语音组件并开放已验收的发送上限')
        return

    python = sys.executable
    def run(*extra):
        env = dict(os.environ, PYTHONIOENCODING='utf-8')
        child = subprocess.run([python, '-B', str(LOADER), '--confirm-sha256', sha, *extra],
                               capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
        out = (child.stdout or '') + (child.stderr or '')
        print(out.strip())
        return child.returncode

    if live_limit() == 1:
        print('[1/2] 语音组件已在当前微信进程中试接，跳过加载')
    else:
        print('[1/2] 加载语音组件（单次试接上限）')
        if run() != 0:
            fail('加载失败：请确认微信没有以管理员权限运行；若提示已加载，请完全退出微信后重开再试')
    print('[2/2] 按既有验收重新开放发送上限')
    if run('--enable-validated') != 0:
        fail('重新开放失败；语音组件已加载但发送上限仍为单次，请重启微信后重试')
    if not armed():
        fail('加载后健康检查未通过，语音仍未就绪')
    print('[完成] 微信语音已恢复；回小鱼里发一条语音即可验证')


if __name__ == '__main__':
    main()
