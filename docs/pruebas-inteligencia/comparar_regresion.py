#!/usr/bin/env python3
"""Compara dos corridas de regresion.sh (main vs rama) y separa fallas anteriores de fallas nuevas.
Uso: python3 comparar_regresion.py /tmp/reg-main.tsv /tmp/reg-rama.tsv"""
import csv, sys

def leer(p):
    with open(p, encoding="utf-8") as f:
        return {r["suite"]: r for r in csv.DictReader(f, delimiter="\t")}

a, b = leer(sys.argv[1]), leer(sys.argv[2])
iguales, nuevas, mejoras, solo_rama, solo_main, otras = [], [], [], [], [], []
for s in sorted(set(a) | set(b)):
    if s not in a: solo_rama.append(s); continue
    if s not in b: solo_main.append(s); continue
    x, y = a[s], b[s]
    fx, fy, ox, oy = int(x["fallas"]), int(y["fallas"]), int(x["ok"]), int(y["ok"])
    if (x["salida"], fx, ox) == (y["salida"], fy, oy): iguales.append(s)
    elif fy > fx or (y["salida"] != "0" and x["salida"] == "0"): nuevas.append(s)
    elif fy < fx or (y["salida"] == "0" and x["salida"] != "0"): mejoras.append(s)
    else: otras.append(s)
print(f"Suites comparadas: {len(set(a) & set(b))} · idénticas: {len(iguales)}")
pre = [s for s in iguales if a[s]["salida"] != "0" or int(a[s]["fallas"]) > 0]
print(f"Fallas PREEXISTENTES (iguales en main y en la rama): {len(pre)}")
for s in pre: print(f"  - {s}: salida {a[s]['salida']}, {a[s]['fallas']} fallas · {a[s]['ultima_linea'][:110]}")
print(f"Fallas NUEVAS en la rama: {len(nuevas)}")
for s in nuevas: print(f"  - {s}: main salida {a[s]['salida']}/{a[s]['fallas']} fallas → rama salida {b[s]['salida']}/{b[s]['fallas']} fallas · {b[s]['ultima_linea'][:110]}")
if mejoras: print("Mejoran en la rama: " + ", ".join(mejoras))
if otras: print("Distinto conteo de OK sin fallas nuevas: " + ", ".join(f"{s} ({a[s]['ok']}→{b[s]['ok']})" for s in otras))
if solo_rama: print("Solo en la rama (suites nuevas): " + ", ".join(f"{s} [salida {b[s]['salida']}, {b[s]['ok']} OK, {b[s]['fallas']} fallas]" for s in solo_rama))
if solo_main: print("Solo en main: " + ", ".join(solo_main))
sys.exit(1 if nuevas else 0)
