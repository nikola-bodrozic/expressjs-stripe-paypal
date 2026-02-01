# Stripe and PayPal backend
Get API keys for Stripe and PayPal. Rename`.env.sample` to `.env` and polulate it w API keys.

Create a product in Stripe and put it's price id in `index.html`
Copy files `success-pp.php`, `success-s.php`, `cancel.php`, `index.html` and `.env` in web root folder.
Create web hook in Stripe with events checkout.session.completed, payment_intent.payment_failed and payment_intent.succeeded
Run `composer install` to install dependancies in `vendor/` folder

Run `yarn` to install dependancies and then `yarn start` to run Express API on <http://localhost:3000/api>

Open browser <http://localhost> and `index.html` will show 2 forms one for Stripe and PayPal.

Also replace price id in shell scripts bellow.

## Testing backend
Stripe
```sh
curl -X POST http://localhost:3000/api   -H "Content-Type: application/json"   -d '{
    "items": [
      {
        "id": "price_1StHDdD0voGcD5ZoTRCW3RrO",
        "quantity": 1
      }
    ],
    "email": "test@example.com"
  }'
```
output
```json
{"url":"https://checkout.stripe.com/c/pay/cs_test_b1gE5RIOufuJwwJP69BHgC4M9LoQdDE4RWVnpJPwcKGvmPFObhmzkY7Ya4#fidnandhYHdWcXxpYCc%2FJ2FgY2RwaXEnKSdkdWxOYHwnPyd1blpxYHZxWjA0VFEwMGlBNXNqQmZBMF9qPXRcZGREbEM8TW9VYEpySERDTWxvf1xAREN%2FXEdrVEFOT2ZgaEtKXFUzV1ZubzdvfWs1ckF0MWpiNTdxb208cD1dbWFGNlZHNTVvMXZUM1RoQicpJ2N3amhWYHdzYHcnP3F3cGApJ2dkZm5id2pwa2FGamlqdyc%2FJyZjY2NjY2MnKSdpZHxqcHFRfHVgJz8naHBpcWxabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"}
```
PayPal
```sh
curl -X POST http://localhost:3000/api/paypal/create-order \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"priceId": "price_1StHDdD0voGcD5ZoTRCW3RrO", "quantity": 1}
    ]
  }'
 ```
 output
 ```json
{"id":"75472425M6528630N","status":"CREATED","links":[{"href":"https://api.sandbox.paypal.com/v2/checkout/orders/75472425M6528630N","rel":"self","method":"GET"},{"href":"https://www.sandbox.paypal.com/checkoutnow?token=75472425M6528630N","rel":"approve","method":"GET"},{"href":"https://api.sandbox.paypal.com/v2/checkout/orders/75472425M6528630N","rel":"update","method":"PATCH"},{"href":"https://api.sandbox.paypal.com/v2/checkout/orders/75472425M6528630N/capture","rel":"capture","method":"POST"}]}
```
