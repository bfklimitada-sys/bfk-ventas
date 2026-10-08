import React from "react";
import ReactDOM from "react-dom/client";
import "./lib/authApiOc.js";
import "./lib/retornoAuth.js"; // antes de App: captura y borra de la dirección los tokens del enlace de recuperación
import App from "./App.jsx";
import { EstilosGlobales } from "./lib/EstilosGlobales.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <EstilosGlobales />
    <App />
  </React.StrictMode>
);
