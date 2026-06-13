const https = require('https');
const url = 'https://script.google.com/macros/s/AKfycbxjJVOI-2VWN7EIKUwSeQA7b8XvJ9iGzf7cSKH0l_RdkRuJdgZhoA5ovAUMlHpDyt6F/exec';
const data = JSON.stringify({ action: 'sendResetOTP', email: 'ankitgaming23@gmail.com' });

const req = https.request(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'text/plain;charset=utf-8',
    'Content-Length': data.length
  }
}, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
  
  // Follow redirect
  if (res.statusCode === 302) {
    const redirectUrl = res.headers.location;
    console.log('Redirecting to: ' + redirectUrl);
    https.get(redirectUrl, (res2) => {
      let body = '';
      res2.on('data', chunk => body += chunk);
      res2.on('end', () => console.log('BODY:', body));
    });
  } else {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => console.log('BODY:', body));
  }
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
