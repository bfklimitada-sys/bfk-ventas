import { C, R, SANS, TOUCH } from "./theme";

// Flecha única de las listas desplegables (reemplaza el aspecto nativo, distinto en cada navegador).
const FLECHA = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

// Reglas globales: tipografía, zonas táctiles, campos y áreas seguras del celular.
// Los botones/campos pequeños pueden excluirse con el atributo data-compact.
export function EstilosGlobales() {
  const css = `
    html{-webkit-text-size-adjust:100%;}
    body{margin:0;background:${C.paper};font-family:${SANS};color:${C.ink};-webkit-font-smoothing:antialiased;}
    b,strong{font-weight:600;}
    button{font-family:inherit;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
    button:not([data-compact]){min-height:${TOUCH - 4}px;}
    button:disabled{cursor:default;}
    select,input:not([type=checkbox]):not([type=radio]),textarea{font-size:16px!important;}
    /* Aspecto base de los campos: lo usa todo campo sin estilo propio y unifica las listas desplegables. */
    select,textarea,input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]){
      font-family:inherit;color:${C.ink};background-color:${C.card};border:1px solid ${C.borderFuerte};border-radius:${R.sm}px;box-sizing:border-box;}
    select{-webkit-appearance:none!important;appearance:none!important;background-image:${FLECHA}!important;background-repeat:no-repeat!important;
      background-position:right 10px center!important;background-size:16px 16px!important;padding-right:34px!important;cursor:pointer;text-overflow:ellipsis;}
    select:disabled,input:disabled,textarea:disabled{background-color:${C.paper};color:${C.inkFaint};cursor:default;}
    input[type=checkbox],input[type=radio]{accent-color:${C.tealDark};}
    ::placeholder{color:#94A3B8;opacity:1;}
    select:focus,textarea:focus,input:not([type=checkbox]):not([type=radio]):not([type=file]):focus{border-color:${C.teal}!important;outline:none;box-shadow:0 0 0 3px rgba(20,184,166,0.16);}
    button:focus-visible,a:focus-visible{outline:2px solid ${C.teal};outline-offset:2px;}
    .bfk-ventana-fondo{align-items:flex-end;}
    .bfk-ventana{border-radius:16px 16px 0 0;max-height:92vh;}
    .bfk-aviso{bottom:80px;}
    .bfk-modo-todo .bfk-indice{display:none!important;}
    /* Pestañas internas: en el celular ocupan el ancho; en escritorio, solo lo que necesitan. */
    .bfk-segmentada{display:flex;}
    .bfk-sin-barra{scrollbar-width:none;}
    /* Agenda: día cuadrado en el celular; en escritorio, alto fijo para que el mes completo quepa en pantalla. */
    .bfk-dia{aspect-ratio:1;min-height:0!important;}
    .bfk-sin-barra::-webkit-scrollbar{display:none;}
    @media (min-width:1024px){
      .bfk-ventana-fondo{align-items:center;padding:24px;box-sizing:border-box;}
      .bfk-ventana{border-radius:16px;max-height:88vh;}
      .bfk-aviso{bottom:28px;left:calc(50% + 124px)!important;}
      .bfk-segmentada{display:inline-flex;max-width:100%;}
      .bfk-dia{aspect-ratio:auto;height:64px;}
    }
    @media print{
      @page{margin:12mm;}
      html,body{background:#fff!important;}
      [data-noprint]{display:none!important;}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-shadow:none!important;}
      body > div > div{min-height:0!important;padding-bottom:0!important;}
    }
    @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;}}
  `;
  return <style>{css}</style>;
}
