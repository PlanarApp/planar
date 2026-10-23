#!/usr/bin/env python3
"""python3 stages.py <label>... — медианные стадии по results/<label>/{mutate,switch,warm,cold,realtime}.json (markdown)."""
import json, statistics, sys, os
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results')
READ = ('tasks', 'taskAssignees', 'taskLabels')
med = lambda a: round(statistics.median(a), 0) if a else 0
load = lambda l, n: json.load(open(f'{R}/{l}/{n}.json'))

def reads(ev, lo, hi):
    r = [e for e in ev if e['k'] == 'tx' and e['n'] == 1 and e['s'] in READ and e.get('t1') and lo - 1 <= e['t0'] < hi]
    return (min(e['t0'] for e in r), max(e['t1'] for e in r)) if r else None

def loaf_start(ev, t, lo):
    """начало long-animation-frame, внутри которого произошло событие t (JS-обработка результата + рендер)"""
    c = [e['t0'] for e in ev if e['k'] == 'loaf' and e['t0'] <= t <= e['t0'] + e['dur'] + 1 and e['t0'] >= lo]
    return min(c) if c else None

def mutate(l):
    st = {k: [] for k in ('A', 'B', 'C', 'D', 'T')}
    for run in load(l, 'mutate')['runs']:
        ev = run['ev']; dom = next(e['t'] for e in ev if e['k'] == 'dom')
        tx = next(e for e in sorted(ev, key=lambda e: e.get('t0', 0)) if e['k'] == 'tx' and e['mode'] == 'readwrite' and e['n'] > 10)
        rd = reads(ev, tx['t1'], dom)
        end = loaf_start(ev, dom, tx['t1']) or (min(rd[1], dom) if rd else tx['t1'])
        st['A'].append(tx['t0']); st['B'].append(tx['t1'] - tx['t0']); st['C'].append(end - tx['t1']); st['D'].append(dom - end); st['T'].append(dom)
    return ['| Enter → начало транзакции mutate (разбор, zod, чтение в мутаторе) | %d |' % med(st['A']),
            '| транзакция mutate (rw, все таблицы) | %d |' % med(st['B']),
            '| liveQuery: перечитать tasks + связи | %d |' % med(st['C']),
            '| сборка TaskView, group/sort, Vue-рендер → DOM | %d |' % med(st['D']),
            '| **итого (медиана)** | **%d** |' % med(st['T'])]

def switch(l):
    st = {k: [] for k in ('A', 'C', 'D', 'T')}
    for run in load(l, 'switch')['runs']:
        ev = run['ev']; dom = next(e['t'] for e in ev if e['k'] == 'dom')
        rd = reads(ev, 0, dom)
        a = rd[0] if rd else 0
        end = loaf_start(ev, dom, 0) or (min(rd[1], dom) if rd else a)
        c = max(0, end - a)
        st['A'].append(a); st['C'].append(c); st['D'].append(dom - a - c); st['T'].append(dom)
    return ['| клик → маршрут, монтирование, старт запросов | %d |' % med(st['A']),
            '| чтение tasks + связей из IndexedDB | %d |' % med(st['C']),
            '| сборка, group/sort, Vue-рендер строк → DOM | %d |' % med(st['D']),
            '| **итого (медиана 10)** | **%d** |' % med(st['T'])]

def warm(l):
    st = {k: [] for k in ('boot', 'auth', 'rd0', 'rd', 'render', 'T')}
    for run in load(l, 'warm')['runs']:
        ev = run['ev']; fr = next(e['t'] for e in ev if e['k'] == 'firstRow')
        au = next(e for e in ev if e['k'] == 'fetch' and e['url'].startswith('/api/auth/me'))
        rd = reads(ev, 0, fr)
        end = loaf_start(ev, fr, rd[0]) or min(rd[1], fr)
        st['boot'].append(au['t0']); st['auth'].append(au['t1'] - au['t0']); st['rd0'].append(rd[0]); st['rd'].append(end - rd[0]); st['render'].append(fr - end); st['T'].append(fr)
    return ['| загрузка скриптов и старт приложения (до /api/auth/me) | %d |' % med(st['boot']),
            '| /api/auth/me (справочно; в патчах идёт параллельно чтению) | %d |' % med(st['auth']),
            '| момент начала чтения задач из IndexedDB (от навигации) | %d |' % med(st['rd0']),
            '| чтение tasks + связей (до начала JS-кадра обработки) | %d |' % med(st['rd']),
            '| сборка, Vue-рендер → первая строка | %d |' % med(st['render']),
            '| **итого (медиана 5)** | **%d** |' % med(st['T'])]

