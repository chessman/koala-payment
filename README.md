
# Koala Payment System

AWS Lambda handles three routes: /order, /callback, /notification.

  1. When Tilda initiates a payment, it sends a request to /order. In this route, a payment link in
     Montonio is created and the user is redirected to the URL.
  2. After the payment is completed, Montonio redirects to /callback. If the payment is successful,
     the callback redirects to the success Koala page, otherwise to the payment not done page.
  3. Montonio also sends a notification to /notification, which is proxied back to the Tilda's
     notification URL. Tilda updates the order status based on this message.

AWS Lambda reads the following parameters from the Parameter store:

| Parameter                 | Type         |
| --------------------------|--------------|
| TILDA\_NOTIFICATION\_URL  | String       |
| MONTONIO\_SANDBOX\_KEY    | String       |
| MONTONIO\_SANDBOX\_SECRET | String       |
| MONTONIO\_PROD\_KEY       | SecureString |
| MONTONIO\_PROD\_SECRET    | SecureString |
| TILDA\_SECRET             | SecureString |
