#!/usr/bin/env python3
"""Сводка по меткам build/artifacts/WB-17/results/<label>/: mutate med/p95, cold, warm, switch p95, realtime med/p95 (мс)."""
import json, os
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'build', 'artifacts', 'WB-17', 'results')
rows = [('base2', 'базовая сборка (feature/web)'), ('P1', '+P1 связи getAll'), ('P1P2', '+P2 push перед pull'),
        ('P1P2P3', '(отвергнуто) P3 параллельные чтения'), ('P1P2P6', '+P6 проекция задач в памяти (mutate — из отдельного прогона, JSON не сохранён)'),
        ('P1P2P6P7P9', '+P7 keep-alive, +P9 preload (поверх P6)'),
        ('P1P2P6P7P9P10', '+P10 без readonly()-прокси'), ('P1P2P6P7P9P10P4', '+P4 общие справочники'), ('P11test', '+P11 ленивый Popover'),
        ('P8test', '+P8 bootstrap: открытый проект первым'), ('P12test', '+P12 prefetch соседних проектов'), ('final', 'итог (повторный прогон)')]
OVR = {('P1P2P6', 'mutate', 'median'): 27, ('P1P2P6', 'mutate', 'p95'): 31}
def g(l, n, k):
    if (l, n, k) in OVR: return OVR[(l, n, k)]
    try: return round(json.load(open(f'{R}/{l}/{n}.json'))[k])
    except Exception: return '—'
print('| сборка | mutate med / p95 | cold | warm | switch p95 | realtime med / p95 |\n|---|---:|---:|---:|---:|---:|')
for l, t in rows:
    print(f"| {t} | {g(l,'mutate','median')} / {g(l,'mutate','p95')} | {g(l,'cold','median')} | {g(l,'warm','median')} | {g(l,'switch','p95')} | {g(l,'realtime','median')} / {g(l,'realtime','p95')} |")
