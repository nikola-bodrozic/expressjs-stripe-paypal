const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Load configuration from environment variables
const config = {
  STRIPE_KEY: process.env.STRIPE_KEY || process.env.STRIPE_SRV_KEY,
  DOMAIN: process.env.DOMAIN || "http://localhost",
  STORE_NAME: process.env.STORE_NAME || "My Awesome Store",
  PAYPAL_ENV: process.env.PAYPAL_ENV || "sandbox",
  GB: process.env.SHIPPING_RATE_GB,
  EU: process.env.SHIPPING_RATE_EU,
  US: process.env.SHIPPING_RATE_US,
  AU: process.env.SHIPPING_RATE_AU,
  CA: process.env.SHIPPING_RATE_CA,
  API_BASE_URL: process.env.API_BASE_URL,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
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
const PAYPAL_API_BASE =
  config.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

let paypalTokenCache = {
  token: null,
  expiresAt: 0,
};
let tokenRefreshLock = null;

async function getPayPalAccessToken() {
  // Return cached token if valid
  if (
    paypalTokenCache.token &&
    Date.now() < paypalTokenCache.expiresAt - 60000
  ) {
    return paypalTokenCache.token;
  }

  // If a refresh is already in progress, wait for it
  if (tokenRefreshLock) {
    console.log("⏳ Another request is refreshing token, waiting...");
    return await tokenRefreshLock;
  }

  // Start a new refresh
  console.log("Starting PayPal token refresh");
  tokenRefreshLock = (async () => {
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

      // Update cache
      paypalTokenCache = {
        token: response.data.access_token,
        expiresAt: Date.now() + response.data.expires_in * 1000,
      };

      console.log(
        `✅ PayPal ${config.PAYPAL_ENV.toUpperCase()} token refreshed`,
      );

      return paypalTokenCache.token;
    } catch (error) {
      console.error(
        `PayPal ${config.PAYPAL_ENV.toUpperCase()} Access Token Error:`,
        error.response?.data || error.message,
      );

      // Clear cache on auth errors
      if (error.response?.status === 401 || error.response?.status === 403) {
        paypalTokenCache = { token: null, expiresAt: 0 };
      }

      throw new Error(
        `Failed to get PayPal ${config.PAYPAL_ENV} access token: ${error.response?.data?.error_description || error.message}`,
      );
    } finally {
      // Always clear the lock
      tokenRefreshLock = null;
    }
  })();

  return tokenRefreshLock;
}
console.log(config.DOMAIN);
// CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost",
  "http://127.0.0.1",
  config.DOMAIN
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

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors(corsOptions));

// Handle preflight requests
app.options("*", cors(corsOptions));

// ========================
// STRIPE WEBHOOK ENDPOINT
// ========================
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    console.log("ߔ Stripe Webhook Received!");

    const webhookSecret = config.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET not set. Cannot verify webhook!");
    }

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      // Try to construct the event from the payload and signature

      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      console.log("✅ Webhook signature verified successfully");

      // Log the full event
      console.log("ߓ Webhook Event Details:");
      console.log("- Event ID:", event.id || "N/A");
      console.log("- Event Type:", event.type || "N/A");
      console.log(
        "- Created:",
        event.created ? new Date(event.created * 1000).toISOString() : "N/A",
      );
      console.log("- Livemode:", event.livemode || false);

      // Handle specific event types
      if (event.type === "checkout.session.completed") {
        console.log("ߎ checkout.session.completed event received!");

        const session = event.data.object;
        console.log("Session Details:");
        console.log("- Session ID:", session.id);
        console.log("- Payment Status:", session.payment_status);
        console.log("- Customer Email:", session.customer_email);
        console.log(
          "- Amount Total:",
          session.amount_total
            ? `${session.currency?.toUpperCase()} ${(session.amount_total / 100).toFixed(2)}`
            : "N/A",
        );
        console.log("- Currency:", session.currency?.toUpperCase());
        console.log("- Metadata:", session.metadata);

        // Check if metadata exists
        if (session.metadata) {
          console.log("Metadata Details:");
          console.log(
            "  /api/stripe/webhook::checkout.session.completed - cartId:",
            session.metadata.cartId || "N/A",
          );
          console.log("  - priceIds:", session.metadata.priceIds || "N/A");
        }
        console.log("✅ checkout.session.completed processed");
      } else if (event.type === "payment_intent.succeeded") {
        console.log("ߒ payment_intent.succeeded event received");
        const paymentIntent = event.data.object;
        console.log("- Payment Intent ID:", paymentIntent.id);
        console.log(
          `/api/stripe/webhook::payment_intent.succeeded cart id: ${paymentIntent.metadata.cartId}`,
        );
        console.log(
          "- Amount:",
          paymentIntent.amount
            ? `${paymentIntent.currency.toUpperCase()} ${(paymentIntent.amount / 100).toFixed(2)}`
            : "N/A",
        );
        console.log("- Customer:", paymentIntent.customer || "N/A");
        console.log("- Metadata:", paymentIntent.metadata);
      } else if (event.type === "payment_intent.payment_failed") {
        console.log("❌ payment_intent.payment_failed event received");
        const paymentIntent = event.data.object;
        console.log("- Payment Intent ID:", paymentIntent.id);
        console.log(
          "- Last Payment Error:",
          paymentIntent.last_payment_error || "N/A",
        );
      } else {
        console.log(`ℹ️ Received unhandled event type: ${event.type}`);
      }
      // Return a response to acknowledge receipt of the event
      res.json({ received: true });
    } catch (err) {
      console.error("❌ Webhook processing error:", err.message);
      console.error(err.stack);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  },
);

