import React from "react";
import ReactDOM from "react-dom/client";
import "./lib/authApiOc.js";
import App from "./App.jsx";
import { EstilosGlobales } from "./lib/EstilosGlobales.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <EstilosGlobales />
    <App />
  </React.StrictMode>
);