def cold(l):
    st = {k: [] for k in ('boot', 'ttfb', 'body', 'proc', 'wr', 'after', 'T')}
    for run in load(l, 'cold')['runs']:
        ev = run['ev']; fr = next(e['t'] for e in ev if e['k'] == 'firstRow')
        f = next(e for e in ev if e['k'] == 'fetch' and e['url'].startswith('/sync/bootstrap'))
        w = next(e for e in sorted(ev, key=lambda e: e.get('t0', 0)) if e['k'] == 'tx' and e['mode'] == 'readwrite' and e['n'] > 10 and e['ops'].get('clear'))
        st['boot'].append(f['t0']); st['ttfb'].append(f['tJ0'] - f['t0']); st['body'].append(f['t1'] - f['tJ0']); st['proc'].append(w['t0'] - f['t1'])
        st['wr'].append(w['t1'] - w['t0']); st['after'].append(fr - w['t1']); st['T'].append(fr)
    return ['| старт приложения, /api/auth/me → запрос bootstrap | %d |' % med(st['boot']),
            '| bootstrap: ожидание ответа сервера (8,1 МБ JSON, без сжатия) | %d |' % med(st['ttfb']),
            '| bootstrap: приём тела + JSON.parse | %d |' % med(st['body']),
            '| zod-разбор `syncBootstrapSchema` до начала записи | %d |' % med(st['proc']),
            '| запись в IndexedDB (транзакция bootstrap) | %d |' % med(st['wr']),
            '| чтение проекта, сборка, рендер → первая строка | %d |' % med(st['after']),
            '| **итого (медиана 3)** | **%d** |' % med(st['T'])]

def realtime(l):
    st = {k: [] for k in ('A', 'push', 'pull', 'apply', 'T')}
    for run in load(l, 'realtime')['runs']:
        A, B = run['A'], run['B']
        p = next(e for e in sorted(A, key=lambda e: e.get('t0', 0)) if e['k'] == 'fetch' and e['url'].startswith('/sync/push'))
        w = next(e for e in sorted(B, key=lambda e: e.get('t', 0)) if e['k'] == 'ws')
        pl = next(e for e in sorted(B, key=lambda e: e.get('t0', 0)) if e['k'] == 'fetch' and e['url'].startswith('/sync/pull') and e['t0'] >= w['t'] - 1)
        dom = next(e['t'] for e in B if e['k'] == 'dom')
        st['A'].append(p['t0']); st['push'].append(w['t'] - p['t0']); st['pull'].append(pl['t1'] - w['t']); st['apply'].append(dom - pl['t1']); st['T'].append(dom)
    return ['| A: Enter → отправка push (локальная правка, пересчёт A, pull перед push) | %d |' % med(st['A']),
            '| push на сервер → poke получен у B | %d |' % med(st['push']),
            '| B: pull (запрос и разбор ответа) | %d |' % med(st['pull']),
            '| B: применение (rebase-транзакция), пересчёт, рендер → DOM | %d |' % med(st['apply']),
            '| **итого (медиана 10)** | **%d** |' % med(st['T'])]

for n, f in (('mutate', mutate), ('switch', switch), ('warm', warm), ('cold', cold), ('realtime', realtime)):
    for l in sys.argv[1:]:
        print(f'\n#### {n} — {l}\n\n| стадия | мс |\n|---|---:|')
        print('\n'.join(f(l)))
