#!/usr/bin/env python3
import urllib.request, yaml, json, re, os, sys

def sync_bpb():
    sub_url = os.getenv('BPB_SUB_URL', '')
    if not sub_url:
        print('[INFO] BPB_SUB_URL not set, skipping BPB sync.')
        return False
    try:
        req = urllib.request.Request(sub_url, headers={'User-Agent': 'Clash/Meta'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode('utf-8')
            data = json.loads(raw) if raw.strip().startswith('{') else yaml.safe_load(raw)
    except Exception as e:
        print(f'[WARN] Failed to fetch BPB: {e}', file=sys.stderr)
        return False

    all_proxies = data.get('proxies', [])
    if not all_proxies:
        return False

    # 替换所有已失效的旧 Pages 域名为正常通畅的 1.x8x.dpdns.org
    for p in all_proxies:
        if p.get('server') == 'dqwkozr5kigssbxhbbigvnt0zd3.pages.dev':
            p['server'] = '1.x8x.dpdns.org'
        if p.get('ws-opts', {}).get('headers', {}).get('Host') == 'dqwkozr5kigssbxhbbigvnt0zd3.pages.dev':
            p['ws-opts']['headers']['Host'] = '1.x8x.dpdns.org'
        if p.get('servername') in ['dqwkozr5kigssbxhbbigvnt0zd3.pages.dev', 'DQWKOZr5kIgSsbXhBbIgvNt0zD3.pageS.dev']:
            p['servername'] = '1.x8x.dpdns.org'

    chain_nodes = [p['name'] for p in all_proxies if '🔗' in p.get('name', '')]
    direct_nodes = [p['name'] for p in all_proxies if '🔗' not in p.get('name', '')]
    sorted_node_names = (chain_nodes + direct_nodes) if chain_nodes else [p['name'] for p in all_proxies]
    primary_nodes = chain_nodes if chain_nodes else sorted_node_names

    config = {
        'port': 7890,
        'socks-port': 7891,
        'redir-port': 7892,
        'mixed-port': 7890,
        'allow-lan': True,
        'bind-address': '*',
        'mode': 'rule',
        'log-level': 'info',
        'unified-delay': True,
        'tcp-concurrent': True,
        'external-controller': '127.0.0.1:9090',
        'dns': {
            'enable': True,
            'ipv6': False,
            'enhanced-mode': 'fake-ip',
            'fake-ip-range': '198.18.0.1/16',
            'default-nameserver': ['223.5.5.5', '119.29.29.29'],
            'nameserver': ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
            'fallback': ['https://dns.cloudflare.com/dns-query', 'https://dns.google/dns-query']
        },
        'rule-providers': {},
        'proxies': all_proxies,
        'proxy-groups': [
            {
                'name': '反重力',
                'type': 'select',
                'proxies': ['🔗 链式反代', '🤖 反重力-自动换到通', '⚡ 反重力-并发优选', '节点选择'] + sorted_node_names
            },
            {
                'name': '🔗 链式反代',
                'type': 'select',
                'proxies': chain_nodes if chain_nodes else sorted_node_names
            },
            {
                'name': '🤖 反重力-自动换到通',
                'type': 'fallback',
                'url': 'https://daily-cloudcode-pa.googleapis.com/generate_204',
                'interval': 15,
                'lazy': False,
                'max-failed-times': 1,
                'proxies': primary_nodes
            },
            {
                'name': '⚡ 反重力-并发优选',
                'type': 'url-test',
                'url': 'https://daily-cloudcode-pa.googleapis.com/generate_204',
                'interval': 30,
                'tolerance': 50,
                'lazy': False,
                'proxies': primary_nodes
            },
            {
                'name': '节点选择',
                'type': 'select',
                'proxies': ['反重力', '🔗 链式反代', '🤖 反重力-自动换到通', '⚡ 反重力-并发优选', '🌐 自动选择', 'DIRECT'] + sorted_node_names
            },
            {
                'name': '🌐 自动选择',
                'type': 'url-test',
                'url': 'http://www.gstatic.com/generate_204',
                'interval': 300,
                'tolerance': 50,
                'proxies': sorted_node_names
            }
        ]
    }

    custom_rules = [
        'DOMAIN-SUFFIX,fn0.xx.kg,DIRECT',
        'DOMAIN,daily-cloudcode-pa.googleapis.com,反重力',
        'DOMAIN,cloudcode-pa.googleapis.com,反重力',
        'DOMAIN,generativelanguage.googleapis.com,反重力',
        'DOMAIN,alkalimakersuite-pa.googleapis.com,反重力',
        'DOMAIN,aistudio.google.com,反重力',
        'DOMAIN,ai.google.dev,反重力',
        'DOMAIN-SUFFIX,gemini.google.com,反重力',
        'DOMAIN-SUFFIX,cloudcli.ai,反重力',
        'DOMAIN-SUFFIX,googleusercontent.com,反重力',
        'DOMAIN-SUFFIX,gstatic.com,反重力',
        'DOMAIN-KEYWORD,antigravity,反重力',
        'DOMAIN-SUFFIX,googleapis.com,反重力',
        'DOMAIN-SUFFIX,google.com,反重力',
        'DOMAIN-KEYWORD,google,反重力'
    ]

    raw_rules = data.get('rules', [])
    filtered_rules = []
    for r in raw_rules:
        r = r.replace('✅ Selector', '节点选择').replace('容器☁', '节点选择')
        filtered_rules.append(r)

    config['rules'] = custom_rules + filtered_rules
    out_yaml = yaml.dump(config, allow_unicode=True, sort_keys=False)

    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_paths = [
        os.path.join(BASE_DIR, 'public/bpb.yanl'),
        os.path.join(BASE_DIR, 'public/bpb.yaml'),
        os.path.join(BASE_DIR, 'home/.antigravity/assets/bpb.yanl'),
        os.path.join(BASE_DIR, 'home/.antigravity/assets/bpb.yaml')
    ]
    for p in target_paths:
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w', encoding='utf-8') as f:
                f.write(out_yaml)
            print(f'[OK] BPB updated: {p}')
        except Exception as e:
            print(f'[WARN] Failed write {p}: {e}', file=sys.stderr)
    return True

def sync_main():
    upstream_url = os.getenv('CLASH_SUB_URL', '')
    if not upstream_url:
        print('[INFO] CLASH_SUB_URL not set, skipping Clash main sync.')
        return False
    try:
        req = urllib.request.Request(upstream_url, headers={'User-Agent': 'Clash/Meta'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode('utf-8')
            data = yaml.safe_load(raw)
    except Exception as e:
        print(f'[WARN] Failed to fetch main: {e}', file=sys.stderr)
        return False

    all_proxies = data.get('proxies', [])
    if not all_proxies:
        return False

    inc_re = re.compile(r'(美|🇺🇲|🇺🇸|US|America|United States|台|🇹🇼|TW|Taiwan|日|🇯🇵|JP|Japan|新|🇸🇬|SG|Singapore|德|DE|英|GB|UK|法|FR|欧|欧洲|澳|AU|Australia)', re.IGNORECASE)
    exc_re = re.compile(r'(港|hk|hongkong|Hong Kong|🇭🇰|澳门|MO|macau|🇲🇴|CN|🇨🇳|中国|Russia|RUS|俄|直连|0倍|流量|到期|重置)', re.IGNORECASE)

    agy_nodes, all_real_nodes = [], []
    us_nodes, tw_nodes, jp_nodes, sg_nodes, eu_nodes, hk_nodes = [], [], [], [], [], []

    for p in all_proxies:
        name = p.get('name', '')
        if re.search(r'(流量|到期|重置)', name):
            continue
        all_real_nodes.append(name)
        if re.search(r'(港|hk|hongkong|Hong Kong|🇭🇰)', name, re.I):
            hk_nodes.append(name)
        if re.search(r'(美|🇺🇲|🇺🇸|US|America|United States)', name, re.I) and not exc_re.search(name):
            us_nodes.append(name)
        if re.search(r'(台|🇹🇼|TW|Taiwan)', name, re.I) and not exc_re.search(name):
            tw_nodes.append(name)
        if re.search(r'(日|🇯🇵|JP|Japan)', name, re.I) and not exc_re.search(name):
            jp_nodes.append(name)
        if re.search(r'(新|🇸🇬|SG|Singapore)', name, re.I) and not exc_re.search(name):
            sg_nodes.append(name)
        if re.search(r'(德|DE|英|GB|UK|法|FR|欧|欧洲|澳|AU|Australia)', name, re.I) and not exc_re.search(name):
            eu_nodes.append(name)
        if inc_re.search(name) and not exc_re.search(name):
            agy_nodes.append(name)

    dns_conf = data.get('dns', {})
    if dns_conf and 'nameserver-policy' in dns_conf:
        dns_conf['nameserver-policy']['+.googleusercontent.com'] = 'https://dns.cloudflare.com/dns-query'
        dns_conf['nameserver-policy']['+.gstatic.com'] = 'https://dns.cloudflare.com/dns-query'
        dns_conf['nameserver-policy']['+.google.com'] = 'https://dns.cloudflare.com/dns-query'
        dns_conf['nameserver-policy']['+.googleapis.com'] = 'https://dns.cloudflare.com/dns-query'

    non_cn_nodes = [n for n in all_real_nodes if not re.search(r'(🇨🇳|CN|中国)', n, re.I)]

    config = {
        'port': 7890,
        'socks-port': 7891,
        'redir-port': 7892,
        'mixed-port': 7890,
        'allow-lan': True,
        'bind-address': '*',
        'mode': 'rule',
        'log-level': 'info',
        'unified-delay': True,
        'tcp-concurrent': True,
        'external-controller': '127.0.0.1:9090',
        'dns': dns_conf,
        'rule-providers': data.get('rule-providers', {}),
        'proxies': all_proxies,
        'proxy-groups': [
            {
                'name': '反重力',
                'type': 'select',
                'proxies': ['反重力自动', '🇺🇸 美国节点', '🇹🇼 台湾节点', '🇯🇵 日本节点', '🇸🇬 新加坡节点', '🇪🇺 欧洲节点'] + agy_nodes
            },
            {
                'name': '反重力自动',
                'type': 'url-test',
                'url': 'http://www.gstatic.com/generate_204',
                'interval': 300,
                'tolerance': 50,
                'proxies': agy_nodes
            },
            {
                'name': '节点选择',
                'type': 'select',
                'proxies': ['反重力', '自动选择', '故障转移', '🇺🇸 美国节点', '🇹🇼 台湾节点', '🇯🇵 日本节点', '🇸🇬 新加坡节点', '🇪🇺 欧洲节点', '🇭🇰 香港节点', 'DIRECT'] + all_real_nodes
            },
            {
                'name': '自动选择',
                'type': 'url-test',
                'url': 'http://www.gstatic.com/generate_204',
                'interval': 300,
                'tolerance': 50,
                'proxies': non_cn_nodes if non_cn_nodes else all_real_nodes
            },
            {
                'name': '故障转移',
                'type': 'fallback',
                'url': 'http://www.gstatic.com/generate_204',
                'interval': 300,
                'proxies': non_cn_nodes if non_cn_nodes else all_real_nodes
            },
            {'name': '🇺🇸 美国节点', 'type': 'select', 'proxies': us_nodes if us_nodes else ['DIRECT']},
            {'name': '🇹🇼 台湾节点', 'type': 'select', 'proxies': tw_nodes if tw_nodes else ['DIRECT']},
            {'name': '🇯🇵 日本节点', 'type': 'select', 'proxies': jp_nodes if jp_nodes else ['DIRECT']},
            {'name': '🇸🇬 新加坡节点', 'type': 'select', 'proxies': sg_nodes if sg_nodes else ['DIRECT']},
            {'name': '🇪🇺 欧洲节点', 'type': 'select', 'proxies': eu_nodes if eu_nodes else ['DIRECT']},
            {'name': '🇭🇰 香港节点', 'type': 'select', 'proxies': hk_nodes if hk_nodes else ['DIRECT']}
        ]
    }

    custom_rules = [
        'DOMAIN-SUFFIX,fn0.xx.kg,DIRECT',
        'DOMAIN,daily-cloudcode-pa.googleapis.com,反重力',
        'DOMAIN,cloudcode-pa.googleapis.com,反重力',
        'DOMAIN,generativelanguage.googleapis.com,反重力',
        'DOMAIN,alkalimakersuite-pa.googleapis.com,反重力',
        'DOMAIN,aistudio.google.com,反重力',
        'DOMAIN,ai.google.dev,反重力',
        'DOMAIN-SUFFIX,gemini.google.com,反重力',
        'DOMAIN-SUFFIX,cloudcli.ai,反重力',
        'DOMAIN-KEYWORD,antigravity,反重力',
        'DOMAIN-SUFFIX,googleusercontent.com,反重力',
        'DOMAIN-SUFFIX,gstatic.com,反重力',
        'DOMAIN-SUFFIX,googleapis.com,反重力',
        'DOMAIN-SUFFIX,google.com,反重力',
        'DOMAIN-KEYWORD,google,反重力'
    ]

    try:
        from urllib.parse import urlparse
        sub_host = urlparse(upstream_url).hostname
        if sub_host:
            custom_rules.append(f'DOMAIN,{sub_host},DIRECT')
    except Exception:
        pass

    raw_rules = data.get('rules', [])
    filtered_rules = []
    for r in raw_rules:
        r = r.replace('容器☁', '节点选择')
        filtered_rules.append(r)

    config['rules'] = custom_rules + filtered_rules
    out_yaml = yaml.dump(config, allow_unicode=True, sort_keys=False)

    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_paths = [
        os.path.join(BASE_DIR, 'public/clash.yaml'),
        os.path.join(BASE_DIR, 'public/clash-antigravity.yaml')
    ]
    for p in target_paths:
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w', encoding='utf-8') as f:
                f.write(out_yaml)
            print(f'[OK] Main updated: {p}')
        except Exception as e:
            print(f'[WARN] Failed to write {p}: {e}', file=sys.stderr)
    return True

if __name__ == '__main__':
    sync_main()
    sync_bpb()
