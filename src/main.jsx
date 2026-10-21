import React from "react";
import ReactDOM from "react-dom/client";
import "./lib/authApiOc.js";
import "./lib/retornoAuth.js"; // antes de App: captura y borra de la dirección los tokens del enlace de recuperación
import "./lib/capturaEntrada.js"; // antes de App: guarda la captura del atajo de Safari y deja #/cotizaciones
import App from "./App.jsx";
import { avisarVersionNueva } from "./lib/cargaModulos.js";

// Vite avisa cuando no puede precargar un archivo de un módulo bajo demanda (típico tras una nueva publicación).
// Solo se informa a la app (aviso con botón); nunca se recarga automáticamente.
window.addEventListener("vite:preloadError", (e) => avisarVersionNueva(e?.payload));
import { EstilosGlobales } from "./lib/EstilosGlobales.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <EstilosGlobales />
    <App />
  </React.StrictMode>
);
