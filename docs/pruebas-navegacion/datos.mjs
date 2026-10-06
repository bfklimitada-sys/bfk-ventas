// Datos simulados (ficticios) para recorrer la interfaz completa.
export const dias=(n)=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
const hoy=new Date(); const Y=hoy.getFullYear(), M=hoy.getMonth()+1;
const oc=(i,o={})=>({id:"oc"+i,numero_oc:`2${String(i).padStart(3,"0")}-${100+i}-SE26`,cliente:"Municipalidad Ficticia "+i,rut_cliente:`69.${String(100+i).padStart(3,"0")}.000-${i%10}`,comuna:"Laja",vendedor_id:i%2?"v1":"v2",estado_compra:"comprado",estado_entrega:"pendiente",estado_factura_propia:"pendiente",estado_pago_cliente:"pendiente",estado_pago_financiamiento:"pendiente",monto_total:1000000+i*50000,costo_total:700000+i*30000,monto_facturado:0,monto_cobrado:0,financiador_id:i%3?"f1":"f2",creadoEn:new Date(Date.now()-i*864e5).toISOString(),dias_pago:30,fecha_emision_mp:dias(40-i),archivada:false,vendedores:{nombre:i%2?"Vendedor Uno":"Vendedora Dos"},financiadores:{nombre:i%3?"Financiador Uno":"Cuenta BFK"},eventos_compra:[{id:"ec"+i,oc_id:"oc"+i,fecha:dias(35-i),monto:700000+i*30000,costo_compra:700000+i*30000,fecha_entrega_estimada:dias(20-i),financiador_id:i%3?"f1":"f2"}],eventos_entrega:[],eventos_factura:[],eventos_pago_cliente:[],eventos_pago_financiamiento:[],eventos_postventa:[],oc_productos_link:[],oc_comentarios:[],oc_reclamos:[],oc_responsables:[],items_oc:[],...o});
export const crear=()=>{
  const OCS=[
    oc(1),oc(2),
    oc(3,{estado_entrega:"confirmada",eventos_entrega:[{id:"en3",oc_id:"oc3",fecha:dias(6)}]}),
    oc(4,{estado_entrega:"confirmada",estado_factura_propia:"emitida",monto_facturado:1200000,eventos_entrega:[{id:"en4",oc_id:"oc4",fecha:dias(50)}],eventos_factura:[{id:"fa4",oc_id:"oc4",fecha:dias(45),numero_factura:"501",monto:1200000}]}),
    oc(5,{estado_entrega:"confirmada",estado_factura_propia:"emitida",estado_pago_cliente:"pagado",monto_facturado:1250000,monto_cobrado:1250000,eventos_entrega:[{id:"en5",oc_id:"oc5",fecha:dias(30)}],eventos_factura:[{id:"fa5",oc_id:"oc5",fecha:dias(25),numero_factura:"502",monto:1250000}],eventos_pago_cliente:[{id:"pc5",oc_id:"oc5",fecha:dias(5),monto:1250000}]}),
    oc(6,{eventos_compra:[]}),
    oc(7,{estado_entrega:"confirmada",estado_factura_propia:"emitida",monto_facturado:1350000,eventos_entrega:[{id:"en7",oc_id:"oc7",fecha:dias(20)}],eventos_factura:[{id:"fa7",oc_id:"oc7",fecha:`${Y}-${String(M).padStart(2,"0")}-02`,numero_factura:"503",monto:1350000}],eventos_postventa:[{id:"pv7",oc_id:"oc7",tipo:"falla",descripcion:"Falla de prueba",estado:"abierto",fecha:dias(2),costo_extra:0}]}),
  ];
  const ARCH=[oc(9,{archivada:true,archivada_en:new Date().toISOString(),archivada_por:"u1",archivada_por_nombre:"Admin Prueba",archivo_motivo:"Duplicada"})];
  return {
    ordenes_compra_v2:[...OCS,...ARCH],
    perfiles:[{id:"u1",nombre:"Admin Prueba",rol:"admin",email:"a@a.cl"},{id:"u2",nombre:"Usuario Prueba",rol:"usuario",email:"u@u.cl"}],
    vendedores:[{id:"v1",nombre:"Vendedor Uno",comision_pct:10},{id:"v2",nombre:"Vendedora Dos",comision_pct:10}],
    financiadores:[{id:"f1",nombre:"Financiador Uno",saldo_deuda:2500000},{id:"f2",nombre:"Cuenta BFK",saldo_deuda:0}],
    categorias_gasto:[{id:"cat_impuesto",nombre:"Impuesto SII",subcategorias:[]},{id:"cat_contador",nombre:"Contador",subcategorias:[]},{id:"cat_otros",nombre:"Otros",subcategorias:[]}],
    gastos_indirectos:[{id:"g1",categoria_id:"cat_impuesto",monto:50000,mes:M===1?12:M-1,anio:M===1?Y-1:Y,fecha:dias(10),detalle:"F29"},{id:"g2",categoria_id:"cat_contador",monto:80000,mes:M,anio:Y,fecha:dias(3),detalle:"Honorarios"}],
    iva_mensual:[{id:"i1",anio:M===1?Y-1:Y,mes:M===1?12:M-1,iva_ventas:190000,iva_compras:60000,iva_pagado:130000,ventas_netas:1000000,compras_netas:315000},{id:"i2",anio:Y,mes:M,iva_ventas:20000,iva_compras:80000,iva_pagado:0,ventas_netas:105000,compras_netas:420000}],
    pagos_vendedor:[], ajustes_saldo_financiador:[], aportes_socios:[{id:"ap1",socio:"Socio A",tipo:"aporte",monto:500000,fecha:dias(60)}],
    contactos_cobranza:[{id:"c1",rut:"69.104.000-4",nombre:"Contacto Pagos",correo:"pagos@ejemplo.cl"}],
    entidades_catalogo:[{id:"e1",rut:"69.101.000-1",nombre_entidad:"Municipalidad Ficticia 1",comuna:"Laja"}],
    notificaciones:[], historial_cambios:[{id:"h1",oc_id:"oc1",oc_numero:"2001-101-SE26",usuario_id:"u1",usuario_nombre:"Admin Prueba",accion:"Creada",creadoEn:new Date().toISOString()}],
    oc_reclamos:[], oc_responsables:[], eventos_postventa:[{id:"pv7",oc_id:"oc7",tipo:"falla",descripcion:"Falla de prueba",estado:"abierto",fecha:dias(2),costo_extra:0,creadoEn:new Date().toISOString()}],
    cartolas_importadas:[], saldo_banco:[{id:"actual",saldo:3000000,fecha_corte:dias(3)}], banco_mensual:[],
    eventos_pago_financiamiento:[], mp_uso_diario:[], mp_cache_avisos:[],
  };
};
