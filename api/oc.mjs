// ═══════════════════════════════════════════════════════════════
// api/oc.js — Función serverless (Vercel)
// Consulta una OC en la API de Mercado Público y devuelve solo
// los campos que usa la app, ya normalizados y listos para guardar.
//
// Uso desde el frontend:  fetch("/api/oc?codigo=1107277-31-AG26")
//
// El ticket se lee de la variable de entorno MP_TICKET.
// Configúrala en Vercel → Settings → Environment Variables.
// Si no existe, la función responde un error claro (ya no usa ticket de pruebas).
// Exige una sesión válida de BFK (cabecera Authorization: Bearer <token>).
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";
// Clave pública (anon) del proyecto: es pública por diseño, igual que en el frontend.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cHl3eGF1Z3d1eGJnbWNxbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA4MjksImV4cCI6MjA5NzE5NjgyOX0.ujdKtdhFklJEPHy1vWlm8RLgPAQlo7sNNBGd_MbmibQ";

// Límite por usuario (en memoria; se reinicia con cada instancia de la función).
const VENTANA_MS = 60_000;
const MAX_CODIGO = 120;   // consultas de una OC por minuto
const MAX_LISTAR = 10;    // listados por minuto
const usos = new Map();
function limitado(uid, tipo, max) {
  const ahora = Date.now();
  const k = `${uid}:${tipo}`;
  const arr = (usos.get(k) || []).filter((t) => ahora - t < VENTANA_MS);
  if (arr.length >= max) { usos.set(k, arr); return true; }
  arr.push(ahora); usos.set(k, arr);
  if (usos.size > 2000) for (const [kk, v] of usos) if (!v.some((t) => ahora - t < VENTANA_MS)) usos.delete(kk);
  return false;
}

// Valida el token con Supabase y comprueba que el usuario tenga perfil BFK.
async function validarSesion(req) {
  const auth = String(req.headers?.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: "Sesión requerida. Inicie sesión en BFK Ventas.", status: 401 };
  const token = m[1].trim();
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return { error: "Sesión inválida o vencida. Vuelva a iniciar sesión.", status: 401 };
    const u = await r.json();
    if (!u?.id) return { error: "Sesión inválida.", status: 401 };
    const p = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${encodeURIComponent(u.id)}&select=id`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    const filas = p.ok ? await p.json() : [];
    if (!Array.isArray(filas) || filas.length === 0) return { error: "Usuario sin perfil autorizado en BFK.", status: 403 };
    return { uid: u.id };
  } catch {
    return { error: "No se pudo validar la sesión. Intente de nuevo.", status: 503 };
  }
}

// Anexo 3.3 de la documentación oficial
const TIPO_DESPACHO = {
  "7":  "Despachar a dirección de envío",
  "9":  "Despachar según programa adjuntado",
  "12": "Otra forma de despacho, ver instrucciones",
  "14": "Retiramos de su bodega",
  "20": "Despacho por courier o encomienda aérea",
  "21": "Despacho por courier o encomienda terrestre",
  "22": "A convenir",
};

// Anexo 3.4 — sirve para calcular el vencimiento real de cada factura
const FORMA_PAGO = {
  "1":  { label: "15 días contra recepción de factura", dias: 15 },
  "2":  { label: "30 días contra recepción de factura", dias: 30 },
  "39": { label: "Otra forma de pago",                  dias: 30 },
  "46": { label: "50 días contra recepción de factura", dias: 50 },
  "47": { label: "60 días contra recepción de factura", dias: 60 },
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ── Modo listado: OCs de BFK por estado y fecha ─────────────
// GET /api/oc?listar=enviadaproveedor&dias=30
// Devuelve las OCs de nuestro RUT en ese estado, para avisar
// de las que están esperando aceptación en Mercado Público.
const RUT_BFK = "77.322.317-3";

// El código de proveedor de BFK en Mercado Público no cambia — lo vimos
// salir "1943006" en decenas de respuestas exitosas. Pedirlo de nuevo en
// cada consulta solo expone la app a que ese endpoint puntual falle sin
// necesidad. Se deja fijo, y solo se recurre a la API como respaldo si
// algún día no viniera seteado (ej. otro RUT usando este mismo código).
const CODIGO_PROVEEDOR_CONOCIDO = "1943006";

async function buscarCodigoProveedor(ticket) {
  if (CODIGO_PROVEEDOR_CONOCIDO) return CODIGO_PROVEEDOR_CONOCIDO;

  // Esta consulta es el primer paso de todo: si falla, nada más funciona.
  for (let intento = 0; intento < 3; intento++) {
    if (intento > 0) await new Promise((res) => setTimeout(res, intento === 1 ? 600 : 1400));
    try {
      const r = await fetch(
        `https://api.mercadopublico.cl/servicios/v1/Publico/Empresas/BuscarProveedor` +
        `?rutempresaproveedor=${encodeURIComponent(RUT_BFK)}&ticket=${encodeURIComponent(ticket)}`,
        { headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const d = await r.json();
      const codigo = d?.listaEmpresas?.[0]?.CodigoEmpresa ?? d?.Listado?.[0]?.CodigoEmpresa ?? null;
      if (codigo) return codigo;
    } catch { /* reintenta */ }
  }
  return null;
}

