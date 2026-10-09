/* ============================================================
   frontend/js/validators.js
   Shared client-side validators for auth forms.
   ============================================================ */

function normalizePhone(raw) {
  if (!raw) return { valid: false, reason: "Phone is required." };

  const s = String(raw).trim();
  const hasLeadingPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");

  if (!digits) return { valid: false, reason: "Phone must contain digits." };
  if (digits.length > 15) return { valid: false, reason: "Phone is too long." };
  if (digits.length < 9)  return { valid: false, reason: "Phone is too short." };

  const isKenyan =
    digits.startsWith("254") ||
    (digits.startsWith("0") && digits.length === 10) ||
    ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9);

  if (isKenyan) {
    let local;
    if (digits.startsWith("254"))      local = digits.slice(3);
    else if (digits.startsWith("0"))   local = digits.slice(1);
    else                                local = digits;

    if (local.length !== 9 || !/^[17]/.test(local)) {
      return { valid: false, reason: "Invalid Kenyan phone number." };
    }
    return { valid: true, normalized: `+254${local}` };
  }

  if (!hasLeadingPlus) {
    return { valid: false, reason: "Foreign numbers must start with + and country code (e.g. +44 for UK)." };
  }

  return { valid: true, normalized: `+${digits}` };
}

function validateName(raw, fieldLabel = "Name") {
  if (!raw || !String(raw).trim()) {
    return { valid: false, reason: `${fieldLabel} is required.` };
  }
  const s = String(raw).trim();
  if (s.length < 2)  return { valid: false, reason: `${fieldLabel} must be at least 2 characters.` };
  if (s.length > 50) return { valid: false, reason: `${fieldLabel} is too long.` };

  if (!/^[A-Za-zÀ-ÿ' -]+$/.test(s)) {
    return { valid: false, reason: `${fieldLabel} contains invalid characters.` };
  }
  return { valid: true, normalized: s };
}

function validateEmail(raw, { optional = false } = {}) {
  if (!raw || !String(raw).trim()) {
    if (optional) return { valid: true, normalized: null };
    return { valid: false, reason: "Email is required." };
  }
  const s = String(raw).trim().toLowerCase();

  if (s.length > 254) return { valid: false, reason: "Email is too long." };

  const re = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  if (!re.test(s)) return { valid: false, reason: "Invalid email format." };

  const [local, domain] = s.split("@");
  if (["test", "admin", "user", "asdf", "qwerty", "a", "abc"].includes(local)) {
    return { valid: false, reason: "Please use a real email address." };
  }
  if (["test.com", "example.com", "example.org", "localhost"].includes(domain)) {
    return { valid: false, reason: "Please use a real email address." };
  }

  return { valid: true, normalized: s };
}

function validatePassword(raw) {
  if (!raw) return { valid: false, reason: "Password is required." };
  const s = String(raw);
  if (s.length < 8)         return { valid: false, reason: "Password must be at least 8 characters." };
  if (s.length > 100)       return { valid: false, reason: "Password is too long." };
  if (!/[A-Z]/.test(s))     return { valid: false, reason: "Password must contain an uppercase letter." };
  if (!/[a-z]/.test(s))     return { valid: false, reason: "Password must contain a lowercase letter." };
  if (!/[0-9]/.test(s))     return { valid: false, reason: "Password must contain a number." };
  return { valid: true };
}