// index.js - Combined Stripe + PayPal (with Webhook and Reconciliation)
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

// In-memory storage for cart reconciliation
// In production, you'd want to use a database
const cartReconciliation = [];

// Track cart creation and webhook confirmation
function trackCartCreation(cartId, source, metadata = {}) {
  const entry = {
    cartId,
    source, // 'stripe-checkout', 'paypal-checkout', etc.
    status: 'created',
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    metadata,
    events: []
  };
  
  cartReconciliation.push(entry);
  console.log(`📦 Cart ${cartId} created from ${source} at ${entry.createdAt}`);
  
  // Keep only last 1000 entries to prevent memory issues
  if (cartReconciliation.length > 1000) {
    cartReconciliation.shift();
  }
  
  return entry;
}

function trackCartConfirmation(cartId, eventType, eventData = {}) {
  const entry = cartReconciliation.find(cart => cart.cartId === cartId);
  
  if (entry) {
    entry.status = 'confirmed';
    entry.confirmedAt = new Date().toISOString();
    entry.confirmedBy = eventType;
    entry.confirmationData = eventData;
    
    // Track all events for this cart
    entry.events.push({
      type: eventType,
      timestamp: new Date().toISOString(),
      data: eventData
    });
    
    console.log(`✅ Cart ${cartId} confirmed by ${eventType} at ${entry.confirmedAt}`);
    console.log(`   Time between creation and confirmation: ${timeDifference(entry.createdAt, entry.confirmedAt)}`);
  } else {
    console.log(`⚠️ Cart ${cartId} confirmed but not found in reconciliation tracking`);
    
    // Create a new entry for this cart
    const newEntry = {
      cartId,
      source: 'unknown',
      status: 'confirmed',
      createdAt: new Date(eventData.created * 1000).toISOString() || new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      confirmedBy: eventType,
      metadata: eventData.metadata || {},
      confirmationData: eventData,
      events: [{
        type: eventType,
        timestamp: new Date().toISOString(),
        data: eventData
      }]
    };
    
    cartReconciliation.push(newEntry);
  }
}

