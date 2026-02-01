// index.js - Stripe + PayPal + Express API
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();
const bodyParser = require("body-parser");

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
  console.error("❌ STRIPE_KEY is not set in environment variables");
  process.exit(1);
}
console.log("✅ Stripe initialized successfully");

const stripe = new Stripe(config.STRIPE_KEY);

// PayPal
const PAYPAL_API_BASE = config.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

let paypalTokenCache = { token: null, expiresAt: 0 };

// ========================
// HELPERS
// ========================
async function getPayPalAccessToken() {
  if (paypalTokenCache.token && Date.now() < paypalTokenCache.expiresAt - 60000) {
    return paypalTokenCache.token;
  }

  try {
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
    const response = await axios.post(
      `${PAYPAL_API_BASE}/v1/oauth2/token`,
      "grant_type=client_credentials",
      { headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" } }
    );

    paypalTokenCache = {
      token: response.data.access_token,
      expiresAt: Date.now() + response.data.expires_in * 1000,
    };
    console.log(`PayPal ${config.PAYPAL_ENV.toUpperCase()} token cached`);
    return response.data.access_token;
  } catch (error) {
    console.error("PayPal token error:", error.response?.data || error.message);
    throw new Error(error.response?.data?.error_description || error.message);
  }
}

async function detectCountryFromIP(ip) {
  try {
    const response = await axios.get(`https://ipapi.co/${ip}/country_code/`, { timeout: 5000 });
    return response.data.trim();
  } catch (error) {
    console.warn("IP detection failed:", error.message);
    return "";
  }
}

function getClientIp(req) {
  const xForwardedFor = req.headers["x-forwarded-for"];
  return xForwardedFor ? xForwardedFor.split(",")[0].trim() : req.ip || req.connection.remoteAddress;
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

  return options.map(c => ({ shipping_rate: shippingRateIds[c] }));
}

// ========================
// MIDDLEWARE
// ========================
const allowedOrigins = ["http://localhost:5173","http://localhost","http://127.0.0.1","http://localhost:80","http://127.0.0.1:80"];
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.options("*", cors());

// ========================
// HEALTH
// ========================
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: { stripe: "active", paypal: config.PAYPAL_ENV, environment: process.env.NODE_ENV || "development" }
  });
});

