// ================================
// PAYMENT.JS WITH EXCEL/CSV EXPORT + M-PESA + RECEIPT
// ================================
//
// NOTE: This script is loaded dynamically — fetched as part of an HTML
// fragment (payments.html) and injected into the SPA shell's
// #main-content-area — AFTER the outer page's DOMContentLoaded event has
// already fired once. A `document.addEventListener("DOMContentLoaded", ...)`
// wrapper here would therefore NEVER run, since that event only fires once
// per page load. Since all the elements below already exist in the DOM by
// the time this script executes, we just run immediately (wrapped in an
// IIFE to keep variables out of the global scope, same as before).
(() => {
  const paymentsBody = document.getElementById("paymentsBody");
  const verifiedBody = document.getElementById("verifiedBody");
  const balanceBody = document.getElementById("balanceBody");
  const residentSelect = document.getElementById("residentId");
  const referenceDiv = document.getElementById("referenceDiv");
  const paymentMethodSelect = document.getElementById("paymentMethod");

  const token = localStorage.getItem("token");
  const userRole = (localStorage.getItem("role") || "resident").toLowerCase();
  const userId = localStorage.getItem("ResidentID") || localStorage.getItem("userId");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };

  // ===============================
  // 📱 PHONE AUTO-FORMAT FUNCTION
  // ===============================
  function formatKenyanPhone(phone) {
    phone = phone.trim();
    if (phone.startsWith("0")) return "254" + phone.slice(1);
    if (phone.startsWith("254")) return phone;
    return null;
  }

  // ------------------------------
  // Show / Hide Reference
  // ------------------------------
  paymentMethodSelect?.addEventListener("change", () => {
    referenceDiv.style.display =
      paymentMethodSelect.value === "Mpesa" ? "none" : "block";
  });

  // ------------------------------
  // Load Residents
  // ------------------------------
  async function loadResidents() {
    if (!residentSelect) return;

    if (userRole !== "admin") {
      residentSelect.innerHTML = `<option value="${userId}" data-phone="${localStorage.getItem("PhoneNumber") || ""}">${userId}</option>`;
      residentSelect.disabled = true;
      return;
    }

    try {
      const res = await fetch("http://localhost:4050/api/residents/all", { headers });
      const data = await res.json();
      const residents = Array.isArray(data) ? data : data.data || [];

      residentSelect.innerHTML =
        `<option value="">Select Resident ID</option>` +
        residents.map(r =>
          `<option value="${r.ResidentID}" data-phone="${r.PhoneNumber || ''}">
            ${r.ResidentID} - ${r.ResidentName || r.Name || ''}
          </option>`
        ).join("");
    } catch (err) {
      console.error("Error fetching residents:", err);
    }
  }

  // ------------------------------
  // Auto-fill phone when resident changes
  // ------------------------------
  if (residentSelect) {
    residentSelect.addEventListener("change", () => {
      const selectedOption = residentSelect.selectedOptions[0];
      const phoneInput = document.getElementById("phoneNumber");

      if (selectedOption && phoneInput) {
        phoneInput.value = (selectedOption.dataset.phone || "").trim();
      }
    });
  }

  // ------------------------------
  // Load Payments
  // ------------------------------
  async function loadPayments() {
    let url = "http://localhost:4050/api/payments";
    if (userRole === "resident") url += `?ResidentID=${userId}`;

    try {
      const res = await fetch(url, { headers });
      const data = await res.json();
      renderPayments(data.data || data);
    } catch (err) {
      console.error("Error loading payments:", err);
    }
  }

  function renderPayments(payments) {
    paymentsBody.innerHTML = payments.map(p => `
      <tr>
        <td>${p.PaymentID}</td>
        <td>${p.ResidentID || userId}</td>
        <td>${p.Amount}</td>
        <td>${p.PaymentDate ? new Date(p.PaymentDate).toLocaleDateString() : "-"}</td>
        <td>${p.Status}</td>
        <td>${p.Reference || "-"}</td>
        <td>${p.PaymentMethod || "-"}</td>
        <td>
          ${
            userRole === "admin" && p.Status !== "Verified"
              ? `<button class="verifyBtn text-green-600" data-id="${p.PaymentID}">
                  Verify
                </button>`
              : "-"
          }
        </td>
      </tr>
    `).join("");

    attachVerifyButtons();
  }

  // ------------------------------
  // VERIFY PAYMENT + OPEN RECEIPT
  // ------------------------------
  function attachVerifyButtons() {
    if (userRole !== "admin") return;

    document.querySelectorAll(".verifyBtn").forEach(btn => {
      btn.addEventListener("click", async e => {
        const paymentId = e.target.dataset.id;

        try {
          const res = await fetch(
            `http://localhost:4050/api/payments/verify/${paymentId}`,
            { method: "PUT", headers }
          );

          if (!res.ok) throw new Error("Verification failed");

          // Open receipt
          window.open(`/api/receipts/${paymentId}`, "_blank");

          loadPayments();
          loadVerifiedPayments();
          loadBalances();
        } catch (err) {
          console.error("Verify failed:", err);
        }
      });
    });
  }

  // ------------------------------
  // Verified Payments
  // ------------------------------
  async function loadVerifiedPayments() {
    let url = "http://localhost:4050/api/payments/verified";
    if (userRole === "resident") url += `?ResidentID=${userId}`;

    try {
      const res = await fetch(url, { headers });
      const data = await res.json();

      verifiedBody.innerHTML = (data.data || data).map(p => `
        <tr>
          <td>${p.ResidentID || userId}</td>
          <td>${p.Amount}</td>
          <td>${p.Reference || "-"}</td>
          <td>${p.VerifiedDate ? new Date(p.VerifiedDate).toLocaleDateString() : "-"}</td>
        </tr>
      `).join("");
    } catch (err) {
      console.error("Error loading verified payments:", err);
    }
  }

  // ------------------------------
  // Balances
  // ------------------------------
  async function loadBalances() {
    let url = "http://localhost:4050/api/payments/balances";
    if (userRole === "resident") url += `?ResidentID=${userId}`;

    try {
      const res = await fetch(url, { headers });
      const data = await res.json();

      balanceBody.innerHTML = (data.data || data).map(b => `
        <tr>
          <td>${b.ResidentID || userId}</td>
          <td>${b.TotalPaid}</td>
          <td>${b.TotalDue}</td>
          <td>${b.Balance}</td>
        </tr>
      `).join("");
    } catch (err) {
      console.error("Error loading balances:", err);
    }
  }

  // ------------------------------
  // M-PESA STK Push
  // ------------------------------
  async function payWithMpesa(residentId, phoneNumber, amount) {
    try {
      const res = await fetch("http://localhost:4050/api/payments/mpesa", {
        method: "POST",
        headers,
        body: JSON.stringify({ residentId, phoneNumber, amount })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "STK Push failed");
      alert("M-Pesa initiated. Check your phone to complete the payment.");
    } catch (err) {
      console.error("STK Push Error:", err);
      alert("M-Pesa payment failed: " + err.message);
    }
  }

  // ------------------------------
  // PAYMENT FORM SUBMISSION
  // ------------------------------
  document.getElementById("makePaymentForm")?.addEventListener("submit", async e => {
    e.preventDefault();

    const residentId = residentSelect.value || userId;
    const rawPhone = document.getElementById("phoneNumber").value;
    const amount = Number(document.getElementById("amount").value);
    const method = paymentMethodSelect.value;
    const reference = document.getElementById("reference")?.value;

    try {
      if (method === "Mpesa") {
        const formattedPhone = formatKenyanPhone(rawPhone);

        if (!formattedPhone) {
          alert("Enter a valid Kenyan phone number (0XXXXXXXXX or 254XXXXXXXXX)");
          return;
        }

        if (amount <= 0) {
          alert("Enter a valid amount");
          return;
        }

        await payWithMpesa(residentId, formattedPhone, amount);
        document.getElementById("msg").innerText =
          "M-Pesa initiated. Complete payment on your phone.";
      } else {
        // NOTE: backend route is POST /api/payments/make, not /api/payments
        const res = await fetch("http://localhost:4050/api/payments/make", {
          method: "POST",
          headers,
          body: JSON.stringify({ residentId, amount, method, reference })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || "Payment failed to save");
        }

        document.getElementById("msg").innerText = "Payment recorded.";
      }

      e.target.reset();
      loadPayments();
      loadVerifiedPayments();
      loadBalances();
    } catch (err) {
      console.error(err);
      document.getElementById("msg").innerText = "Payment failed";
    }
  });

  // ------------------------------
  // EXPORT TO EXCEL / CSV
  // ------------------------------
  function exportTableToExcel(tableId, filename) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.table_to_sheet(table);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, filename);
  }

  function exportTableToCSV(tableId, filename) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const ws = XLSX.utils.table_to_sheet(table);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }

  // ------------------------------
  // EXPORT BUTTON EVENTS
  // ------------------------------
  document.getElementById("exportExcel")?.addEventListener("click", () => {
    exportTableToExcel("paymentsTable", "PaymentHistory.xlsx");
  });
  document.getElementById("exportCsv")?.addEventListener("click", () => {
    exportTableToCSV("paymentsTable", "PaymentHistory.csv");
  });
  document.getElementById("exportVerifiedExcel")?.addEventListener("click", () => {
    exportTableToExcel("verifiedTable", "VerifiedPayments.xlsx");
  });
  document.getElementById("exportVerifiedCsv")?.addEventListener("click", () => {
    exportTableToCSV("verifiedTable", "VerifiedPayments.csv");
  });
  document.getElementById("exportBalancesExcel")?.addEventListener("click", () => {
    exportTableToExcel("balanceTable", "Balances.xlsx");
  });
  document.getElementById("exportBalancesCsv")?.addEventListener("click", () => {
    exportTableToCSV("balanceTable", "Balances.csv");
  });

  // ------------------------------
  // INIT
  // ------------------------------
  loadResidents();
  loadPayments();
  loadVerifiedPayments();
  loadBalances();
})();