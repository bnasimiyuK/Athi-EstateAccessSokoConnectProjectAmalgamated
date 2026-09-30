
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof requireRole === "function" && !requireRole("security", "admin")) return;
    const me = typeof getUser === "function" ? getUser() : null;
    if (me) {
      document.getElementById("user-greeting").textContent = `Hi, ${me.name || "User"}`;
      document.getElementById("user-name").textContent = me.name || "—";
      document.getElementById("user-role").textContent = me.role || "—";
    }
  });
