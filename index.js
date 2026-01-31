// stripe.js - Combined Stripe + PayPal
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const axios = require("axios");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Load configuration from environment variables
const config = {
  STRIPE_KEY: process.env.STRIPE_KEY || process.env.STRIPE_SRV_KEY,
  DOMAIN: process.env.DOMAIN || "http://localhost",
  FRONT_END_HOST: process.env.FRONT_END_HOST || "http://localhost",
  STORE_NAME: process.env.STORE_NAME || "My Awesome Store",
  PAYPAL_ENV: process.env.PAYPAL_ENV || "sandbox",
  // Shipping rates
  GB: process.env.SHIPPING_RATE_GB || "shr_1SL9GtD0voGcD5ZoF86nlgoA",
  EU: process.env.SHIPPING_RATE_EU || "shr_1SL9GtD0voGcD5Zo9m5VjFIO",
  US: process.env.SHIPPING_RATE_US || "shr_1SL9GuD0voGcD5ZoN43oVk4O",
  AU: process.env.SHIPPING_RATE_AU || "shr_1SL9GuD0voGcD5ZoSpN7c4lH",
  CA: process.env.SHIPPING_RATE_CA || "shr_1SL9GuD0voGcD5ZoKesfCSiB",
};

// Validate Stripe key
if (!config.STRIPE_KEY) {
  console.error("❌ ERROR: STRIPE_KEY is not set in environment variables");
  process.exit(1);
}

console.log("✅ Stripe initialized successfully");

// Initialize Stripe
const stripe = new Stripe(config.STRIPE_KEY);

// PayPal configuration
const PAYPAL_API_BASE = config.PAYPAL_ENV === "live" 
  ? "https://api-m.paypal.com" 
  : "https://api-m.sandbox.paypal.com";

let paypalTokenCache = {
  token: null,
  expiresAt: 0,
};

// Get PayPal access token with caching
async function getPayPalAccessToken() {
  if (
    paypalTokenCache.token &&
    Date.now() < paypalTokenCache.expiresAt - 60000
  ) {
    return paypalTokenCache.token;
  }

  try {
    const auth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
    ).toString("base64");

    const response = await axios.post(
      `${PAYPAL_API_BASE}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000,
      },
    );

    // Cache the token
    paypalTokenCache = {
      token: response.data.access_token,
      expiresAt: Date.now() + response.data.expires_in * 1000,
    };

    console.log(`PayPal ${config.PAYPAL_ENV.toUpperCase()} token obtained and cached`);
    return response.data.access_token;
  } catch (error) {
    console.error(
      `PayPal ${config.PAYPAL_ENV.toUpperCase()} Access Token Error:`,
      error.response?.data || error.message,
    );
    throw new Error(
      `Failed to get PayPal ${config.PAYPAL_ENV} access token: ${error.response?.data?.error_description || error.message}`,
    );
  }
}

// CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost",
  "http://127.0.0.1",
  "http://localhost:80",
  "http://127.0.0.1:80",
  config.FRONT_END_HOST,
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log("⚠️ CORS blocked origin:", origin);
      callback(null, true); // Allow for development
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 3600,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Handle preflight requests
app.options("*", cors(corsOptions));

app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    services: {
      stripe: "active",
      paypal: config.PAYPAL_ENV,
      environment: process.env.NODE_ENV || "development"
    }
  });
});

// ========================
// PAYPAL ENDPOINTS
// ========================
// Create PayPal order using Stripe prices
app.post("/api/paypal/create-order", async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items array is required" });
    }

    let paypalItems = [];
    let totalCents = 0;
    let currency = null;

    // Loop through Stripe prices
    for (const item of items) {
      // Get price data
      const { data: price } = await axios.get(
        `https://api.stripe.com/v1/prices/${item.priceId}`,
        { auth: { username: config.STRIPE_KEY, password: "" } },
      );

      // Validate
      if (!price.unit_amount || !price.currency) {
        return res.status(400).json({ error: "Invalid Stripe price" });
      }

      // Get title from product
      let title = "Product";
      if (price.product) {
        try {
          const { data: product } = await axios.get(
            `https://api.stripe.com/v1/products/${price.product}`,
            { auth: { username: config.STRIPE_KEY, password: "" } },
          );
          title = product.name || "Product";
        } catch (e) {
          // Keep default title
        }
      }

      // Check currency consistency
      const itemCurrency = price.currency.toUpperCase();
      if (!currency) currency = itemCurrency;
      else if (currency !== itemCurrency) {
        return res.status(400).json({ error: "Mixed currencies are not allowed" });
      }

      // Add to totals and items
      const qty = Number(item.quantity) || 1;
      totalCents += price.unit_amount * qty;

      paypalItems.push({
        name: title,
        unit_amount: {
          currency_code: currency,
          value: (price.unit_amount / 100).toFixed(2),
        },
        quantity: qty.toString(),
      });
    }

    const totalAmount = (totalCents / 100).toFixed(2);
    const accessToken = await getPayPalAccessToken();
    
    const paypalResponse = await axios.post(
      `${PAYPAL_API_BASE}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "cart-" + Date.now(),
            amount: {
              currency_code: currency,
              value: totalAmount,
              breakdown: {
                item_total: {
                  currency_code: currency,
                  value: totalAmount,
                },
              },
            },
            items: paypalItems,
          },
        ],
        application_context: {
          return_url: `${config.FRONT_END_HOST}/success.php`,
          cancel_url: `${config.FRONT_END_HOST}/cancel.php`,
          brand_name: config.STORE_NAME,
          user_action: "PAY_NOW",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log(`PayPal ${config.PAYPAL_ENV} order created: ${paypalResponse.data.id}`);
    res.json(paypalResponse.data);
  } catch (err) {
    console.error(`PayPal ${config.PAYPAL_ENV} create order error:`, err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create PayPal order", details: err.message });
  }
});

// Capture PayPal order
app.post("/api/paypal/capture-order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const accessToken = await getPayPalAccessToken();
    
    const response = await axios.post(
      `${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`PayPal ${config.PAYPAL_ENV} order captured: ${orderId}`);
    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    console.error(`PayPal ${config.PAYPAL_ENV} capture error:`, err.response?.data || err.message);
    res.status(500).json({ 
      success: false,
      error: "Failed to capture PayPal order",
      details: err.response?.data || err.message 
    });
  }
});

