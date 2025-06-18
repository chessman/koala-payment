import querystring from 'querystring';
import jwt from 'jsonwebtoken';
import axios from "axios";
import crypto from "crypto"
import AWS from "aws-sdk"

const ssm = new AWS.SSM();

function orderSignature(order, secret) {
    return crypto.createHash('sha256')
                 .update(order.amount + "|" + order.merchant_reference + "|" + secret)
                 .digest('hex');
}

function notificationSignature(notification, secret) {
    return crypto.createHash('sha256')
        .update(notification.uuid + "|" + notification["merchant_reference"] + "|" + notification.status + "|" + secret)
        .digest('hex');
}

async function getParameterSecret(name) {
    const { Parameter } = await ssm.getParameter({
      Name: name,
      WithDecryption: true
    }).promise();

    return Parameter.Value;
}

async function getParameterString(name) {
    const { Parameter } = await ssm.getParameter({
      Name: name
    }).promise();

    return Parameter.Value;
}

async function orderHandler(event) {
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
    const parsedBody = querystring.parse(rawBody);
    console.log('parsedBody', parsedBody);

    const tildaSecret = await getParameterSecret('TILDA_SECRET')

    if (orderSignature(parsedBody, tildaSecret) != parsedBody.signature) {
        return { 
            statusCode: 400,
            body: "Wrong signature"
        };
    }

    var key;
    var secret;
    var montonioUrl;
    if (parsedBody['test_mode_'] == 'true') {
        console.log('SANDBOX mode')
        key = await getParameterString('MONTONIO_SANDBOX_KEY')
        secret = await getParameterString('MONTONIO_SANDBOX_SECRET')
        montonioUrl = 'https://sandbox-stargate.montonio.com/api'
    } else {
        console.log('PROD mode')
        key = await getParameterSecret('MONTONIO_PROD_KEY')
        secret = await getParameterSecret('MONTONIO_PROD_SECRET')
        montonioUrl = 'https://stargate.montonio.com/api'
    }

    const notificationUrl = parsedBody['merchant_return_url'].replace('callback', 'notification')

    const payload = {
        "accessKey": key,
        "description": parsedBody['payment_information_unstructured'],
        "currency": parsedBody['currency'],
        "amount": parseFloat(parsedBody['amount']),
        "locale": parsedBody['lang_'],
        "expiresAt": new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        "type": 'one_time',
        "merchantReference": parsedBody['merchant_reference'],
        "returnUrl": parsedBody['merchant_return_url'],
        "notificationUrl": notificationUrl,
        "askAdditionalInfo": false
    };

    console.log('payload', payload);

    const token = jwt.sign(
        payload, 
        secret,
        { algorithm: 'HS256', expiresIn: "10m" }
    );

    var response = await axios
        .post(montonioUrl + "/payment-links", {
            data: token,
        })
    
    console.log(response);
    const { data } = response;

    return { 
        statusCode: 301,
        headers: {
            Location: data.url
        }
    };
}

async function decodeToken(token) {
    const decoded = jwt.decode(token)
    const sandboxKey = await getParameterString("MONTONIO_SANDBOX_KEY")

    if (decoded.accessKey == sandboxKey) {
        return jwt.verify(token, await getParameterString('MONTONIO_SANDBOX_SECRET'))
    }

    return jwt.verify(token, await getParameterSecret('MONTONIO_PROD_SECRET'))
}

async function callbackHandler(event) {
    const orderToken = event.queryStringParameters["order-token"]
    console.log('orderToken', orderToken);

    const decoded = await decodeToken(orderToken); 

    console.log(decoded)

    const redirectUrl = (decoded.paymentStatus == 'PAID') ? "https://www.koalatallinn.ee/success" : 'https://koala.tilda.ws/payment-not-done';

    return { 
        statusCode: 301,
        headers: {
            Location: redirectUrl
        }
    };
}

async function notificationHandler(event) {
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
    const { orderToken } = JSON.parse(rawBody)

    console.log('orderToken', orderToken);

    const decoded = await decodeToken(orderToken); 

    console.log(decoded)

    const notification = {
        "uuid": decoded.uuid,
        "merchant_reference": decoded["merchantReferenceDisplay"],
        "status": decoded.paymentStatus,
        "amount": decoded.grandTotal.toString()
    }

    const tildaSecret = await getParameterSecret('TILDA_SECRET')

    notification.signature = notificationSignature(notification, tildaSecret)
    console.log(notification)

    // notify tilda about the payment
    const resp = await axios.post('https://forms.tildacdn.com/payment/custom/ps347320', notification);
    console.log(resp)

    return { 
        statusCode: 200
    };
}

export const handler = async (event) => {
    console.log('event', event);

    if (event.rawPath == '/default/order') {
        return orderHandler(event)
    } else if (event.rawPath.startsWith('/default/callback')) {
        return callbackHandler(event)
    } else if (event.rawPath.startsWith('/default/notification')) {
        return notificationHandler(event)
    }
};
