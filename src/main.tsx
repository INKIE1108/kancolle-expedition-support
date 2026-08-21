import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";
import "./ui-v55.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent("kancolle-pwa-update"));
            }
          });
        });
      })
      .catch(() => {
        // 開発中に登録失敗してもアプリ本体は動かす
      });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
