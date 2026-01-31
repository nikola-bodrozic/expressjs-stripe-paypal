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
{"url":"https://checkout.stripe.com/c/pay/cs_test_b1gE5RIOufuJwwJP69BHgC4M9LoQdDE4RWVnpJPwcKGvmPFObhmzkY7Ya4#fidnandhYHdWcXxpYCc%2FJ2FgY2RwaXEnKSdkdWxOYHwnPyd1blpxYHZxWjA0VFEwMGlBNXNqQmZBMF9qPXRcZGREbEM8TW9VYEpySERDTWxvf1xAREN%2FXEdrVEFOT2ZgaEtKXFUzV1ZubzdvfWs1ckF0MWpiNTdxb208cD1dbWFGNlZHNTVvMXZUM1RoQicpJ2N3amhWYHdzYHcnP3F3cGApJ2dkZm5id2pwa2FGamlqdyc%2FJyZjY2NjY2MnKSdpZHxqcHFRfHVgJz8naHBpcWxabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"}
```
```sh
curl -X POST http://localhost:3000/api/paypal/create-order \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"priceId": "price_1StHDdD0voGcD5ZoTRCW3RrO", "quantity": 1}
    ]
  }'
{"id":"75472425M6528630N","status":"CREATED","links":[{"href":"https://api.sandbox.paypal.com/v2/checkout/orders/75472425M6528630N","rel":"self","method":"GET"},{"href":"https://www.sandbox.paypal.com/checkoutnow?token=75472425M6528630N","rel":"approve","method":"GET"},{"href":"https://api.sandbox.paypal.com/v2/checkout/orders/75472425M6528630N","rel":"update","method":"PATCH"},{"href":"https://api.sandbox.paypal.com/v2/checkout/orders/75472425M6528630N/capture","rel":"capture","method":"POST"}]}
```
