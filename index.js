// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const Stripe = require("stripe");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const app = express();
const port = process.env.PORT || 3000;

// ========================
// CONFIG
// ========================
const config = {
  STRIPE_KEY: process.env.STRIPE_KEY,
  DOMAIN: process.env.DOMAIN || "http://localhost",
  STORE_NAME: process.env.STORE_NAME || "My Awesome Store",
  PAYPAL_ENV: process.env.PAYPAL_ENV || "sandbox",
  GB: process.env.SHIPPING_RATE_GB,
  EU: process.env.SHIPPING_RATE_EU,
  US: process.env.SHIPPING_RATE_US,
  AU: process.env.SHIPPING_RATE_AU,
  CA: process.env.SHIPPING_RATE_CA,
};

if (!config.STRIPE_KEY) {
  console.error("❌ STRIPE_KEY is missing in environment variables");
  process.exit(1);
}

// Initialize Stripe
const stripe = new Stripe(config.STRIPE_KEY);

// PayPal base URL
const PAYPAL_API_BASE =
  config.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

let paypalTokenCache = { token: null, expiresAt: 0 };

// ========================
// MIDDLEWARE
// ========================

// CORS config
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost",
  "http://127.0.0.1",
  "http://localhost:80",
  "http://127.0.0.1:80",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(null, true);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 3600,
  })
);

// Parse JSON for all routes **except webhook**
// JSON parser for all routes **except webhook**
app.use((req, res, next) => {
  if (req.originalUrl === "/api/stripe/webhook") return next();
  express.json()(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

app.use(cookieParser());

// ========================
// HELPER FUNCTIONS
// ========================

async function getPayPalAccessToken() {
  if (paypalTokenCache.token && Date.now() < paypalTokenCache.expiresAt - 60000)
    return paypalTokenCache.token;

  try {
    const auth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString("base64");

    const response = await axios.post(
      `${PAYPAL_API_BASE}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    paypalTokenCache = {
      token: response.data.access_token,
      expiresAt: Date.now() + response.data.expires_in * 1000,
    };

    return response.data.access_token;
  } catch (err) {
    console.error("PayPal token error:", err.response?.data || err.message);
    throw err;
  }
}

async function detectCountryFromIP(ip) {
  try {
    const res = await axios.get(`https://ipapi.co/${ip}/country_code/`, { timeout: 5000 });
    return res.data.trim();
  } catch (err) {
    console.warn("Could not detect country:", err.message);
    return "";
  }
}

function getClientIp(req) {
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (xForwardedFor) return xForwardedFor.split(",")[0].trim();
  return req.ip || req.connection.remoteAddress;
}

function getShippingOptionsForCountry(country, shippingRateIds) {
  const europeanCountries = [
    "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
    "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"
  ];

  let options = [];

  if (country === "GB") options = ["GB","EU","US","AU","CA"];
  else if (europeanCountries.includes(country)) options = ["EU","GB","US","AU","CA"];
  else if (country === "US") options = ["US","GB","EU","AU","CA"];
  else if (country === "AU") options = ["AU","GB","EU","US","CA"];
  else if (country === "CA") options = ["CA","GB","EU","US","AU"];
  else options = ["GB","EU","US","AU","CA"];

  return options.map((c) => ({ shipping_rate: shippingRateIds[c] }));
}

// ========================
// HEALTH
// ========================
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: { stripe: "active", paypal: config.PAYPAL_ENV },
  });
});