// ========================
// STRIPE ENDPOINTS
// ========================
// GET endpoint: Get all products
app.get("/api", async (req, res) => {
  try {
    if (req.query.action === "get_all_products") {
      const prices = await stripe.prices.list({
        expand: ["data.product"],
      });

      const activePrices = prices.data.filter(
        (price) => price.active && price.product.active,
      );

      const products = activePrices.map((price) => {
        const imgFileName = price.product.metadata?.imgFileName || "";

        return {
          id: price.id,
          price: price.unit_amount / 100,
          currency: price.currency.toUpperCase(),
          description: price.product.description,
          imgFileName: imgFileName,
        };
      });
      res.json(products);
    } else if (req.query.action === "get_session" && req.query.session_id) {
      const session = await stripe.checkout.sessions.retrieve(
        req.query.session_id,
        {
          expand: ["line_items.data.price.product", "payment_intent"],
        },
      );
      res.json(session);
    } else {
      res.status(400).json({ error: "Invalid action" });
    }
  } catch (error) {
    console.error("GET Error:", error.message);
    res.status(400).json({ error: error.message });
  }
});

// Helper function to detect country from IP
async function detectCountryFromIP(ip) {
  try {
    const response = await axios.get(`https://ipapi.co/${ip}/country_code/`, {
      timeout: 5000,
    });
    return response.data.trim();
  } catch (error) {
    console.error("Error detecting country:", error.message);
    return "";
  }
}

