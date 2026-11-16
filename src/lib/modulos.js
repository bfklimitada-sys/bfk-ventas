// Módulos que se pueden retirar de la interfaz sin tocar la base (16/11/2026).
//
// MODULO_CORREOS_BFK — «Correos de BFK»: correos del buzón de Gmail convertidos en notificaciones (tabla correos_bfk,
// pestaña «Correos» de Alertas, «Correos recibidos» en la ficha de la OC y su suma en la campana). RETIRADO: con false
// la app no lo muestra ni lo consulta (ni al ingresar, ni al actualizar, ni cada 5 minutos).
// NO se retira: la preparación y registro de correos a clientes desde la OC (reclamos de pago, entrega fallida, fecha de
// entrega: lib/correos.js y FormulariosCorreo.jsx), «Correos enviados desde BFK» de la ficha, ni el ingreso/contraseñas.
// La tabla correos_bfk, sus registros, funciones y permisos quedan intactos.
// Para recuperarlo: poner true aquí y volver a activar la sincronización «Correos BFK» de bfk-respaldos (correos.yml; con
// «Run workflow» y ventana de hasta 90 días se recuperan los correos del período en que estuvo detenida).
export const MODULO_CORREOS_BFK = false;
