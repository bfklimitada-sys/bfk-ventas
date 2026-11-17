import { createContext } from "react";
// Centro de Acciones (17/11/2026): catálogo de categorías de la base para la ficha de OC (Seguimiento especial).
// categorias=null → migración del 17/11/2026 no instalada: la ficha usa las categorías fijas de siempre.
export const AccionesContext = createContext({ categorias: null });