// POST endpoint: Create Stripe checkout session
app.post("/api", async (req, res) => {
  try {
    const { items, email } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid or missing items data" });
    }

    // Validate items
    const priceIds = [];
    const line_items = items.map((item, index) => {
      if (!item.id || !item.quantity) {
        throw new Error(`Item at index ${index} must have an id and quantity`);
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new Error(
          `Item at index ${index}: quantity must be an integer greater than 0`,
        );
      }
      if (!/^price_[a-zA-Z0-9]{24}$/.test(item.id)) {
        throw new Error(
          `Item at index ${index}: invalid Stripe price ID format`,
        );
      }
      priceIds.push(item.id);
      return {
        price: item.id,
        quantity: item.quantity,
      };
    });

    // Shipping rate IDs
    const shippingRateIds = {
      GB: config.GB,
      EU: config.EU,
      US: config.US,
      AU: config.AU,
      CA: config.CA,
    };

    // Get client IP
    const getClientIp = (req) => {
      const xForwardedFor = req.headers["x-forwarded-for"];
      if (xForwardedFor) {
        return xForwardedFor.split(",")[0].trim();
      }
      return req.ip || req.connection.remoteAddress;
    };

    const ip = getClientIp(req);
    let detectedCountry = "";
    try {
      detectedCountry = await detectCountryFromIP(ip);
    } catch (error) {
      console.warn("Could not detect country:", error.message);
    }

    // European countries
    const europeanCountries = [
      "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
      "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"
    ];

    // Sort shipping options according to country
    let sortedShippingOptions = [];
    if (detectedCountry === "GB") {
      sortedShippingOptions = [
        { shipping_rate: shippingRateIds["GB"] },
        { shipping_rate: shippingRateIds["EU"] },
        { shipping_rate: shippingRateIds["US"] },
        { shipping_rate: shippingRateIds["AU"] },
        { shipping_rate: shippingRateIds["CA"] },
      ];
    } else if (europeanCountries.includes(detectedCountry)) {
      sortedShippingOptions = [
        { shipping_rate: shippingRateIds["EU"] },
        { shipping_rate: shippingRateIds["GB"] },
        { shipping_rate: shippingRateIds["US"] },
        { shipping_rate: shippingRateIds["AU"] },
        { shipping_rate: shippingRateIds["CA"] },
      ];
    } else if (detectedCountry === "US") {
      sortedShippingOptions = [
        { shipping_rate: shippingRateIds["US"] },
        { shipping_rate: shippingRateIds["GB"] },
        { shipping_rate: shippingRateIds["EU"] },
        { shipping_rate: shippingRateIds["AU"] },
        { shipping_rate: shippingRateIds["CA"] },
      ];
    } else if (detectedCountry === "AU") {
      sortedShippingOptions = [
        { shipping_rate: shippingRateIds["AU"] },
        { shipping_rate: shippingRateIds["GB"] },
        { shipping_rate: shippingRateIds["EU"] },
        { shipping_rate: shippingRateIds["US"] },
        { shipping_rate: shippingRateIds["CA"] },
      ];
    } else if (detectedCountry === "CA") {
      sortedShippingOptions = [
        { shipping_rate: shippingRateIds["CA"] },
        { shipping_rate: shippingRateIds["GB"] },
        { shipping_rate: shippingRateIds["EU"] },
        { shipping_rate: shippingRateIds["US"] },
        { shipping_rate: shippingRateIds["AU"] },
      ];
    } else {
      sortedShippingOptions = [
        { shipping_rate: shippingRateIds["GB"] },
        { shipping_rate: shippingRateIds["EU"] },
        { shipping_rate: shippingRateIds["US"] },
        { shipping_rate: shippingRateIds["AU"] },
        { shipping_rate: shippingRateIds["CA"] },
      ];
    }

    const allowedCountries = ["GB", "US", "AU", "CA", ...europeanCountries];

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "paypal"],
      line_items: line_items,
      mode: "payment",
      success_url: `${config.DOMAIN}/success.php?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.DOMAIN}/cancel.php`,
      customer_email: email || null,
      phone_number_collection: {
        enabled: true,
      },
      shipping_address_collection: {
        allowed_countries: allowedCountries,
      },
      shipping_options: sortedShippingOptions,
      billing_address_collection: "required",
      allow_promotion_codes: true,
      metadata: {
        priceIds: priceIds.join(","),
      },
    });

    console.log(`Stripe session created: ${session.id}`);
    res.json({ url: session.url });
  } catch (error) {
    console.error("POST Error:", error.message);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: error.message,
      status: "error",
      code: statusCode,
    });
  }
});

// ========================
// ROOT & ERROR HANDLING
// ========================
app.get("/", (req, res) => {
  res.json({
    message: "Stripe & PayPal Integration API",
    endpoints: {
      stripe: {
        products: "GET /api?action=get_all_products",
        createSession: "POST /api",
        getSession: "GET /api?action=get_session&session_id=:id"
      },
      paypal: {
        createOrder: "POST /api/paypal/create-order",
        captureOrder: "POST /api/paypal/capture-order/:orderId"
      },
      health: "GET /api/health",
      test: "GET /live"
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server Error:", err.stack);
  res.status(500).json({
    error: "Internal server error",
    status: "error",
    code: 500,
  });
});

// Start server
app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Express.js API is running on port ${port}`);
  console.log(`🌐 Express.js API is at: ${config.DOMAIN}:${port}`);
  console.log(`🎯 CORS allowed origins: ${allowedOrigins.join(", ")}`);
  console.log(`🏠 Domain for PHP files: ${config.DOMAIN}`);
  console.log(`🏪 Store: ${config.STORE_NAME}`);
});

module.exports = app;