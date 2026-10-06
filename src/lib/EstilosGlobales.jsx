import { C, SANS, TOUCH } from "./theme";

// Reglas globales: tipografía, zonas táctiles y áreas seguras del celular.
// Los botones/campos pequeños pueden excluirse con el atributo data-compact.
export function EstilosGlobales() {
  const css = `
    html{-webkit-text-size-adjust:100%;}
    body{margin:0;background:${C.paper};font-family:${SANS};color:${C.ink};-webkit-font-smoothing:antialiased;}
    button{font-family:inherit;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
    button:not([data-compact]){min-height:${TOUCH - 4}px;}
    select,input:not([type=checkbox]):not([type=radio]),textarea{font-size:16px!important;}
    button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid ${C.teal};outline-offset:2px;}
    .bfk-ventana-fondo{align-items:flex-end;}
    .bfk-ventana{border-radius:18px 18px 0 0;max-height:92vh;}
    .bfk-aviso{bottom:80px;}
    .bfk-modo-todo .bfk-indice{display:none!important;}
    @media (min-width:1024px){
      .bfk-ventana-fondo{align-items:center;padding:24px;box-sizing:border-box;}
      .bfk-ventana{border-radius:18px;max-height:88vh;}
      .bfk-aviso{bottom:28px;left:calc(50% + 124px)!important;}
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
