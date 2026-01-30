const express = require("express");
const axios = require("axios");
const app = express();
const cookieParser = require("cookie-parser");
const cors = require("cors");

app.use(cors({ origin: ["http://localhost:5173","http://localhost"] }));
app.use(express.json()); // Middleware to parse JSON data
app.use(express.urlencoded({ extended: true })); // Middleware to parse URL-encoded data
app.use(cookieParser()); // Middleware to parse cookies
require("dotenv").config();

const PORT = process.env.PORT;
const STRIPE_SRV_KEY = process.env.STRIPE_SRV_KEY;
const PAYPAL_ENV = process.env.PAYPAL_ENV || "sandbox"; // sandbox or live
const STORE_NAME = process.env.STORE_NAME || "Test Store";
const FRONT_END_HOST = process.env.FRONT_END_HOST;
// Validate required environment variables
if (!STRIPE_SRV_KEY) {
  console.error("STRIPE_SRV_KEY is not set in environment variables");
  process.exit(1);
}

// Set PayPal API URL based on environment
const PAYPAL_API_BASE = PAYPAL_ENV === "live" 
  ? "https://api-m.paypal.com" 
  : "https://api-m.sandbox.paypal.com";

console.log(`PayPal environment: ${PAYPAL_ENV.toUpperCase()}`);
console.log(`PayPal API URL: ${PAYPAL_API_BASE}`);

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

    console.log(`PayPal ${PAYPAL_ENV.toUpperCase()} token obtained and cached`);
    return response.data.access_token;
  } catch (error) {
    console.error(
      `PayPal ${PAYPAL_ENV.toUpperCase()} Access Token Error:`,
      error.response?.data || error.message,
    );
    throw new Error(
      `Failed to get PayPal ${PAYPAL_ENV} access token: ${error.response?.data?.error_description || error.message}`,
    );
  }
}

// Create PayPal order using Stripe prices
app.post("/api/paypal/create-order", async (req, res) => {
  try {
    // {
    //   "items": [
    //     {"priceId": "price_1QsBjhD0voGcD5Zof94i6IkP","quantity": 2},
    //     {"priceId": "price_1RJRLDD0voGcD5ZoTFQdTZUQ", "quantity": 1}
    //   ]
    // }
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items array is required" });
    }

    let paypalItems = [];
    let totalCents = 0;
    let currency = null;

    // Loop through Stripe prices (axios, sequential)
    for (const item of items) {
      // Get price data
      const { data: price } = await axios.get(
        `https://api.stripe.com/v1/prices/${item.priceId}`,
        { auth: { username: process.env.STRIPE_SRV_KEY, password: "" } },
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
            { auth: { username: process.env.STRIPE_SRV_KEY, password: "" } },
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
        return res
          .status(400)
          .json({ error: "Mixed currencies are not allowed" });
      }

      // Add to totals and items
      const qty = Number(item.quantity) || 1;
      totalCents += price.unit_amount * qty;

      paypalItems.push({
        name: title, // Title
        unit_amount: {
          currency_code: currency, // Currency (GBP, EUR, USD)
          value: (price.unit_amount / 100).toFixed(2), // Price in decimal
        },
        quantity: qty.toString(),
      });
    }

    const totalAmount = (totalCents / 100).toFixed(2);

    const accessToken = await getPayPalAccessToken();
    console.log("PayPal items:", paypalItems);
    
    const paypalResponse = await axios.post(
      `${PAYPAL_API_BASE}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "cart-001",
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
          return_url: `${FRONT_END_HOST}/success.php`,
          cancel_url: `${FRONT_END_HOST}/cancel.php`,
          brand_name: STORE_NAME,
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

    console.log(`PayPal ${PAYPAL_ENV} order created: ${paypalResponse.data.id}`);
    res.json(paypalResponse.data);
  } catch (err) {
    console.error(`PayPal ${PAYPAL_ENV} create order error:`, err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create PayPal order" });
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

    console.log(`PayPal ${PAYPAL_ENV} order captured: ${orderId}`);
    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    console.error(`PayPal ${PAYPAL_ENV} capture error:`, err.response?.data || err.message);
    res.status(500).json({ 
      success: false,
      error: "Failed to capture PayPal order",
      details: err.response?.data || err.message 
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
    res.json({ 
        status: "ok", 
        timestamp: new Date().toISOString(),
        service: "PayPal-Stripe Integration API",
        environment: {
          paypal: PAYPAL_ENV,
          node: process.env.NODE_ENV || "development"
        }
    });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "PayPal-Stripe Integration API",
    environment: PAYPAL_ENV.toUpperCase(),
    store: STORE_NAME,
    endpoints: {
      createOrder: "POST /api/paypal/create-order",
      captureOrder: "POST /api/paypal/capture-order/:orderId",
      health: "GET /api/health"
    }
  });
});

// Start the server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server Started on port ${PORT}`);
  });
}

module.exports = app;