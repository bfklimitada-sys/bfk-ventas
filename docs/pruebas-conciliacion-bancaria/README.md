# Conciliación bancaria BancoEstado · Etapas 1 a 3

Autorizadas el 09/10/2026. Rama `conciliacion-bancaria-etapas-1-3`.

| Aspecto | Alcance |
|---|---|
| Base de datos | Sin SQL, sin tablas nuevas y sin cambios de datos |
| Histórico | No se modifican registros históricos, saldos ni reglas FIFO |
| Datos de prueba | 100 % ficticios. **Nunca** se suben cartolas reales a este repositorio público |

## Qué cambia

### Etapa 1 · Importador seguro (solo consulta)

**`src/lib/cartolas.js`: lectura de los dos formatos BancoEstado**

- **Formatos:** Cartola en Línea (hoja `Registros`) e Histórica (hoja `Movimientos`).
- **Columnas:** se ubican por el nombre del encabezado.
- **Datos que se conservan:** el N° de operación, normalizado sin ceros a la izquierda, y el saldo de cada línea.
- **Montos:** solo enteros.
- **Año en la histórica:** se obtiene por secuencia de meses desde la Fecha Inicio y se verifica contra la Fecha Final.
- **Validaciones:**
  - Cadena de saldo, línea por línea.
  - Resumen: Total Abonos + Total Depósitos.
  - N° de movimientos declarado.
- Un archivo con cualquier error se rechaza completo.

**`unirCartolas`: unión de archivos**

- **Duplicados:** se eliminan por multiconjunto con la clave fecha + cargo + abono + saldo, sin la glosa. Así un archivo repetido o el mismo período en el otro formato no duplican nada.
- **Cartolas faltantes:** se avisan cuando el saldo no empalma entre archivos.

**`src/lib/conciliacion.js`: cuatro estados**

| Estado | Significado |
|---|---|
| Conciliado | Hay evidencia además del monto: RUT, nombre del cliente o persona en la glosa, o un lote que suma exacto |
| Posible registrado | Hay registros que podrían corresponder, pero sin evidencia suficiente |
| Pendiente | No hay registro en BFK |
| Neutro | Abono y cargo del mismo monto, el mismo día y con la misma contraparte |

Reglas de la conciliación:
- Cada registro BFK se usa una sola vez.
- Lo registrado fuera del banco nunca se usa para conciliar.
- No hay preselección.

**`ImportarCartola.jsx`: pantalla**

- Muestra **todos** los movimientos, con filtros por estado y sentido.
- Nada se registra al consultar.

### Etapa 2 · Registro seguro

- **Qué se puede registrar:** solo los movimientos **pendientes posteriores al cierre** (`CIERRE_CONCILIACION = 2026-10-07`), uno a la vez.
- **Sin selección previa:** el destino se elige a mano y nada viene marcado.
- **Confirmación:** se exige confirmación explícita, con el resumen de lo que se escribirá.
- **Verificación final:** antes de escribir se vuelven a leer los registros **actuales de la base** (no los de pantalla) y se concilia de nuevo. Si el movimiento ya tiene registro, o lleva la marca de cartola de otra sesión, no se registra (`src/lib/registroCartola.js`).
- **Concurrencia (09/10/2026):**
  - Bloqueo inmediato contra doble clic.
  - El registro lleva un id derivado del movimiento (fecha, cargo, abono, saldo y ocurrencia): si dos sesiones registran el mismo movimiento en la misma tabla, la clave primaria rechaza la segunda escritura.
  - **Límite conocido:** dos sesiones que registran el mismo movimiento como **tipos distintos** en el mismo instante, o un pago a financiador (función de la base con ids propios), solo quedan protegidas por la verificación final. Cerrar esa ventana requiere un cambio en la base, no aplicado.
- **Retiro de capital:** se registra en `aportes_socios` como retiro, nunca como gasto.
- **N° de operación:** queda en la nota del registro, o en `referencia_bancaria` en los pagos a vendedor.
- **Control inverso:** avisa de registros BFK posteriores al cierre que no tienen movimiento bancario (posible doble registro).
- **«Guardar solo los totales del banco»:** también exige confirmación.

### Etapa 3 · Informes (solo presentación)

**Archivos:** `src/lib/informes.js` y `InformeFinanciero.jsx`, en el Panel.

**Informe financiero en el Panel:**
- **Resultado del mes:** margen comercial − comisiones − apoyo en gestión − gastos operacionales. Los impuestos se informan aparte.
- **F29 por período:** IVA + PPM.
- **Caja:** caja registrada por tipo y lo registrado fuera de BancoEstado.
- **Financiadores:** compras − devoluciones = saldo. Las devoluciones no son gasto.
- **Comisiones:** comisión + apoyo en gestión = una sola transferencia.

**Cambios de presentación:**
- En el Panel, «Utilidad del mes» pasa a llamarse **«Margen comercial del mes»**.
- En Gastos se agrega **«Apoyo en gestión»**, una sola línea que suma el gasto y el extra incluido en pagos a vendedor, cada monto una vez.

**`f29.js`:**
- Desde agosto 2026, el F29 determinado es IVA + PPM, tomado del total del F29 registrado.
- Si falta el total del F29, se avisa.
- Los períodos anteriores no cambian.

**Comisiones (`calculos.js` / `caja.js` / `pagosVendedor.js`):**
- Desde agosto 2026, la comisión es provisoria mientras falte el total del F29.
- No cambia ningún monto.

## Pruebas

- **Unitarias:** `node docs/pruebas-conciliacion-bancaria/ejecutar.mjs`.
- **Interfaz** (Supabase simulado; nada sale a la red):
  1. Construir con `vite build`.
  2. Servir con `vite preview --port 4179`.
  3. Ejecutar `node docs/pruebas-conciliacion-bancaria/e2e_cartola.mjs http://127.0.0.1:4179/` y `node docs/pruebas-conciliacion-bancaria/e2e_concurrencia.mjs http://127.0.0.1:4179/` (dos sesiones, doble clic y reimportación).
  - La simulación de Supabase (`pruebas-oc/mock_estado.mjs`) rechaza ids repetidos, igual que la clave primaria.
- **Pruebas existentes ajustadas por cambio de regla autorizado:**

  | Archivo | Ajuste |
  |---|---|
  | `pruebas-iva-unificado/reglas.test.mjs` | El F29 de agosto pasa a ser IVA + PPM |
  | `pruebas-cierre/reglas_cierre.test.mjs` | Se agrega el caso «sin total del F29 → provisorio» |
  | `pruebas-4c/e2e_fase4c.mjs` (C7) | La cartola ya no preselecciona y exige confirmación |

## Reversión

No hay datos ni esquema que revertir. Para volver atrás:

- **Si nunca se fusionó:** basta no fusionar la rama.
- **Si ya se fusionó:** `git revert` del commit de la rama, o promover en Vercel el despliegue anterior.
