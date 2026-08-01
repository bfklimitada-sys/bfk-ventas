// ═══════════════════════════════════════════════════════════════
// api/oc.js — Función serverless (Vercel)
// Consulta una OC en la API de Mercado Público y devuelve solo
// los campos que usa la app, ya normalizados y listos para guardar.
//
// Uso desde el frontend:  fetch("/api/oc?codigo=1107277-31-AG26")
//
// El ticket se lee de la variable de entorno MP_TICKET.
// Configúrala en Vercel → Settings → Environment Variables.
// Si no existe, usa el ticket público de pruebas de ChileCompra.
// ═══════════════════════════════════════════════════════════════

const TICKET_PRUEBAS = "F8537A18-6766-4DEF-9E59-426B4FEE2844";

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

async function buscarCodigoProveedor(ticket) {
  const r = await fetch(
    `https://api.mercadopublico.cl/servicios/v1/Publico/Empresas/BuscarProveedor` +
    `?rutempresaproveedor=${encodeURIComponent(RUT_BFK)}&ticket=${encodeURIComponent(ticket)}`,
    { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  const d = await r.json();
  return d?.listaEmpresas?.[0]?.CodigoEmpresa ?? d?.Listado?.[0]?.CodigoEmpresa ?? null;
}

async function listarOCs(req, res, ticket) {
  const estado = txt(req.query?.listar) || "enviadaproveedor";
  const dias = Math.min(Number(req.query?.dias) || 30, 90);

  const codigo = await buscarCodigoProveedor(ticket);
  if (!codigo) {
    return res.status(502).json({ ok: false, error: "No se pudo obtener el código de proveedor" });
  }

  const encontradas = [];
  const hoy = new Date();
  for (let i = 0; i < dias; i++) {
    const d = new Date(hoy); d.setDate(d.getDate() - i);
    const f = `${String(d.getDate()).padStart(2,"0")}${String(d.getMonth()+1).padStart(2,"0")}${d.getFullYear()}`;
    const url = "https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json" +
      `?fecha=${f}&estado=${encodeURIComponent(estado)}&CodigoProveedor=${codigo}` +
      `&ticket=${encodeURIComponent(ticket)}`;
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const j = await r.json();
      for (const oc of (j?.Listado || [])) {
        encontradas.push({
          numero_oc: txt(oc.Codigo),
          nombre: txt(oc.Nombre),
          estado: txt(oc.Estado) || estado,
          fecha: txt(oc.FechaEnvio) || txt(oc.FechaCreacion),
        });
      }
    } catch { /* un día que falle no debe cortar la búsqueda */ }
  }

  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate");
  return res.status(200).json({
    ok: true, estado, dias, codigoProveedor: codigo,
    total: encontradas.length, ocs: encontradas,
  });
}

export default async function handler(req, res) {

  const ticket = process.env.MP_TICKET || TICKET_PRUEBAS;

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

    for (const base of BASES) {
      const url = `${base}?codigo=${encodeURIComponent(codigo)}&ticket=${encodeURIComponent(ticket)}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      ultimoStatus = r.status;
      if (!r.ok) continue;
      try { data = await r.json(); } catch { continue; }
      if (data) break;
    }

    if (!data) {
      return res.status(502).json({
        ok: false,
        error: `Mercado Público respondió ${ultimoStatus}`,
        usandoTicketPruebas: !process.env.MP_TICKET,
      });
    }

    const oc = data?.Listado?.[0];

    if (!oc) {
      return res.status(404).json({
        ok: false,
        error: "OC no encontrada en Mercado Público",
        detalle: "Puede que aún no esté publicada. Reintenta más tarde.",
        codigo,
      });
    }

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
      usandoTicketPruebas: !process.env.MP_TICKET,
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "No se pudo consultar Mercado Público",
      detalle: String(e?.message || e),
    });
  }
}