// ========================
// PAYPAL ENDPOINTS
// ========================
app.post("/api/paypal/create-order", async (req, res) => {
  try {
    const cartId = uuidv4();
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "Items array is required" });

    let paypalItems = [];
    let totalCents = 0;
    let currency = null;

    for (const item of items) {
      const { data: price } = await axios.get(
        `https://api.stripe.com/v1/prices/${item.priceId}`,
        { auth: { username: config.STRIPE_KEY, password: "" } }
      );

      if (!price.unit_amount || !price.currency) throw new Error("Invalid Stripe price");

      let title = "Product";
      if (price.product) {
        try {
          const { data: product } = await axios.get(
            `https://api.stripe.com/v1/products/${price.product}`,
            { auth: { username: config.STRIPE_KEY, password: "" } }
          );
          title = product.name || title;
        } catch {}
      }

      const itemCurrency = price.currency.toUpperCase();
      if (!currency) currency = itemCurrency;
      else if (currency !== itemCurrency)
        return res.status(400).json({ error: "Mixed currencies not allowed" });

      const qty = Number(item.quantity) || 1;
      totalCents += price.unit_amount * qty;

      paypalItems.push({
        name: title,
        unit_amount: { currency_code: currency, value: (price.unit_amount / 100).toFixed(2) },
        quantity: qty.toString(),
      });
    }

    const totalAmount = (totalCents / 100).toFixed(2);
    const accessToken = await getPayPalAccessToken();

    const paypalRes = await axios.post(
      `${PAYPAL_API_BASE}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: cartId,
            amount: { currency_code: currency, value: totalAmount, breakdown: { item_total: { currency_code: currency, value: totalAmount } } },
            items: paypalItems,
          },
        ],
        application_context: {
          return_url: `${config.DOMAIN}/success-pp.php`,
          cancel_url: `${config.DOMAIN}/cancel.php`,
          brand_name: config.STORE_NAME,
          user_action: "PAY_NOW",
        },
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );

    res.json(paypalRes.data);
  } catch (err) {
    console.error("PayPal create-order error:", err.message);
    res.status(500).json({ error: "Failed to create PayPal order", details: err.message });
  }
});

// ========================
// STRIPE ENDPOINTS
// ========================

// List products
app.get("/api/stripe/products", async (req, res) => {
  try {
    const prices = await stripe.prices.list({ expand: ["data.product"] });
    const products = prices.data
      .filter((p) => p.active && p.product.active)
      .map((p) => ({
        id: p.id,
        price: p.unit_amount / 100,
        currency: p.currency.toUpperCase(),
        description: p.product.description,
        imgFileName: p.product.metadata?.imgFileName || "",
        productName: p.product.name,
        productMetadata: p.product.metadata,
      }));
    res.json({ success: true, count: products.length, data: products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create Stripe session
app.post("/api/stripe/create-session", async (req, res) => {
  try {
    const cartId = uuidv4();
    const { items, email } = req.body;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "Items are required" });

    const line_items = items.map((item, index) => ({
      price: item.id,
      quantity: item.quantity,
    }));

    const shippingRateIds = { GB: config.GB, EU: config.EU, US: config.US, AU: config.AU, CA: config.CA };
    const ip = getClientIp(req);
    const detectedCountry = await detectCountryFromIP(ip);
    const shipping_options = getShippingOptionsForCountry(detectedCountry, shippingRateIds);

    const allowedCountries = ["GB","US","AU","CA","AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      success_url: `${config.DOMAIN}/success-s.php?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.DOMAIN}/cancel.php`,
      customer_email: email || null,
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: allowedCountries },
      shipping_options,
      billing_address_collection: "required",
      allow_promotion_codes: true,
      metadata: { cartId, detectedCountry: detectedCountry || "unknown" },
    });

    res.json({ success: true, sessionId: session.id, url: session.url });
  } catch (err) {
    console.error("Stripe create session error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================
// STRIPE WEBHOOK
// ========================
app.post(
  "/api/stripe/webhook",
  bodyParser.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) return res.status(500).send("Webhook secret not configured");

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      console.log("✅ Stripe webhook verified:", event.type);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        console.log("🛒 Checkout session completed:", session);
      }

      res.status(200).send({ received: true });
    } catch (err) {
      console.error("❌ Webhook verification failed:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// ========================
// ROOT & ERROR HANDLING
// ========================
app.get("/", (req, res) => {
  res.json({ message: "Stripe & PayPal API v2" });
});

app.use((req, res) => res.status(404).json({ error: "Endpoint not found" }));

app.use((err, req, res, next) => {
  console.error("Server Error:", err.stack);
  if (!res.headersSent)
    res.status(500).json({ error: "Internal server error", code: 500 });
});

// ========================
// START SERVER
// ========================
app.listen(port, "0.0.0.0", () => {
  console.log(`Express.js API running on port ${port}`);
  console.log(`Domain: ${config.DOMAIN}`);
  console.log(`Store: ${config.STORE_NAME}`);
  console.log(`✅ Success pages: ${config.DOMAIN}/success-s.php & ${config.DOMAIN}/success-pp.php`);
});

module.exports = app;

