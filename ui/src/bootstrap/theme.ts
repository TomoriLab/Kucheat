(() => {
  let preference: "system" | "light" | "dark" = "system";
  try {
    const stored = localStorage.getItem("kucheat.theme");
    if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
  } catch {
    // Theme remains usable when the webview denies local storage.
  }
  document.documentElement.dataset.theme = preference;
})();
