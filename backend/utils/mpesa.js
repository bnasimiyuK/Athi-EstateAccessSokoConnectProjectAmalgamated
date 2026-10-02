/* ============================================================
   utils/mpesa.js — Safaricom Daraja helpers
   - getAccessToken()  : OAuth token, cached for the process lifetime
   - stkPush()         : send STK push prompt to resident's phone
   - stkQuery()        : poll status by CheckoutRequestID
   ============================================================ */

const axios = require("axios");

const ENV           = (process.env.MPESA_ENV || "sandbox").toLowerCase();
const CONSUMER_KEY  = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SEC = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE     = process.env.MPESA_SHORTCODE;
const PASSKEY       = process.env.MPESA_PASSKEY;
const CALLBACK_URL  = process.env.MPESA_CALLBACK_URL;

/* Daraja base URLs */
const BASE_URL = ENV === "production"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

/* ------------------------------------------------------------
   In-process token cache (Safaricom tokens last 1 hour)
   ------------------------------------------------------------ */
let _tokenCache = { value: null, expiresAt: 0 };

async function getAccessToken() {
  const now = Date.now();
  if (_tokenCache.value && now < _tokenCache.expiresAt - 30_000) {
    return _tokenCache.value;
  }

  if (!CONSUMER_KEY || !CONSUMER_SEC) {
    throw new Error("M-Pesa not configured: missing MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET.");
  }

  const auth = Buffer
    .from(`${CONSUMER_KEY}:${CONSUMER_SEC}`)
    .toString("base64");

  const res = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 15000,
    }
  );

  const token = res.data.access_token;
  const ttl   = Number(res.data.expires_in) || 3599;

  _tokenCache = { value: token, expiresAt: now + ttl * 1000 };
  console.log("[mpesa] new access token, expires in", ttl, "s");
  return token;
}

/* ------------------------------------------------------------
   Timestamp: YYYYMMDDHHmmss, Africa/Nairobi (UTC+3)
   ------------------------------------------------------------ */
function nairobiTimestamp() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000); // shift UTC → EAT
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

/* ------------------------------------------------------------
   Base64 password: Shortcode + Passkey + Timestamp
   ------------------------------------------------------------ */
function buildPassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

/* ------------------------------------------------------------
   Normalize phone to 254XXXXXXXXX
   ------------------------------------------------------------ */
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\D/g, "");
  if (s.startsWith("0"))  s = "254" + s.slice(1);
  if (s.startsWith("7") || s.startsWith("1")) s = "254" + s;
  if (!s.startsWith("254")) return null;
  if (s.length !== 12) return null;
  return s;
}

/* ------------------------------------------------------------
   Initiate STK push
   ------------------------------------------------------------ */
async function stkPush({ phone, amount, accountReference, transactionDesc }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("Invalid phone number for M-Pesa.");
  if (!SHORTCODE || !PASSKEY) {
    throw new Error("M-Pesa not configured: missing MPESA_SHORTCODE / MPESA_PASSKEY.");
  }
  if (!CALLBACK_URL || !CALLBACK_URL.startsWith("https://")) {
    throw new Error("M-Pesa not configured: MPESA_CALLBACK_URL must be public HTTPS.");
  }

  const timestamp = nairobiTimestamp();
  const password  = buildPassword(SHORTCODE, PASSKEY, timestamp);
  const token     = await getAccessToken();

  const payload = {
    BusinessShortCode: SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   "CustomerPayBillOnline",
    Amount:            Math.round(Number(amount)),
    PartyA:            normalized,
    PartyB:            SHORTCODE,
    PhoneNumber:       normalized,
    CallBackURL:       CALLBACK_URL,
    AccountReference:  String(accountReference || "AthiSoko").slice(0, 12),
    TransactionDesc:   String(transactionDesc || "Signup").slice(0, 100),
  };

  const res = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    {
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 45000,
    }
  );

  return {
    MerchantRequestID: res.data.MerchantRequestID,
    CheckoutRequestID: res.data.CheckoutRequestID,
    ResponseCode:      res.data.ResponseCode,
    ResponseDescription: res.data.ResponseDescription,
    CustomerMessage:   res.data.CustomerMessage,
    raw:               res.data,
  };
}

/* ------------------------------------------------------------
   Query an STK push by CheckoutRequestID
   ------------------------------------------------------------ */
async function stkQuery(checkoutRequestId) {
  if (!checkoutRequestId) throw new Error("checkoutRequestId required.");
  const timestamp = nairobiTimestamp();
  const password  = buildPassword(SHORTCODE, PASSKEY, timestamp);
  const token     = await getAccessToken();

  const res = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    {
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );

  return res.data;
}

module.exports = {
  getAccessToken,
  stkPush,
  stkQuery,
  normalizePhone,
  nairobiTimestamp,
};