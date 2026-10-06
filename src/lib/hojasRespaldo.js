// ÚNICA lista de datos que incluye el Excel de respaldo manual (Administración).
// Cada hoja corresponde a una tabla que la aplicación realmente lee o escribe.
//  · importable: la hoja puede volver a subirse desde "Subir Excel editado" (las 14 de siempre; no se amplía lo que se puede importar).
//  · margen: agrega las columnas _Margen($) y _Margen(%) con fórmula.
// Excluido a propósito (datos técnicos, no del negocio): oc_bloqueos (candados de edición de 30 s),
// mp_cache_avisos (caché de Mercado Público) y mp_uso_diario (contador de consultas a la API).
export const HOJAS_RESPALDO = [
  { hoja:"OrdenesCompra",             tabla:"ordenes_compra_v2",           importable:true, margen:true },
  { hoja:"ProductosLinks",            tabla:"oc_productos_link" },
  { hoja:"EventosCompra",             tabla:"eventos_compra",              importable:true },
  { hoja:"EventosEntrega",            tabla:"eventos_entrega",             importable:true },
  { hoja:"EventosFactura",            tabla:"eventos_factura",             importable:true },
  { hoja:"EventosPagoCliente",        tabla:"eventos_pago_cliente",        importable:true },
  { hoja:"EventosPagoFinanciamiento", tabla:"eventos_pago_financiamiento", importable:true },  // incluye los pagos sin OC (oc_id vacío)
  { hoja:"EventosPostventa",          tabla:"eventos_postventa" },
  { hoja:"Reclamos",                  tabla:"oc_reclamos" },
  { hoja:"Responsables",              tabla:"oc_responsables" },
  { hoja:"Comentarios",               tabla:"oc_comentarios" },
  { hoja:"Financiadores",             tabla:"financiadores",               importable:true },
  { hoja:"Vendedores",                tabla:"vendedores",                  importable:true },
  { hoja:"CategoriasGasto",           tabla:"categorias_gasto",            importable:true },
  { hoja:"GastosIndirectos",          tabla:"gastos_indirectos",           importable:true },
  { hoja:"IvaMensual",                tabla:"iva_mensual",                 importable:true },
  { hoja:"PagosVendedor",             tabla:"pagos_vendedor",              importable:true },
  { hoja:"AjustesSaldo",              tabla:"ajustes_saldo_financiador",   importable:true },
  { hoja:"ContactosCobranza",         tabla:"contactos_cobranza",          importable:true },
  { hoja:"AportesSocios",             tabla:"aportes_socios" },
  { hoja:"SaldoBanco",                tabla:"saldo_banco" },
  { hoja:"BancoMensual",              tabla:"banco_mensual" },
  { hoja:"CartolasImportadas",        tabla:"cartolas_importadas" },
  { hoja:"EntidadesCatalogo",         tabla:"entidades_catalogo" },
  { hoja:"Perfiles",                  tabla:"perfiles" },
  { hoja:"Notificaciones",            tabla:"notificaciones" },
  { hoja:"HistorialCambios",          tabla:"historial_cambios" },
  { hoja:"DiferenciasHistoricas",     tabla:"fin_diferencias_historicas" },  // Fase 4B: diferencias congeladas pendientes de aprobación (solo lectura)
];
