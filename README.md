# Stripe and PayPal backend

This is API that process shoping carts from Stripe and PayPal

Rename `.env.sample` to `.env`

Get API keys for Stripe and PayPal and put them in `.env`

Create a product in Stripe and put it's price id in `index.html`

Copy files `success-pp.php`, `success-s.php`, `cancel.php`, `index.html` and `.env` in web root folder such as `public_html/`

Create web hook in Stripe with events `checkout.session.completed`, `payment_intent.payment_failed` and `payment_intent.succeeded`

Run `composer install` to install dependancies in `vendor/` folder

Run `yarn` to install dependancies and then `yarn dev` to run Express API on <http://localhost:3000/api>

Open browser <http://localhost> and `index.html` will show 2 forms one for Stripe and PayPal.