// Helper function to calculate time difference
function timeDifference(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate - startDate;
  
  if (diffMs < 1000) return `${diffMs}ms`;
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(2)}s`;
  if (diffMs < 3600000) return `${(diffMs / 60000).toFixed(2)}min`;
  return `${(diffMs / 3600000).toFixed(2)}h`;
}

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

// IMPORTANT: Express.json() must be configured BEFORE the webhook endpoint
// For webhooks, we need the raw body for signature verification
// We'll configure it conditionally for the webhook endpoint

// Parse JSON for all routes except webhook
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') {
    next(); // Skip JSON parsing for webhook
  } else {
    express.json()(req, res, next);
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors(corsOptions));

// Handle preflight requests
app.options("*", cors(corsOptions));

// ========================
// RECONCILIATION ENDPOINTS
// ========================
app.get("/api/reconciliation/stats", (req, res) => {
  const confirmed = cartReconciliation.filter(c => c.status === 'confirmed').length;
  const pending = cartReconciliation.filter(c => c.status === 'created').length;
  const failed = cartReconciliation.filter(c => c.status === 'failed').length;
  
  // Calculate average confirmation time
  const confirmedCarts = cartReconciliation.filter(c => c.status === 'confirmed' && c.createdAt && c.confirmedAt);
  let avgConfirmationTime = 0;
  
  if (confirmedCarts.length > 0) {
    const totalTime = confirmedCarts.reduce((sum, cart) => {
      const start = new Date(cart.createdAt);
      const end = new Date(cart.confirmedAt);
      return sum + (end - start);
    }, 0);
    
    avgConfirmationTime = totalTime / confirmedCarts.length;
  }
  
  // Find recent carts (last 24 hours)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentCarts = cartReconciliation.filter(c => 
    new Date(c.createdAt) > twentyFourHoursAgo
  );
  
  res.json({
    success: true,
    data: {
      total: cartReconciliation.length,
      confirmed,
      pending,
      failed,
      recent24h: recentCarts.length,
      confirmationRate: cartReconciliation.length > 0 ? ((confirmed / cartReconciliation.length) * 100).toFixed(2) + '%' : '0%',
      avgConfirmationTimeMs: Math.round(avgConfirmationTime),
      avgConfirmationTime: avgConfirmationTime > 0 ? timeDifference(new Date(0), new Date(avgConfirmationTime)) : 'N/A',
      bySource: {
        stripe: cartReconciliation.filter(c => c.source === 'stripe-checkout').length,
        paypal: cartReconciliation.filter(c => c.source === 'paypal-checkout').length,
        unknown: cartReconciliation.filter(c => !c.source || c.source === 'unknown').length
      }
    }
  });
});

app.get("/api/reconciliation/cart/:cartId", (req, res) => {
  const { cartId } = req.params;
  const cart = cartReconciliation.find(c => c.cartId === cartId);
  
  if (!cart) {
    return res.status(404).json({
      success: false,
      error: "Cart not found in reconciliation tracking"
    });
  }
  
  // Calculate time differences
  let timeToConfirmation = null;
  if (cart.createdAt && cart.confirmedAt) {
    const start = new Date(cart.createdAt);
    const end = new Date(cart.confirmedAt);
    timeToConfirmation = timeDifference(start, end);
  }
  
  res.json({
    success: true,
    data: {
      ...cart,
      timeToConfirmation,
      // Add additional calculated fields
      isRecent: new Date(cart.createdAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)
    }
  });
});

app.get("/api/reconciliation/info", (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const status = req.query.status; // 'created', 'confirmed', 'failed'
  const source = req.query.source; // 'stripe-checkout', 'paypal-checkout'
  
  let filteredCarts = [...cartReconciliation];
  
  // Apply filters
  if (status) {
    filteredCarts = filteredCarts.filter(c => c.status === status);
  }
  
  if (source) {
    filteredCarts = filteredCarts.filter(c => c.source === source);
  }
  
  // Sort by most recent first
  filteredCarts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  // Apply pagination
  const paginatedCarts = filteredCarts.slice(offset, offset + limit);
  
  res.json({
    success: true,
    data: {
      total: filteredCarts.length,
      limit,
      offset,
      hasMore: (offset + limit) < filteredCarts.length,
      carts: paginatedCarts.map(cart => ({
        cartId: cart.cartId,
        source: cart.source,
        status: cart.status,
        createdAt: cart.createdAt,
        confirmedAt: cart.confirmedAt,
        confirmedBy: cart.confirmedBy,
        metadata: {
          totalItems: cart.metadata?.totalItems || 0,
          email: cart.metadata?.email || 'not provided',
        },
        eventsCount: cart.events?.length || 0
      }))
    }
  });
});

// ========================
// STRIPE WEBHOOK ENDPOINT
// ========================
app.post("/api/stripe/webhook", express.raw({ type: 'application/json' }), async (req, res) => {
  console.log("🔔 Stripe Webhook Received!");
  
  const sig = req.headers['stripe-signature'];
  const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  try {
    // Try to construct the event from the payload and signature
    if (webhookSecret) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        console.log("✅ Webhook signature verified successfully");
      } catch (err) {
        console.error("❌ Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    } else {
      // If no webhook secret is configured, create a basic event object from the raw body
      console.warn("⚠️ STRIPE_WEBHOOK_SECRET not set - skipping signature verification");
      try {
        event = JSON.parse(req.body.toString());
      } catch (err) {
        console.error("❌ Failed to parse webhook body:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    }
    
    // Log the full event
    console.log("📋 Webhook Event Details:");
    console.log("- Event ID:", event.id || "N/A");
    console.log("- Event Type:", event.type || "N/A");
    console.log("- Created:", event.created ? new Date(event.created * 1000).toISOString() : "N/A");
    console.log("- Livemode:", event.livemode || false);
    
    // Handle specific event types
    if (event.type === 'checkout.session.completed') {
      console.log("🎉 checkout.session.completed event received!");
      
      const session = event.data.object;
      console.log("Session Details:");
      console.log("- Session ID:", session.id);
      console.log("- Payment Status:", session.payment_status);
      console.log("- Customer Email:", session.customer_email);
      console.log("- Amount Total:", session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : "N/A");
      console.log("- Currency:", session.currency?.toUpperCase());
      console.log("- Metadata:", session.metadata);
      
      // Check if metadata exists
      if (session.metadata) {
        console.log("Metadata Details:");
        console.log("  - cartId:", session.metadata.cartId || "N/A");
        console.log("  - priceIds:", session.metadata.priceIds || "N/A");
        
        // Track cart confirmation
        if (session.metadata.cartId) {
          trackCartConfirmation(
            session.metadata.cartId,
            'checkout.session.completed',
            {
              sessionId: session.id,
              paymentStatus: session.payment_status,
              amount: session.amount_total,
              currency: session.currency,
              customerEmail: session.customer_email,
              metadata: session.metadata,
              created: session.created
            }
          );
        }
      }
      
      console.log("✅ checkout.session.completed processed");
    }
    
    // Handle other event types
    else if (event.type === 'payment_intent.succeeded') {
      console.log("💰 payment_intent.succeeded event received");
      const paymentIntent = event.data.object;
      console.log("- Payment Intent ID:", paymentIntent.id);
      console.log("- Amount:", paymentIntent.amount ? `$${(paymentIntent.amount / 100).toFixed(2)}` : "N/A");
      console.log("- Customer:", paymentIntent.customer || "N/A");
      console.log("- Metadata:", paymentIntent.metadata);
      
      // Track cart confirmation via payment intent
      if (paymentIntent.metadata && paymentIntent.metadata.cartId) {
        trackCartConfirmation(
          paymentIntent.metadata.cartId,
          'payment_intent.succeeded',
          {
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            status: paymentIntent.status,
            metadata: paymentIntent.metadata,
            created: paymentIntent.created
          }
        );
      }
    }
    
    else if (event.type === 'payment_intent.payment_failed') {
      console.log("❌ payment_intent.payment_failed event received");
      const paymentIntent = event.data.object;
      console.log("- Payment Intent ID:", paymentIntent.id);
      console.log("- Last Payment Error:", paymentIntent.last_payment_error || "N/A");
      
      // Track payment failure
      if (paymentIntent.metadata && paymentIntent.metadata.cartId) {
        const cart = cartReconciliation.find(c => c.cartId === paymentIntent.metadata.cartId);
        if (cart) {
          cart.status = 'failed';
          cart.failedAt = new Date().toISOString();
          cart.failureReason = paymentIntent.last_payment_error?.message || 'Payment failed';
          console.log(`❌ Cart ${paymentIntent.metadata.cartId} payment failed`);
        }
      }
    }
    
    else {
      console.log(`ℹ️ Received unhandled event type: ${event.type}`);
    }
    
    // Return a response to acknowledge receipt of the event
    res.json({ received: true });
    
  } catch (err) {
    console.error("❌ Webhook processing error:", err.message);
    console.error(err.stack);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// ========================
// HEALTH & INFO ENDPOINTS
// ========================
app.get("/api/health", (req, res) => {
  const reconciliationStats = {
    totalCarts: cartReconciliation.length,
    confirmedCarts: cartReconciliation.filter(c => c.status === 'confirmed').length,
    pendingCarts: cartReconciliation.filter(c => c.status === 'created').length
  };
  
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      stripe: "active",
      paypal: config.PAYPAL_ENV,
      environment: process.env.NODE_ENV || "development",
      webhook: config.STRIPE_WEBHOOK_SECRET ? "configured" : "not configured"
    },
    reconciliation: reconciliationStats
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

    // Generate a cart ID for PayPal
    const paypalCartId = uuidv4();
    
    // Track PayPal cart creation
    trackCartCreation(paypalCartId, 'paypal-checkout', {
      items: items.map(item => ({
        priceId: item.priceId,
        quantity: item.quantity || 1
      })),
      totalItems: items.length
    });

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

    console.log(`PayPal ${config.PAYPAL_ENV} order created: ${paypalResponse.data.id}`);
    
    // Update cart tracking with PayPal order ID
    const cart = cartReconciliation.find(c => c.cartId === paypalCartId);
    if (cart) {
      cart.metadata.paypalOrderId = paypalResponse.data.id;
      cart.metadata.paypalOrderStatus = paypalResponse.data.status;
    }
    
    res.json({
      ...paypalResponse.data,
      cartId: paypalCartId
    });
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
    
    // Find and update cart reconciliation for PayPal
    const cart = cartReconciliation.find(c => c.metadata.paypalOrderId === orderId);
    if (cart) {
      trackCartConfirmation(
        cart.cartId,
        'paypal.order.captured',
        {
          paypalOrderId: orderId,
          status: response.data.status,
          payer: response.data.payer,
          purchase_units: response.data.purchase_units
        }
      );
    }
    
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
      data: products
    });
  } catch (error) {
    console.error("Stripe products error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch products",
      details: error.message
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
        error: "Product not found or inactive"
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
      data: product
    });
  } catch (error) {
    console.error("Stripe product error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch product",
      details: error.message
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
        error: "Invalid or missing items data"
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
      "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
      "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"
    ];
    const allowedCountries = ["GB", "US", "AU", "CA", ...europeanCountries];

    // Generate cart ID for this session
    const sessionCartId = uuidv4();
    
    // Track cart creation
    trackCartCreation(sessionCartId, 'stripe-checkout', {
      items: items.map(item => ({
        priceId: item.id,
        quantity: item.quantity
      })),
      email: email || 'not provided',
      totalItems: items.length
    });

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
        .map(id => ({ shipping_rate: id })),

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
    console.log(`ℹ️ Webhook will be sent to: ${config.DOMAIN}/api/stripe/webhook when payment is complete`);
    console.log(`📦 Cart ${sessionCartId} tracking initiated`);
    
    res.json({
      success: true,
      sessionId: session.id,
      cartId: sessionCartId,
      url: session.url,
      expiresAt: session.expires_at,
      paymentStatus: session.payment_status,
      metadata: session.metadata
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
        paymentIntent: session.payment_intent
      }
    });
  } catch (error) {
    console.error("Stripe session error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch session",
      details: error.message
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
        error: "Session ID is required"
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
        metadata: session.metadata
      }
    });
  } catch (error) {
    console.error("Stripe verify payment error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to verify payment",
      details: error.message
    });
  }
});

// ========================
// ROOT & ERROR HANDLING
// ========================
app.get("/", (req, res) => {
  const reconciliationStats = {
    total: cartReconciliation.length,
    confirmed: cartReconciliation.filter(c => c.status === 'confirmed').length,
    pending: cartReconciliation.filter(c => c.status === 'created').length
  };
  
  res.json({
    message: "Stripe & PayPal Integration API",
    version: "2.0",
    webhook: config.STRIPE_WEBHOOK_SECRET ? "active" : "not configured",
    reconciliation: reconciliationStats,
    endpoints: {
      stripe: {
        products: "GET /api/stripe/products",
        product: "GET /api/stripe/products/:priceId",
        createSession: "POST /api/stripe/create-session",
        getSession: "GET /api/stripe/sessions/:sessionId",
        verifyPayment: "POST /api/stripe/verify-payment",
        webhook: "POST /api/stripe/webhook"
      },
      paypal: {
        createOrder: "POST /api/paypal/create-order",
        captureOrder: "POST /api/paypal/capture-order/:orderId"
      },
      reconciliation: {
        all: "GET /api/reconciliation",
        stats: "GET /api/reconciliation/stats",
        byCartId: "GET /api/reconciliation/:cartId"
      },
      health: "GET /api/health",
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found"
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
  console.log(`✅ Success pages: ${config.DOMAIN}/success-s.php (Stripe) & ${config.DOMAIN}/success-pp.php (PayPal)`);
  console.log(`🔔 Stripe Webhook Endpoint: ${config.API_BASE_URL}/api/stripe/webhook`);
  console.log(`⚠️ Webhook Status: ${config.STRIPE_WEBHOOK_SECRET ? '✅ Configured' : '❌ Not configured - set STRIPE_WEBHOOK_SECRET env variable'}`);
  console.log(`📊 Reconciliation tracking enabled - track cart creation to confirmation`);
});

module.exports = app;