app.use(express.json());

// ========================
// PAYPAL ENDPOINTS
// ========================
// Create PayPal order using Stripe prices
app.post("/api/paypal/create-order", async (req, res) => {
  try {
    const paypalItems = [];
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items array is required" });
    }

    let totalCents = 0;
    let currency = null;

    // Generate a cart ID for PayPal
    const paypalCartId = uuidv4();

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
          // eslint-disable-next-line no-unused-vars
        } catch (e) {
          // Keep default title
        }
      }

      // Check currency consistency
      const itemCurrency = price.currency.toUpperCase();
      if (!currency) {
        currency = itemCurrency;
      } else if (currency !== itemCurrency) {
        return res
          .status(400)
          .json({ error: "Mixed currencies are not allowed" });
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
            reference_id: paypalCartId,
            custom_id: paypalCartId,
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
          return_url: `${config.DOMAIN}/success-pp.php`,
          cancel_url: `${config.DOMAIN}/cancel.php`,
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

    console.log("/api/paypal/create-order ", JSON.stringify(paypalCartId));
    console.log(
      `PayPal ${config.PAYPAL_ENV} order created: ${paypalResponse.data.id}`,
    );

    res.json({
      ...paypalResponse.data,
      cartId: paypalCartId,
    });
  } catch (err) {
    console.error(
      `PayPal ${config.PAYPAL_ENV} create order error:`,
      err.response?.data || err.message,
    );
    res
      .status(500)
      .json({ error: "Failed to create PayPal order", details: err.message });
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
      },
    );
    console.log(
      "/api/paypal/capture-order/:orderId PayPal cart id: ",
      JSON.stringify(response.data.purchase_units[0]?.reference_id),
    );
    console.log(`PayPal ${config.PAYPAL_ENV} order captured: ${orderId}`);

    res.json({
      success: true,
      data: response.data,
    });
  } catch (err) {
    console.error(
      `PayPal ${config.PAYPAL_ENV} capture error:`,
      err.response?.data || err.message,
    );
    res.status(500).json({
      success: false,
      error: "Failed to capture PayPal order",
      details: err.response?.data || err.message,
    });
  }
});

// ========================
// STRIPE ENDPOINTS (RESTful)
// ========================
// GET all products with prices
app.get("/api/stripe/products", async (req, res) => {
  try {
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
        productId: price.product.id,
        productName: price.product.name,
        productDescription: price.product.description,
        productMetadata: price.product.metadata,
        billingScheme: price.billing_scheme,
        type: price.type,
        recurring: price.recurring,
      };
    });

    res.json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error("Stripe products error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch products",
      details: error.message,
    });
  }
});

// GET single product by price ID
app.get("/api/stripe/products/:priceId", async (req, res) => {
  try {
    const { priceId } = req.params;

    const price = await stripe.prices.retrieve(priceId, {
      expand: ["product"],
    });

    if (!price.active || !price.product.active) {
      return res.status(404).json({
        success: false,
        error: "Product not found or inactive",
      });
    }

    const product = {
      id: price.id,
      price: price.unit_amount / 100,
      currency: price.currency.toUpperCase(),
      description: price.product.description,
      imgFileName: price.product.metadata?.imgFileName || "",
      productId: price.product.id,
      productName: price.product.name,
      productDescription: price.product.description,
      productMetadata: price.product.metadata,
      billingScheme: price.billing_scheme,
      type: price.type,
      recurring: price.recurring,
    };

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Stripe product error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch product",
      details: error.message,
    });
  }
});

