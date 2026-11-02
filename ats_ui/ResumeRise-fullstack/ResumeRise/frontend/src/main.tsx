import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
// Run expired-entry cleanup once at app boot (before any hook reads storage)
import { lsClearExpired } from "./persistence";
import { AuthProvider } from "./context/AuthContext";

lsClearExpired();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
