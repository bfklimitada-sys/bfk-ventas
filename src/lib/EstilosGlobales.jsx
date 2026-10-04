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
    @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;}}
  `;
  return <style>{css}</style>;
}