// Create Stripe checkout session
app.post("/api/stripe/create-session", async (req, res) => {
  try {
    const { items, email } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        error: "Invalid or missing items data",
      });
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

    // European countries for allowed shipping
    const europeanCountries = [
      "AT",
      "BE",
      "BG",
      "HR",
      "CY",
      "CZ",
      "DK",
      "EE",
      "FI",
      "FR",
      "DE",
      "GR",
      "HU",
      "IE",
      "IT",
      "LV",
      "LT",
      "LU",
      "MT",
      "NL",
      "PL",
      "PT",
      "RO",
      "SK",
      "SI",
      "ES",
      "SE",
    ];
    const allowedCountries = ["GB", "US", "AU", "CA", ...europeanCountries];

    // Generate cart ID for this session
    const sessionCartId = uuidv4();

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: line_items,
      mode: "payment",

      success_url: `${config.DOMAIN}/success-s.php?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.DOMAIN}/cancel.php`,

      customer_email: email || null,

      phone_number_collection: {
        enabled: true,
      },

      shipping_address_collection: {
        allowed_countries: allowedCountries,
      },

      shipping_options: Object.values(shippingRateIds)
        .filter(Boolean) // remove undefined
        .map((id) => ({ shipping_rate: id })),

      billing_address_collection: "required",
      allow_promotion_codes: true,

      // ✅ THIS IS FOR checkout.session.completed webhook
      metadata: {
        cartId: sessionCartId,
        priceIds: priceIds.join(","),
      },

      // ✅ THIS IS FOR payment_intent.* webhooks (IMPORTANT)
      payment_intent_data: {
        metadata: {
          cartId: sessionCartId,
        },
      },
    });

    console.log(`Stripe session created: ${session.id}`);
    console.log(
      ` /api/stripe/create-session  Cart ${sessionCartId} created and added to metadata`,
    );

    res.json({
      success: true,
      sessionId: session.id,
      cartId: sessionCartId,
      url: session.url,
      expiresAt: session.expires_at,
      paymentStatus: session.payment_status,
      metadata: session.metadata,
    });
  } catch (error) {
    console.error("Stripe create session error:", error.message);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message,
      code: statusCode,
    });
  }
});

// Get Stripe session by ID
app.get("/api/stripe/sessions/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items.data.price.product", "payment_intent"],
    });
    console.log(
      `cart id in /api/stripe/sessions/:sessionId ${session.metadata.cartId}`,
    );
    res.json({
      success: true,
      data: {
        id: session.id,
        paymentStatus: session.payment_status,
        status: session.status,
        customerEmail: session.customer_email,
        customerDetails: session.customer_details,
        amountTotal: session.amount_total,
        amountSubtotal: session.amount_subtotal,
        shippingCost: session.shipping_cost,
        currency: session.currency,
        expiresAt: session.expires_at,
        metadata: session.metadata,
        lineItems: session.line_items,
        shippingAddress: session.shipping_details?.address,
        billingAddress: session.customer_details?.address,
        paymentIntent: session.payment_intent,
      },
    });
  } catch (error) {
    console.error("Stripe session error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch session",
      details: error.message,
    });
  }
});

// Verify Stripe payment status
app.post("/api/stripe/verify-payment", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "Session ID is required",
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    const isPaid = session.payment_status === "paid";
    const isCompleted = session.status === "complete";

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        paymentStatus: session.payment_status,
        status: session.status,
        isPaid: isPaid,
        isCompleted: isCompleted,
        amountTotal: session.amount_total,
        currency: session.currency,
        customerEmail: session.customer_email,
        paymentIntentId: session.payment_intent?.id,
        paymentIntentStatus: session.payment_intent?.status,
        metadata: session.metadata,
      },
    });
  } catch (error) {
    console.error("Stripe verify payment error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to verify payment",
      details: error.message,
    });
  }
});

// ========================
// ROOT & ERROR HANDLING
// ========================
app.get("/", (req, res) => {
  res.json({
    message: "Stripe & PayPal Integration API",
    version: "2.0",
    webhook: config.STRIPE_WEBHOOK_SECRET ? "active" : "not configured",
    endpoints: {
      stripe: {
        products: "GET /api/stripe/products",
        product: "GET /api/stripe/products/:priceId",
        createSession: "POST /api/stripe/create-session",
        getSession: "GET /api/stripe/sessions/:sessionId",
        verifyPayment: "POST /api/stripe/verify-payment",
        webhook: "POST /api/stripe/webhook",
      },
      paypal: {
        createOrder: "POST /api/paypal/create-order",
        captureOrder: "POST /api/paypal/capture-order/:orderId",
      },
      health: "GET /api/health",
    },
  });
});

// ========================
// HEALTH & INFO ENDPOINTS
// ========================
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
  });
});

// Error handling middleware
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Server Error:", err.stack);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    code: 500,
  });
});

// Start server
app.listen(port, "0.0.0.0", () => {
  console.log(`Express.js API is running on port ${port}`);
  console.log(`Express.js API is at: ${config.API_BASE_URL}:${port}`);
  console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
  console.log(`Domain for PHP/HTML files: ${config.DOMAIN}`);
  console.log(`Store: ${config.STORE_NAME}`);
  console.log(
    `✅ Success pages: ${config.DOMAIN}/success-s.php (Stripe) & ${config.DOMAIN}/success-pp.php (PayPal)`,
  );
  console.log(
    `ߔ Stripe Webhook Endpoint: ${config.API_BASE_URL}/api/stripe/webhook`,
  );
});

module.exports = app;
