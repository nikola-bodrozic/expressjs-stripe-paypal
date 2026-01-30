const express = require("express");
const axios = require("axios");
const app = express();
const cookieParser = require("cookie-parser");
const cors = require("cors");

app.use(cors({ origin: 'http://localhost:5173' })); 
app.use(express.json()); // Middleware to parse JSON data
app.use(express.urlencoded({ extended: true })); // Middleware to parse URL-encoded data
app.use(cookieParser()); // Middleware to parse cookies
require("dotenv").config();

const PORT = process.env.PORT
const APP_PREFIX = process.env.APP_PREFIX
const STRIPE_SEC_KEY = process.env.STRIPE_SEC_KEY

// Validate required environment variables
if (!STRIPE_SEC_KEY) {
  console.error("STRIPE_SEC_KEY is not set in environment variables");
  process.exit(1);
}

// Stripe API configuration
const stripeApi = axios.create({
  baseURL: 'https://api.stripe.com/v1',
  headers: {
    'Authorization': `Bearer ${STRIPE_SEC_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  }
});

// 1. Get all Stripe products with optional expand parameter
app.get(`${APP_PREFIX}/stripe/products`, async (req, res) => {
  try {
    const { expand, active, limit = 10 } = req.query;
    
    let url = '/products';
    const params = new URLSearchParams();
    
    if (active !== undefined) {
      params.append('active', active);
    }
    if (limit) {
      params.append('limit', limit);
    }
    if (expand) {
      params.append('expand[]', 'data.default_price');
    }
    
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
    
    const response = await stripeApi.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('Stripe API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch products from Stripe',
      details: error.response?.data || error.message 
    });
  }
});

// 2. Get a specific Stripe product by ID
app.get(`${APP_PREFIX}/stripe/products/:id`, async (req, res) => {
  try {
    const { id } = req.params;
    const { expand } = req.query;
    
    let url = `/products/${id}`;
    if (expand) {
      url += `?expand[]=default_price`;
    }
    
    const response = await stripeApi.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('Stripe API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 404).json({ 
      error: 'Product not found or error fetching product',
      details: error.response?.data || error.message 
    });
  }
});

// 3. Get Stripe products with prices expanded (convenience endpoint)
app.get(`${APP_PREFIX}/stripe/products-with-prices`, async (req, res) => {
  try {
    const { active, limit = 10 } = req.query;
    
    let url = '/products?expand[]=data.default_price';
    const params = new URLSearchParams();
    
    if (active !== undefined) {
      params.append('active', active);
    }
    if (limit) {
      params.append('limit', limit);
    }
    
    const queryString = params.toString();
    if (queryString) {
      url += `&${queryString}`;
    }
    
    const response = await stripeApi.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('Stripe API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch products with prices',
      details: error.response?.data || error.message 
    });
  }
});

// 4. Get Stripe prices
app.get(`${APP_PREFIX}/stripe/prices`, async (req, res) => {
  try {
    const { active, product, limit = 10 } = req.query;
    
    let url = '/prices';
    const params = new URLSearchParams();
    
    if (active !== undefined) {
      params.append('active', active);
    }
    if (product) {
      params.append('product', product);
    }
    if (limit) {
      params.append('limit', limit);
    }
    
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
    
    const response = await stripeApi.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('Stripe API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch prices from Stripe',
      details: error.response?.data || error.message 
    });
  }
});

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

    // Loop through Stripe prices (axios, sequential)
    for (const item of items) {
      const response = await axios.get(
        `https://api.stripe.com/v1/prices/${item.priceId}`,
        {
          auth: {
            username: process.env.STRIPE_SECRET_KEY,
            password: "",
          },
        }
      );

      const price = response.data;

      if (!price.unit_amount || !price.currency) {
        return res.status(400).json({ error: "Invalid Stripe price" });
      }

      const itemCurrency = price.currency.toUpperCase();

      if (!currency) {
        currency = itemCurrency;
      } else if (currency !== itemCurrency) {
        return res
          .status(400)
          .json({ error: "Mixed currencies are not allowed" });
      }

      const quantity = Number(item.quantity) || 1;
      totalCents += price.unit_amount * quantity;

      paypalItems.push({
        name: price.nickname || "Product",
        unit_amount: {
          currency_code: currency,
          value: (price.unit_amount / 100).toFixed(2),
        },
        quantity: quantity.toString(),
      });
    }

    const totalAmount = (totalCents / 100).toFixed(2);

    const accessToken = await getPayPalAccessToken();

    const paypalResponse = await axios.post(
      "https://api-m.sandbox.paypal.com/v2/checkout/orders",
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
          return_url: "https://example.com/return",
          cancel_url: "https://example.com/cancel",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json(paypalResponse.data);
  } catch (err) {
    console.error(
      "Create order error:",
      err.response?.data || err.message
    );
    res.status(500).json({ error: "Failed to create PayPal order" });
  }
});

// Start the server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
    console.log(`API endpoints are prefixed with: ${APP_PREFIX}`);
    console.log(`Stripe endpoints available under: ${APP_PREFIX}/stripe/`);
  });
}

module.exports = app;