// Códigos de estado que devuelve la API (CodigoEstado), según la
// documentación oficial (chilecompra.cl/api → Órdenes de Compra):
//   4  Enviada a Proveedor · 5  En proceso · 6  Aceptada · 9  Cancelada
//   12 Recepción Conforme  · 13 Pendiente de Recepcionar
//   14 Recepcionada Parcialmente · 15 Recepción Conforme Incompleta
const ESTADOS_OC = {
  4:  "Enviada a proveedor",
  5:  "En proceso",
  6:  "Aceptada",
  9:  "Cancelada",
  12: "Recepción conforme",
  13: "Pendiente de recepcionar",
  14: "Recepcionada parcialmente",
  15: "Recepción conforme incompleta",
};
// Los que interesan para avisar: aún sin aceptar
const SIN_ACEPTAR = new Set([4, 5]);
// Ya aceptadas (en cualquier etapa posterior) y listas para cargar a la app
const ACEPTADAS = new Set([6, 12, 13, 14, 15]);

async function listarOCs(req, res, ticket) {
  const dias = Math.min(Number(req.query?.dias) || 30, 90);
  const modo = txt(req.query?.listar); // "enviadaproveedor" | "aceptadas" | "todas"

  const codigo = await buscarCodigoProveedor(ticket);
  if (!codigo) {
    return res.status(502).json({ ok: false, error: "No se pudo obtener el código de proveedor" });
  }

  const encontradas = [];
  const hoy = new Date();
  const dds = Array.from({ length: dias }, (_, i) => { const d = new Date(hoy); d.setDate(d.getDate() - i); return d; });

  const consultarDia = async (d) => {
    const f = `${String(d.getDate()).padStart(2,"0")}${String(d.getMonth()+1).padStart(2,"0")}${d.getFullYear()}`;
    // La API no acepta 'estado' junto con CodigoProveedor: se filtra acá.
    const url = "https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json" +
      `?fecha=${f}&CodigoProveedor=${codigo}&ticket=${encodeURIComponent(ticket)}`;

    // Un solo intento, con tope duro de 3 segundos. Insistir varias veces
    // con esperas largas suena más confiable, pero si Mercado Público
    // está lento hoy, eso es justo lo que deja la consulta entera pegada
    // varios minutos. Mejor fallar rápido en un día puntual y seguir con
    // el resto — "Validar todas mis OC" cubre lo que se pierda acá.
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), 3000);
    let j = null;
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" }, signal: control.signal });
      if (r.ok) j = await r.json();
    } catch { /* este día queda sin datos, se sigue con el resto */ }
    finally { clearTimeout(corte); }
    if (!j) return [];

    return (j?.Listado || []).map((oc) => {
      const cod = Number(oc.CodigoEstado);
      return {
        cod,
        fila: {
          numero_oc: txt(oc.Codigo),
          nombre: txt(oc.Nombre),
          codigo_estado: cod,
          estado: ESTADOS_OC[cod] || `Estado ${cod}`,
          fecha: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`,
        },
      };
    });
  };

  // Tope global además del tope por solicitud: si ya pasaron 45 segundos,
  // se devuelve lo encontrado hasta ahí en vez de seguir y arriesgarse a
  // que Vercel corte la función a la fuerza sin responder nada.
  const inicio = Date.now();
  const LOTE = 5;
  for (let i = 0; i < dds.length; i += LOTE) {
    if (Date.now() - inicio > 45000) break;
    const resultados = await Promise.all(dds.slice(i, i + LOTE).map(consultarDia));
    for (const items of resultados) {
      for (const { cod, fila } of items) {
        if (modo === "aceptadas") { if (!ACEPTADAS.has(cod)) continue; }
        else if (modo !== "todas") { if (!SIN_ACEPTAR.has(cod)) continue; }
        encontradas.push(fila);
      }
    }
  }

  // Antes 15 min: si una OC se acepta/cancela en MP, la app podía
  // seguir mostrando el estado viejo hasta por un cuarto de hora.
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
  return res.status(200).json({
    ok: true, dias, codigoProveedor: codigo,
    total: encontradas.length, ocs: encontradas,
  });
}

export default async function handler(req, res) {

  const ses = await validarSesion(req);
  if (ses.error) return res.status(ses.status).json({ ok: false, error: ses.error });

  const ticket = (process.env.MP_TICKET || "").trim();
  if (!ticket) {
    return res.status(500).json({ ok: false, error: "Falta configurar MP_TICKET en el servidor (Vercel → Environment Variables)." });
  }

  const tipo = req.query?.listar ? "listar" : "codigo";
  if (limitado(ses.uid, tipo, tipo === "listar" ? MAX_LISTAR : MAX_CODIGO)) {
    return res.status(429).json({ ok: false, error: "Demasiadas consultas. Espere un minuto e intente de nuevo." });
  }

  // Modo listado
  if (req.query?.listar) {
    try { return await listarOCs(req, res, ticket); }
    catch (e) { return res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  }

  const codigo = txt(req.query?.codigo);
  if (!codigo) {
    return res.status(400).json({ ok: false, error: "Falta el parámetro 'codigo' o 'listar'" });
  }

  // El endpoint real es "ordenesdecompra.json" (plural, minúsculas).
  // La documentación PDF menciona "OrdenCompra.json", que ya no responde:
  // lo dejamos como respaldo por si vuelve a habilitarse.
  const BASES = [
    "https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json",
    "https://api.mercadopublico.cl/servicios/v1/publico/OrdenCompra.json",
  ];

  try {
    let data = null;
    let ultimoStatus = null;
    // Respuestas válidas de Mercado Público SIN la OC (Listado vacío): significa que MP no la tiene
    // (código inexistente, o todavía no publicada/aceptada). Es distinto de que MP esté caído.
    let respuestasSinOC = 0;

    // Nunca había tenido reintento — funcionó bien todo el día porque
    // Mercado Público estaba estable, pero cuando ellos tienen un mal
    // momento, un solo intento por variante no alcanza.
    for (let intento = 0; intento < 3 && !data; intento++) {
      if (intento > 0) await new Promise((res) => setTimeout(res, intento === 1 ? 600 : 1400));
      for (const base of BASES) {
        const url = `${base}?codigo=${encodeURIComponent(codigo)}&ticket=${encodeURIComponent(ticket)}`;
        try {
          const r = await fetch(url, { headers: { Accept: "application/json" } });
          ultimoStatus = r.status;
          if (!r.ok) continue;
          const j = await r.json().catch(() => null);
          if (j?.Listado?.[0]) { data = j; break; }
          // Respuesta válida y vacía: no se prueba la variante antigua (ya no responde); se confirma una vez más.
          if (j && Array.isArray(j.Listado) && j.Listado.length === 0) { respuestasSinOC++; break; }
        } catch { /* prueba la siguiente variante o reintenta */ }
      }
      // Dos respuestas válidas y vacías seguidas: Mercado Público no tiene esa OC.
      if (!data && respuestasSinOC >= 2) break;
    }

    if (!data && respuestasSinOC > 0) {
      return res.status(404).json({
        ok: false,
        error: "OC no encontrada en Mercado Público",
        detalle: "Puede que aún no esté publicada o aceptada, o que el código tenga un error.",
        codigo,
      });
    }

    if (!data) {
      return res.status(502).json({
        ok: false,
        error: `Mercado Público no respondió correctamente (código ${ultimoStatus ?? "sin respuesta"}). Intente de nuevo en unos minutos.`,
        usandoTicketPruebas: false,
      });
    }

    const oc = data.Listado[0];

    const comprador = oc.Comprador || {};
    const itemsRaw = oc.Items?.Listado || [];
    const pago = FORMA_PAGO[txt(oc.FormaPago)] || null;

    const productos = itemsRaw.map((it, i) => {
      const cantidad = num(it.Cantidad) || 1;
      const precioNeto = num(it.PrecioNeto);
      return {
        orden: i,
        descripcion: txt(it.EspecificacionComprador) || txt(it.EspecificacionProveedor) || `Ítem ${i + 1}`,
        especificacion_proveedor: txt(it.EspecificacionProveedor),
        categoria: txt(it.Categoria),
        codigo_producto: txt(it.CodigoProducto),
        cantidad,
        precio_venta_unitario: precioNeto,
        total_linea: num(it.Total) || precioNeto * cantidad,
      };
    });

    const normalizada = {
      numero_oc: txt(oc.Codigo) || codigo,
      nombre_oc: txt(oc.Nombre),
      descripcion: txt(oc.Descripcion),
      estado_mp: txt(oc.Estado) || txt(oc.CodigoEstado),
      codigo_estado: Number(oc.CodigoEstado) || null,

      // ── Datos del cliente (van directo a ordenes_compra_v2) ──
      cliente: txt(comprador.NombreOrganismo),
      entidad: txt(comprador.NombreUnidad),
      rut_cliente: txt(comprador.RutUnidad),
      comuna: txt(comprador.ComunaUnidad),
      region: txt(comprador.RegionUnidad),
      direccion: txt(comprador.DireccionUnidad),
      contacto: [txt(comprador.NombreContacto), txt(comprador.FonoContacto)]
        .filter(Boolean).join(" · "),
      cargo_contacto: txt(comprador.CargoContacto),
      correo_cliente: txt(comprador.MailContacto),

      // ── Montos ──
      monto_neto: num(oc.TotalNeto),
      impuestos: num(oc.Impuestos),
      descuentos: num(oc.Descuentos),
      cargos: num(oc.Cargos),
      monto_total: num(oc.Total),
      moneda: txt(oc.TipoMoneda) || "CLP",

      // ── Fechas ──
      fecha_creacion: txt(oc.Fechas?.FechaCreacion),
      fecha_envio: txt(oc.Fechas?.FechaEnvio),
      fecha_aceptacion: txt(oc.Fechas?.FechaAceptacion),

      // ── Entrega y pago ──
      tipo_despacho_codigo: txt(oc.TipoDespacho),
      tipo_despacho: TIPO_DESPACHO[txt(oc.TipoDespacho)] || "No especificado",
      forma_pago_codigo: txt(oc.FormaPago),
      forma_pago: pago?.label || "No especificada",
      dias_pago: pago?.dias ?? 30,

      productos,
    };

    // Cache de 5 minutos: si Mati pega el mismo código dos veces, no repite la consulta
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");

    return res.status(200).json({
      ok: true,
      oc: normalizada,
      usandoTicketPruebas: false,
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "No se pudo consultar Mercado Público",
      detalle: String(e?.message || e),
    });
  }
}
