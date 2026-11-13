// Campo numérico en formato chileno (es-CL) para Cotizaciones: lo mismo al escribir, pegar o editar (lib/numeroCL.js).
//  · Muestra el valor guardado con punto de miles y coma decimal (25.990 · 1.250.000,75); guarda el número.
//  · Mientras se escribe conserva el texto; si es válido entrega el número, vacío entrega `vacio` ("" por omisión).
//  · Si el formato es incorrecto o ambiguo (p. ej. «1250.50»), muestra el motivo y entrega NaN: el formulario no puede
//    guardar ese valor (ver esInvalido) y nunca recibe un monto mal interpretado.
//  · porcentaje: se escribe en % (32,5) y se entrega la fracción (0,325), como los campos de recargo de siempre.
import { useEffect, useRef, useState } from "react";
import { leerNumeroCL, formatoCL, fraccionAPorcentaje, porcentajeAFraccion } from "../../lib/numeroCL";
import { C } from "../../lib/theme";

export default function CampoNumeroCL({ valor, onCambiar, decimales = 2, negativo = false, porcentaje = false, min = null, max = null, vacio = "",
  style, contenedor, disabled, ...resto }) {
  const aTexto = (v) => {
    if (v === "" || v == null || (typeof v === "number" && Number.isNaN(v))) return "";
    const n = porcentaje ? fraccionAPorcentaje(v) : Number(v);
    // Montos con centavos: siempre los dos decimales (25.990,90); porcentajes y cantidades, solo los que tienen.
    return formatoCL(n, { decimales, minimoDecimales: !porcentaje && decimales === 2 && !Number.isInteger(n) ? 2 : 0 });
  };
  const [texto, setTexto] = useState(() => aTexto(valor));
  const inicialInvalido = typeof valor === "number" && Number.isNaN(valor);
  const [error, setError] = useState(inicialInvalido ? "El valor anterior tenía formato incorrecto: ingrésalo nuevamente." : "");
  const [mostrar, setMostrar] = useState(inicialInvalido);
  const enfocado = useRef(false); const pegado = useRef(false);
  // Un cambio desde fuera (otra acción, recargo aplicado, versión recargada) se refleja si no se está escribiendo.
  useEffect(() => {
    if (enfocado.current) return;
    if (typeof valor === "number" && Number.isNaN(valor)) return;   // inválido: se conserva lo escrito y su mensaje
    setTexto(aTexto(valor)); setError(""); setMostrar(false);
  }, [valor]); // eslint-disable-line react-hooks/exhaustive-deps

  const evaluar = (t) => {
    const r = leerNumeroCL(t, { decimales, negativo, porcentaje });
    if (r.error) return { error: r.error };
    if (r.valor == null) return { valor: vacio };
    if (min != null && r.valor < min) return { error: `Debe ser al menos ${formatoCL(min, { decimales })}${porcentaje ? " %" : ""}.` };
    if (max != null && r.valor > max) return { error: `No puede superar ${formatoCL(max, { decimales })}${porcentaje ? " %" : ""}.` };
    return { valor: porcentaje ? porcentajeAFraccion(r.valor) : r.valor };
  };
  const cambiar = (t) => {
    setTexto(t);
    const r = evaluar(t);
    if (r.error) { setError(r.error); if (pegado.current) setMostrar(true); onCambiar?.(NaN); }
    else { setError(""); setMostrar(false); onCambiar?.(r.valor); }
    pegado.current = false;
  };
  const ver = mostrar && error;
  return (
    <span style={{ display: "block", ...contenedor }}>
      <input type="text" inputMode="decimal" autoComplete="off" {...resto} disabled={disabled} value={texto}
        aria-invalid={error ? "true" : undefined} data-numero-invalido={error ? "" : undefined}
        style={{ ...style, ...(ver ? { borderColor: C.danger, boxShadow: `0 0 0 1px ${C.danger}` } : {}) }}
        onFocus={() => { enfocado.current = true; }}
        onPaste={() => { pegado.current = true; }}
        onChange={(e) => cambiar(e.target.value)}
        onBlur={() => {
          enfocado.current = false;
          const r = evaluar(texto);
          if (r.error) setMostrar(true);
          else if (r.valor !== "" && r.valor != null) setTexto(aTexto(r.valor));
        }} />
      {ver && <span data-error-numero role="alert" style={{ display: "block", fontSize: 12, color: C.dangerText || C.danger, fontWeight: 500, marginTop: 3, lineHeight: 1.3 }}>{error}</span>}
    </span>
  );
}