// ========================
// PAYPAL ENDPOINTS
// ========================
app.post("/api/paypal/create-order", async (req, res) => {
  const cartId = uuidv4();
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Items array is required" });

    let paypalItems = [], totalCents = 0, currency = null;

    for (const item of items) {
      const { data: price } = await axios.get(`https://api.stripe.com/v1/prices/${item.priceId}`, { auth: { username: config.STRIPE_KEY, password: "" } });

      if (!price.unit_amount || !price.currency) return res.status(400).json({ error: "Invalid Stripe price" });

      let title = "Product";
      if (price.product) {
        try { const { data: product } = await axios.get(`https://api.stripe.com/v1/products/${price.product}`, { auth: { username: config.STRIPE_KEY, password: "" } }); title = product.name || "Product"; } catch {}
      }

      if (!currency) currency = price.currency.toUpperCase();
      else if (currency !== price.currency.toUpperCase()) return res.status(400).json({ error: "Mixed currencies are not allowed" });

      const qty = Number(item.quantity) || 1;
      totalCents += price.unit_amount * qty;

      paypalItems.push({ name: title, unit_amount: { currency_code: currency, value: (price.unit_amount / 100).toFixed(2) }, quantity: qty.toString() });
    }

    const totalAmount = (totalCents / 100).toFixed(2);
    const accessToken = await getPayPalAccessToken();

    const paypalResponse = await axios.post(
      `${PAYPAL_API_BASE}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [{ reference_id: cartId, custom_id: cartId, amount: { currency_code: currency, value: totalAmount, breakdown: { item_total: { currency_code: currency, value: totalAmount } } }, items: paypalItems }],
        application_context: { return_url: `${config.DOMAIN}/success-pp.php`, cancel_url: `${config.DOMAIN}/cancel.php`, brand_name: config.STORE_NAME, user_action: "PAY_NOW" },
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );

    console.log(`PayPal order created: ${paypalResponse.data.id}`);
    return res.json(paypalResponse.data);
  } catch (err) {
    console.error("PayPal create order error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to create PayPal order", details: err.message });
  }
});

app.post("/api/paypal/capture-order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const accessToken = await getPayPalAccessToken();
    const response = await axios.post(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {}, { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } });

    console.log(`PayPal order captured: ${orderId}`);
    return res.json({ success: true, data: response.data });
  } catch (err) {
    console.error("PayPal capture error:", err.response?.data || err.message);
    return res.status(500).json({ success: false, error: "Failed to capture order", details: err.response?.data || err.message });
  }
});

// ========================
// STRIPE ENDPOINTS
// ========================
app.get("/api/stripe/products", async (req, res) => {
  try {
    const prices = await stripe.prices.list({ expand: ["data.product"] });
    const products = prices.data.filter(p => p.active && p.product.active).map(price => ({
      id: price.id, price: price.unit_amount / 100, currency: price.currency.toUpperCase(),
      description: price.product.description, imgFileName: price.product.metadata?.imgFileName || "",
      productId: price.product.id, productName: price.product.name,
      billingScheme: price.billing_scheme, type: price.type, recurring: price.recurring
    }));
    return res.json({ success: true, count: products.length, data: products });
  } catch (err) {
    console.error("Stripe products error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch products", details: err.message });
  }
});

app.get("/api/stripe/products/:priceId", async (req, res) => {
  try {
    const { priceId } = req.params;
    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    if (!price.active || !price.product.active) return res.status(404).json({ success: false, error: "Product not found or inactive" });

    const product = { id: price.id, price: price.unit_amount / 100, currency: price.currency.toUpperCase(), description: price.product.description, imgFileName: price.product.metadata?.imgFileName || "", productId: price.product.id, productName: price.product.name, billingScheme: price.billing_scheme, type: price.type, recurring: price.recurring };
    return res.json({ success: true, data: product });
  } catch (err) {
    console.error("Stripe product error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch product", details: err.message });
  }
});

app.post("/api/stripe/create-session", async (req, res) => {
  const cartId = uuidv4();
  try {
    const { items, email } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ success: false, error: "Invalid or missing items data" });

    const priceIds = [];
    const line_items = items.map((item, index) => {
      if (!item.id || !item.quantity) throw new Error(`Item ${index} must have id and quantity`);
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error(`Item ${index} quantity must be integer > 0`);
      if (!/^price_[a-zA-Z0-9]{24}$/.test(item.id)) throw new Error(`Item ${index} invalid Stripe price ID`);
      priceIds.push(item.id);
      return { price: item.id, quantity: item.quantity };
    });

    const shippingRateIds = { GB: config.GB, EU: config.EU, US: config.US, AU: config.AU, CA: config.CA };
    const ip = getClientIp(req);
    const detectedCountry = await detectCountryFromIP(ip);
    const shipping_options = getShippingOptionsForCountry(detectedCountry, shippingRateIds);

    const europeanCountries = ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"];
    const allowedCountries = ["GB","US","AU","CA", ...europeanCountries];

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
      metadata: { cartId, priceIds: priceIds.join(","), detectedCountry: detectedCountry || "unknown" },
      payment_intent_data: { metadata: { cartId } }
    });

    console.log(`Stripe session created: ${session.id}`);
    return res.json({ success: true, sessionId: session.id, url: session.url, expiresAt: session.expires_at, paymentStatus: session.payment_status, metadata: session.metadata });
  } catch (err) {
    console.error("Stripe create session error:", err.message);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.statusCode || 500 });
  }
});

app.get("/api/stripe/sessions/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items.data.price.product", "payment_intent"] });
    return res.json({ success: true, data: { id: session.id, paymentStatus: session.payment_status, status: session.status, customerEmail: session.customer_email, customerDetails: session.customer_details, amountTotal: session.amount_total, amountSubtotal: session.amount_subtotal, shippingCost: session.shipping_cost, currency: session.currency, expiresAt: session.expires_at, metadata: session.metadata, lineItems: session.line_items, shippingAddress: session.shipping_details?.address, billingAddress: session.customer_details?.address, paymentIntent: session.payment_intent } });
  } catch (err) {
    console.error("Stripe session error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch session", details: err.message });
  }
});

app.post("/api/stripe/verify-payment", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "Session ID is required" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    return res.json({ success: true, data: { sessionId: session.id, paymentStatus: session.payment_status, status: session.status, isPaid: session.payment_status === "paid", isCompleted: session.status === "complete", amountTotal: session.amount_total, currency: session.currency, customerEmail: session.customer_email, paymentIntentId: session.payment_intent?.id, paymentIntentStatus: session.payment_intent?.status, metadata: session.metadata } });
  } catch (err) {
    console.error("Stripe verify payment error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to verify payment", details: err.message });
  }
});

// ========================
// ROOT
// ========================
app.get("/", (req, res) => {
  return res.json({
    message: "Stripe & PayPal Integration API",
    version: "2.0",
    endpoints: {
      stripe: { products: "GET /api/stripe/products", product: "GET /api/stripe/products/:priceId", createSession: "POST /api/stripe/create-session", getSession: "GET /api/stripe/sessions/:sessionId", verifyPayment: "POST /api/stripe/verify-payment" },
      paypal: { createOrder: "POST /api/paypal/create-order", captureOrder: "POST /api/paypal/capture-order/:orderId" },
      health: "GET /api/health"
    }
  });
});

// ========================
// STRIPE WEBHOOK
// ========================
app.post("/api/stripe/webhook", bodyParser.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("❌ STRIPE_WEBHOOK_SECRET is not set!");
    res.status(500).send("Webhook secret not configured");
    return;
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log("✅ Stripe webhook verified:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log("🛒 Checkout session completed:", session);
      console.log(`CartID: ${session.metadata?.cartId}, Email: ${session.customer_email}, Amount: ${session.amount_total/100} ${session.currency.toUpperCase()}`);
      // TODO: Update your DB here
    }

    return res.status(200).send({ received: true });
  } catch (err) {
    console.error("❌ Webhook verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// ========================
// 404
// ========================
app.use((req, res) => res.status(404).json({ success: false, error: "Endpoint not found" }));

// ========================
// GLOBAL ERROR HANDLER
// ========================
app.use((err, req, res, next) => {
  console.error("Server Error:", err.stack);
  if (res.headersSent) return next(err);
  return res.status(500).json({ success: false, error: "Internal server error", code: 500 });
});

// ========================
// START SERVER
// ========================
app.listen(port, "0.0.0.0", () => {
  console.log(`Express.js API running on port ${port}`);
  console.log(`Domain for PHP/HTML files: ${config.DOMAIN}`);
  console.log(`Store: ${config.STORE_NAME}`);
  console.log(`✅ Success pages: ${config.DOMAIN}/success-s.php (Stripe) & ${config.DOMAIN}/success-pp.php (PayPal)`);
});

